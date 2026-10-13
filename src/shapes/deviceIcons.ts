// Built-in device pictures for network diagrams: generic line-art icons drawn for ClearChart
// (no vendor artwork), with starting platform rules. Each becomes a picture element in new
// documents (see `defaultTemplates` in model/doc.ts). Pure data.

const STROKE = '#1f4e8c';
const FILL = '#e8f1fb';

/** An arrow from (x1,y1) to (x2,y2) as path data, with an open head at the end. */
function arrow(x1: number, y1: number, x2: number, y2: number, head = 5): string {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  const px = -uy * head * 0.6;
  const py = ux * head * 0.6;
  const r = (v: number) => Math.round(v * 10) / 10;
  return `M${r(x1)} ${r(y1)}L${r(x2)} ${r(y2)}M${r(bx + px)} ${r(by + py)}L${r(x2)} ${r(y2)}L${r(bx - px)} ${r(by - py)}`;
}

/** An arc centered at (cx,cy) of radius r, from angle a0 to a1 (degrees, y down), as path data. */
function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => `${Math.round((cx + r * Math.cos((a * Math.PI) / 180)) * 10) / 10} ${Math.round((cy + r * Math.sin((a * Math.PI) / 180)) * 10) / 10}`;
  return `M${p(a0)}A${r} ${r} 0 0 1 ${p(a1)}`;
}

const lines = (d: string) => `<path d="${d}" fill="none"/>`;
const dot = (x: number, y: number, r = 2.2) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${STROKE}" stroke="none"/>`;

/** [x, y, w, h]: the part of the 64×64 drawing grid an icon uses (its drawing plus the stroke). */
type Frame = [number, number, number, number];

export interface BuiltInDevice {
  /** Stable key; the picture's asset id is `builtin-<key>`. */
  key: string;
  name: string;
  /** Starting platform rules (matched case-insensitively as substrings). */
  rules: string[];
  /**
   * The picture, framed tightly around the drawing so a device's box (where its lines attach)
   * hugs what you see.
   */
  svg: string;
  /** The picture's size in drawing units (its aspect ratio). */
  w: number;
  h: number;
}

/** A device whose picture is `body` (drawn on a 64×64 grid) cropped to `frame`, in the shared outline style. */
function device(key: string, name: string, rules: string[], frame: Frame, body: string): BuiltInDevice {
  const [x, y, w, h] = frame;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}">` +
    `<g fill="${FILL}" stroke="${STROKE}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`;
  return { key, name, rules, svg, w, h };
}

export const BUILT_IN_DEVICES: BuiltInDevice[] = [
  device(
    'switch',
    'Switch',
    ['catalyst', 'nexus', 'n3k', 'n5k', 'n7k', 'n9k', 'c9', 'ws-c', 'switch'],
    [2, 14, 60, 36],
    // A flat box with traffic arrows both ways.
    `<rect x="4" y="16" width="56" height="32" rx="4"/>` +
      lines(arrow(10, 26, 28, 26) + arrow(36, 26, 54, 26) + arrow(28, 38, 10, 38) + arrow(54, 38, 36, 38)),
  ),
  device(
    'l3switch',
    'Layer-3 switch',
    ['l3 switch', 'multilayer'],
    [2, 14, 60, 36],
    // A flat box with arrows routed out in four directions.
    `<rect x="4" y="16" width="56" height="32" rx="4"/>` +
      lines(arrow(32, 32, 32, 20) + arrow(32, 32, 32, 44) + arrow(32, 32, 12, 32) + arrow(32, 32, 52, 32)),
  ),
  device(
    'router',
    'Router',
    ['isr', 'asr', 'c8', 'ncs', 'cisco19', 'cisco29', 'cisco39', 'router'],
    [6, 6, 52, 52],
    // A round body with arrows in and out on the diagonals.
    `<circle cx="32" cy="32" r="24"/>` +
      lines(arrow(17, 17, 27, 27) + arrow(47, 47, 37, 37) + arrow(37, 27, 47, 17) + arrow(27, 37, 17, 47)),
  ),
  device(
    'firewall',
    'Firewall',
    ['asa', 'firepower', 'ftd', 'fortigate', 'palo alto', 'srx', 'firewall'],
    [4, 10, 56, 44],
    // A brick wall.
    `<rect x="6" y="12" width="52" height="40" rx="2"/>` +
      lines('M6 22H58M6 32H58M6 42H58M24 12V22M40 12V22M16 22V32M32 22V32M48 22V32M24 32V42M40 32V42M16 42V52M32 42V52M48 42V52'),
  ),
  device(
    'wireless',
    'Wireless AP',
    ['air-', 'aironet', 'c91', 'access point'],
    [10, 13, 44, 42],
    // A low body with radio waves above it.
    `<rect x="12" y="40" width="40" height="13" rx="6.5"/>` +
      dot(32, 46.5) +
      lines(arc(32, 36, 7, 225, 315) + arc(32, 36, 14, 225, 315) + arc(32, 36, 21, 225, 315)),
  ),
  device(
    'loadbalancer',
    'Load balancer',
    ['f5', 'big-ip', 'netscaler', 'load balancer'],
    [2, 12, 60, 40],
    // One stream fanning out to three.
    `<rect x="4" y="14" width="56" height="36" rx="4"/>` +
      lines('M10 32H24' + arrow(24, 32, 52, 21) + arrow(24, 32, 53, 32) + arrow(24, 32, 52, 43)),
  ),
  device(
    'server',
    'Server',
    ['ucs', 'server', 'esxi', 'linux', 'windows'],
    [14, 2, 36, 60],
    // A tower with drive slots and a power light.
    `<rect x="16" y="4" width="32" height="56" rx="3"/>` + lines('M22 14H42M22 22H42M22 30H42M22 48H32') + dot(40, 48),
  ),
  device(
    'cloud',
    'Cloud',
    ['cloud', 'internet', 'isp'],
    [4, 13, 55, 37],
    `<path d="M18 48H46A11 11 0 0 0 46 26A14 14 0 0 0 20 22A13 13 0 0 0 18 48Z"/>`,
  ),
  device(
    'generic',
    'Generic device',
    [],
    [6, 12, 52, 40],
    // A box with a display and status lights.
    `<rect x="8" y="14" width="48" height="36" rx="5"/>` +
      `<rect x="14" y="20" width="36" height="15" rx="2" fill="#ffffff"/>` +
      dot(18, 43) +
      dot(26, 43) +
      dot(34, 43) +
      lines('M40 43H50'),
  ),
];

/** The built-in device that devices matching no rule use. */
export const DEFAULT_DEVICE_KEY = 'generic';

export const builtInAssetId = (key: string) => `builtin-${key}`;

/** A picture as an embeddable data URL. */
export const svgDataUrl = (markup: string) => `data:image/svg+xml,${encodeURIComponent(markup)}`;

/** The built-in pictures, keyed by asset id. */
export function builtInAssets(): Record<string, string> {
  return Object.fromEntries(BUILT_IN_DEVICES.map((d) => [builtInAssetId(d.key), svgDataUrl(d.svg)]));
}
