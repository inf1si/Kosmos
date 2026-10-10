'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Archive, ArrowLeftRight, Files, FileUp, Keyboard, LayoutGrid, Palette, RotateCcw, Sparkles, StickyNote, Trash2, Type, User } from 'lucide-react';
import { AuthorProfilePanel } from './author-profile-panel';
import { Modal } from './primitives';
import { useStudio } from './studio-provider';
import { AISettingsPanel } from './ai-settings-dialog';
import { useAIConnection } from './use-ai-connection';
import { useAppPreferences, useStoredChoice } from './use-app-preferences';
import { useEditorPreferences } from './use-editor-preferences';
import { paletteOptions, useSitePalette, useThemeMode, type ThemeMode } from './theme-toggle';
import { manuscriptFontVariables } from './manuscript-fonts';
import { checkpointIntervals, defaultAppPreferences, lineHeights, manuscriptLayoutStyle, manuscriptWidths, NOTES_HOME_VIEW_KEY, NOTES_LIST_VIEW_KEY, notesHomeViews, notesListViews, paragraphGaps, paragraphIndents } from '@/lib/app-preferences';
import { defaultEditorPreferences, fontSizes, manuscriptFonts } from '@/lib/editor-preferences';
import { countMetrics } from '@/lib/text-statistics';

export type SettingsSection='display'|'manuscript'|'tools'|'notes'|'ai'|'data'|'keys'|'profile';

export const sections:{id:SettingsSection;label:string;icon:typeof Palette}[]=[
  {id:'display',label:'화면',icon:Palette},
  {id:'manuscript',label:'원고 표시',icon:Type},
  {id:'tools',label:'집필 도구',icon:LayoutGrid},
  {id:'notes',label:'노트',icon:StickyNote},
  {id:'ai',label:'AI',icon:Sparkles},
  {id:'data',label:'저장 · 백업',icon:Archive},
  {id:'keys',label:'단축키',icon:Keyboard},
  {id:'profile',label:'자기소개',icon:User},
];

const modal=(detail:string)=>window.dispatchEvent(new CustomEvent('studio-modal',{detail}));

/** One labelled setting: name and default on the left, the control on the right. */
function Row({label,hint,children}:{label:string;hint?:string;children:ReactNode}){
  return <div className="settings-row"><div className="settings-row-label"><span>{label}</span>{hint&&<small>{hint}</small>}</div><div className="settings-row-control">{children}</div></div>;
}

function Choice<T extends string|number|boolean>({label,value,options,onChange}:{label:string;value:T;options:readonly (readonly [T,string])[];onChange:(value:T)=>void}){
  return <div className="segmented" role="group" aria-label={label}>{options.map(([v,name])=><button type="button" key={String(v)} aria-pressed={value===v} onClick={()=>onChange(v)}>{name}</button>)}</div>;
}

function Head({onReset}:{onReset:()=>void}){
  return <div className="settings-head"><button type="button" className="button" onClick={onReset}><RotateCcw size={13}/>기본값으로</button></div>;
}

const onOff=[[true,'켬'],[false,'끔']] as const;

function DisplaySection(){
  const [palette,setPalette]=useSitePalette();const [mode,setMode]=useThemeMode();

  return <><Head onReset={()=>{setPalette('violet');setMode('system');}}/>
    <Row label="색 계열" hint="기본 보라"><Choice label="색 계열" value={palette} options={paletteOptions.map(p=>[p.id,p.name] as const)} onChange={setPalette}/></Row>
    <Row label="밝기" hint="기본 기기 설정 따름"><Choice<ThemeMode> label="밝기" value={mode} options={[['system','기기 설정'],['light','라이트'],['dark','다크']]} onChange={setMode}/></Row>
  </>;
}

