'use client';

import { Fragment, useState } from 'react';
import { Files, Folder, Trash2 } from 'lucide-react';
import { documentTitle } from '@/lib/model';
import { childrenOf, resolveNavigation, type DocumentDestination, type NavigationNode } from '@/lib/document-navigation';
import { noteTitle } from '@/lib/note-navigation';
import { templateSelection, templateTree, type TemplateSource } from '@/lib/workspace-templates';
import { useStudio } from './studio-provider';
import { DocIcon } from './studio-icons';
import { Modal } from './primitives';

export type TemplateDialogRequest={selected?:string[];destination?:DocumentDestination};

export function WorkspaceTemplates({source,request,onClose,onCreated}:{source:TemplateSource;request:TemplateDialogRequest;onClose:()=>void;onCreated:(id:string)=>void}){
  const s=useStudio(),[mode,setMode]=useState(request.selected?'save':'apply'),[selected,setSelected]=useState(request.selected||[]);
  const work=templateTree(s.state!,source),nav=resolveNavigation(work),noun=source.scope==='notes'?'노트':'문서';
  const label=(node:NavigationNode)=>node.type==='folder'?node.title:source.scope==='notes'?noteTitle(s.state!.notes!.find(n=>n.id===node.id)!):documentTitle(work.documents.find(d=>d.id===node.id)!);
  const [name,setName]=useState(request.selected?.length===1?label(nav.nodes.find(n=>n.id===request.selected![0])!):'');
  const [id,setId]=useState(''),[location,setLocation]=useState(request.destination?.parentId?`node:${request.destination.parentId}`:`section:${request.destination?.sectionId||nav.sections[0].id}`);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmDelete,setConfirmDelete]=useState(false);
  const readonly=busy||!s.canUse||!!s.conflict;
  const rows:{node:NavigationNode;depth:number;path:string}[]=[];

  function walk(sectionId:string,parentId:string|null,depth:number,path:string){
    for(const node of childrenOf(nav,parentId,sectionId)){const full=[path,label(node)].filter(Boolean).join(' / ');rows.push({node,depth,path:full});walk(sectionId,node.id,depth+1,full);}
  }

  for(const section of nav.sections)walk(section.id,null,0,source.scope==='notes'?'':section.title);
  const existing=new Set(nav.nodes.map(n=>n.id)),selection=selected.filter(id=>existing.has(id)),covered=templateSelection(nav,selection);
  const templates=(s.state!.templates||[]).filter(t=>t.scope===source.scope),template=templates.find(t=>t.id===id)||templates[0];
  const templateId=template?.id||'',count=nav.nodes.filter(n=>covered.has(n.id)&&n.type==='document').length;
  const options=[...nav.sections.map(section=>({value:`section:${section.id}`,label:source.scope==='notes'?'최상위':section.title})),...rows.map(row=>({value:`node:${row.node.id}`,label:row.path}))];
  const destination=options.some(o=>o.value===location)?location:options[0].value;

  async function run(operation:()=>Promise<void>){setBusy(true);setError('');

try{await operation();}catch(e){setError(e instanceof Error?e.message:'템플릿을 저장하지 못했습니다.');}finally{setBusy(false);}}

  async function save(){
    const created=await s.saveTemplate(source,selection,name);setId(created);setMode('apply');
  }

  async function apply(){
    const parentId=destination.startsWith('node:')?destination.slice(5):null;
    const sectionId=parentId?nav.nodes.find(n=>n.id===parentId)!.sectionId:destination.slice(8);
    const ids=await s.applyTemplate(templateId,source.scope==='notes'?{scope:'notes',to:{parentId}}:{...source,to:{sectionId,parentId}});
    onClose();onCreated(ids[0]);
  }

  return <Modal open onClose={()=>{if(!busy)onClose();}} title="템플릿" wide>
    <div className="template-controls segmented" role="group" aria-label="템플릿 작업"><button type="button" aria-pressed={mode==='apply'} disabled={busy} onClick={()=>{setMode('apply');setError('');}}>템플릿 사용</button><button type="button" aria-pressed={mode==='save'} disabled={busy} onClick={()=>{setMode('save');setError('');}}>새 템플릿 저장</button></div>
    {mode==='save'?<>
      <label>템플릿 이름<input aria-label="템플릿 이름" maxLength={200} value={name} disabled={readonly} onChange={e=>setName(e.target.value)}/></label>
      <div className="template-selection" role="group" aria-label="템플릿에 담을 항목">{rows.map(({node,depth,path},index)=>{
        const inherited=covered.has(node.id)&&!selection.includes(node.id);
        // Work trees span several sections; without a heading 원고 and 설정집 items look like one list.
        const heading=source.scope==='work'&&rows[index-1]?.node.sectionId!==node.sectionId?<h3 className="template-section">{nav.sections.find(section=>section.id===node.sectionId)?.title}</h3>:null;

        return <Fragment key={node.id}>{heading}<label className="transfer-export-row" style={{paddingInlineStart:12+Math.min(depth,3)*12}} title={path}><input type="checkbox" aria-label={`${label(node)} 템플릿에 포함`} checked={covered.has(node.id)} disabled={readonly||inherited} onChange={e=>setSelected(ids=>e.target.checked?[...ids,node.id]:ids.filter(id=>id!==node.id))}/>{node.type==='folder'?<Folder size={15}/>:<DocIcon doc={work.documents.find(d=>d.id===node.id)!}/>}<span>{label(node)}</span></label></Fragment>;
      })}</div>
      <p className="field-help">{noun} {count}개 · 폴더 {nav.nodes.filter(n=>n.type==='folder'&&covered.has(n.id)).length}개</p>
      <p className="field-help">본문·속성·첨부·내부 연결을 복사합니다. 묶음 밖 문서 연결·AI 대화·공개 상태·작품 연결은 복사하지 않습니다.</p>
      <div className="modal-actions"><button type="button" className="button primary" disabled={readonly||!count||!name.trim()} onClick={()=>void run(save)}>{busy?'저장 중':'템플릿 저장'}</button></div>
    </>:templates.length?<>
      <div className="form-grid"><label>저장한 템플릿<select aria-label="저장한 템플릿" disabled={readonly} value={templateId} onChange={e=>{setId(e.target.value);}}>{templates.map(t=><option key={t.id} value={t.id}>{t.name} · {t.scope==='work'?t.documents.length:t.notes.length}개</option>)}</select></label><label>넣을 위치<select aria-label="템플릿을 넣을 위치" disabled={readonly} value={destination} onChange={e=>setLocation(e.target.value)}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label></div>
      <p className="field-help"><Files size={14}/> {template?.scope==='work'?template.documents.length:template?.notes.length}개를 새 {noun}로 만듭니다. 원본과 템플릿은 유지됩니다.</p>
      <div className="modal-actions"><button type="button" className="button" disabled={readonly} onClick={()=>setConfirmDelete(true)}><Trash2 size={14}/>템플릿 삭제</button><button type="button" className="button primary" disabled={readonly} onClick={()=>void run(apply)}>{busy?'만드는 중':'템플릿으로 만들기'}</button></div>
    </>:<p className="muted">저장한 템플릿이 없습니다. 새 템플릿 저장에서 항목을 선택하세요.</p>}
    {error&&<p className="error-message" role="alert">{error}</p>}
    <Modal open={confirmDelete} onClose={()=>{if(!busy)setConfirmDelete(false);}} title="템플릿 삭제"><p>‘{template?.name}’ 템플릿을 삭제할까요?</p><p className="field-help">이미 만든 문서는 유지됩니다.</p><div className="modal-actions"><button type="button" className="button" disabled={busy} onClick={()=>setConfirmDelete(false)}>취소</button><button type="button" className="button danger" disabled={readonly} onClick={()=>void run(async()=>{await s.deleteTemplate(templateId);setConfirmDelete(false);})}>삭제</button></div>{error&&<p className="error-message" role="alert">{error}</p>}</Modal>
  </Modal>;
}
