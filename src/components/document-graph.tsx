'use client';

import { documentTitle } from '@/lib/model';

import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { ArrowUpRight, FileText, Focus, Network, RotateCcw, Search, SlidersHorizontal, StickyNote, ZoomIn, ZoomOut } from 'lucide-react';
import { NovelDocument, statuses } from '@/lib/model';
import { buildDocumentGraph, filterDocumentGraph, GRAPH_EDGE_LIMIT, GRAPH_FULL_LABELS, layoutDocumentGraph, type GraphEdge, type GraphPoint } from '@/lib/document-graph';
import { Popover } from './primitives';
import { WikiIcon } from './studio-icons';
import styles from './document-graph.module.css';
import { useAppPreferences } from './use-app-preferences';

const kindNames = { scene: '원고', wiki: '설정집', memo: '메모' } as const;

const clampZoom = (z: number) => Math.max(0.05, Math.min(4, z));

function DocIcon({doc, size = 14}: {doc: NovelDocument; size?: number}) { return doc.kind === 'wiki' ? <WikiIcon category={doc.category} size={size}/> : doc.kind === 'memo' ? <StickyNote size={size}/> : <FileText size={size}/>; }

/** 같은 두 문서 사이의 본문 링크와 시점 관계는 선 하나로 그린다. 본문 링크가 있으면 실선이다. */
function mergeEdges(edges: GraphEdge[]) {
  const pairs = new Map<string, GraphEdge>();

  for (const e of edges) { const key = [e.source, e.target].sort().join('|'), previous = pairs.get(key);

 if (!previous || previous.kind === 'pov' && e.kind === 'link') pairs.set(key, e); }

  return [...pairs.values()];
}

