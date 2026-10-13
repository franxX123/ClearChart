import type { Point } from '../model/types';

// Turns the SVG paths of the shape library (absolute M, L, H, V, A, C, Z commands) into
// polylines, so they can be written to formats without SVG paths (Visio geometry). Pure.

export interface Subpath {
  points: Point[];
  /** Ended with Z: a closed outline that can be filled. */
  closed: boolean;
}

/** Points along an SVG elliptical arc from `p0` to `p1` (excluding `p0`), per SVG's arc rules. */
function arcPoints(
  p0: Point,
  rx: number,
  ry: number,
  rotationDeg: number,
  large: boolean,
  sweep: boolean,
  p1: Point,
  segments: number,
): Point[] {
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry || (p0.x === p1.x && p0.y === p1.y)) return [p1];
  const phi = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  // Endpoint → center parameterization (SVG 1.1, appendix F.6.5).
  const dx = (p0.x - p1.x) / 2;
  const dy = (p0.y - p1.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cx1 = (coef * rx * y1) / ry;
  const cy1 = (-coef * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0.x + p1.x) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0.y + p1.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const out: Point[] = [];
  for (let i = 1; i <= segments; i++) {
    const t = t1 + (dt * i) / segments;
    out.push({
      x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
      y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
    });
  }
  out[out.length - 1] = p1;
  return out;
}

/** Points along a cubic Bézier from `p0` (excluding it). */
function cubicPoints(p0: Point, c1: Point, c2: Point, p1: Point, segments: number): Point[] {
  const out: Point[] = [];
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
    });
  }
  return out;
}

/** Flattens an absolute-coordinate SVG path into polylines, one per subpath. */
export function flattenPath(d: string, segments = 16): Subpath[] {
  const tokens = d.match(/[MLHVACZ]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const out: Subpath[] = [];
  let cur: Subpath | null = null;
  let pos: Point = { x: 0, y: 0 };
  let i = 0;
  let cmd = '';
  const num = () => Number(tokens[i++]);
  const isNum = () => i < tokens.length && !/[A-Za-z]/.test(tokens[i]);
  const add = (p: Point) => {
    cur!.points.push(p);
    pos = p;
  };
  while (i < tokens.length) {
    if (!isNum()) cmd = tokens[i++].toUpperCase();
    switch (cmd) {
      case 'M':
        cur = { points: [], closed: false };
        out.push(cur);
        add({ x: num(), y: num() });
        cmd = 'L'; // further coordinate pairs after M are line-tos
        break;
      case 'L':
        add({ x: num(), y: num() });
        break;
      case 'H':
        add({ x: num(), y: pos.y });
        break;
      case 'V':
        add({ x: pos.x, y: num() });
        break;
      case 'A': {
        const rx = num();
        const ry = num();
        const rot = num();
        const large = num() !== 0;
        const sweep = num() !== 0;
        const end = { x: num(), y: num() };
        for (const p of arcPoints(pos, rx, ry, rot, large, sweep, end, segments)) add(p);
        break;
      }
      case 'C': {
        const c1 = { x: num(), y: num() };
        const c2 = { x: num(), y: num() };
        const end = { x: num(), y: num() };
        for (const p of cubicPoints(pos, c1, c2, end, segments)) add(p);
        break;
      }
      case 'Z':
        if (cur) {
          cur.closed = true;
          pos = cur.points[0];
        }
        // Z takes no numbers; anything following must start with a command.
        if (isNum()) i++;
        break;
      default:
        i++; // unknown command or stray token: skip it
    }
  }
  return out.filter((sp) => sp.points.length > 1);
}
