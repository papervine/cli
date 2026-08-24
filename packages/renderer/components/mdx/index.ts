import type { MDXComponents } from "mdx/types";
import { Note, Info_, Warning, Tip, Check, Danger, CustomCallout } from "./Callout";
import { Card, CardGroup } from "./Card";
import { Steps, Step } from "./Steps";
import { Frame } from "./Frame";
import { Tabs, Tab } from "./Tabs";
import { CodeBlock } from "./CodeBlock";
import { CodeGroup } from "./CodeGroup";
import { Accordion, AccordionGroup } from "./Accordion";
import { ParamField, ResponseField } from "./ApiField";
import { Expandable } from "./Expandable";
import { Mermaid } from "./Mermaid";
import { Badge } from "./Badge";
import { Icon } from "./Icon";
import { Tooltip } from "./Tooltip";
import { Tile } from "./Tile";
import { Tree, FileTree } from "./Tree";
import { Color } from "./Color";
import { GitHub } from "./GitHub";
import { Update } from "./Update";
import { Visibility } from "./Visibility";
import { Prompt } from "./Prompt";
import { View } from "./View";
import { Panel, RequestExample, ResponseExample } from "./Panel";
import { Banner } from "./Banner";

/**
 * The component set available inside every MDX page (SPEC.md §5).
 *
 * Anything *not* in this map degrades to its children rather than throwing (see
 * `componentsForCompiled` in lib/mdx.tsx), which is why an unsupported component shows as
 * plain text instead of breaking the page. That fallback is the safety net, not the goal:
 * every name here is one a docs repo can rely on rendering properly.
 */
export const mdxComponents: MDXComponents = {
  // Callouts
  Note,
  Info: Info_,
  Warning,
  Tip,
  Check,
  Danger,
  Callout: CustomCallout,
  Banner,

  // Layout & navigation
  Card,
  CardGroup,
  Columns: CardGroup, // the current name for the card grid; CardGroup is the legacy alias
  Tile,
  Steps,
  Step,
  Frame,
  Tabs,
  Tab,
  Accordion,
  AccordionGroup,
  Expandable,
  Panel,

  // Code
  // Intrinsic override: every fenced block routes through CodeBlock for the copy button.
  pre: CodeBlock,
  CodeGroup,
  RequestExample,
  ResponseExample,
  Prompt,

  // API reference
  ParamField,
  ResponseField,

  // Inline & visual
  Badge,
  Icon,
  Tooltip,
  Color,
  Tree,
  FileTree, // documented alias for Tree
  Mermaid,
  GitHub,

  // Content control
  Update,
  Visibility,
  View,
};
