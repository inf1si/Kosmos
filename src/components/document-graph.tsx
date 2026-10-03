'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { ArrowUpRight, FileText, Focus, Network, RotateCcw, Search, SlidersHorizontal, StickyNote, ZoomIn, ZoomOut } from 'lucide-react';
import { NovelDocument } from '@/lib/model';
import { buildDocumentGraph, filterDocumentGraph, GRAPH_EDGE_LIMIT, GRAPH_LIMIT, layoutDocumentGraph, type GraphPoint } from '@/lib/document-graph';
import { WikiIcon } from './studio-icons';
import styles from './document-graph.module.css';

const kindNames = { scene: '원고', wiki: '설정집', memo: '메모' } as const;
const clampZoom = (z: number) => Math.max(0.05, Math.min(4, z));
function Shape({kind, selected = false}: {kind: NovelDocument['kind']; selected?: boolean}) {
  const props = { className: `${styles.nodeShape} ${selected ? styles.selectedShape : ''}` };
  return kind === 'scene' ? <rect {...props} x={-8} y={-8} width={16} height={16} rx={3}/>
    : kind === 'memo' ? <path {...props} d="M0 -10 L10 0 L0 10 L-10 0 Z"/> : <circle {...props} r={9}/>;
}
function DocIcon({doc}: {doc: NovelDocument}) { return doc.kind === 'wiki' ? <WikiIcon category={doc.category} size={14}/> : doc.kind === 'memo' ? <StickyNote size={14}/> : <FileText size={14}/>; }

