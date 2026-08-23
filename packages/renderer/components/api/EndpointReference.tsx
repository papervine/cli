import clsx from "clsx";
import {
  apiOperations,
  sampleAuth,
  sampleFromSchema,
  type Operation,
  type Param,
  type Schema,
} from "../../lib/openapi";
import { defaultAuthChoice } from "../../lib/try-it-credentials";
import { shellQuote } from "../../lib/shell-quote";
import { methodColor } from "../../lib/method-colors";
import { highlightToHtml } from "../../lib/highlight";
import { ApiField, FieldSection } from "../mdx/ApiField";
import { Expandable } from "../mdx/Expandable";
import { ApiPlayground, type CodeSample, type ResponseExample } from "./ApiPlayground";
import { ApiTryItModal, type TryItAuth, type TryItParam, type TryItSibling } from "./ApiTryItModal";

function typeLabel(schema?: Schema): string | undefined {
  if (!schema) return undefined;
  if (Array.isArray(schema.enum)) return schema.enum.map(String).join(" · ");
  const type = schema.type as string | undefined;
  if (type === "array") {
    const items = schema.items as Schema | undefined;
    return `${typeLabel(items) ?? "any"}[]`;
  }
  if (schema.format) return `${type}<${schema.format}>`;
  return type;
}

function nestedSchema(schema?: Schema): Schema | undefined {
  if (!schema) return undefined;
  if (schema.type === "object" && schema.properties) return schema;
  if (schema.type === "array") {
    const items = schema.items as Schema | undefined;
    if (items?.type === "object" && items.properties) return items;
  }
  return undefined;
}

function SchemaFields({ schema }: { schema?: Schema }) {
  const properties = schema?.properties as Record<string, Schema> | undefined;
  if (!properties) return null;
  const required = new Set((schema?.required as string[]) ?? []);

  return (
    <>
      {Object.entries(properties).map(([name, prop]) => {
        const child = nestedSchema(prop);
        return (
          <ApiField
            key={name}
            name={name}
            type={typeLabel(prop)}
            required={required.has(name)}
            deprecated={prop.deprecated as boolean | undefined}
            defaultValue={prop.default !== undefined ? JSON.stringify(prop.default) : undefined}
          >
            {typeof prop.description === "string" && <p>{prop.description}</p>}
            {child && (
              <Expandable title="child attributes">
                <SchemaFields schema={child} />
              </Expandable>
            )}
          </ApiField>
        );
      })}
    </>
  );
}

// ---- Request code samples (cURL / JavaScript / Python) ----
// Generated from the spec and Shiki-highlighted server-side, then handed to the client
// playground as HTML. Credentials show as placeholders.

/** Placeholder auth for the samples, from the operation's first `security` alternative — the same
 *  one the playground preselects. A spec can *also* document auth as an explicit `Authorization`
 *  header parameter; that's added too (unless a security scheme already claimed the header), since
 *  dropping a header the spec documents as required leaves a sample that doesn't work. */
function sampleAuthFor(op: Operation): { headers: [string, string][]; query: [string, string][] } {
  const resolved = sampleAuth(op.auth[defaultAuthChoice(op.auth)] ?? []);
  const authParam = op.parameters.find((x) => x.in === "header" && /authorization/i.test(x.name));
  // Match on the parameter's own name, not the substring that found it: a spec documenting
  // `X-Authorization-Token` gets that header, not a hard-coded `Authorization` it never declared.
  const alreadySet = resolved.headers.some(
    ([name]) => name.toLowerCase() === authParam?.name.toLowerCase(),
  );
  if (authParam && !alreadySet) {
    return { ...resolved, headers: [...resolved.headers, [authParam.name, "Bearer <token>"]] };
  }
  return resolved;
}

/** The sample's URL, carrying any auth that belongs in the query string. */
function sampleUrl(op: Operation): string {
  const { query } = sampleAuthFor(op);
  const qs = query.map(([k, v]) => `${k}=${v}`).join("&");
  return `${op.baseUrl}${op.path}${qs ? `?${qs}` : ""}`;
}

// The Accept header the operation expects, from what it `produces` (preferring JSON). Many APIs
// 406 / return HTML without it. Skip when the spec already declares its own Accept parameter.
function acceptHeader(op: Operation): string | undefined {
  if (op.parameters.some((x) => x.in === "header" && /^accept$/i.test(x.name))) return undefined;
  return op.produces.includes("application/json") ? "application/json" : op.produces[0];
}

function bodyObject(op: Operation): unknown | undefined {
  return op.requestBody ? sampleFromSchema(op.requestBody) : undefined;
}

