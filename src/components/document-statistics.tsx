'use client';

import { documentTitle } from '@/lib/model';

import { useMemo,useState } from 'react';
import { ChevronDown, Grid3x3 } from 'lucide-react';
import type { NovelDocument,RichNode,Work } from '@/lib/model';
import { countMetrics,manuscriptStatistics,textStatistics,type CountMetric } from '@/lib/text-statistics';
import { Popover } from './primitives';
import { useEditorPreferences } from './use-editor-preferences';
import styles from './document-statistics.module.css';
import { Select } from './select';

export function DocumentStatistics({doc,work,selection,onPaper}:{doc:NovelDocument;work:Work;selection:RichNode|null;onPaper?:()=>void}){
  const [open,setOpen]=useState(false);
  const [preferences,setPreferences]=useEditorPreferences();
  const stats=textStatistics(doc.content),metric=countMetrics.find(m=>m.id===preferences.countMetric)!;
  const selected=selection?textStatistics(selection):null;
  const whole=useMemo(()=>open?manuscriptStatistics(work.documents):null,[open,work.documents]);
  const value=(selected||stats)[metric.id],display=`${selected?'선택 영역 ':''}${value.toLocaleString()}${metric.unit}${metric.suffix?' · '+metric.suffix:''}`;
  const rows=[...countMetrics.map(m=>({key:m.id,label:m.label,unit:m.unit})),{key:'footnotes' as const,label:'각주 수',unit:'개'}];

  return <Popover open={open} onOpenChange={setOpen} align="end" width={380} title="문서 통계" trigger={<button type="button" className={`char-count ${styles.trigger}`} aria-label={`${display} · 문서 통계 열기`} title="표시 기준·세부 통계">
    {selected&&<span className={styles.selection}>선택</span>}<span className="tape-counter" aria-hidden="true">{String(value).padStart(5,'0')}</span><span className="count-number">{value.toLocaleString()}</span>{metric.unit}<span className="count-suffix">{metric.suffix?' · '+metric.suffix:''}</span><ChevronDown size={12} aria-hidden="true"/>
  </button>}>
    <div className={styles.root}><label>도구 모음에 표시<Select aria-label="통계 표시 기준" value={metric.id} onChange={value=>setPreferences({countMetric:countMetrics.find(metric=>metric.id===value)?.id||'charactersWithSpaces'})}>{countMetrics.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</Select></label>
      <p className={styles.document}>{documentTitle(doc)}</p>
      <table><caption>본문 통계 비교</caption><thead><tr><th scope="col">기준</th><th scope="col">현재 문서</th>{selected&&<th scope="col">선택 영역</th>}<th scope="col">전체 원고</th></tr></thead><tbody>{rows.map(row=><tr key={row.key}><th scope="row">{row.label}<span className={styles.unit}> · {row.unit}</span></th><td>{stats[row.key].toLocaleString()}</td>{selected&&<td>{selected[row.key].toLocaleString()}</td>}<td>{whole?.[row.key].toLocaleString()}</td></tr>)}</tbody></table>
      {onPaper&&<button type="button" className={`button ${styles.paper}`} onClick={()=>{setOpen(false);onPaper();}}><Grid3x3 size={14} aria-hidden="true"/>원고지로 보기</button>}
    </div>
  </Popover>;
}
