'use client';

import { assetSchema } from '@/lib/model';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Workspace, LocalRecord, uid, Revision, Publication, makePublication, withdrawPublication, AssetMeta } from '@/lib/model';
import { seedWorkspace } from '@/lib/seed';
import { db, writeLocal, checkpoint, LocalConflict, listRevisions } from '@/lib/database';
import { cloud, cloudConfigured, fetchCloud, initializeCloud, saveCloud, publishCloud, unpublishCloud, authorLibrary, reorderLibrary } from '@/lib/cloud';
import { previewPositions, previewPublicationPosition, previewPublications, reorderPreviewLibrary, type LibraryItem } from '@/lib/library-order';
import { createBackup, readBackup } from '@/lib/backup';
import { prepareImport, exportInterchange, type ImportBundle, type ImportChoice, type ExportFormat, type TransferDownload } from '@/lib/interchange';
import type { Work } from '@/lib/model';
import { applyNavigation, resolveNavigation } from '@/lib/document-navigation';
import { preserveAIPreferences } from '@/lib/ai-prompt-presets';
import { preserveNotes, preserveNoteDetails, prepareFolderWork, prepareNoteCopy, prepareNoteImport } from '@/lib/personal-notes';
import { materializeNoteNavigation } from '@/lib/note-navigation';
import { materializeTrash, preserveTrash, trashNote as moveNoteToTrash, trashDocument as moveDocumentToTrash, trashDocumentFolder as moveDocumentFolderToTrash, trashNoteFolder as moveNoteFolderToTrash, trashWork as moveWorkToTrash, restoreTrash as restoreTrashItem, purgeTrash as purgeTrashItems } from '@/lib/workspace-trash';
import type { NovelDocument } from '@/lib/model';
import { isRejectedLegacyTrashSave,recoverLegacyTrash } from '@/lib/sync-recovery';
import { prepareTemplate, prepareTemplateApplication, preserveTemplateData, removeTemplate, type TemplateSource, type TemplateTarget } from '@/lib/workspace-templates';
import { useAppPreferences } from './use-app-preferences';

type Conflict={local:Workspace;remote:Workspace;remoteLocalVersion?:number;remoteCloudVersion?:number};

type StudioContextValue={
  state:Workspace|null;namespace:string;loading:boolean;status:string;error:string;conflict:Conflict|null;
  user:string|null;canUse:boolean;epoch:number;lastExportAt:string|null;
  update:(fn:(state:Workspace)=>Workspace)=>void;
  snapshot:(label:string)=>Promise<void>;revisions:()=>Promise<Revision[]>;restore:(data:Workspace)=>Promise<void>;
  exportBackup:()=>Promise<TransferDownload>;importBackup:(file:File)=>Promise<void>;
  importDocuments:(bundle:ImportBundle,choices:ImportChoice[],target:{workId:string}|{title:string;form:Work['form']})=>Promise<string>;
  exportDocuments:(workId:string,documentIds:string[],format:ExportFormat)=>Promise<TransferDownload>;
  publish:(workId:string,sceneIds:string[])=>Promise<Publication>;unpublish:(workId:string)=>Promise<void>;
  libraryPublications:()=>Promise<LibraryItem[]>;setLibraryOrder:(ids:string[])=>Promise<LibraryItem[]>;
  addAsset:(workId:string,docId:string,file:File)=>Promise<void>;
  addNoteAsset:(noteId:string,file:File)=>Promise<string>;importNotes:(bundle:ImportBundle,folderTitle:string)=>Promise<{folderId:string;count:number}>;createWorkFromFolder:(folderId:string,target:{title:string;form:Work['form']})=>Promise<string>;copyNote:(noteId:string,workId:string,kind:NovelDocument['kind'])=>Promise<string>;
  trashNote:(noteId:string)=>Promise<void>;
  trashDocument:(workId:string,docId:string)=>Promise<string>;trashWork:(workId:string)=>Promise<void>;
  trashDocumentFolder:(workId:string,folderId:string)=>Promise<string>;trashNoteFolder:(folderId:string)=>Promise<void>;
  restoreTrash:(id:string)=>Promise<void>;purgeTrash:(ids:string[])=>Promise<void>;
  resolve:(choice:'local'|'remote')=>Promise<void>;login:(email:string,password:string)=>Promise<void>;logout:()=>Promise<void>;
  flush:()=>Promise<void>;syncNow:()=>Promise<void>;clearError:()=>void;
  saveTemplate:(source:TemplateSource,selected:string[],name:string)=>Promise<string>;
  applyTemplate:(id:string,target:TemplateTarget)=>Promise<string[]>;deleteTemplate:(id:string)=>Promise<void>;
};