export function DocumentGraph({documents, initialDocumentId, onOpen}: {documents: NovelDocument[]; initialDocumentId: string; onOpen: (id: string) => void}) {
  const [defaults] = useAppPreferences();
  const [mode, setMode] = useState<'all' | 'local'>(defaults.graphScope);
  const [center, setCenter] = useState(initialDocumentId);
  const [selected, setSelected] = useState(initialDocumentId);
  const [query, setQuery] = useState(''), [category, setCategory] = useState('');
  const [kinds, setKinds] = useState<NovelDocument['kind'][]>(['scene', 'wiki', 'memo']);
  const [depth, setDepth] = useState<number>(defaults.graphDepth), [includePov, setIncludePov] = useState(defaults.graphIncludePov), [hideIsolated, setHideIsolated] = useState(false);
  const [filters, setFilters] = useState(false);
  const [size, setSize] = useState({width: 800, height: 500});
  const [camera, setCamera] = useState({x: 400, y: 250, zoom: 1});
  const [offsets, setOffsets] = useState<Record<string, GraphPoint>>({});
  const canvas = useRef<HTMLDivElement>(null);
  const drag = useRef<{id?: string; pointer: number; x: number; y: number; moved: boolean; origin: GraphPoint} | null>(null);
  const suppressClick = useRef(false);
  const lastClick = useRef<{id: string; time: number} | null>(null);
  const graph = useMemo(() => buildDocumentGraph(documents), [documents]);
  const visible = useMemo(() => filterDocumentGraph(graph, {kinds, query, category, includePov, hideIsolated, center: mode === 'local' ? center : undefined, depth}), [graph, kinds, query, category, includePov, hideIsolated, mode, center, depth]);
  const points = useMemo(() => layoutDocumentGraph(visible.documents, visible.edges), [visible]);
  const lines = useMemo(() => mergeEdges(visible.edges), [visible.edges]);
  const categories = [...new Set(documents.filter(d => d.kind === 'wiki').map(d => d.category.trim()).filter(Boolean))].sort();
  const doc = visible.documents.find(d => d.id === selected);
  const neighbors = doc ? graph.edges.filter(e => (includePov || e.kind === 'link') && (e.source === doc.id || e.target === doc.id)) : [];

  const related = [...new Set(neighbors.map(e => e.source === doc?.id ? e.target : e.source))].flatMap(id => { const document=documents.find(d => d.id === id);

    return document?[document]:[];
  });

  const point = (id: string) => offsets[id] || points.get(id)!;
  const screen = (p: GraphPoint) => ({x: camera.x + p.x * camera.zoom, y: camera.y + p.y * camera.zoom});
  const filtered = query.trim() || category || kinds.length < 3 || !includePov || hideIsolated;

  useEffect(() => {
    const observer = new ResizeObserver(entries => { const {width, height} = entries[0].contentRect;

 if (width && height) setSize({width, height}); });

    observer.observe(canvas.current!);

 return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = canvas.current!;

    const wheel = (e: WheelEvent) => {
      e.preventDefault(); const r = element.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      setCamera(c => {const zoom = clampZoom(c.zoom * Math.exp(-e.deltaY * 0.0015)), ratio = zoom / c.zoom;

 return {zoom, x: x - (x - c.x) * ratio, y: y - (y - c.y) * ratio};});
    };

    element.addEventListener('wheel', wheel, {passive: false});

    return () => element.removeEventListener('wheel', wheel);
  }, []);

  function fit() {
    const positions = [...points.values()];

    if (!positions.length) { setCamera({x: size.width / 2, y: size.height / 2, zoom: 1});

 return; }

    const xs = positions.map(p => p.x), ys = positions.map(p => p.y);
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
    // 칩은 확대율과 관계없이 같은 크기라 화면 여백(칩 폭·높이)을 빼고 맞춘다.
    const zoom = Math.min(1.6, clampZoom(Math.min((size.width - 240) / Math.max(1, right - left), (size.height - 90) / Math.max(1, bottom - top))));
    setCamera({x: size.width / 2 - (left + right) / 2 * zoom, y: size.height / 2 - (top + bottom) / 2 * zoom, zoom});
  }

  useEffect(() => { setOffsets({}); fit(); /* Fit when the visible graph or canvas changes. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, size.width, size.height]);

  function zoomBy(factor: number, x = size.width / 2, y = size.height / 2) {
    setCamera(c => { const zoom = clampZoom(c.zoom * factor), ratio = zoom / c.zoom;

 return {zoom, x: x - (x - c.x) * ratio, y: y - (y - c.y) * ratio}; });
  }

  function startDrag(e: PointerEvent<HTMLElement>, id?: string) {
    if (e.button !== 0) return;

    if (!id && (e.target instanceof Element?e.target:null)?.closest('button,select,input,a')) return;

    if (id) e.stopPropagation(); else e.preventDefault();
    suppressClick.current = false;
    drag.current = {id, pointer: e.pointerId, x: e.clientX, y: e.clientY, moved: false, origin: id ? point(id) : {x: camera.x, y: camera.y}};
    canvas.current?.setPointerCapture(e.pointerId);
  }

  function moveDrag(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;

 if (!d || d.pointer !== e.pointerId) return;
    const x = e.clientX - d.x, y = e.clientY - d.y;

    if (Math.hypot(x, y) > 4) d.moved = true;

    if (d.id) setOffsets(o => ({...o, [d.id!]: {x: d.origin.x + x / camera.zoom, y: d.origin.y + y / camera.zoom}}));
    else setCamera(c => ({...c, x: d.origin.x + x, y: d.origin.y + y}));
  }

  function endDrag(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;

 if (!d || d.pointer !== e.pointerId) return;
    suppressClick.current = d.moved;

    if (d.id && !d.moved && e.type !== 'pointercancel') {
      setSelected(d.id);
      const now = performance.now(), previous = lastClick.current;

      if (previous?.id === d.id && now - previous.time < 400) {lastClick.current = null; onOpen(d.id);}
      else lastClick.current = {id: d.id, time: now};
    } else lastClick.current = null;
    drag.current = null;

    if (canvas.current?.hasPointerCapture(e.pointerId)) canvas.current.releasePointerCapture(e.pointerId);
  }

  function resetFilters() { setQuery(''); setCategory(''); setKinds(['scene', 'wiki', 'memo']); setHideIsolated(false); setIncludePov(defaults.graphIncludePov); }

  function selectNeighbor(id: string) { setSelected(id); resetFilters();

 if (mode === 'local' || !visible.documents.some(d => d.id === id)) {setCenter(id); setMode('local');} }

  // 큰 지도와 좁은 화면은 축소 상태에서 선택한 문서만 제목을 보여 칩이 겹치지 않게 한다.
  const compact = (visible.documents.length > GRAPH_FULL_LABELS || size.width < 520) && camera.zoom < 1;

  return <section className={styles.graph} aria-label="문서 그래프">
    <header className={`board-bar ${styles.bar}`}>
      <div className="segmented" aria-label="그래프 범위">
        <button type="button" aria-pressed={mode === 'all'} onClick={() => setMode('all')}>전체</button>
        <button type="button" aria-pressed={mode === 'local'} onClick={() => {setMode('local'); setCenter(selected || initialDocumentId);}}>주변 연결</button>
      </div>
      <label className={styles.search}><Search size={14}/><input aria-label="그래프 문서 검색" placeholder="문서 제목 검색" value={query} onChange={e => setQuery(e.target.value)}/></label>
      <span className={styles.count} aria-live="polite">문서 {visible.documents.length} · 연결 {visible.edges.length}</span>
      <Popover open={filters} onOpenChange={setFilters} align="end" width={300} title="그래프 필터" trigger={<button type="button" className={`button ${styles.filterButton}`} aria-pressed={!!filtered}><SlidersHorizontal size={14}/>필터{filtered && <i className={styles.filterDot} aria-label="적용 중"/>}</button>}>
        <div className={styles.filters}>
          <fieldset><legend>문서 종류</legend>{(['scene', 'wiki', 'memo'] as const).map(kind => <label key={kind}><input type="checkbox" checked={kinds.includes(kind)} onChange={e => setKinds(k => e.target.checked ? [...k, kind] : k.filter(x => x !== kind))}/>{kindNames[kind]}</label>)}</fieldset>
          <label className={styles.field}>설정집 분류<select aria-label="그래프 설정집 분류" value={category} onChange={e => setCategory(e.target.value)}><option value="">모든 분류</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
          <label><input type="checkbox" checked={includePov} onChange={e => setIncludePov(e.target.checked)}/>시점 인물 연결</label>
          <label><input type="checkbox" checked={hideIsolated} onChange={e => setHideIsolated(e.target.checked)}/>연결 없는 문서 숨기기</label>
        </div>
        <div className="popover-actions"><button type="button" className="button" disabled={!filtered} onClick={resetFilters}><RotateCcw size={13}/>필터 초기화</button></div>
      </Popover>
    </header>
    {mode === 'local' && <div className={styles.localControls}>
      <label>중심 문서<select aria-label="그래프 중심 문서" value={center} onChange={e => {setCenter(e.target.value); setSelected(e.target.value);}}>{documents.map(d => <option value={d.id} key={d.id}>{documentTitle(d)}</option>)}</select></label>
      <label>범위<select aria-label="주변 연결 단계" value={depth} onChange={e => setDepth(Number(e.target.value))}>{[1, 2, 3].map(n => <option key={n} value={n}>{n}단계</option>)}</select></label>
    </div>}
    {visible.limited && <p className={styles.notice}>문서 {visible.documents.length} / {visible.total}개 · 연결 최대 {GRAPH_EDGE_LIMIT}개</p>}
    <div className={styles.body}>
      <div className={styles.canvas} ref={canvas} title="빈 곳을 끌어 이동 · 휠로 확대 · 두 번 눌러 문서 열기" onPointerDown={e => startDrag(e)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={e => {endDrag(e); suppressClick.current = true;}}>
        <svg className={styles.svg} width="100%" height="100%" viewBox={`0 0 ${size.width} ${size.height}`} tabIndex={0} role="group" aria-label="문서 관계 지도. 방향키로 이동, 더하기와 빼기로 확대 축소, Home으로 전체 맞춤"
          onKeyDown={e => {
            if (e.key === '+' || e.key === '=') zoomBy(1.2);
            else if (e.key === '-') zoomBy(1 / 1.2);
            else if (e.key === 'Home') fit();
            else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) setCamera(c => ({...c, x: c.x + (e.key === 'ArrowLeft' ? 40 : e.key === 'ArrowRight' ? -40 : 0), y: c.y + (e.key === 'ArrowUp' ? 40 : e.key === 'ArrowDown' ? -40 : 0)}));
            else return; e.preventDefault();
          }}>
          {lines.map(e => {const a = screen(point(e.source)), b = screen(point(e.target)), highlight = e.source === doc?.id || e.target === doc?.id;

 return <line key={`${e.source}-${e.target}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`${styles.edge} ${highlight ? styles.highlightEdge : ''}`} strokeDasharray={e.kind === 'pov' ? '4 4' : undefined}/>;})}
        </svg>
        <div className={styles.nodes}>
          {visible.documents.map(d => {const p = screen(point(d.id)), chosen = d.id === doc?.id, small = compact && !chosen;

 return <button type="button" key={d.id} className={`${styles.node} ${small ? styles.compact : ''}`} style={{transform: `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`}} aria-pressed={chosen} aria-label={`문서 선택: ${documentTitle(d)}`} title={`${documentTitle(d)} · ${kindNames[d.kind]}${d.category ? ` · ${d.category}` : ''}`}
            onPointerDown={e => startDrag(e, d.id)} onClick={() => {if (!suppressClick.current) setSelected(d.id);}}
            onKeyDown={e => {if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {e.preventDefault(); onOpen(d.id);}}}>
            <DocIcon doc={d} size={13}/>{!small && <span>{documentTitle(d)}</span>}{!small && d.kind === 'scene' && <i className={`status-dot ${d.status}`} role="img" aria-label={statuses[d.status]}/>}
          </button>;})}
        </div>
        {!visible.documents.length && <div className={styles.empty}><Network size={24}/><strong>표시할 문서가 없습니다.</strong><button type="button" className="button" onClick={resetFilters}>필터 초기화</button></div>}
        <div className={styles.zoomControls} aria-label="지도 조작"><button type="button" aria-label="그래프 확대" onClick={() => zoomBy(1.2)}><ZoomIn size={15}/></button><span>{Math.round(camera.zoom * 100)}%</span><button type="button" aria-label="그래프 축소" onClick={() => zoomBy(1 / 1.2)}><ZoomOut size={15}/></button><button type="button" aria-label="그래프 전체 맞춤" onClick={() => {setOffsets({}); fit();}}><Focus size={15}/></button></div>
        <div className={styles.legend} aria-hidden="true"><span><i/>본문 링크</span>{includePov && <span><i className={styles.dashed}/>시점 인물</span>}</div>
      </div>
      <aside className={styles.inspector} aria-label="그래프 문서 정보">
        {doc ? <>
          <span className={styles.kicker}><DocIcon doc={doc} size={13}/>{kindNames[doc.kind]}{doc.category && ` · ${doc.category}`}{doc.kind === 'scene' && <> · {statuses[doc.status]}</>}</span><h2>{documentTitle(doc)}</h2>
          {doc.summary && <p className={styles.summary}>{doc.summary}</p>}
          <div className={styles.docActions}><button type="button" className="button" onClick={() => onOpen(doc.id)}><ArrowUpRight size={14}/>문서 열기</button><button type="button" className="button" onClick={() => {setCenter(doc.id); setMode('local');}}><Network size={14}/>주변 연결</button></div>
          <h3>연결된 문서 <span>{related.length}</span></h3>
          {related.length ? <ul className={styles.relatedList}>{related.map(d => {const edges = neighbors.filter(e => e.source === d.id || e.target === d.id);

 return <li key={d.id}><button type="button" className={styles.related} onClick={() => selectNeighbor(d.id)}><DocIcon doc={d}/><span><strong>{documentTitle(d)}</strong><small>{[...new Set(edges.map(e => e.kind === 'pov' ? '시점 인물' : e.source === doc.id ? '이 문서에서 연결' : '이 문서를 참조'))].join(' · ')}</small></span></button></li>;})}</ul> : <p className={styles.hint}>연결된 문서가 없습니다.</p>}
        </> : <p className={styles.hint}>선택한 문서가 없습니다.</p>}
        <details className={styles.documentList}><summary>표시된 문서 목록 · {visible.documents.length}개</summary>{visible.documents.map(d => <button type="button" key={d.id} aria-pressed={d.id === doc?.id} onClick={() => setSelected(d.id)}><DocIcon doc={d}/><span>{documentTitle(d)}</span></button>)}</details>
      </aside>
    </div>
  </section>;
}
