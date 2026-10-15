'use client';

import { useMemo } from 'react';
import { documentTitle, type NovelDocument } from '@/lib/model';
import { manuscriptFonts } from '@/lib/editor-preferences';
import { paperColumns, paperRowsPerSheet, paperSheets, type PaperCell } from '@/lib/manuscript-paper';
import { manuscriptFontVariables } from './manuscript-fonts';
import { Modal } from './primitives';
import { useEditorPreferences } from './use-editor-preferences';

const blankRow:PaperCell[]=Array.from({length:paperColumns},()=>({text:''}));

/** Read-only 200자 원고지 sheets: the editor cannot keep letters in cells because manuscript fonts have uneven widths. */
export function ManuscriptPaper({doc,onClose}:{doc:NovelDocument|null;onClose:()=>void}){
  const [preferences]=useEditorPreferences();
  const font=manuscriptFonts.find(f=>f.id===preferences.font)||manuscriptFonts[0];
  const sheets=useMemo(()=>doc?paperSheets(doc.content):[],[doc]);

  return <Modal open={!!doc} onClose={onClose} title="원고지 보기" wide className="paper-modal">
    {doc&&<><p className="paper-meta">{documentTitle(doc)} · {sheets.length}매</p>
      <div className={`paper-sheets ${manuscriptFontVariables}`} style={/* SAFETY: React forwards CSS custom properties whose values here are strings or numbers. */ {'--paper-font':font.family} as React.CSSProperties}>
        {sheets.map((rows,sheet)=><section className="paper-sheet" key={sheet} aria-label={`${sheet+1}매`}>
          {Array.from({length:paperRowsPerSheet},(_,r)=>{const row=rows[r]||[];

return <div className="paper-row" key={r}>{[...row,...blankRow.slice(row.length)].map((cell,c)=><span key={c} className={cell.low?'low':undefined}>{cell.text}</span>)}</div>;})}
          <span className="paper-number">{sheet+1}</span>
        </section>)}
      </div></>}
  </Modal>;
}