const Context=createContext<StudioContextValue|null>(null);

export function useStudio(){const c=useContext(Context);

if(!c)throw new Error('Studio provider missing');

return c;}

export function StudioProvider({children,localPreview}:{children:ReactNode;localPreview:boolean}){
  const [state,setState]=useState<Workspace|null>(null);const dataRef=useRef<Workspace|null>(null);
  const [{checkpointMinutes}]=useAppPreferences();
  const [namespace,setNamespace]=useState('preview');const namespaceRef=useRef('preview');
  const [user,setUser]=useState<string|null>(null);const [loading,setLoading]=useState(true);
  const [status,setStatus]=useState('불러오는 중');const [error,setError]=useState('');const [conflict,setConflict]=useState<Conflict|null>(null);
  const conflictRef=useRef<Conflict|null>(null);const [epoch,setEpoch]=useState(0);const [lastExportAt,setLastExportAt]=useState<string|null>(null);
  const recordRef=useRef<LocalRecord|null>(null);const saveQueue=useRef<Promise<void>>(Promise.resolve());
  const channelRef=useRef<BroadcastChannel|null>(null);const cloudId=useRef<string|null>(null);
  const syncing=useRef(false);const timer=useRef<ReturnType<typeof setTimeout>|null>(null);const pending=useRef(0);
  const openedFor=useRef<string|null|undefined>(undefined);
  const syncError=useRef<string|null>(null);
  const canUse=cloudConfigured?!!user:localPreview;
  const showConflict=useCallback((value:Conflict)=>{conflictRef.current=value;setConflict(value);setStatus('충돌 확인 필요');},[]);
  const setCurrent=useCallback((data:Workspace)=>{dataRef.current=data;setState(data);},[]);

  const syncNow=useCallback(async()=>{
    if(!cloudConfigured||!cloudId.current||syncing.current||conflictRef.current)return;
    await saveQueue.current;

    if(!navigator.onLine){setStatus('연결 끊김 · 이 기기에 저장됨');

return;}

    const targetNamespace=namespaceRef.current,targetCloudId=cloudId.current;
    const r=await db.workspaces.get(targetNamespace);

if(!r?.dirty||syncing.current||conflictRef.current)return;
    syncing.current=true;setStatus('클라우드 동기화 중');
    const operation=r.pendingRequest?.baseVersion===r.cloudVersion?r.pendingRequest:{id:uid(),localVersion:r.localVersion,baseVersion:r.cloudVersion,data:r.data};
    let recovered=false;

    try{
      await db.transaction('rw',db.workspaces,async()=>{const row=await db.workspaces.get(targetNamespace);

if(row)await db.workspaces.put({...row,pendingRequest:operation});});
      const result=await saveCloud(targetCloudId,operation.baseVersion,operation.data,operation.id);

      if(namespaceRef.current!==targetNamespace)return;

      if(result.status==='conflict'){
        try{await checkpoint(namespaceRef.current,dataRef.current!,'클라우드 충돌 · 기기 원고');}catch{setError('충돌 원고를 이력에 저장하지 못했습니다. ZIP으로 보관하세요.');}

        showConflict({local:dataRef.current!,remote:result.payload!,remoteCloudVersion:result.version});

return;
      }

      await db.transaction('rw',db.workspaces,async()=>{
        const current=await db.workspaces.get(namespaceRef.current);

if(!current)return;
        const next={...current,cloudVersion:result.version,dirty:current.localVersion!==operation.localVersion,pendingRequest:undefined};
        await db.workspaces.put(next);recordRef.current=next;
        setStatus(next.dirty?'이 기기에 저장됨 · 전송 대기':'클라우드 동기화됨');
      });
      const message=syncError.current;setError(value=>value===message?'':value);syncError.current=null;
    }catch(e){
      try{
        if(!isRejectedLegacyTrashSave(e instanceof Error?e:undefined,operation.data))throw e;
        const remote=await fetchCloud();

        if(!remote||remote.id!==targetCloudId||namespaceRef.current!==targetNamespace)throw e;

        // Serialize recovery with edits: use the latest local body, not the rejected snapshot.
        const recovery=saveQueue.current.then(async()=>{
          await db.transaction('rw',db.workspaces,async()=>{
            const current=await db.workspaces.get(targetNamespace);

            if(namespaceRef.current!==targetNamespace||cloudId.current!==targetCloudId||!current||current.pendingRequest?.id!==operation.id||current.cloudVersion!==operation.baseVersion)return;

            if(current.localVersion!==recordRef.current?.localVersion){showConflict({local:dataRef.current!,remote:current.data,remoteLocalVersion:current.localVersion});

return;}

            const data=remote.version===current.cloudVersion?recoverLegacyTrash(current.data,remote.data):null;

            if(!data){showConflict({local:dataRef.current!,remote:remote.data,remoteCloudVersion:remote.version});

return;}

            const next={...current,data,pendingRequest:undefined};
            await db.workspaces.put(next);

if(namespaceRef.current!==targetNamespace)return;recordRef.current=next;

            // Only an absent empty field is added; preserve edits already displayed/queued.
            if(dataRef.current&&dataRef.current.trash===undefined)setCurrent({...dataRef.current,trash:data.trash});
            recovered=true;setStatus('이 기기에 저장됨 · 전송 대기');
          });
        });

        // A failed compatibility read/write must not poison subsequent local saves.
        saveQueue.current=recovery.catch(()=>{});await recovery;
      }catch(failure){const message=failure instanceof Error?failure.message:'클라우드 저장을 완료하지 못했습니다.';syncError.current=message;setError(message);setStatus('이 기기에 저장됨 · 클라우드 재시도 필요');}
    }finally{syncing.current=false;

if(recovered)queueMicrotask(()=>void syncNow());}
  },[setCurrent,showConflict]);

  const scheduleSync=useCallback(()=>{if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>void syncNow(),1500);},[syncNow]);

  const update=useCallback((fn:(state:Workspace)=>Workspace)=>{
    if(!dataRef.current||conflictRef.current){if(conflictRef.current)setError('충돌 원고를 확인한 뒤 편집할 수 있습니다.');

return;}

    // Materialize legacy folders before editing properties, so the first chapter edit does not rename them.
    const base=materializeTrash(materializeNoteNavigation({...dataRef.current,works:dataRef.current.works.map(w=>w.navigation?w:applyNavigation(w,resolveNavigation(w)))}));
    const edited=preserveTemplateData(preserveTrash(preserveNoteDetails(preserveNotes(preserveAIPreferences(fn(structuredClone(base)),base),base),base),base),base);
    const data={...edited,works:edited.works.map(w=>applyNavigation(w,resolveNavigation(w))),updatedAt:new Date().toISOString()};setCurrent(data);setStatus('기기에 저장 중');pending.current++;
    const targetNamespace=namespaceRef.current;
    saveQueue.current=saveQueue.current.then(async()=>{
      if(conflictRef.current){pending.current--;

return;}

      try{
        const written=await writeLocal(targetNamespace,data,recordRef.current?.localVersion||0);
        recordRef.current=written;channelRef.current?.postMessage({version:written.localVersion});
        setStatus(cloudConfigured?'이 기기에 저장됨 · 전송 대기':'이 기기에 저장됨');scheduleSync();
      }catch(e){
        if(e instanceof LocalConflict){try{await checkpoint(targetNamespace,dataRef.current!,'다른 창과 충돌 · 현재 원고');}catch{setError('충돌 원고를 이력에 저장하지 못했습니다. ZIP으로 보관하세요.');}

showConflict({local:dataRef.current!,remote:e.remote.data,remoteLocalVersion:e.remote.localVersion});}
        else {setError('기기 저장 실패: 저장 공간과 브라우저 설정을 확인하세요.');setStatus('저장 실패 · 백업 필요');}
      }finally{pending.current--;}
    });
  },[scheduleSync,setCurrent,showConflict]);

  const flush=useCallback(async()=>{await saveQueue.current;

if(conflictRef.current)throw new Error('원고 충돌을 먼저 확인하세요.');const stored=await db.workspaces.get(namespaceRef.current);

if(!stored||JSON.stringify(stored.data)!==JSON.stringify(dataRef.current))throw new Error('기기 저장이 끝나지 않았습니다. 다시 저장하거나 백업하세요.');},[]);

  useEffect(()=>{
    let disposed=false;let authSub:{unsubscribe:()=>void}|undefined;

    async function open(uidValue:string|null){
      if(openedFor.current===uidValue)return;openedFor.current=uidValue;
      setLoading(true);setUser(null);cloudId.current=null;setConflict(null);conflictRef.current=null;
      const ns=uidValue?`author:${uidValue}`:'preview';namespaceRef.current=ns;setNamespace(ns);

      if(cloudConfigured&&!uidValue){setState(null);dataRef.current=null;setLoading(false);

return;}

      if(!cloudConfigured&&!localPreview){setLoading(false);

return;}

      try{
        if(uidValue){const author=await cloud().from('authors').select('user_id').eq('user_id',uidValue).single();

if(author.error||!author.data)throw new Error('이 계정에는 집필실 권한이 없습니다.');setUser(uidValue);}

        let row=await db.workspaces.get(ns);

        if(!row){row={namespace:ns,data:seedWorkspace(),localVersion:0,cloudVersion:0,dirty:false,lastExportAt:null};await db.workspaces.put(row);await checkpoint(ns,row.data,'처음 시작');}

        if(disposed)return;recordRef.current=row;setCurrent(row.data);setLastExportAt(row.lastExportAt);setStatus(cloudConfigured?'클라우드 확인 중':'이 기기에 저장됨');

        if(uidValue){
          const remote=await fetchCloud()||await initializeCloud(row.data);cloudId.current=remote.id;

          if(row.dirty&&row.cloudVersion!==remote.version){showConflict({local:row.data,remote:remote.data,remoteCloudVersion:remote.version});}
          else if(!row.dirty){const next={...row,data:remote.data,cloudVersion:remote.version};await db.workspaces.put(next);recordRef.current=next;setCurrent(next.data);setStatus('클라우드 동기화됨');}
          else scheduleSync();
        }
      }catch(e){setError(e instanceof Error?e.message:'원고를 불러오지 못했습니다.');setStatus('클라우드 연결 확인 필요');}
      finally{if(!disposed)setLoading(false);}
    }

    if(cloudConfigured){
      void cloud().auth.getSession().then(({data})=>open(data.session?.user.id||null));
      authSub=cloud().auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_IN'||event==='SIGNED_OUT')void open(session?.user.id||null);}).data.subscription;
    }else void open(null);

    return()=>{disposed=true;openedFor.current=undefined;authSub?.unsubscribe();

if(timer.current)clearTimeout(timer.current);};
  },[localPreview,scheduleSync,setCurrent,showConflict]);
  useEffect(()=>{
    if(!state)return;
    const channel=new BroadcastChannel(`orbit:${namespace}`);channelRef.current=channel;
    channel.onmessage=async()=>{
      if(pending.current||conflictRef.current){return;}

      const remote=await db.workspaces.get(namespace);

if(!remote||remote.localVersion<=(recordRef.current?.localVersion||0))return;
      recordRef.current=remote;setCurrent(remote.data);setEpoch(x=>x+1);setStatus(cloudConfigured?'이 기기에 저장됨 · 전송 대기':'이 기기에 저장됨');
    };

    const onUnload=(e:BeforeUnloadEvent)=>{if(pending.current||conflictRef.current){e.preventDefault();e.returnValue='';}};

    const reconnect=async()=>{
      if(!cloudConfigured||!cloudId.current||pending.current||syncing.current)return;
      const local=await db.workspaces.get(namespace);

if(local?.dirty){void syncNow();

return;}

      try{const remote=await fetchCloud();

if(remote&&local&&remote.version!==local.cloudVersion){const next={...local,data:remote.data,cloudVersion:remote.version,localVersion:local.localVersion+1};await db.workspaces.put(next);recordRef.current=next;setCurrent(next.data);setEpoch(x=>x+1);setStatus('클라우드 동기화됨');}}catch{/* Keep the local recovery copy on network failure. */}
    };

    window.addEventListener('beforeunload',onUnload);window.addEventListener('online',reconnect);window.addEventListener('focus',reconnect);
    const offline=()=>setStatus('연결 끊김 · 이 기기에 저장됨');window.addEventListener('offline',offline);
    let subscription:ReturnType<ReturnType<typeof cloud>['channel']>|null=null;

    if(cloudConfigured&&user)subscription=cloud().channel(`workspace:${user}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'workspaces',filter:`owner_id=eq.${user}`},()=>void reconnect()).subscribe();
    const syncTimer=setInterval(()=>void syncNow(),12000);

    return()=>{channel.close();channelRef.current=null;clearInterval(syncTimer);window.removeEventListener('beforeunload',onUnload);window.removeEventListener('online',reconnect);window.removeEventListener('focus',reconnect);window.removeEventListener('offline',offline);

if(subscription)void cloud().removeChannel(subscription);};
  // The workspace changes often; subscriptions depend only on its availability and identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[!!state,namespace,user,setCurrent,syncNow]);
  // The interval comes from the settings dialog; changing it restarts the timer without touching sync.
  useEffect(()=>{
    if(!state)return;
    const backupTimer=setInterval(()=>{if(dataRef.current)void checkpoint(namespace,dataRef.current,'자동 복구 지점').catch(()=>setError('자동 복구 지점을 만들지 못했습니다. ZIP 백업을 보관하세요.'));},checkpointMinutes*60*1000);

    return()=>clearInterval(backupTimer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[!!state,namespace,checkpointMinutes]);

  async function restore(data:Workspace){await flush();await checkpoint(namespace,dataRef.current!,'복원 전 원고');update(()=>structuredClone(data));await flush();setEpoch(x=>x+1);}

  async function exportBackup(){
    // A recovery export must remain available when local saving or conflict resolution fails.
    await saveQueue.current;
    const current=dataRef.current;

if(!current)throw new Error('원고가 없습니다.');
    let history=await listRevisions(namespace);

    if(conflictRef.current)history=[{id:uid(),namespace,createdAt:new Date().toISOString(),label:'충돌 중 · 다른 원고',data:conflictRef.current.remote},...history].slice(0,50);

    if(cloudConfigured){for(const meta of new Map([...current.assets,...history.flatMap(r=>r.data.assets)].map(a=>[a.id,a])).values()){
      if(!(await db.assets.get([namespace,meta.id]))){const {data:blob,error}=await cloud().storage.from('private-assets').download(`${user}/${meta.id}`);

if(error||!blob)throw new Error(`첨부를 내려받지 못했습니다: ${meta.name}`);await db.assets.put({id:meta.id,namespace,blob});}
    }}

    const assets=await db.assets.where('namespace').equals(namespace).toArray();
    const blob=await createBackup(current,history,assets);
    const date=new Date().toISOString();

try{await db.transaction('rw',db.workspaces,async()=>{const row=await db.workspaces.get(namespace);

if(row)await db.workspaces.put({...row,lastExportAt:date});});}catch{/* The archive is still usable when IndexedDB cannot store the timestamp. */}

setLastExportAt(date);

    return{blob,name:`Orbis-Tertius-전체백업-${new Date().toISOString().slice(0,10)}.zip`};
  }

  async function importDocuments(bundle:ImportBundle,choices:ImportChoice[],target:{workId:string}|{title:string;form:Work['form']}){
    await flush();const before=dataRef.current!;
    const prepared=prepareImport(before,bundle,choices,target);
    await checkpoint(namespace,before,'외부 문서 가져오기 전');

    for(const asset of prepared.assets){
      if(cloudConfigured){const result=await cloud().storage.from('private-assets').upload(`${user}/${asset.id}`,asset.blob,{contentType:asset.blob.type});

if(result.error)throw new Error('첨부의 클라우드 저장을 완료하지 못했습니다. 원고는 유지됩니다.');}

      await db.assets.put({...asset,namespace});
    }

    await flush();

if(JSON.stringify(dataRef.current)!==JSON.stringify(before))throw new Error('가져오는 동안 원고가 바뀌었습니다. 다시 시도하세요.');
    update(()=>prepared.state);await flush();setEpoch(x=>x+1);

return prepared.workId;
  }

  async function exportDocuments(workId:string,documentIds:string[],format:ExportFormat){
    await flush();const current=structuredClone(dataRef.current!);const work=current.works.find(w=>w.id===workId);

if(!work)throw new Error('작품을 찾지 못했습니다.');
    const ids=new Set(work.documents.filter(d=>documentIds.includes(d.id)).flatMap(d=>d.assetIds));const assets:{id:string;blob:Blob}[]=[];

    for(const id of ids){let blob=(await db.assets.get([namespace,id]))?.blob;

      if(!blob&&cloudConfigured){const result=await cloud().storage.from('private-assets').download(`${user}/${id}`);

if(result.error||!result.data)throw new Error('첨부를 내려받지 못했습니다.');blob=result.data;await db.assets.put({id,namespace,blob});}

      if(!blob)throw new Error('첨부를 찾지 못했습니다.');assets.push({id,blob});
    }

return exportInterchange(work,documentIds,current.assets,assets,format);
  }

  async function importBackup(file:File){
    const parsed=await readBackup(file);await flush();

    for(const asset of parsed.assets){
      const old=await db.assets.get([namespace,asset.id]);

      if(old){const a=new Uint8Array(await old.blob.arrayBuffer());const b=new Uint8Array(await asset.blob.arrayBuffer());

if(a.length!==b.length||a.some((v,i)=>v!==b[i]))throw new Error('기존 첨부와 백업 첨부의 ID가 충돌합니다. 현재 원고는 유지됩니다.');}

      if(cloudConfigured){const path=`${user}/${asset.id}`;const existing=await cloud().storage.from('private-assets').download(path);

if(existing.error){const upload=await cloud().storage.from('private-assets').upload(path,asset.blob,{contentType:asset.blob.type});

if(upload.error)throw new Error('백업 첨부의 클라우드 저장을 완료하지 못했습니다.');}else if(existing.data){const remote=new Uint8Array(await existing.data.arrayBuffer()),backup=new Uint8Array(await asset.blob.arrayBuffer());

if(remote.length!==backup.length||remote.some((v,i)=>v!==backup[i]))throw new Error('클라우드의 기존 첨부와 백업의 내용이 다릅니다. 현재 원고는 유지됩니다.');}}
    }

    await checkpoint(namespace,dataRef.current!,'백업 복원 전 원고');
    await db.transaction('rw',db.assets,db.revisions,async()=>{
      for(const asset of parsed.assets)await db.assets.put({...asset,namespace});

      for(const revision of parsed.revisions)await db.revisions.put({...revision,id:uid(),namespace,label:`가져온 이력 · ${revision.label}`});
      const all=await db.revisions.where('namespace').equals(namespace).sortBy('createdAt');

if(all.length>50)await db.revisions.bulkDelete(all.slice(0,all.length-50).map(r=>r.id));
    });
    update(()=>parsed.data);await flush();setEpoch(x=>x+1);
  }

  async function publish(workId:string,sceneIds:string[]){
    await flush();

if(cloudConfigured){await syncNow();const row=await db.workspaces.get(namespace);

if(row?.dirty||conflictRef.current)throw new Error('클라우드 저장을 확인한 뒤 게시하세요.');}

    const work=dataRef.current!.works.find(w=>w.id===workId)!;await checkpoint(namespace,dataRef.current!,'게시 전 원고');
    const pub=cloudConfigured?await publishCloud(cloudId.current!,workId,sceneIds):{...makePublication(work,sceneIds),libraryPosition:previewPublicationPosition(previewPositions(dataRef.current!),workId)};
    update(state=>{const s=cloudConfigured?state:previewPositions(state);

return {...s,works:s.works.map(w=>w.id===workId?{...w,publications:[...w.publications,pub].slice(-100),activePublicationId:pub.id}:w)};});await flush();

return pub;
  }

  async function unpublish(workId:string){
    await flush();

    if(conflictRef.current)throw new Error('충돌 원고를 확인한 뒤 게시를 철회할 수 있습니다.');

    if(cloudConfigured)await unpublishCloud(workId);
    update(state=>withdrawPublication(state,workId));await flush();
  }

  async function libraryPublications(){return cloudConfigured?authorLibrary():previewPublications(dataRef.current!);}

  async function setLibraryOrder(ids:string[]){
    await flush();

    if(conflictRef.current||!dataRef.current)throw new Error('충돌을 확인한 뒤 서재 순서를 저장하세요.');
    const targetNamespace=namespaceRef.current;

    if(cloudConfigured){const result=await reorderLibrary(ids);

      if(namespaceRef.current!==targetNamespace)throw new Error('계정이 바뀌었습니다. 순서 편집을 다시 열어주세요.');

      return result;
    }

    const next=reorderPreviewLibrary(dataRef.current,ids);update(()=>next);await flush();

return previewPublications(next);
  }

  async function addAsset(workId:string,docId:string,file:File){
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024)throw new Error('PNG, JPEG, WebP 이미지 10MB 이하만 첨부할 수 있습니다.');
    const id=uid();await db.assets.put({id,namespace,blob:file});

    if(cloudConfigured){const {error:uploadError}=await cloud().storage.from('private-assets').upload(`${user}/${id}`,file,{contentType:file.type});

if(uploadError)throw uploadError;}

    const meta:AssetMeta={id,workId,name:file.name,type:assetSchema.shape.type.parse(file.type),size:file.size};
    update(s=>({...s,assets:[...s.assets,meta],works:s.works.map(w=>w.id===workId?{...w,documents:w.documents.map(d=>d.id===docId?{...d,assetIds:[...d.assetIds,id]}:d)}:w)}));
  }

  async function addNoteAsset(noteId:string,file:File){
    await flush();const note=dataRef.current?.notes?.find(n=>n.id===noteId);

    if(!note)throw new Error('노트를 찾지 못했습니다.');

    if((dataRef.current?.assets.length||0)>=2000)throw new Error('작업 공간 첨부는 최대 2,000개입니다.');

    if(note.assetIds.length>=200)throw new Error('노트 첨부는 최대 200개입니다.');

    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024)throw new Error('PNG, JPEG, WebP 이미지 10MB 이하만 첨부할 수 있습니다.');
    const id=uid();await db.assets.put({id,namespace,blob:file});

    if(cloudConfigured){const result=await cloud().storage.from('private-assets').upload(`${user}/${id}`,file,{contentType:file.type});

if(result.error)throw result.error;}

    const meta:AssetMeta={id,noteId,name:file.name,type:assetSchema.shape.type.parse(file.type),size:file.size};

    if(conflictRef.current)throw new Error('원고 충돌을 먼저 확인하세요.');
    update(state=>({...state,assets:[...state.assets,meta],notes:(state.notes||[]).map(n=>n.id===noteId?{...n,assetIds:[...n.assetIds,id],updatedAt:new Date().toISOString()}:n)}));
    await flush();

return id;
  }

  /** 첨부 사본을 같은 사용자 저장소에 복제한다. 노트→작품 복사와 폴더→새 작품이 함께 쓴다. */
  async function copyAssetBlobs(copies:{sourceId:string;id:string}[]){
    for(const copy of copies){
      let blob=(await db.assets.get([namespace,copy.sourceId]))?.blob;

      if(!blob&&cloudConfigured){const result=await cloud().storage.from('private-assets').download(`${user}/${copy.sourceId}`);

if(result.error)throw result.error;blob=result.data||undefined;}

      if(!blob)throw new Error('노트 첨부를 내려받지 못했습니다. 원본 노트는 유지됩니다.');

      if(cloudConfigured){const result=await cloud().storage.from('private-assets').upload(`${user}/${copy.id}`,blob,{contentType:blob.type});

if(result.error)throw result.error;}

      await db.assets.put({id:copy.id,namespace,blob});
    }
  }

  async function importNotes(bundle:ImportBundle,folderTitle:string){
    await flush();const before=dataRef.current!;
    const prepared=prepareNoteImport(before,bundle,folderTitle);
    await checkpoint(namespace,before,'노트 가져오기 전');

    for(const asset of prepared.assets){
      if(cloudConfigured){const result=await cloud().storage.from('private-assets').upload(`${user}/${asset.id}`,asset.blob,{contentType:asset.blob.type});

if(result.error)throw new Error('첨부의 클라우드 저장을 완료하지 못했습니다. 노트는 유지됩니다.');}

      await db.assets.put({...asset,namespace});
    }

    await flush();

if(JSON.stringify(dataRef.current)!==JSON.stringify(before))throw new Error('가져오는 동안 노트가 바뀌었습니다. 다시 시도하세요.');
    update(()=>prepared.state);await flush();

return {folderId:prepared.folderId,count:prepared.count};
  }

  async function createWorkFromFolder(folderId:string,target:{title:string;form:Work['form']}){
    await flush();const before=structuredClone(dataRef.current!),prepared=prepareFolderWork(before,folderId,target);
    await checkpoint(namespace,before,'노트 폴더로 작품 만들기 전');
    await copyAssetBlobs(prepared.copies);
    await flush();

if(JSON.stringify(dataRef.current)!==JSON.stringify(before))throw new Error('작품을 만드는 동안 노트가 바뀌었습니다. 다시 시도하세요.');
    update(()=>prepared.state);await flush();

return prepared.workId;
  }

  async function copyNote(noteId:string,workId:string,kind:NovelDocument['kind']){
    await flush();const before=structuredClone(dataRef.current!),prepared=prepareNoteCopy(before,noteId,workId,kind);
    await checkpoint(namespace,before,'노트를 작품으로 가져오기 전');
    await copyAssetBlobs(prepared.copies);
    await flush();

if(JSON.stringify(dataRef.current)!==JSON.stringify(before))throw new Error('가져오는 동안 작업이 바뀌었습니다. 다시 시도하세요.');
    update(()=>prepared.state);await flush();

return prepared.docId;
  }

  async function saveTemplate(source:TemplateSource,selected:string[],name:string){
    await flush();const before=structuredClone(dataRef.current!),targetNamespace=namespaceRef.current,prepared=prepareTemplate(before,source,selected,name);
    await copyAssetBlobs(prepared.copies);await flush();

    if(namespaceRef.current!==targetNamespace||JSON.stringify(dataRef.current)!==JSON.stringify(before))throw new Error('저장하는 동안 작업이 바뀌었습니다. 다시 시도하세요.');
    update(()=>prepared.state);await flush();

return prepared.templateId;
  }

  async function applyTemplate(id:string,target:TemplateTarget){
    await flush();const before=structuredClone(dataRef.current!),targetNamespace=namespaceRef.current,prepared=prepareTemplateApplication(before,id,target);
    await checkpoint(namespace,before,'템플릿 적용 전');await copyAssetBlobs(prepared.copies);await flush();

    if(namespaceRef.current!==targetNamespace||JSON.stringify(dataRef.current)!==JSON.stringify(before))throw new Error('만드는 동안 작업이 바뀌었습니다. 다시 시도하세요.');
    update(()=>prepared.state);await flush();

return prepared.documentIds;
  }

  async function deleteTemplate(id:string){
    await flush();const before=structuredClone(dataRef.current!);await checkpoint(namespace,before,'템플릿 삭제 전');await flush();

    if(JSON.stringify(dataRef.current)!==JSON.stringify(before))throw new Error('삭제하는 동안 작업이 바뀌었습니다. 다시 시도하세요.');
    update(state=>removeTemplate(state,id));await flush();
  }

  async function resolve(choice:'local'|'remote'){
    const c=conflictRef.current;

if(!c)return;
    await checkpoint(namespace,c.local,'충돌 해결 전 · 기기 원고');await checkpoint(namespace,c.remote,'충돌 해결 전 · 다른 원고');
    const row=await db.workspaces.get(namespace);

if(!row)throw new Error('기기 원고가 없습니다.');
    recordRef.current={...row,cloudVersion:c.remoteCloudVersion??row.cloudVersion};await db.workspaces.put(recordRef.current);
    conflictRef.current=null;setConflict(null);update(()=>structuredClone(choice==='local'?c.local:c.remote));await flush();setEpoch(x=>x+1);
  }

  async function trashNote(noteId:string){
    await flush();update(state=>moveNoteToTrash(state,noteId));await flush();
  }

  async function trashDocument(workId:string,docId:string){
    await flush();const before=dataRef.current!,next=moveDocumentToTrash(before,workId,docId);
    const index=before.works.find(w=>w.id===workId)!.documents.findIndex(d=>d.id===docId),documents=next.works.find(w=>w.id===workId)!.documents;
    update(()=>next);await flush();

return documents[Math.min(index,documents.length-1)].id;
  }

  async function trashDocumentFolder(workId:string,folderId:string){
    await flush();const before=dataRef.current!,targetNamespace=namespaceRef.current;
    const next=moveDocumentFolderToTrash(before,workId,folderId);
    await checkpoint(targetNamespace,before,'폴더 전체 삭제 전');

    if(conflictRef.current||namespaceRef.current!==targetNamespace||dataRef.current!==before)throw new Error('삭제 준비 중 작업이 바뀌었습니다. 다시 시도하세요.');
    update(()=>next);await flush();

return next.works.find(w=>w.id===workId)!.documents[0].id;
  }

  async function trashNoteFolder(folderId:string){
    await flush();const before=dataRef.current!,targetNamespace=namespaceRef.current;
    const next=moveNoteFolderToTrash(before,folderId);
    await checkpoint(targetNamespace,before,'노트 폴더 전체 삭제 전');

    if(conflictRef.current||namespaceRef.current!==targetNamespace||dataRef.current!==before)throw new Error('삭제 준비 중 작업이 바뀌었습니다. 다시 시도하세요.');
    update(()=>next);await flush();
  }

  // A work in the trash must not stay in the public library, so its edition is withdrawn first. On a server without
  // that function this stops before the workspace changes, which also keeps the save from tripping the older trash guard.
  async function trashWork(workId:string){
    await flush();

    if(conflictRef.current)throw new Error('충돌 원고를 확인한 뒤 작품을 옮길 수 있습니다.');
    // Dry run: refuse the last or a missing work before the server withdraws anything.
    moveWorkToTrash(dataRef.current!,workId);

    if(cloudConfigured)await unpublishCloud(workId);
    update(state=>moveWorkToTrash(state,workId));await flush();
  }

  async function restoreTrash(id:string){
    await flush();update(state=>restoreTrashItem(state,id));await flush();
  }

  async function purgeTrash(ids:string[]){
    await flush();const before=dataRef.current!,targetNamespace=namespaceRef.current;
    const next=purgeTrashItems(before,ids);
    await checkpoint(targetNamespace,before,'휴지통 영구 삭제 전');

    if(conflictRef.current||namespaceRef.current!==targetNamespace||dataRef.current!==before)throw new Error('삭제 준비 중 작업이 바뀌었습니다. 다시 시도하세요.');
    update(()=>next);await flush();
  }

  return <Context.Provider value={{state,namespace,loading,status,error,conflict,user,canUse,epoch,lastExportAt,update,
    snapshot:async(label)=>{await flush();await checkpoint(namespace,dataRef.current!,label);},revisions:()=>listRevisions(namespace),restore,exportBackup,importBackup,importDocuments,exportDocuments,publish,unpublish,addAsset,addNoteAsset,importNotes,createWorkFromFolder,copyNote,trashNote,trashDocument,trashDocumentFolder,trashNoteFolder,trashWork,restoreTrash,purgeTrash,resolve,saveTemplate,applyTemplate,deleteTemplate,
    libraryPublications,setLibraryOrder,
    login:async(email,password)=>{const {error}=await cloud().auth.signInWithPassword({email,password});

if(error)throw error;},
    logout:async()=>{await flush();await syncNow();await flush();const {error}=await cloud().auth.signOut({scope:'local'});

if(error){const message='서버 로그아웃을 확인하지 못했습니다.';setError(message);throw new Error(message,{cause:error});}

setError('');syncError.current=null;},flush,syncNow,clearError:()=>setError('')}}>{children}</Context.Provider>;
}
