import { NovelDocument, wikiReferences } from './model';

export type GraphEdge = { source: string; target: string; kind: 'link' | 'pov' };

export type DocumentGraphData = { documents: NovelDocument[]; edges: GraphEdge[] };

export type GraphOptions = {
  kinds: NovelDocument['kind'][]; query: string; category: string;
  includePov: boolean; hideIsolated: boolean; center?: string; depth: number;
};

export const GRAPH_LIMIT = 200;

export const GRAPH_EDGE_LIMIT = 800;

/** Only stored links inside this work count. Ambiguous character titles are never guessed. */
export function buildDocumentGraph(documents: NovelDocument[]): DocumentGraphData {
  const ids = new Set(documents.map(d => d.id));
  const characters = new Map<string, string[]>();

  for (const d of documents) if (d.kind === 'wiki' && d.category.trim() === '인물') {
    const title = d.title.trim();
    characters.set(title, [...(characters.get(title) || []), d.id]);
  }

  const edges: GraphEdge[] = [];

  for (const d of documents) {
    for (const target of wikiReferences(d.content)) {
      if (ids.has(target) && target !== d.id) edges.push({ source: d.id, target, kind: 'link' });
    }

    const person = d.pov.trim() ? characters.get(d.pov.trim()) : undefined;

    if (d.kind === 'scene' && person?.length === 1) edges.push({ source: d.id, target: person[0], kind: 'pov' });
  }

  return { documents, edges };
}

/** Neighborhoods follow both directions, after type/category/search filters. */
export function filterDocumentGraph(graph: DocumentGraphData, options: GraphOptions, limit = GRAPH_LIMIT) {
  const query = options.query.trim().toLocaleLowerCase();

  const eligible = graph.documents.filter(d => options.kinds.includes(d.kind)
    && (!options.category || d.kind !== 'wiki' || d.category.trim() === options.category)
    && (!query || d.title.toLocaleLowerCase().includes(query) || d.id === options.center));

  const ids = new Set(eligible.map(d => d.id));
  const edges = graph.edges.filter(e => (options.includePov || e.kind === 'link') && ids.has(e.source) && ids.has(e.target));
  const neighbors = new Map<string, Set<string>>();

  for (const e of edges) {
    if (!neighbors.has(e.source)) neighbors.set(e.source, new Set());

    if (!neighbors.has(e.target)) neighbors.set(e.target, new Set());
    neighbors.get(e.source)!.add(e.target); neighbors.get(e.target)!.add(e.source);
  }

  let keep = ids;

  if (options.center) {
    keep = new Set(ids.has(options.center) ? [options.center] : []);
    let frontier = [...keep];

    for (let level = 0; level < Math.max(1, Math.min(3, options.depth)); level++) {
      const next: string[] = [];

      for (const id of frontier) for (const neighbor of neighbors.get(id) || []) if (!keep.has(neighbor)) { keep.add(neighbor); next.push(neighbor); }

      frontier = next;
    }
  }

  const matching = eligible.filter(d => keep.has(d.id) && (!options.hideIsolated || neighbors.has(d.id) || d.id === options.center));

  // Keep the neighborhood center, then the most connected documents in large works.
  const ranked = matching.length > limit ? [...matching].sort((a, b) =>
    Number(b.id === options.center) - Number(a.id === options.center)
    || (neighbors.get(b.id)?.size || 0) - (neighbors.get(a.id)?.size || 0)
    || a.id.localeCompare(b.id)) : matching;

  const documents = ranked.slice(0, limit), visible = new Set(documents.map(d => d.id));
  const visibleEdges = edges.filter(e => visible.has(e.source) && visible.has(e.target));

  return { documents, edges: visibleEdges.slice(0, GRAPH_EDGE_LIMIT), edgeTotal: visibleEdges.length, total: matching.length, limited: matching.length > limit || visibleEdges.length > GRAPH_EDGE_LIMIT };
}

