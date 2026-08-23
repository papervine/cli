import "server-only";
import { cache } from "react";
import { dereference, upgrade } from "@scalar/openapi-parser";
import type { DocsConfig } from "./config";
import { loadRaw } from "./content";

/**
 * OpenAPI → endpoint pages (SPEC §7, hosted docs platforms model). A `docs.json` nav division
 * with an `openapi` property auto-generates one in-nav, in-theme page per operation.
 * We use Scalar's MIT parser to load + dereference the spec; rendering is ours.
 *
 * The spec is read through the active `ContentSource` (`loadRaw`), NOT a direct
 * `fs.readFile` — so it resolves the same for a local `papervine dev` preview (fsSource →
 * disk) and a synced tenant (s3Source → storage). Reading the filesystem directly only ever
 * worked for the former, which is why OpenAPI silently failed for connected tenant sites.
 */

// Minimal shapes we read off the dereferenced spec (it's fully resolved JSON).
export type Schema = Record<string, unknown>;
export type Param = {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: Schema;
};
// A resolved security requirement for an operation (from `components.securitySchemes` + the
// operation's `security`, falling back to the root `security`). The Try-it playground turns each
// into the right input(s): basic → username + password, bearer/oauth2 → a token, apiKey → a
// single header/query value. This is how the playground "encompasses" auth, not just params.
export type AuthScheme = {
  key: string; // the scheme's name in components.securitySchemes
  type: "basic" | "bearer" | "apiKey" | "oauth2" | "other";
  in?: "header" | "query" | "cookie"; // apiKey location
  name?: string; // apiKey header/query name
  format?: string; // http bearerFormat, e.g. JWT — shown as a hint on the token field
  description?: string;
};
/**
 * The alternatives that satisfy an operation: **outer array is OR, inner is AND** — exactly what
 * OpenAPI's `security` list means. `[{BasicAuth: []}, {BearerAuth: []}]` is "either works" and
 * resolves to two options; `[{BasicAuth: [], BearerAuth: []}]` is "send both" and resolves to one
 * option holding two schemes. An empty inner array is a legal "no auth needed" alternative
 * (`security: [{}]`).
 *
 * We used to read only the first requirement, which meant a spec offering Basic *or* Bearer showed
 * only Basic and silently dropped the other — so the playground now carries every alternative and
 * lets the reader pick one.
 */
export type AuthOptions = AuthScheme[][];
export type Operation = {
  slug: string; // URL slug for the generated page
  method: string; // GET, POST, …
  path: string; // /users/{id}
  summary?: string;
  description?: string;
  deprecated?: boolean;
  tag?: string;
  parameters: Param[];
  requestBody?: Schema;
  responses: { status: string; description?: string; schema?: Schema }[];
  // Response media types the operation can return (the keys under each response's `content`),
  // deduped. Drives the "Try it" Accept header — many APIs 406/return HTML without it.
  produces: string[];
  auth: AuthOptions;
  baseUrl: string;
  specPath: string;
};

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