function curlSample(op: Operation): string {
  const url = sampleUrl(op);
  const body = bodyObject(op);
  const accept = acceptHeader(op);
  // Shell-quoted: these samples are meant to be pasted into a terminal, where an unquoted `?`/`&`
  // (two query parameters) backgrounds the command and a `<key>` placeholder is a redirect.
  const parts = [`curl -X ${op.method} ${shellQuote(url)}`];
  for (const [name, value] of sampleAuthFor(op).headers)
    parts.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
  if (accept) parts.push(`  -H ${shellQuote(`Accept: ${accept}`)}`);
  if (body !== undefined) {
    parts.push(`  -H 'Content-Type: application/json'`);
    // The body carries spec-authored strings (`example: "O'Brien"`), so it needs quoting too.
    parts.push(`  -d ${shellQuote(JSON.stringify(body, null, 2))}`);
  }
  return parts.join(" \\\n");
}

function jsSample(op: Operation): string {
  const url = sampleUrl(op);
  const body = bodyObject(op);
  const accept = acceptHeader(op);
  // JSON.stringify, not bare quotes: header names come from the spec's `securitySchemes[…].name`
  // and the URL from its `servers`, either of which can contain a quote or a backslash.
  const headers: string[] = sampleAuthFor(op).headers.map(
    ([name, value]) => `    ${JSON.stringify(name)}: ${JSON.stringify(value)},`,
  );
  if (accept) headers.push(`    "Accept": ${JSON.stringify(accept)},`);
  if (body !== undefined) headers.push(`    "Content-Type": "application/json",`);
  const opts = [`  method: "${op.method}",`];
  if (headers.length) opts.push(`  headers: {\n${headers.join("\n")}\n  },`);
  if (body !== undefined) opts.push(`  body: JSON.stringify(${JSON.stringify(body, null, 2)}),`);
  return (
    `const response = await fetch(${JSON.stringify(url)}, {\n${opts.join("\n")}\n});\n` +
    `const data = await response.json();`
  );
}

function pythonSample(op: Operation): string {
  const url = sampleUrl(op);
  const accept = acceptHeader(op);
  const body = bodyObject(op);
  const args = [`    ${JSON.stringify(url)},`];
  const hdrs: string[] = sampleAuthFor(op).headers.map(
    ([name, value]) => `${JSON.stringify(name)}: ${JSON.stringify(value)}`,
  );
  if (accept) hdrs.push(`"Accept": ${JSON.stringify(accept)}`);
  if (hdrs.length) args.push(`    headers={${hdrs.join(", ")}},`);
  if (body !== undefined) args.push(`    json=${JSON.stringify(body, null, 2)},`);
  return (
    `import requests\n\n` +
    `response = requests.${op.method.toLowerCase()}(\n${args.join("\n")}\n)\n` +
    `print(response.json())`
  );
}

/** A playground field holds text, so only a scalar example can prefill one — `String()` on an
 *  object writes "[object Object]" into the field and then sends it. */
function scalarExample(value: unknown): string | undefined {
  const t = typeof value;
  return t === "string" || t === "number" || t === "boolean" ? String(value) : undefined;
}

function paramExample(p: Param): string | undefined {
  const s = p.schema;
  if (!s) return undefined;
  if (s.example !== undefined) return scalarExample(s.example);
  // 3.0's `example` arrives here as 3.1's `examples: [x]` — see the note in `sampleFromSchema`.
  if (Array.isArray(s.examples) && s.examples.length > 0) return scalarExample(s.examples[0]);
  if (Array.isArray(s.enum) && s.enum.length) return scalarExample(s.enum[0]);
  return undefined;
}

