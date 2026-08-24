# Papervine Starter

An example docs site for [Papervine](https://github.com/papervine/papervine). Fork it to start
your own docs, or use it to explore the renderer and reader-auth.

- **Get Started / Guides** — ungated pages plus a `public: true` page.
- **Internal** — pages gated by reader-auth groups (`groups: [...]` frontmatter), used to
  demonstrate and test per-page RBAC. With reader-auth off, these render normally; with it on,
  a reader must be in a listed group.

- **API Reference** — an OpenAPI spec (`openapi.json`) auto-generates per-endpoint pages, exercising the API reference renderer.
