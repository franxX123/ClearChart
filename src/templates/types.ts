import type { ConnectorStyle, NodeComponent, Routing, Rule } from '../model/types';

export type { NodeComponent, Part, Rule } from '../model/types';

/** A reusable line style for links whose ends match `rule`. `rule: null` is the template's default. */
export interface LinkComponent {
  id: string;
  name: string;
  rule: Rule | null;
  style: ConnectorStyle;
  routing: Routing;
  /** Middle label; may hold `{{field}}` placeholders filled from the link's fields. */
  label: string;
}

/** A named set of components. Order within `nodes`/`links` is match priority. */
export interface GraphTemplate {
  id: string;
  name: string;
  /** Known data fields (from a sample or imported graph), offered in rule and placeholder hints. */
  fields: string[];
  nodes: NodeComponent[];
  links: LinkComponent[];
}

/** One node of an imported edge, as a flat record of strings. */
export type DataRecord = Record<string, string>;