function ManuscriptSection(){
  const [editor,setEditor]=useEditorPreferences();const [app,update,reset]=useAppPreferences();
  const font=manuscriptFonts.find(f=>f.id===editor.font)!;const sizes=fontSizes.includes(editor.size)?fontSizes:[...fontSizes,editor.size].sort((a,b)=>a-b);
  const defaultFont=manuscriptFonts.find(f=>f.id===defaultEditorPreferences.font)!.label;

  return <><Head onReset={()=>{setEditor({font:defaultEditorPreferences.font,size:defaultEditorPreferences.size});reset(['lineHeight','paragraphIndent','paragraphGap','manuscriptWidth']);}}/>
    <Row label="글꼴" hint={`기본 ${defaultFont}`}><select aria-label="본문 글꼴" value={editor.font} onChange={e=>setEditor({font:e.target.value})}>{manuscriptFonts.map(f=><option key={f.id} value={f.id}>{f.label}</option>)}</select></Row>
    <Row label="글자 크기" hint={`기본 ${defaultEditorPreferences.size}px`}><select aria-label="본문 글자 크기" value={editor.size} onChange={e=>setEditor({size:Number(e.target.value)})}>{sizes.map(n=><option key={n} value={n}>{n}px</option>)}</select></Row>
    <Row label="줄간격" hint={`기본 ${defaultAppPreferences.lineHeight}`}><Choice label="줄간격" value={app.lineHeight} options={lineHeights.map(n=>[n,String(n)] as const)} onChange={lineHeight=>update({lineHeight})}/></Row>
    <Row label="문단 첫 줄 들여쓰기" hint="기본 1글자"><Choice label="문단 첫 줄 들여쓰기" value={app.paragraphIndent} options={paragraphIndents.map(n=>[n,n?`${n}글자`:'없음'] as const)} onChange={paragraphIndent=>update({paragraphIndent})}/></Row>
    <Row label="문단 간격" hint={`기본 ${defaultAppPreferences.paragraphGap}줄`}><Choice label="문단 간격" value={app.paragraphGap} options={paragraphGaps.map(n=>[n,n?`${n}줄`:'없음'] as const)} onChange={paragraphGap=>update({paragraphGap})}/></Row>
    <Row label="본문 폭" hint={`기본 ${defaultAppPreferences.manuscriptWidth}px · 노트에도 적용`}><Choice label="본문 폭" value={app.manuscriptWidth} options={manuscriptWidths.map(n=>[n,`${n}px`] as const)} onChange={manuscriptWidth=>update({manuscriptWidth})}/></Row>
    <div className={`settings-preview ${manuscriptFontVariables}`} aria-label="원고 표시 미리보기" role="img"><div className="manuscript" style={{...manuscriptLayoutStyle(app),fontFamily:font.family,fontSize:`${editor.size}px`}}><p>다람쥐 헌 쳇바퀴에 타고파.</p><p>첫 문단 다음에는 이렇게 새 문단이 이어집니다.</p></div></div>
  </>;
}

