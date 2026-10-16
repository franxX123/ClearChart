import { addItems, emptyDoc, makeConnector, makeShape } from '../model/doc';
import type { Doc, Endpoint, Shape } from '../model/types';

/**
 * A small diagram for tests: a new document (built-in elements included) with five shapes on
 * its first page, joined by lines attached to their ports, two of them labeled.
 */
export function exampleDoc(): Doc {
  const doc = emptyDoc();
  doc.title = 'Example diagram';
  const start = makeShape('roundRect', { x: 160, y: 40, w: 140, h: 50 }, 'Start', { fill: '#dff3e4' });
  const step = makeShape('rect', { x: 150, y: 140, w: 160, h: 70 }, 'Collect requirements');
  const check = makeShape('triangle', { x: 155, y: 260, w: 150, h: 100 }, 'Approved?', { fill: '#fff4d6' });
  const done = makeShape('circle', { x: 190, y: 420, w: 80, h: 80 }, 'Ship it', { fill: '#dff3e4' });
  const rework = makeShape('rect', { x: 400, y: 275, w: 140, h: 70 }, 'Revise plan');
  const at = (s: Shape, port: number): Endpoint => ({ shapeId: s.id, port, x: 0, y: 0 });
  addItems(doc.pages[0], [
    start,
    step,
    check,
    done,
    rework,
    makeConnector(at(start, 2), at(step, 0)),
    makeConnector(at(step, 2), at(check, 0)),
    makeConnector(at(check, 2), at(done, 0), 'Yes'),
    makeConnector(at(check, 1), at(rework, 3), 'No'),
    makeConnector(at(rework, 0), at(step, 1)),
  ]);
  return doc;
}
