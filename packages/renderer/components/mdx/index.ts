import type { MDXComponents } from "mdx/types";
import { Note, Info_, Warning, Tip, Check } from "./Callout";
import { Card, CardGroup } from "./Card";
import { Steps, Step } from "./Steps";
import { Frame } from "./Frame";
import { Tabs, Tab } from "./Tabs";
import { CodeGroup } from "./CodeGroup";
import { Accordion, AccordionGroup } from "./Accordion";
import { ParamField, ResponseField } from "./ApiField";
import { Expandable } from "./Expandable";
import { Mermaid } from "./Mermaid";

/** The component set available inside every MDX page (SPEC.md §5). */
export const mdxComponents: MDXComponents = {
  Note,
  Info: Info_,
  Warning,
  Tip,
  Check,
  Card,
  CardGroup,
  Columns: CardGroup, // hosted docs platforms' current name for the card grid; CardGroup is the legacy alias
  Steps,
  Step,
  Frame,
  Tabs,
  Tab,
  CodeGroup,
  Accordion,
  AccordionGroup,
  ParamField,
  ResponseField,
  Expandable,
  Mermaid,
};