function kebab(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/** Stable, readable slug for an operation: operationId if present, else method+path. */
function operationSlug(method: string, p: string, op: Record<string, unknown>): string {
  if (typeof op.operationId === "string" && op.operationId) return kebab(op.operationId);
  return kebab(`${method}-${p}`);
}

/** One `components.securitySchemes` entry → the playground's input model. */
function resolveScheme(s: Record<string, unknown> | undefined, key: string): AuthScheme[] {
  if (!s) return [];
  const type = s.type as string;
  const scheme = (s.scheme as string | undefined)?.toLowerCase();
  const description = s.description as string | undefined;
  if (type === "http" && scheme === "basic") return [{ key, type: "basic", description }];
  if (type === "http")
    return [{ key, type: "bearer", format: s.bearerFormat as string | undefined, description }];
  if (type === "apiKey")
    return [
      {
        key,
        type: "apiKey",
        in: (s.in as AuthScheme["in"]) ?? "header",
        name: (s.name as string) ?? key,
        description,
      },
    ];
  if (type === "oauth2" || type === "openIdConnect") return [{ key, type: "oauth2", description }];
  return [{ key, type: "other", description }];
}

/**
 * What the request carries for an auth alternative, with the credential itself elided — for the
 * read-only cURL/JS/Python samples on the page. The interactive playground builds the same shapes
 * from real input (`ApiTryItModal`), so a spec that declares auth gets a sample that shows it,
 * rather than an unauthenticated snippet beside a playground sending `Authorization: Basic …`.
 *
 * They agree on *shape*, not always on *which* alternative: these samples are server-rendered from
 * the operation's first credential-bearing alternative, while the playground restores whichever one
 * the reader last picked. A reader who chose Bearer sees a Basic sample beside a Bearer playground
 * — inherent to rendering the sample on the server, and the picker above it says which is live.
 */
export function sampleAuth(schemes: AuthScheme[]): {
  headers: [string, string][];
  query: [string, string][];
} {
  // One name, one value: an AND requirement combining two Authorization-header schemes can't send
  // both, and emitting the header twice would print a duplicate `-H` (and a duplicate key in the
  // JavaScript object literal). Later scheme wins, matching how the playground folds them in — the
  // playground also flags the collision to the reader.
  const headers = new Map<string, string>();
  const query: [string, string][] = [];
  // Cookies accumulate rather than overwrite: one `Cookie` header carries them all, and a spec
  // pairing a session cookie with a CSRF cookie is ordinary.
  const cookies: string[] = [];
  for (const s of schemes) {
    if (s.type === "basic") headers.set("Authorization", "Basic <credentials>");
    else if (s.type === "apiKey") {
      const name = s.name ?? s.key;
      if (s.in === "query") query.push([name, "<key>"]);
      // A cookie-located key is `Cookie: name=value`, not a header named after the cookie —
      // emitting the latter produces a snippet that 401s when pasted.
      else if (s.in === "cookie") cookies.push(`${name}=<key>`);
      else headers.set(name, "<key>");
    } else headers.set("Authorization", `Bearer <${s.format?.toLowerCase() ?? "token"}>`);
  }
  if (cookies.length) headers.set("Cookie", cookies.join("; "));
  return { headers: [...headers], query };
}

/** Load, upgrade (2.0→3), and dereference a spec. Cached per spec path. Reads through the
 *  active ContentSource so it works for both filesystem previews and synced tenants. */
const loadSpec = cache(async (specPath: string): Promise<Schema | null> => {
  const raw = await loadRaw(specPath);
  if (raw === null) return null;
  const parsed = raw.trimStart().startsWith("{") ? JSON.parse(raw) : raw;
  const upgraded = upgrade(parsed);
  const { schema } = await dereference(upgraded.specification ?? parsed);
  return (schema as Schema) ?? null;
});

/** Resolve an operation's security requirements into the auth inputs the playground renders.
 *  Reads `components.securitySchemes`, preferring the op's `security` over the spec root's.
 *  Every alternative is kept — see `AuthOptions` for what the nesting means. */
function resolveAuth(schema: Schema | null, op: Record<string, unknown>): AuthOptions {
  const schemes = (schema?.components as { securitySchemes?: Record<string, Record<string, unknown>> })
    ?.securitySchemes;
  if (!schemes) return [];
  const requirement = (op.security ?? schema?.security) as
    | Record<string, unknown>[]
    | undefined;
  if (!Array.isArray(requirement) || requirement.length === 0) return [];
  // Each requirement object ANDs its keys; each element of the list is an OR alternative.
  const seen = new Set<string>();
  return requirement.flatMap((req): AuthOptions => {
    const keys = Object.keys(req ?? {});
    const resolved = keys.flatMap((key) => resolveScheme(schemes[key], key));
    // A requirement naming only schemes the spec never defines is broken, not "auth optional" —
    // drop it, or the playground would offer a no-auth alternative the API doesn't actually have.
    // An empty requirement object (`{}`) *is* the spec's way to say auth is optional, so it stays.
    //
    // Warn rather than fail, per the config layer's posture: the author owns the typo, and they're
    // the only one who can fix it. Note the residual — if the *only* requirement is broken, the
    // operation resolves to no auth at all and the page reads as an open endpoint. Surfacing that
    // to readers would mean plumbing "there was a requirement we couldn't resolve" through to the
    // modal; the warning is what the author needs, and a spec this broken is loud elsewhere.
    if (resolved.length < keys.length) {
      const missing = keys.filter((k) => !schemes[k]);
      console.warn(
        `openapi: security requirement references undefined scheme(s) ${missing.join(", ")} — ` +
          `add them to components.securitySchemes or the playground can't offer that auth.`,
      );
      // Nothing resolved: drop the alternative entirely, or the playground would offer a no-auth
      // option the API doesn't have. Some resolved: keep what we can — a partial alternative still
      // beats none — but the warning above is the only signal that it's short a credential.
      if (resolved.length === 0) return [];
    }
    // Alternatives differing only by OAuth2 scopes (`[{OAuth2: ["read"]}, {OAuth2: ["write"]}]`)
    // collapse to the same schemes, since scopes don't change the input or the request we build.
    // Keeping both would put two identical, unpickable buttons in the picker.
    const signature = resolved.map((s) => s.key).join("+");
    if (seen.has(signature)) return [];
    seen.add(signature);
    return [resolved];
  });
}

/** Extract the ordered list of operations from a spec. Cached per spec path. */
export const apiOperations = cache(async (specPath: string): Promise<Operation[]> => {
  const schema = await loadSpec(specPath);
  const paths = (schema?.paths ?? {}) as Record<string, Record<string, unknown>>;
  const servers = (schema?.servers as { url?: string }[]) ?? [];
  const baseUrl = servers[0]?.url ?? "";
  const ops: Operation[] = [];

  for (const [p, pathItem] of Object.entries(paths)) {
    for (const method of METHODS) {
      const op = pathItem[method] as Record<string, unknown> | undefined;
      if (!op || typeof op !== "object") continue;

      const params: Param[] = [
        ...((pathItem.parameters as Param[]) ?? []),
        ...((op.parameters as Param[]) ?? []),
      ].filter((x) => x && typeof x === "object");

      const content = (op.requestBody as { content?: Record<string, { schema?: Schema }> })
        ?.content;
      const requestBody = content?.["application/json"]?.schema;

      const responseEntries = Object.entries(
        (op.responses ?? {}) as Record<string, { description?: string; content?: Record<string, { schema?: Schema }> }>,
      );
      const responses = responseEntries.map(([status, r]) => ({
        status,
        description: r?.description,
        schema: r?.content?.["application/json"]?.schema,
      }));
      // Union of response media types (e.g. application/json) across all responses — what the
      // operation `produces`, used to seed the Accept header in the playground.
      const produces = Array.from(
        new Set(responseEntries.flatMap(([, r]) => Object.keys(r?.content ?? {}))),
      );

      ops.push({
        slug: operationSlug(method, p, op),
        method: method.toUpperCase(),
        path: p,
        summary: op.summary as string | undefined,
        description: op.description as string | undefined,
        deprecated: op.deprecated as boolean | undefined,
        tag: Array.isArray(op.tags) ? (op.tags[0] as string) : undefined,
        parameters: params,
        requestBody,
        responses,
        produces,
        auth: resolveAuth(schema, op),
        baseUrl,
        specPath,
      });
    }
  }
  return ops;
});

/**
 * Build an example value from a JSON schema for the request/response code panels.
 * Prefers explicit `example`/`default`, then enum, then a placeholder by type.
 * Guarded against the cyclic graphs dereferencing can produce.
 */
export function sampleFromSchema(schema?: Schema, seen: Set<Schema> = new Set(), depth = 0): unknown {
  if (!schema || depth > 6) return null;
  if (schema.example !== undefined) return schema.example;
  // `upgrade()` rewrites 3.0's `example: x` into 3.1's `examples: [x]`, so reading only `example`
  // meant every author-written example in a 3.0 spec — which is most of them — was dropped on the
  // floor and replaced with a `"string"` placeholder.
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0];
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (seen.has(schema)) return null;

  const type = schema.type as string | undefined;
  if (type === "object" || schema.properties) {
    seen.add(schema);
    const props = (schema.properties ?? {}) as Record<string, Schema>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) out[k] = sampleFromSchema(v, seen, depth + 1);
    seen.delete(schema);
    return out;
  }
  if (type === "array") {
    return [sampleFromSchema(schema.items as Schema | undefined, seen, depth + 1)];
  }
  if (type === "string") {
    const fmt = schema.format as string | undefined;
    if (fmt === "email") return "user@example.com";
    if (fmt === "date-time") return "2023-01-01T00:00:00Z";
    if (fmt === "uri") return "https://example.com";
    return "string";
  }
  if (type === "integer" || type === "number") return 0;
  if (type === "boolean") return true;
  return null;
}

/** Collect every `openapi` spec path referenced anywhere in the navigation tree. */
function collectSpecRefs(value: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) collectSpecRefs(v, out);
  } else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.openapi === "string") out.add(obj.openapi);
    for (const v of Object.values(obj)) collectSpecRefs(v, out);
  }
  return out;
}

/** Map of operation slug → operation, across all specs the docs.json references. */
export const loadApiCatalog = cache(
  async (config: DocsConfig): Promise<Map<string, Operation>> => {
    const specs = collectSpecRefs(config.navigation);
    const map = new Map<string, Operation>();
    for (const specPath of specs) {
      for (const op of await apiOperations(specPath)) map.set(op.slug, op);
    }
    return map;
  },
);
