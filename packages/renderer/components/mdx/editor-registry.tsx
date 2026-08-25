"use client";

// Client-safe registry of the MDX components for the WYSIWYG editor's node views. These are
// the SAME components the reader-facing renderer uses (packages/renderer/components/mdx) — all
// plain props+children React with no server-only imports — so the Visual editor renders live
// and looks like the published page, not an approximation.
//
// Keyed by the source JSX tag (mdxName on the node). Components that inspect their children
// structurally (Tabs, CodeGroup) are intentionally absent: a single editable content hole
// can't satisfy their `Children.toArray` logic, so their node views fall back to editor chrome.
import type { ComponentType } from "react";
import { Note, Info_, Warning, Tip, Check } from "./Callout";
import { Card, CardGroup } from "./Card";
import { Steps, Step } from "./Steps";
import { Frame } from "./Frame";
import { Accordion, AccordionGroup } from "./Accordion";
import { ParamField, ResponseField, ApiField } from "./ApiField";
import { Expandable } from "./Expandable";
import { Mermaid } from "./Mermaid";

// The live Mermaid renderer, exported for the editor's ```mermaid code-block node view (the
// converter keeps mermaid as a fenced code block for byte-exact round-trip, so it isn't in the
// tag-keyed map below).
export { Mermaid };

// Exported by name as well as through the map, because the editor's Steps/Step node views need
// more than "wrap this around a content hole": <Steps> gets an "add a step" button appended
// inside it (so the button inherits the rail's geometry instead of re-deriving it), and <Step>
// gets an input passed as its `title` (so the editable title slot gets the heading's real
// styling instead of a copy of its classes).
export { Steps, Step };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const editorComponents: Record<string, ComponentType<any>> = {
  Note,
  Info: Info_,
  Warning,
  Tip,
  Check,
  Card,
  CardGroup,
  Columns: CardGroup,
  Steps,
  Step,
  Frame,
  Accordion,
  AccordionGroup,
  ParamField,
  ResponseField,
  ApiField,
  Expandable,
};