export function DocumentGraph({documents, initialDocumentId, onOpen}: {documents: NovelDocument[]; initialDocumentId: string; onOpen: (id: string) => void}) {
  const [mode, setMode] = useState<'all' | 'local'>('all');
  const [center, setCenter] = useState(initialDocumentId);
  const [selected, setSelected] = useState(initialDocumentId);
  const [query, setQuery] = useState(''), [category, setCategory] = useState('');
  const [kinds, setKinds] = useState<NovelDocument['kind'][]>(['scene', 'wiki', 'memo']);
  const [depth, setDepth] = useState(1), [includePov, setIncludePov] = useState(true), [hideIsolated, setHideIsolated] = useState(false);
  const [filters, setFilters] = useState(false);
  const [size, setSize] = useState({width: 800, height: 500});
  const [camera, setCamera] = useState({x: 400, y: 250, zoom: 1});
  const [offsets, setOffsets] = useState<Record<string, GraphPoint>>({});
  const canvas = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{id?: string; pointer: number; x: number; y: number; moved: boolean; origin: GraphPoint} | null>(null);
  const suppressClick = useRef(false);
  const lastClick = useRef<{id: string; time: number} | null>(null);
  const graph = useMemo(() => buildDocumentGraph(documents), [documents]);
  const visible = useMemo(() => filterDocumentGraph(graph, {kinds, query, category, includePov, hideIsolated, center: mode === 'local' ? center : undefined, depth}), [graph, kinds, query, category, includePov, hideIsolated, mode, center, depth]);
  const points = useMemo(() => layoutDocumentGraph(visible.documents, visible.edges), [visible]);
  const categories = [...new Set(documents.filter(d => d.kind === 'wiki').map(d => d.category.trim()).filter(Boolean))].sort();
  const doc = visible.documents.find(d => d.id === selected);
  const neighbors = doc ? graph.edges.filter(e => (includePov || e.kind === 'link') && (e.source === doc.id || e.target === doc.id)) : [];
  const related = [...new Set(neighbors.map(e => e.source === doc?.id ? e.target : e.source))].map(id => documents.find(d => d.id === id)).filter((d): d is NovelDocument => !!d);
  const point = (id: string) => offsets[id] || points.get(id)!;

  useEffect(() => {
    const observer = new ResizeObserver(entries => { const {width, height} = entries[0].contentRect; if (width && height) setSize({width, height}); });
    observer.observe(canvas.current!); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const element = svg.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); const r = element.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      setCamera(c => {const zoom = clampZoom(c.zoom * Math.exp(-e.deltaY * 0.0015)), ratio = zoom / c.zoom; return {zoom, x: x - (x - c.x) * ratio, y: y - (y - c.y) * ratio};});
    };
    element.addEventListener('wheel', wheel, {passive: false});
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  function fit() {
    const positions = [...points.values()];
    if (!positions.length) { setCamera({x: size.width / 2, y: size.height / 2, zoom: 1}); return; }
    const xs = positions.map(p => p.x), ys = positions.map(p => p.y);
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
    const zoom = Math.min(1.5, clampZoom(Math.min(size.width / (right - left + 250), size.height / (bottom - top + 130))));
    setCamera({x: size.width / 2 - (left + right) / 2 * zoom, y: size.height / 2 - (top + bottom) / 2 * zoom, zoom});
  }
  useEffect(() => { setOffsets({}); fit(); /* Fit when the visible graph or canvas changes. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, size.width, size.height]);
  function zoomBy(factor: number, x = size.width / 2, y = size.height / 2) {
    setCamera(c => { const zoom = clampZoom(c.zoom * factor), ratio = zoom / c.zoom; return {zoom, x: x - (x - c.x) * ratio, y: y - (y - c.y) * ratio}; });
  }
  function startDrag(e: PointerEvent<SVGElement>, id?: string) {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); suppressClick.current = false;
    drag.current = {id, pointer: e.pointerId, x: e.clientX, y: e.clientY, moved: false, origin: id ? point(id) : {x: camera.x, y: camera.y}};
    svg.current?.setPointerCapture(e.pointerId);
  }
  function moveDrag(e: PointerEvent<SVGSVGElement>) {
    const d = drag.current; if (!d || d.pointer !== e.pointerId) return;
    const x = e.clientX - d.x, y = e.clientY - d.y;
    if (Math.hypot(x, y) > 4) d.moved = true;
    if (d.id) setOffsets(o => ({...o, [d.id!]: {x: d.origin.x + x / camera.zoom, y: d.origin.y + y / camera.zoom}}));
    else setCamera(c => ({...c, x: d.origin.x + x, y: d.origin.y + y}));
  }
  function endDrag(e: PointerEvent<SVGSVGElement>) {
    const d = drag.current; if (!d || d.pointer !== e.pointerId) return;
    suppressClick.current = d.moved;
    if (d.id && !d.moved && e.type !== 'pointercancel') {
      setSelected(d.id);
      const now = performance.now(), previous = lastClick.current;
      if (previous?.id === d.id && now - previous.time < 400) {lastClick.current = null; onOpen(d.id);}
      else lastClick.current = {id: d.id, time: now};
    } else lastClick.current = null;
    drag.current = null;
    if (svg.current?.hasPointerCapture(e.pointerId)) svg.current.releasePointerCapture(e.pointerId);
  }
  function resetFilters() { setQuery(''); setCategory(''); setKinds(['scene', 'wiki', 'memo']); setHideIsolated(false); setIncludePov(true); }
  function selectNeighbor(id: string) { setSelected(id); resetFilters(); if (mode === 'local' || !visible.documents.some(d => d.id === id)) {setCenter(id); setMode('local');} }
  return <section className={styles.graph} aria-label="문서 그래프">
    <header className={styles.bar}>
      <span className={styles.heading}><Network size={16}/>문서 그래프</span>
      <div className="segmented" aria-label="그래프 범위">
        <button type="button" aria-pressed={mode === 'all'} onClick={() => setMode('all')}>전체</button>
        <button type="button" aria-pressed={mode === 'local'} onClick={() => {setMode('local'); setCenter(selected || initialDocumentId);}}>주변 연결</button>
      </div>
      <button type="button" className={styles.filterToggle} aria-expanded={filters} aria-controls="graph-filters" onClick={() => setFilters(v => !v)}><SlidersHorizontal size={14}/>필터</button>
    </header>
    <div className={styles.searchRow}>
      <label className={styles.search}><Search size={14}/><input aria-label="그래프 문서 검색" placeholder="문서 제목 검색" value={query} onChange={e => setQuery(e.target.value)}/></label>
      <span className={styles.count} aria-live="polite">문서 {visible.documents.length} · 연결 {visible.edges.length}</span>
    </div>
    {mode === 'local' && <div className={styles.localControls}>
      <label>중심 문서<select aria-label="그래프 중심 문서" value={center} onChange={e => {setCenter(e.target.value); setSelected(e.target.value);}}>{documents.map(d => <option value={d.id} key={d.id}>{d.title}</option>)}</select></label>
      <label>범위<select aria-label="주변 연결 단계" value={depth} onChange={e => setDepth(Number(e.target.value))}>{[1, 2, 3].map(n => <option key={n} value={n}>{n}단계</option>)}</select></label>
    </div>}
    {filters && <div className={styles.filters} id="graph-filters">
      <fieldset><legend>문서 종류</legend>{(['scene', 'wiki', 'memo'] as const).map(kind => <label key={kind}><input type="checkbox" checked={kinds.includes(kind)} onChange={e => setKinds(k => e.target.checked ? [...k, kind] : k.filter(x => x !== kind))}/>{kindNames[kind]}</label>)}</fieldset>
      <label>설정집 분류<select aria-label="그래프 설정집 분류" value={category} onChange={e => setCategory(e.target.value)}><option value="">모든 분류</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
      <label><input type="checkbox" checked={includePov} onChange={e => setIncludePov(e.target.checked)}/>시점 인물 연결</label>
      <label><input type="checkbox" checked={hideIsolated} onChange={e => setHideIsolated(e.target.checked)}/>연결 없는 문서 숨기기</label>
      <button type="button" className={styles.textButton} onClick={resetFilters}><RotateCcw size={13}/>필터 초기화</button>
    </div>}
    {visible.limited && <p className={styles.notice}>검색 결과 {visible.total}개 중 최대 {GRAPH_LIMIT}개 문서와 {GRAPH_EDGE_LIMIT}개 연결을 표시합니다. 검색이나 주변 연결로 범위를 좁혀주세요.</p>}
    <div className={styles.body}>
      <div className={styles.canvas} ref={canvas}>
        <svg ref={svg} className={styles.svg} width="100%" height="100%" viewBox={`0 0 ${size.width} ${size.height}`} tabIndex={0} role="group" aria-label="문서 관계 지도. 방향키로 이동, 더하기와 빼기로 확대 축소, Home으로 전체 맞춤"
          onPointerDown={e => startDrag(e)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={e => {endDrag(e); suppressClick.current = true;}}
          onKeyDown={e => {
            if (e.target !== e.currentTarget) return;
            if (e.key === '+' || e.key === '=') zoomBy(1.2);
            else if (e.key === '-') zoomBy(1 / 1.2);
            else if (e.key === 'Home') fit();
            else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) setCamera(c => ({...c, x: c.x + (e.key === 'ArrowLeft' ? 40 : e.key === 'ArrowRight' ? -40 : 0), y: c.y + (e.key === 'ArrowUp' ? 40 : e.key === 'ArrowDown' ? -40 : 0)}));
            else return; e.preventDefault();
          }}>
          <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
            {visible.edges.map(e => {const a = point(e.source), b = point(e.target), highlight = e.source === doc?.id || e.target === doc?.id; return <line key={`${e.source}-${e.target}-${e.kind}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`${styles.edge} ${highlight ? styles.highlightEdge : ''}`} strokeDasharray={e.kind === 'pov' ? '5 5' : undefined}/>;})}
            {visible.documents.map(d => {const p = point(d.id), chosen = d.id === doc?.id; return <g key={d.id} data-node="true" transform={`translate(${p.x} ${p.y})`} className={`${styles.node} ${chosen ? styles.selectedNode : ''}`} role="button" tabIndex={0} aria-label={`문서 선택: ${d.title}`} aria-pressed={chosen}
              onPointerDown={e => startDrag(e, d.id)} onClick={() => {if (!suppressClick.current) setSelected(d.id);}}
              onKeyDown={e => {if (e.key === 'Enter' || e.key === ' ') {e.preventDefault(); e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onOpen(d.id); else {setSelected(d.id); suppressClick.current = false;}}}}>
              <title>{d.title} · {kindNames[d.kind]}{d.category ? ` · ${d.category}` : ''}</title>
              <circle r={22} className={styles.hitArea}/><Shape kind={d.kind} selected={chosen}/>
              {(visible.documents.length <= 50 || camera.zoom >= 1 || chosen) && <text y={28} textAnchor="middle" className={styles.nodeLabel}>{d.title.length > 18 ? `${d.title.slice(0, 17)}…` : d.title}</text>}
            </g>;})}
          </g>
        </svg>
        {!visible.documents.length && <div className={styles.empty}><Network size={24}/><strong>표시할 문서가 없습니다.</strong><p>검색어나 필터를 조정해보세요.</p><button type="button" onClick={resetFilters}>필터 초기화</button></div>}
        <div className={styles.zoomControls} aria-label="지도 조작"><button type="button" aria-label="그래프 확대" onClick={() => zoomBy(1.2)}><ZoomIn size={16}/></button><span>{Math.round(camera.zoom * 100)}%</span><button type="button" aria-label="그래프 축소" onClick={() => zoomBy(1 / 1.2)}><ZoomOut size={16}/></button><button type="button" aria-label="그래프 전체 맞춤" onClick={() => {setOffsets({}); fit();}}><Focus size={16}/></button></div>
      </div>
      <aside className={styles.inspector} aria-label="그래프 문서 정보">
        {doc ? <>
          <span className={styles.kicker}>{kindNames[doc.kind]}{doc.category && ` · ${doc.category}`}</span><h2>{doc.title}</h2>
          <div className={styles.docActions}><button type="button" onClick={() => onOpen(doc.id)}>문서 열기<ArrowUpRight size={14}/></button><button type="button" onClick={() => {setCenter(doc.id); setMode('local');}}>주변 연결</button></div>
          {doc.summary && <p className={styles.summary}>{doc.summary}</p>}
          <h3>연결된 문서 <span>{related.length}</span></h3>
          {related.length ? related.map(d => {const edges = neighbors.filter(e => e.source === d.id || e.target === d.id); return <button type="button" className={styles.related} key={d.id} onClick={() => selectNeighbor(d.id)}><DocIcon doc={d}/><span><strong>{d.title}</strong><small>{[...new Set(edges.map(e => e.kind === 'pov' ? '시점 인물' : e.source === doc.id ? '이 문서에서 연결' : '이 문서를 참조'))].join(' · ')}</small></span></button>;}) : <p className={styles.hint}>본문의 ‘설정 링크 추가’로 다른 문서를 연결할 수 있습니다.</p>}
        </> : <p className={styles.hint}>노드를 선택하면 연결된 문서를 볼 수 있습니다. 두 번 누르면 문서가 열립니다.</p>}
        <details className={styles.documentList}><summary>표시된 문서 목록 ({visible.documents.length})</summary>{visible.documents.map(d => <button type="button" key={d.id} aria-pressed={d.id === doc?.id} onClick={() => setSelected(d.id)}><DocIcon doc={d}/><span>{d.title}</span></button>)}</details>
      </aside>
    </div>
    <footer className={styles.footer}><span className={styles.legend}>{(['scene', 'wiki', 'memo'] as const).map(kind => <span key={kind}><svg width="20" height="20" viewBox="-12 -12 24 24" aria-hidden="true"><Shape kind={kind}/></svg>{kindNames[kind]}</span>)}<span><i/>본문 링크</span>{includePov && <span><i className={styles.dashed}/>시점 인물</span>}</span><span className={styles.gestureHint}>드래그로 이동 · 휠로 확대 · 두 번 눌러 문서 열기</span></footer>
  </section>;
}