export type GraphPoint = { x: number; y: number };

/** Vertical distance between chip centres: 28px chip and a 12px gap. */
export const GRAPH_ROW = 40;

/** Maps with more documents than this show icon-only chips when zoomed out below 100%. */
export const GRAPH_FULL_LABELS = 50;

/** Estimated chip width in px for a 12px title: Hangul 12px, other characters 6.5px, plus padding, icon and status dot. */
export const graphChipWidth = (title: string) => [...title].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 12 : 6.5), 0) + 52;

/** Bounded, deterministic force layout: at most GRAPH_LIMIT nodes in the UI. */
export function layoutDocumentGraph(documents: NovelDocument[], edges: GraphEdge[]): Map<string, GraphPoint> {
  const sorted = [...documents].sort((a, b) => a.id.localeCompare(b.id));
  const n = sorted.length, radius = Math.max(140, Math.sqrt(n) * 45);
  const points = sorted.map((_, i) => ({ x: Math.cos(i * 2.399963) * radius * Math.sqrt((i + 1) / Math.max(n, 1)), y: Math.sin(i * 2.399963) * radius * Math.sqrt((i + 1) / Math.max(n, 1)) }));
  const indices = new Map(sorted.map((d, i) => [d.id, i]));

  const pairs = edges.flatMap(e => { const source=indices.get(e.source),target=indices.get(e.target);

    return source===undefined||target===undefined?[]:[[source,target]];
  });

  for (let iteration = 0; iteration < 90; iteration++) {
    const forces = points.map(p => ({ x: -p.x * 0.012, y: -p.y * 0.012 }));

    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = points[i].x - points[j].x, dy = points[i].y - points[j].y;
      const distance = Math.max(1, Math.hypot(dx, dy)), force = Math.min(20, 3500 / (distance * distance));
      forces[i].x += dx / distance * force; forces[i].y += dy / distance * force;
      forces[j].x -= dx / distance * force; forces[j].y -= dy / distance * force;
    }

    for (const [a, b] of pairs) {
      const dx = points[b].x - points[a].x, dy = points[b].y - points[a].y;
      const distance = Math.max(1, Math.hypot(dx, dy)), force = (distance - 110) * 0.025;
      forces[a].x += dx / distance * force; forces[a].y += dy / distance * force;
      forces[b].x -= dx / distance * force; forces[b].y -= dy / distance * force;
    }

    const step = 1 - iteration / 120;
    points.forEach((p, i) => { p.x += Math.max(-15, Math.min(15, forces[i].x)) * step; p.y += Math.max(-15, Math.min(15, forces[i].y)) * step; });
  }

  // Separate the title chips (icon + title + status dot, 28px high, at most 220px wide) at 100% zoom.
  // Large maps open zoomed out with 24px icon chips, so they only keep the icons apart.
  const compact = n > GRAPH_FULL_LABELS, row = compact ? 30 : GRAPH_ROW;
  const halfWidths = sorted.map(d => compact ? 15 : Math.min(220, graphChipWidth(d.title)) / 2 + 6);

  for (let iteration = 0; iteration < 35; iteration++) {
    let moved = false;

    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = points[i].x - points[j].x, dy = points[i].y - points[j].y;
      const overlapX = halfWidths[i] + halfWidths[j] - Math.abs(dx), overlapY = row - Math.abs(dy);

      if (overlapX <= 0 || overlapY <= 0) continue;
      moved = true;

      if (overlapX < overlapY) { const shift = (overlapX / 2 + 0.1) * (dx >= 0 ? 1 : -1); points[i].x += shift; points[j].x -= shift; }
      else { const shift = (overlapY / 2 + 0.1) * (dy >= 0 ? 1 : -1); points[i].y += shift; points[j].y -= shift; }
    }

    if (!moved) break;
  }

  return new Map(sorted.map((d, i) => [d.id, points[i]]));
}
