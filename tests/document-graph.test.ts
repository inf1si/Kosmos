import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newDocument, povSettings, type NovelDocument } from '../src/lib/model';
import { buildDocumentGraph, filterDocumentGraph, layoutDocumentGraph, graphChipWidth, GRAPH_EDGE_LIMIT, GRAPH_ROW, type GraphOptions } from '../src/lib/document-graph';

const options: GraphOptions = {kinds: ['scene', 'wiki', 'memo'], query: '', category: '', includePov: true, hideIsolated: false, depth: 1};

function link(doc: NovelDocument, ...targets: string[]) {
  doc.content = {type: 'doc', content: [{type: 'paragraph', content: targets.map(targetId => ({type: 'text', text: '연결', marks: [{type: 'wikiLink', attrs: {targetId}}]}))}]};
}

test('graph excludes other works, deleted and self targets and deduplicates repeated references', () => {
  const scene = newDocument('scene', '원고'), wiki = newDocument('wiki', '항구'), memo = newDocument('memo', '노트'), other = newDocument('wiki', '다른 작품');
  link(scene, wiki.id, wiki.id, scene.id, other.id, 'deleted'); link(memo, wiki.id); link(wiki, memo.id);
  const before = JSON.stringify([scene, wiki, memo]);
  const graph = buildDocumentGraph([scene, wiki, memo]);
  assert.deepEqual(graph.edges, [{source: scene.id, target: wiki.id, kind: 'link'}, {source: wiki.id, target: memo.id, kind: 'link'}, {source: memo.id, target: wiki.id, kind: 'link'}]);
  assert.equal(JSON.stringify([scene, wiki, memo]), before);
});

test('POV requires an exact unique character title and can be disabled separately from text links', () => {
  const scene = newDocument('scene', '장면'), person = newDocument('wiki', ' 해린 '), place = newDocument('wiki', '항구');
  person.category = ' 인물 '; place.category = '장소'; scene.pov = '해린'; link(scene, person.id);
  const graph = buildDocumentGraph([scene, person, place]);
  assert.equal(graph.edges.filter(e => e.kind === 'pov').length, 1);
  assert.equal(filterDocumentGraph(graph, {...options, includePov: false}).edges.length, 1);
  const duplicate = {...newDocument('wiki', '해린'), category: '인물'};
  assert.equal(buildDocumentGraph([scene, person, duplicate]).edges.filter(e => e.kind === 'pov').length, 0);
  scene.pov = '항구'; assert.equal(buildDocumentGraph([scene, person, place]).edges.filter(e => e.kind === 'pov').length, 0);
});

test('an untitled character is never the POV of scenes without one', () => {
  const scene = newDocument('scene', '장면'), person = {...newDocument('wiki', ''), category: '인물'};
  assert.equal(buildDocumentGraph([scene, person]).edges.length, 0);
  assert.deepEqual(povSettings([scene, person], scene.pov), []);
  scene.pov = ' ';
  assert.deepEqual(povSettings([scene, person], scene.pov), []);
  const named = newDocument('wiki', '해린'); scene.pov = '해린';
  assert.deepEqual(povSettings([scene, person, named], scene.pov).map(d => d.id), [named.id]);
});

test('neighborhoods traverse incoming and outgoing links through cycles and respect depth and filters', () => {
  const a = newDocument('scene', '첫 원고'), b = newDocument('wiki', '항구'), c = newDocument('wiki', '궤도'), d = newDocument('memo', '관측'), isolated = newDocument('memo', '고립');
  b.category = '장소'; c.category = '기술'; link(a, b.id); link(b, c.id); link(c, d.id); link(d, b.id);
  const graph = buildDocumentGraph([a, b, c, d, isolated]);
  assert.deepEqual(new Set(filterDocumentGraph(graph, {...options, center: a.id}).documents.map(d => d.id)), new Set([a.id, b.id]));
  assert.equal(filterDocumentGraph(graph, {...options, center: a.id, depth: 2}).documents.length, 4);
  assert.equal(filterDocumentGraph(graph, {...options, center: a.id, depth: 3}).documents.length, 4);
  assert.equal(filterDocumentGraph(graph, {...options, hideIsolated: true}).documents.length, 4);
  assert.equal(filterDocumentGraph(graph, {...options, kinds: ['wiki'], category: '장소'}).documents.length, 1);
  assert.equal(filterDocumentGraph(graph, {...options, query: '궤도'}).documents[0].id, c.id);
  assert.equal(filterDocumentGraph(graph, {...options, kinds: []}).documents.length, 0);
  assert.equal(filterDocumentGraph(graph, {...options, center: 'outside-work'}).documents.length, 0);
});

test('large graphs cap nodes and edges explicitly, preserve the center and never leave dangling rendered edges', () => {
  const docs = Array.from({length: 230}, (_, i) => newDocument('wiki', `문서 ${i}`));
  docs.forEach((d, i) => link(d, ...docs.slice(0, 35).filter(x => x.id !== d.id).map(x => x.id)));
  const graph = buildDocumentGraph(docs), result = filterDocumentGraph(graph, {...options, center: docs[229].id, depth: 3});
  assert.equal(result.total, 230); assert.equal(result.documents.length, 200); assert.equal(result.edges.length, GRAPH_EDGE_LIMIT); assert.ok(result.limited);
  const ids = new Set(result.documents.map(d => d.id)); assert.ok(ids.has(docs[229].id));
  assert.ok(result.edges.every(e => ids.has(e.source) && ids.has(e.target))); assert.ok(result.edgeTotal > result.edges.length);
});

test('force layout is stable across document ordering and produces finite separated coordinates', () => {
  const docs = Array.from({length: 200}, (_, i) => newDocument(i % 2 ? 'wiki' : 'scene', `문서 ${i}`));
  docs.forEach((d, i) => {if (i) link(d, docs[i - 1].id);});
  const graph = buildDocumentGraph(docs), layout = layoutDocumentGraph(docs, graph.edges);
  assert.deepEqual(layout, layoutDocumentGraph([...docs].reverse(), graph.edges));
  assert.equal(layout.size, 200); assert.equal(layoutDocumentGraph([], []).size, 0);
  assert.ok([...layout.values()].every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  const coordinates = [...layout.values()]; let closest = Infinity;

  for (let i = 0; i < coordinates.length; i++) for (let j = i + 1; j < coordinates.length; j++) closest = Math.min(closest, Math.hypot(coordinates[i].x - coordinates[j].x, coordinates[i].y - coordinates[j].y));
  assert.ok(closest > 15, `closest nodes were ${closest} units apart`);
});

test('small graphs separate Korean title chips around a connected character', () => {
  const person = newDocument('wiki', '시점 인물'), docs = [person, ...Array.from({length: 12}, (_, i) => newDocument('scene', `${i + 1}. 도착한 항구의 시간`))];
  docs.forEach((d, i) => {d.id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;});
  docs.slice(1).forEach(d => link(d, person.id));
  const points = layoutDocumentGraph(docs, buildDocumentGraph(docs).edges);
  const halfWidth = (d: NovelDocument) => Math.min(220, graphChipWidth(d.title)) / 2;

  for (let i = 0; i < docs.length; i++) for (let j = i + 1; j < docs.length; j++) {
    const a = points.get(docs[i].id)!, b = points.get(docs[j].id)!;
    assert.ok(Math.abs(a.x - b.x) >= halfWidth(docs[i]) + halfWidth(docs[j]) - 1 || Math.abs(a.y - b.y) >= GRAPH_ROW - 1, `title chips overlap: ${i}, ${j}`);
  }
});