function ToolsSection(){
  const [editor,setEditor]=useEditorPreferences();const [app,update,reset]=useAppPreferences();

  return <><Head onReset={()=>{setEditor({countMetric:defaultEditorPreferences.countMetric});reset(['studioStart','plotBoardMode','graphScope','graphDepth','graphIncludePov']);}}/>
    <Row label="집필실 첫 화면" hint="기본 집필실 홈"><Choice label="집필실 첫 화면" value={app.studioStart} options={[['home','집필실 홈'],['last','마지막 문서']]} onChange={studioStart=>update({studioStart})}/></Row>
    <Row label="글자 수 기준" hint="기본 공백 포함"><select aria-label="글자 수 기준" value={editor.countMetric} onChange={e=>{const metric=countMetrics.find(m=>m.id===e.target.value);

if(metric)setEditor({countMetric:metric.id});}}>{countMetrics.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></Row>
    <h3>플롯보드</h3>
    <Row label="첫 보기" hint="기본 부와 장"><Choice label="플롯보드 첫 보기" value={app.plotBoardMode} options={[['part','부와 장'],['status','진행 상태'],['time','작중 시간']]} onChange={plotBoardMode=>update({plotBoardMode})}/></Row>
    <h3>문서 그래프</h3>
    <Row label="첫 범위" hint="기본 전체"><Choice label="문서 그래프 첫 범위" value={app.graphScope} options={[['all','전체'],['local','주변 연결']]} onChange={graphScope=>update({graphScope})}/></Row>
    <Row label="주변 연결 단계" hint="기본 1단계"><Choice label="주변 연결 단계" value={app.graphDepth} options={[[1,'1단계'],[2,'2단계'],[3,'3단계']]} onChange={graphDepth=>update({graphDepth})}/></Row>
    <Row label="시점 인물 연결선" hint="기본 켬"><Choice label="시점 인물 연결선" value={app.graphIncludePov} options={onOff} onChange={graphIncludePov=>update({graphIncludePov})}/></Row>
  </>;
}

function NotesSection(){
  const [home,setHome]=useStoredChoice(NOTES_HOME_VIEW_KEY,notesHomeViews,'home');const [list,setList]=useStoredChoice(NOTES_LIST_VIEW_KEY,notesListViews,'tree');

  return <><Head onReset={()=>{setHome('home');setList('tree');}}/>
    <Row label="노트 홈 보기" hint="기본 최근"><Choice label="노트 홈 보기" value={home} options={[['home','최근'],['board','보드']]} onChange={setHome}/></Row>
    <Row label="노트 목록" hint="기본 폴더"><Choice label="노트 목록" value={list} options={[['tree','폴더'],['list','최근 수정순']]} onChange={setList}/></Row>
  </>;
}

function AISection(){
  const [app,update,reset]=useAppPreferences();const {providers,provider,storageAvailable,refreshProviders}=useAIConnection();

  return <><Head onReset={()=>reset(['aiIncludeManuscript','aiAttachLinked'])}/>
    <h3>새 대화의 보낼 자료</h3>
    <Row label="현재 문서 포함" hint="기본 켬"><Choice label="현재 문서 포함" value={app.aiIncludeManuscript} options={onOff} onChange={aiIncludeManuscript=>update({aiIncludeManuscript})}/></Row>
    <Row label="연결 설정 자동 첨부" hint="기본 켬 · 본문 링크와 시점 인물, 최대 8개"><Choice label="연결 설정 자동 첨부" value={app.aiAttachLinked} options={onOff} onChange={aiAttachLinked=>update({aiAttachLinked})}/></Row>
    <AISettingsPanel providers={providers} providerId={provider} storageAvailable={storageAvailable} onRefresh={refreshProviders}/>
  </>;
}

function DataSection(){
  const [app,update,reset]=useAppPreferences();const readonly=!!useStudio().conflict;

  return <><Head onReset={()=>reset(['checkpointMinutes'])}/>
    <Row label="자동 복구 지점" hint={`기본 ${defaultAppPreferences.checkpointMinutes}분마다 · 백업과 복구에서 되돌림`}><select aria-label="자동 복구 지점 간격" value={app.checkpointMinutes} onChange={e=>{const minutes=checkpointIntervals.find(n=>n===Number(e.target.value));

if(minutes)update({checkpointMinutes:minutes});}}>{checkpointIntervals.map(n=><option key={n} value={n}>{n}분마다</option>)}</select></Row>
    <div className="settings-links"><button type="button" className="button" onClick={()=>modal('backup')}><Archive size={14}/>백업과 복구</button><button type="button" className="button" onClick={()=>modal('interchange')}><ArrowLeftRight size={14}/>가져오기 · 내보내기</button><button type="button" className="button" disabled={readonly} onClick={()=>modal('note-import')}><FileUp size={14}/>노트 가져오기</button><button type="button" className="button" disabled={readonly} onClick={()=>modal('template')}><Files size={14}/>템플릿</button><button type="button" className="button" onClick={()=>modal('trash')}><Trash2 size={14}/>휴지통</button></div>
  </>;
}

const shortcuts:[string,string][]=[
  ['작품과 노트 검색','Ctrl/⌘ K'],
  ['빠른 메모 · 노트 공간에서는 새 노트','Alt/Option N'],
  ['빠른 메모를 수집함에 넣기','Ctrl/⌘ Enter'],
  ['AI 질문 · 선택 글 또는 현재 문단','Alt/Option Enter'],
  ['입력 메뉴 · 제목, 목록, AI, 내 스킬','/'],
  ['찾기 · 바꾸기','Ctrl/⌘ F · H'],
  ['설정 링크 · 노트 링크를 옆에 열기','Ctrl 클릭'],
  ['메뉴 · 팝오버 닫기','Esc'],
];

function KeysSection(){
  return <>
    <dl className="settings-keys">{shortcuts.map(([what,keys])=><div key={what}><dt>{what}</dt><dd><kbd>{keys}</kbd></dd></div>)}</dl>
  </>;
}

/** App-wide settings in one place. The body mounts only while open, so the AI section asks for providers only when shown. */
export function SettingsDialog({open,section='display',onClose,onReturnFocus}:{open:boolean;section?:SettingsSection;onClose:()=>void;onReturnFocus?:()=>void}){
  return <Modal open={open} onClose={onClose} onReturnFocus={onReturnFocus} title="설정" wide className="settings-modal"><SettingsBody initial={section}/></Modal>;
}

function SettingsBody({initial}:{initial:SettingsSection}){
  const [section,setSection]=useState<SettingsSection>(initial);const nav=useRef<HTMLElement>(null);
  // The narrow layout scrolls the section list sideways; keep the chosen one in view.
  useEffect(()=>{nav.current?.querySelector('[aria-pressed=true]')?.scrollIntoView({block:'nearest',inline:'nearest'});},[section]);
  const body={display:<DisplaySection/>,manuscript:<ManuscriptSection/>,tools:<ToolsSection/>,notes:<NotesSection/>,ai:<AISection/>,data:<DataSection/>,keys:<KeysSection/>,profile:<AuthorProfilePanel/>}[section];

  return <div className="settings-layout">
    <nav className="settings-nav" aria-label="설정 구역" ref={nav}>{sections.map(({id,label,icon:Icon})=><button type="button" key={id} className="nav-item" aria-pressed={section===id} onClick={()=>setSection(id)}><Icon size={16}/><span>{label}</span></button>)}</nav>
    <div className="settings-body" key={section}>{body}</div>
  </div>;
}
