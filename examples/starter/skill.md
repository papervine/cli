---
name: Papervine Starter
description: Publish and maintain a documentation site from a folder of MDX and a docs.json. Use when creating docs pages, configuring navigation, adding components, or wiring up an API reference.
license: Elastic-2.0
compatibility: Requires Node.js 20+ for the CLI. Works with any Git-based workflow, or with no repository at all.
metadata:
  author: papervine
  version: "1.0"
---

# Papervine Starter

This example site is a working Papervine docs repo. An agent reading this can expect the
capabilities below to hold for any site built the same way.

## Capabilities

- **Publish a docs site** from a directory of `.mdx` pages plus a `docs.json` describing
  navigation, theme, and colors.
- **Serve an API reference** generated from an OpenAPI document referenced by the navigation.
- **Answer questions about the content** through an assistant that cites the page each answer
  came from.

## Skills

### Add a page
Create `<slug>.mdx` with `title` and `description` frontmatter, then add its slug to a
navigation group in `docs.json`. A page not listed in the navigation is still reachable by URL.

### Change the navigation
Edit `navigation` in `docs.json`. Groups hold page slugs; tabs hold groups.

## Constraints

- Pages are MDX. A component the renderer does not know degrades to its children rather than
  failing the page.
- `docs.json` is validated leniently: an unexpected field warns and is passed through.
