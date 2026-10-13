import type { CsvTable } from '../io/csv';

// Turns a links CSV (one row per connection between two devices) into a graph of devices and
// links: devices deduplicated by name, links deduplicated when two rows describe the same
// pair of interfaces from either side (CDP/LLDP data reports every link twice). Pure.

/** The columns a links CSV may have (matched case-insensitively). Any others become link data. */
export const LINK_COLUMNS = [
  'hostName',
  'hostInterface',
  'hostIP',
  'hostPlatform',
  'neighborName',
  'neighborInterface',
  'neighborIP',
  'neighborPlatform',
] as const;
export const REQUIRED_COLUMNS = ['hostName', 'neighborName'] as const;

export interface LinkInfo {
  /** Dedup key: the unordered pair of device+interface ends. */
  key: string;
  /** Device keys of the two ends, oriented as in the first row that mentioned the link. */
  host: string;
  neighbor: string;
  /** `hostInterface`, `neighborInterface` (when given) plus any extra columns. */
  data: Record<string, string>;
}

export interface SkippedRow {
  line: number;
  reason: string;
}

/**
 * Field names a device's values are stored under (and used as `{placeholders}` in node
 * templates). They're the host-side column names; a device that appears as the neighbor has
 * its neighborName / neighborIP / neighborPlatform stored under the same names.
 */
export const DEVICE_FIELDS = { name: 'hostName', ip: 'hostIP', platform: 'hostPlatform' } as const;

export interface LinkGraph {
  /** Device fields by device key: `hostName` always, `hostIP` / `hostPlatform` when the file has them. */
  nodes: Map<string, Record<string, string>>;
  links: LinkInfo[];
  skipped: SkippedRow[];
  /** Rows folded into a link already described by an earlier row. */
  merged: number;
}

/** How devices are matched: by name, ignoring case and surrounding spaces. */
export const deviceKey = (name: string) => name.trim().toLowerCase();

/** Same link whichever side describes it: sorted `device|interface` ends. */
export const linkKey = (a: string, aIf: string, b: string, bIf: string) =>
  [`${a}|${aIf.trim().toLowerCase()}`, `${b}|${bIf.trim().toLowerCase()}`].sort().join('↔');

/** Copies `value` into `target[key]` unless it's empty or the key already has a value. */
function fill(target: Record<string, string>, key: string, value: string | undefined) {
  if (value && !target[key]) target[key] = value;
}

export function buildGraph(table: CsvTable): LinkGraph {
  const present = new Set(table.headers.map((h) => h.toLowerCase()));
  const missing = REQUIRED_COLUMNS.filter((c) => !present.has(c.toLowerCase()));
  if (missing.length) {
    throw new Error(`Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Expected: ${LINK_COLUMNS.join(', ')}.`);
  }
  const known = new Set<string>(LINK_COLUMNS.map((c) => c.toLowerCase()));
  const extras = table.headers.filter((h) => !known.has(h.toLowerCase()));

  const nodes = new Map<string, Record<string, string>>();
  const links = new Map<string, LinkInfo>();
  const skipped: SkippedRow[] = [];
  let merged = 0;

  const device = (name: string, ip: string, platform: string) => {
    const key = deviceKey(name);
    if (!nodes.has(key)) nodes.set(key, { [DEVICE_FIELDS.name]: name.trim() });
    const d = nodes.get(key)!;
    fill(d, DEVICE_FIELDS.ip, ip);
    fill(d, DEVICE_FIELDS.platform, platform);
    return key;
  };

  table.rows.forEach((row, i) => {
    const line = table.lines[i];
    const hostName = row.hostname ?? '';
    const neighborName = row.neighborname ?? '';
    if (!hostName || !neighborName) {
      skipped.push({ line, reason: `missing ${!hostName ? 'hostName' : 'neighborName'}` });
      return;
    }
    if (deviceKey(hostName) === deviceKey(neighborName)) {
      skipped.push({ line, reason: `"${hostName}" is linked to itself` });
      return;
    }
    const host = device(hostName, row.hostip, row.hostplatform);
    const neighbor = device(neighborName, row.neighborip, row.neighborplatform);
    const hostIf = row.hostinterface ?? '';
    const neighborIf = row.neighborinterface ?? '';
    const key = linkKey(host, hostIf, neighbor, neighborIf);

    let link = links.get(key);
    if (link) merged++;
    else {
      link = { key, host, neighbor, data: {} };
      links.set(key, link);
    }
    // A reciprocal row has the ends swapped relative to the link's orientation.
    const same = link.host === host;
    fill(link.data, 'hostInterface', same ? hostIf : neighborIf);
    fill(link.data, 'neighborInterface', same ? neighborIf : hostIf);
    for (const h of extras) fill(link.data, h, row[h.toLowerCase()]);
  });

  return { nodes, links: [...links.values()], skipped, merged };
}
