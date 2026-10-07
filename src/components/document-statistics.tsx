'use client';

import { documentTitle } from '@/lib/model';

import { useMemo,useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { NovelDocument,RichNode,Work } from '@/lib/model';
import { countMetrics,manuscriptStatistics,textStatistics,type CountMetric } from '@/lib/text-statistics';
import { Popover } from './primitives';
import { useEditorPreferences } from './use-editor-preferences';
import styles from './document-statistics.module.css';

export function DocumentStatistics({doc,work,selection}:{doc:NovelDocument;work:Work;selection:RichNode|null}){
  const [open,setOpen]=useState(false);
  const [preferences,setPreferences]=useEditorPreferences();
  const stats=textStatistics(doc.content),metric=countMetrics.find(m=>m.id===preferences.countMetric)!;
  const selected=selection?textStatistics(selection):null;
  const whole=useMemo(()=>open?manuscriptStatistics(work.documents):null,[open,work.documents]);
  const value=(selected||stats)[metric.id],display=`${selected?'선택 영역 ':''}${value.toLocaleString()}${metric.unit}${metric.suffix?' · '+metric.suffix:''}`;
  const rows=[...countMetrics.map(m=>({key:m.id,label:m.label,unit:m.unit})),{key:'footnotes' as const,label:'각주 수',unit:'개'}];

  return <Popover open={open} onOpenChange={setOpen} align="end" width={380} title="문서 통계" description="표시 기준을 고르면 도구 모음에 바로 반영됩니다. 이 브라우저에 저장되는 보기 설정입니다." trigger={<button type="button" className={`char-count ${styles.trigger}`} aria-label={`${display} · 문서 통계 열기`} title="표시 기준·세부 통계">
    {selected&&<span className={styles.selection}>선택</span>}<span className="tape-counter" aria-hidden="true">{String(value).padStart(5,'0')}</span><span className="count-number">{value.toLocaleString()}</span>{metric.unit}<span className="count-suffix">{metric.suffix?' · '+metric.suffix:''}</span><ChevronDown size={12} aria-hidden="true"/>
  </button>}>
    <div className={styles.root}><label>도구 모음에 표시<select aria-label="통계 표시 기준" value={metric.id} onChange={e=>setPreferences({countMetric:countMetrics.find(metric=>metric.id===e.target.value)?.id||'charactersWithSpaces'})}>{countMetrics.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
      <p className={styles.document}>{documentTitle(doc)}</p>
      <table><caption>본문 통계 비교</caption><thead><tr><th scope="col">기준</th><th scope="col">현재 문서</th>{selected&&<th scope="col">선택 영역</th>}<th scope="col">전체 원고</th></tr></thead><tbody>{rows.map(row=><tr key={row.key}><th scope="row">{row.label}<span className={styles.unit}> · {row.unit}</span></th><td>{stats[row.key].toLocaleString()}</td>{selected&&<td>{selected[row.key].toLocaleString()}</td>}<td>{whole?.[row.key].toLocaleString()}</td></tr>)}</tbody></table>
      <p className={styles.help}>전체 원고는 이 작품의 원고 {work.documents.filter(d=>d.kind==='scene').length}개 합계입니다. 설정집·메모는 합계에 넣지 않습니다.{!selected&&' 본문에서 글을 선택한 뒤 열면 선택 영역도 비교합니다.'}</p>
      <details className={styles.rules}><summary>집계 기준</summary><ul className={styles.help}><li>문서 제목·요약·각주 본문은 글자 수에서 제외합니다. 각주는 따로 셉니다.</li><li>공백 포함은 띄어쓰기·탭을 포함하고 줄바꿈은 제외합니다. 이모지·결합 문자는 화면상의 한 글자를 1자로 셉니다.</li><li>단어는 공백·줄바꿈으로 나눈 어절입니다. 문장부호만 있는 묶음은 제외합니다.</li><li>문단은 내용이 있는 본문 문단입니다. 제목 서식·빈 문단은 제외합니다.</li><li>원고지는 공백 포함 글자 수를 200자로 나누어 올림한 환산입니다. 실제 조판 매수와 다를 수 있습니다.</li></ul></details>
    </div>
  </Popover>;
}
