/**
 * Classifying what a page asks the *server* to execute (SPEC §10.6, the MDX execution model).
 *
 * The renderer's rule is that the server renders **data** — markdown, our own built-in
 * components, and literal expressions — while anything that is author *logic* is evaluated in
 * the visitor's browser instead. That is what makes server-side RCE impossible by construction
 * rather than by containment: an MDX expression is real JavaScript, and evaluating it in the
 * process that holds `DATABASE_URL` is how `{process.env.DATABASE_URL}` came to render a live
 * connection string into a page.
 *
 * This module is the pure decision layer for that split. It answers two questions about a page:
 *
 *  1. **Must this go to the client?** True as soon as the page defines any author binding
 *     (`export const …`) or uses any non-literal expression. A literal needs no evaluator —
 *     `cols={2}` is a value, not a computation — so pages made only of literals keep the fast
 *     server path, which is essentially all real content.
 *  2. **Does it break the component contract?** A small allowlist, matching what upstream
 *     documents: named arrow-function exports and `/snippets/` imports only. `export default`,
 *     `function` declarations, npm/relative imports and dynamic `import()` are refused, and the
 *     page degrades to a notice instead of rendering.
 *
 * Kept free of remark/React so it can be unit-tested directly on ESTree, the same way
 * `parseCodeTitle` is.
 */

/** A node of the ESTree the MDX parser hangs off `node.data.estree`. */
type EsNode = { type: string; [key: string]: unknown };

export type AuthorCodeViolation = {
  kind:
    | "default-export"
    | "function-declaration"
    | "external-import"
    | "dynamic-import"
    | "unsupported-statement";
  detail: string;
};

export type AuthorCodeReport = {
  /** Names bound by `export const …` — the page's author-defined components and values. */
  bindings: string[];
  /** True when the page contains anything the server must not evaluate. */
  hasAuthorCode: boolean;
  /** Contract breaks. A page with any of these degrades rather than rendering. */
  violations: AuthorCodeViolation[];
};

/** The only import source an author may reach for. */
const SNIPPET_PREFIX = "/snippets/";

/** Walk every nested ESTree node, in document order. */
function walkEs(node: unknown, visit: (n: EsNode) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkEs(child, visit);
    return;
  }
  const candidate = node as EsNode;
  if (typeof candidate.type === "string") visit(candidate);
  for (const [key, value] of Object.entries(candidate)) {
    // `data` carries positional metadata, not syntax; skip it so we don't walk the whole file.
    if (key === "loc" || key === "range" || key === "data") continue;
    walkEs(value, visit);
  }
}

/**
 * Is this expression made only of literal values?
 *
 * Deliberately an allowlist. A denylist of dangerous forms is a game you lose — the goal is that
 * anything not *provably* inert goes to the client, so an unrecognised node type is a "no".
 */
export function isLiteralExpression(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const n = node as EsNode;
  switch (n.type) {
    case "Literal":
      return true;
    // A template with no `${…}` is just a string spelled with backticks.
    case "TemplateLiteral":
      return Array.isArray(n.expressions) && n.expressions.length === 0;
    // Negative and positive numbers parse as a unary operator over a literal.
    case "UnaryExpression":
      return (
        (n.operator === "-" || n.operator === "+") && isLiteralExpression(n.argument)
      );
    case "ArrayExpression":
      return (
        Array.isArray(n.elements) &&
        n.elements.every((el) => el === null || isLiteralExpression(el))
      );
    case "ObjectExpression":
      return (
        Array.isArray(n.properties) &&
        n.properties.every((raw) => {
          const p = raw as EsNode;
          if (p.type !== "Property" || p.computed) return false;
          const key = p.key as EsNode | undefined;
          const keyOk = key?.type === "Identifier" || key?.type === "Literal";
          return keyOk && isLiteralExpression(p.value);
        })
      );
    default:
      return false;
  }
}