export async function EndpointReference({
  op,
  baseUrl,
  siteBase = "",
}: {
  op: Operation;
  baseUrl: string;
  // The tenant's URL base (`/sites/{slug}` in apex path mode) — the operation switcher's links
  // need it like every other internal link. Empty on a tenant's own host.
  siteBase?: string;
}) {
  const groups: { title: string; params: typeof op.parameters }[] = [
    { title: "Path parameters", params: op.parameters.filter((p) => p.in === "path") },
    { title: "Query parameters", params: op.parameters.filter((p) => p.in === "query") },
    { title: "Headers", params: op.parameters.filter((p) => p.in === "header") },
    { title: "Cookie parameters", params: op.parameters.filter((p) => p.in === "cookie") },
  ];

  // Request samples (highlighted server-side) + response examples per status.
  const samples: CodeSample[] = await Promise.all(
    (
      [
        { label: "cURL", code: curlSample(op), lang: "bash" as const },
        { label: "JavaScript", code: jsSample(op), lang: "javascript" as const },
        { label: "Python", code: pythonSample(op), lang: "python" as const },
      ]
    ).map(async (s) => ({ label: s.label, html: await highlightToHtml(s.code, s.lang) })),
  );

  // One response tab per documented status (2xx first); each is a Shiki-highlighted JSON sample.
  const ordered = [...op.responses].sort((a, b) =>
    a.status.startsWith("2") === b.status.startsWith("2") ? 0 : a.status.startsWith("2") ? -1 : 1,
  );
  const responses: ResponseExample[] = await Promise.all(
    (ordered.length ? ordered : [{ status: "200", schema: undefined as Schema | undefined }]).map(
      async (r) => ({
        status: r.status,
        html: await highlightToHtml(
          r.schema ? JSON.stringify(sampleFromSchema(r.schema), null, 2) : "{}",
          "json",
        ),
      }),
    ),
  );

  const tryItParams: TryItParam[] = op.parameters.map((p) => ({
    name: p.name,
    in: p.in,
    required: p.required,
    example: paramExample(p),
    type: typeLabel(p.schema),
    description: p.description,
  }));
  // Seed an Accept header from what the operation produces (preferring JSON) — many APIs return
  // 406 / HTML without it, yet specs rarely declare it as an explicit parameter. Shown pre-filled
  // + editable in the Headers section and sent with the request. Skip if the spec already declares
  // its own Accept header, or the operation declares no response media type.
  const accept = op.produces.includes("application/json")
    ? "application/json"
    : op.produces[0];
  if (accept && !tryItParams.some((p) => p.in === "header" && /^accept$/i.test(p.name))) {
    tryItParams.push({
      name: "Accept",
      in: "header",
      required: false,
      example: accept,
      type: "string",
      description: "Response media type to request.",
    });
  }
  // One entry per `security` alternative (the reader picks); each holds the schemes that
  // alternative ANDs together.
  const tryItAuth: TryItAuth[][] = op.auth.map((option) =>
    option.map((a) => ({
      key: a.key,
      type: a.type,
      in: a.in,
      name: a.name,
      format: a.format,
      description: a.description,
    })),
  );
  const bodySample =
    op.requestBody !== undefined
      ? JSON.stringify(sampleFromSchema(op.requestBody), null, 2)
      : undefined;
  const ok = op.responses.find((r) => r.status.startsWith("2")) ?? op.responses[0];

  // Sibling operations on the same spec feed the modal's operation switcher.
  const siblings: TryItSibling[] = (await apiOperations(op.specPath))
    .filter((o) => o.slug !== op.slug)
    .map((o) => ({ slug: o.slug, method: o.method, summary: o.summary ?? `${o.method} ${o.path}` }));

  const tryItProps = {
    method: op.method,
    baseUrl,
    path: op.path,
    summary: op.summary ?? `${op.method} ${op.path}`,
    params: tryItParams,
    auth: tryItAuth,
    bodySample,
    siblings,
    specPath: op.specPath,
    siteBase,
  };

  return (
    <>
      <article className="prose min-w-0 flex-1">
        {op.tag && <div className="mb-2 text-sm font-semibold text-primary">{op.tag}</div>}
        <h1 className="!mb-3">{op.summary ?? `${op.method} ${op.path}`}</h1>

        {/* Endpoint bar: method + full URL + the Try it trigger (opens the modal playground) */}
        <div className="not-prose mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 p-2 dark:border-zinc-800">
          <span className={clsx("rounded-md px-2 py-1 text-xs font-bold", methodColor(op.method))}>
            {op.method}
          </span>
          <code className="min-w-0 flex-1 truncate text-sm text-zinc-600 dark:text-zinc-300">
            {baseUrl}
            {op.path}
          </code>
          {/* Keyed by operation: the App Router remounts this subtree on navigation today, which
              is what resets one endpoint's inputs before the next. The key makes that structural
              rather than observed — it's constant within a page, so closing and reopening the
              playground still keeps what you typed. */}
          <ApiTryItModal key={op.slug} {...tryItProps} />
        </div>

        {op.description && <p className="text-zinc-600 dark:text-zinc-400">{op.description}</p>}

        {groups.map(
          (g) =>
            g.params.length > 0 && (
              <FieldSection key={g.title} title={g.title}>
                {g.params.map((p) => (
                  <ApiField
                    key={p.name}
                    name={p.name}
                    type={typeLabel(p.schema)}
                    required={p.required}
                  >
                    {p.description && <p>{p.description}</p>}
                  </ApiField>
                ))}
              </FieldSection>
            ),
        )}

        {op.requestBody && (
          <FieldSection title="Body">
            <SchemaFields schema={op.requestBody} />
          </FieldSection>
        )}

        {ok?.schema && (
          <FieldSection title="Response">
            <SchemaFields schema={ok.schema} />
          </FieldSection>
        )}
      </article>

      {/* Sticky right column: read-only language-tabbed request + response tabs (hosted docs platforms layout) */}
      <aside className="hidden w-[26rem] shrink-0 lg:block">
        <div className="sticky top-24">
          <ApiPlayground samples={samples} responses={responses} />
        </div>
      </aside>
    </>
  );
}
