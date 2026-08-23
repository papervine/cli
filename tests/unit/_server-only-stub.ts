// Stub for the `server-only` import guard so unit tests can load server modules
// (search/content/nav) that are pure logic but marked server-only. Vitest aliases
// the bare `server-only` specifier here; see vitest.config.ts.
export {};