/**
 * Verdict for one `{…}` expression (a body expression or a JSX attribute value).
 *
 * An expression whose program has no statements is a comment — `{/* … *\/}` — which carries no
 * computation and stays on the server.
 */
export function isServerSafeExpression(estree: unknown): boolean {
  if (!estree || typeof estree !== "object") return true;
  const body = (estree as { body?: unknown[] }).body;
  if (!Array.isArray(body) || body.length === 0) return true;
  if (body.length > 1) return false;
  const stmt = body[0] as EsNode;
  if (stmt.type !== "ExpressionStatement") return false;
  return isLiteralExpression(stmt.expression);
}

/**
 * Verdict for one ESM block (`import` / `export` in MDX).
 *
 * Returns the names it binds plus any contract breaks. Note a *snippet import* is allowed and
 * does not by itself make a page author code — resolving it is a separate concern (GAP-REPORT);
 * what matters here is that the import surface stays closed.
 */
export function inspectEsm(estree: unknown): {
  bindings: string[];
  violations: AuthorCodeViolation[];
} {
  const bindings: string[] = [];
  const violations: AuthorCodeViolation[] = [];
  const body = (estree as { body?: unknown[] } | null)?.body;
  if (!Array.isArray(body)) return { bindings, violations };

  for (const raw of body) {
    const stmt = raw as EsNode;
    switch (stmt.type) {
      case "ImportDeclaration": {
        const source = (stmt.source as EsNode | undefined)?.value;
        if (typeof source !== "string" || !source.startsWith(SNIPPET_PREFIX)) {
          violations.push({
            kind: "external-import",
            detail: `import from ${JSON.stringify(source ?? "?")} — only ${SNIPPET_PREFIX}* imports are supported`,
          });
        }
        break;
      }
      case "ExportDefaultDeclaration":
        violations.push({
          kind: "default-export",
          detail: "export default — use a named export (`export const Name = () => …`)",
        });
        break;
      case "ExportNamedDeclaration": {
        const decl = stmt.declaration as EsNode | undefined;
        if (!decl) {
          // `export { a, b }` — a re-export of bindings, with no declaration to inspect.
          violations.push({
            kind: "unsupported-statement",
            detail: "export { … } — declare and export in one statement instead",
          });
          break;
        }
        if (decl.type === "FunctionDeclaration") {
          violations.push({
            kind: "function-declaration",
            detail: "exported `function` — use an arrow function (`export const Name = () => …`)",
          });
          break;
        }
        if (decl.type === "VariableDeclaration") {
          for (const d of (decl.declarations as EsNode[] | undefined) ?? []) {
            const id = d.id as EsNode | undefined;
            if (id?.type === "Identifier" && typeof id.name === "string") {
              bindings.push(id.name);
            }
          }
          break;
        }
        violations.push({
          kind: "unsupported-statement",
          detail: `export of ${decl.type} is not supported`,
        });
        break;
      }
      case "FunctionDeclaration":
        violations.push({
          kind: "function-declaration",
          detail: "`function` declaration — use an arrow function (`const Name = () => …`)",
        });
        break;
      default:
        violations.push({
          kind: "unsupported-statement",
          detail: `${stmt.type} is not supported in MDX`,
        });
    }
  }
  return { bindings, violations };
}

/** Dynamic `import()` anywhere in an ESTree — refused, so the module graph stays closed. */
export function findDynamicImports(estree: unknown): AuthorCodeViolation[] {
  const out: AuthorCodeViolation[] = [];
  walkEs(estree, (n) => {
    if (n.type === "ImportExpression") {
      out.push({
        kind: "dynamic-import",
        detail: "dynamic import() — all code must be reachable without a runtime resolver",
      });
    }
  });
  return out;
}

/** An empty report — the starting point a collector accumulates into. */
export function emptyReport(): AuthorCodeReport {
  return { bindings: [], hasAuthorCode: false, violations: [] };
}
