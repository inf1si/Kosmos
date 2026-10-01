'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Workspace, LocalRecord, uid, Revision, Publication, makePublication, AssetMeta } from '@/lib/model';
import { seedWorkspace } from '@/lib/seed';
import { db, writeLocal, checkpoint, LocalConflict, listRevisions } from '@/lib/database';
import { cloud, cloudConfigured, fetchCloud, initializeCloud, saveCloud, publishCloud } from '@/lib/cloud';
import { createBackup, readBackup } from '@/lib/backup';

type Conflict={local:Workspace;remote:Workspace;remoteLocalVersion?:number;remoteCloudVersion?:number};
type StudioContextValue={
  state:Workspace|null;namespace:string;loading:boolean;status:string;error:string;conflict:Conflict|null;
  user:string|null;canUse:boolean;epoch:number;lastExportAt:string|null;
  update:(fn:(state:Workspace)=>Workspace)=>void;
  snapshot:(label:string)=>Promise<void>;revisions:()=>Promise<Revision[]>;restore:(data:Workspace)=>Promise<void>;
  exportBackup:()=>Promise<void>;importBackup:(file:File)=>Promise<void>;
  publish:(workId:string,sceneIds:string[])=>Promise<Publication>;
  addAsset:(workId:string,docId:string,file:File)=>Promise<void>;
  resolve:(choice:'local'|'remote')=>Promise<void>;login:(email:string,password:string)=>Promise<void>;logout:()=>Promise<void>;
  flush:()=>Promise<void>;syncNow:()=>Promise<void>;clearError:()=>void;
};
const Context=createContext<StudioContextValue|null>(null);
export function useStudio(){const c=useContext(Context);if(!c)throw new Error('Studio provider missing');return c;}
export function StudioProvider({children,localPreview}:{children:ReactNode;localPreview:boolean}){
  const [state,setState]=useState<Workspace|null>(null);const dataRef=useRef<Workspace|null>(null);
  const [namespace,setNamespace]=useState('preview');const namespaceRef=useRef('preview');
  const [user,setUser]=useState<string|null>(null);const [loading,setLoading]=useState(true);
  const [status,setStatus]=useState('불러오는 중');const [error,setError]=useState('');const [conflict,setConflict]=useState<Conflict|null>(null);
  const conflictRef=useRef<Conflict|null>(null);const [epoch,setEpoch]=useState(0);const [lastExportAt,setLastExportAt]=useState<string|null>(null);
  const recordRef=useRef<LocalRecord|null>(null);const saveQueue=useRef<Promise<void>>(Promise.resolve());
  const channelRef=useRef<BroadcastChannel|null>(null);const cloudId=useRef<string|null>(null);
  const syncing=useRef(false);const timer=useRef<ReturnType<typeof setTimeout>|null>(null);const pending=useRef(0);
  const openedFor=useRef<string|null|undefined>(undefined);
  const canUse=cloudConfigured?!!user:localPreview;
  const showConflict=useCallback((value:Conflict)=>{conflictRef.current=value;setConflict(value);setStatus('충돌 확인 필요');},[]);
  const setCurrent=useCallback((data:Workspace)=>{dataRef.current=data;setState(data);},[]);
  const syncNow=useCallback(async()=>{
    if(!cloudConfigured||!cloudId.current||syncing.current||conflictRef.current)return;
    await saveQueue.current;
    if(!navigator.onLine){setStatus('연결 끊김 · 이 기기에 저장됨');return;}
    const r=await db.workspaces.get(namespaceRef.current);if(!r?.dirty)return;
    syncing.current=true;setStatus('클라우드 동기화 중');
    try{
      const operation=r.pendingRequest?.baseVersion===r.cloudVersion?r.pendingRequest:{id:uid(),localVersion:r.localVersion,baseVersion:r.cloudVersion,data:r.data};
      await db.transaction('rw',db.workspaces,async()=>{const row=await db.workspaces.get(namespaceRef.current);if(row)await db.workspaces.put({...row,pendingRequest:operation});});
      const result=await saveCloud(cloudId.current,operation.baseVersion,operation.data,operation.id);
      if(result.status==='conflict'){
        try{await checkpoint(namespaceRef.current,dataRef.current!,'클라우드 충돌 · 기기 원고');}catch{setError('충돌 원고를 이력에 저장하지 못했습니다. ZIP으로 보관하세요.');}
        showConflict({local:dataRef.current!,remote:result.payload!,remoteCloudVersion:result.version});return;
      }
      await db.transaction('rw',db.workspaces,async()=>{
        const current=await db.workspaces.get(namespaceRef.current);if(!current)return;
        const next={...current,cloudVersion:result.version,dirty:current.localVersion!==operation.localVersion,pendingRequest:undefined};
        await db.workspaces.put(next);recordRef.current=next;
        setStatus(next.dirty?'이 기기에 저장됨 · 전송 대기':'클라우드 동기화됨');
      });
    }catch(e){setError(e instanceof Error?e.message:'클라우드 저장을 완료하지 못했습니다.');setStatus('이 기기에 저장됨 · 클라우드 재시도 필요');}
    finally{syncing.current=false;}
  },[showConflict]);
  const scheduleSync=useCallback(()=>{if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>void syncNow(),1500);},[syncNow]);
  const update=useCallback((fn:(state:Workspace)=>Workspace)=>{
    if(!dataRef.current||conflictRef.current){if(conflictRef.current)setError('충돌 원고를 확인한 뒤 편집할 수 있습니다.');return;}
    const data={...fn(structuredClone(dataRef.current)),updatedAt:new Date().toISOString()};setCurrent(data);setStatus('기기에 저장 중');pending.current++;
    const targetNamespace=namespaceRef.current;
    saveQueue.current=saveQueue.current.then(async()=>{
      if(conflictRef.current){pending.current--;return;}
      try{
        const written=await writeLocal(targetNamespace,data,recordRef.current?.localVersion||0);
        recordRef.current=written;channelRef.current?.postMessage({version:written.localVersion});
        setStatus(cloudConfigured?'이 기기에 저장됨 · 전송 대기':'이 기기에 저장됨');scheduleSync();
      }catch(e){
        if(e instanceof LocalConflict){try{await checkpoint(targetNamespace,dataRef.current!,'다른 창과 충돌 · 현재 원고');}catch{setError('충돌 원고를 이력에 저장하지 못했습니다. ZIP으로 보관하세요.');}showConflict({local:dataRef.current!,remote:e.remote.data,remoteLocalVersion:e.remote.localVersion});}
        else {setError('기기 저장 실패: 저장 공간과 브라우저 설정을 확인하세요.');setStatus('저장 실패 · 백업 필요');}
      }finally{pending.current--;}
    });
  },[scheduleSync,setCurrent,showConflict]);
  const flush=useCallback(async()=>{await saveQueue.current;if(conflictRef.current)throw new Error('원고 충돌을 먼저 확인하세요.');const stored=await db.workspaces.get(namespaceRef.current);if(!stored||JSON.stringify(stored.data)!==JSON.stringify(dataRef.current))throw new Error('기기 저장이 끝나지 않았습니다. 다시 저장하거나 백업하세요.');},[]);
  useEffect(()=>{
    let disposed=false;let authSub:{unsubscribe:()=>void}|undefined;
    async function open(uidValue:string|null){
      if(openedFor.current===uidValue)return;openedFor.current=uidValue;
      setLoading(true);setUser(null);cloudId.current=null;setConflict(null);conflictRef.current=null;
      const ns=uidValue?`author:${uidValue}`:'preview';namespaceRef.current=ns;setNamespace(ns);
      if(cloudConfigured&&!uidValue){setState(null);dataRef.current=null;setLoading(false);return;}
      if(!cloudConfigured&&!localPreview){setLoading(false);return;}
      try{
        if(uidValue){const author=await cloud().from('authors').select('user_id').eq('user_id',uidValue).single();if(author.error||!author.data)throw new Error('이 계정에는 집필실 권한이 없습니다.');setUser(uidValue);}
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
    return()=>{disposed=true;openedFor.current=undefined;authSub?.unsubscribe();if(timer.current)clearTimeout(timer.current);};
  },[localPreview,scheduleSync,setCurrent,showConflict]);
  useEffect(()=>{
    if(!state)return;
    const channel=new BroadcastChannel(`orbit:${namespace}`);channelRef.current=channel;
    channel.onmessage=async()=>{
      if(pending.current||conflictRef.current){return;}
      const remote=await db.workspaces.get(namespace);if(!remote||remote.localVersion<=(recordRef.current?.localVersion||0))return;
      recordRef.current=remote;setCurrent(remote.data);setEpoch(x=>x+1);setStatus(cloudConfigured?'이 기기에 저장됨 · 전송 대기':'이 기기에 저장됨');
    };
    const onUnload=(e:BeforeUnloadEvent)=>{if(pending.current||conflictRef.current){e.preventDefault();e.returnValue='';}};
    const reconnect=async()=>{
      if(!cloudConfigured||!cloudId.current||pending.current||syncing.current)return;
      const local=await db.workspaces.get(namespace);if(local?.dirty){void syncNow();return;}
      try{const remote=await fetchCloud();if(remote&&local&&remote.version!==local.cloudVersion){const next={...local,data:remote.data,cloudVersion:remote.version,localVersion:local.localVersion+1};await db.workspaces.put(next);recordRef.current=next;setCurrent(next.data);setEpoch(x=>x+1);setStatus('클라우드 동기화됨');}}catch{/* Keep the local recovery copy on network failure. */}
    };
    window.addEventListener('beforeunload',onUnload);window.addEventListener('online',reconnect);window.addEventListener('focus',reconnect);
    const offline=()=>setStatus('연결 끊김 · 이 기기에 저장됨');window.addEventListener('offline',offline);
    let subscription:ReturnType<ReturnType<typeof cloud>['channel']>|null=null;
    if(cloudConfigured&&user)subscription=cloud().channel(`workspace:${user}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'workspaces',filter:`owner_id=eq.${user}`},()=>void reconnect()).subscribe();
    const backupTimer=setInterval(()=>{if(dataRef.current)void checkpoint(namespace,dataRef.current,'자동 복구 지점').catch(()=>setError('자동 복구 지점을 만들지 못했습니다. ZIP 백업을 보관하세요.'));},10*60*1000);
    const syncTimer=setInterval(()=>void syncNow(),12000);
    return()=>{channel.close();channelRef.current=null;clearInterval(backupTimer);clearInterval(syncTimer);window.removeEventListener('beforeunload',onUnload);window.removeEventListener('online',reconnect);window.removeEventListener('focus',reconnect);window.removeEventListener('offline',offline);if(subscription)void cloud().removeChannel(subscription);};
  // The workspace changes often; subscriptions depend only on its availability and identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[!!state,namespace,user,setCurrent,syncNow]);
  async function restore(data:Workspace){await flush();await checkpoint(namespace,dataRef.current!,'복원 전 원고');update(()=>structuredClone(data));await flush();setEpoch(x=>x+1);}
  async function exportBackup(){
    const current=dataRef.current;if(!current)throw new Error('원고가 없습니다.');
    const history=await listRevisions(namespace);
    if(cloudConfigured){for(const meta of new Map([...current.assets,...history.flatMap(r=>r.data.assets)].map(a=>[a.id,a])).values()){
      if(!(await db.assets.get([namespace,meta.id]))){const {data:blob,error}=await cloud().storage.from('private-assets').download(`${user}/${meta.id}`);if(error||!blob)throw new Error(`첨부를 내려받지 못했습니다: ${meta.name}`);await db.assets.put({id:meta.id,namespace,blob});}
    }}
    const assets=await db.assets.where('namespace').equals(namespace).toArray();
    const blob=await createBackup(current,history,assets);
    const href=URL.createObjectURL(blob);const a=document.createElement('a');a.href=href;a.download=`궤도서재-전체백업-${new Date().toISOString().slice(0,10)}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
    const date=new Date().toISOString();await db.transaction('rw',db.workspaces,async()=>{const row=await db.workspaces.get(namespace);if(row)await db.workspaces.put({...row,lastExportAt:date});});setLastExportAt(date);
  }
  async function importBackup(file:File){
    const parsed=await readBackup(file);await flush();
    for(const asset of parsed.assets){
      const old=await db.assets.get([namespace,asset.id]);
      if(old){const a=new Uint8Array(await old.blob.arrayBuffer());const b=new Uint8Array(await asset.blob.arrayBuffer());if(a.length!==b.length||a.some((v,i)=>v!==b[i]))throw new Error('기존 첨부와 백업 첨부의 ID가 충돌합니다. 현재 원고는 유지됩니다.');}
      if(cloudConfigured){const path=`${user}/${asset.id}`;const existing=await cloud().storage.from('private-assets').download(path);if(existing.error){const upload=await cloud().storage.from('private-assets').upload(path,asset.blob,{contentType:asset.blob.type});if(upload.error)throw new Error('백업 첨부의 클라우드 저장을 완료하지 못했습니다.');}}
    }
    await checkpoint(namespace,dataRef.current!,'백업 복원 전 원고');
    await db.transaction('rw',db.assets,db.revisions,async()=>{
      for(const asset of parsed.assets)await db.assets.put({...asset,namespace});
      for(const revision of parsed.revisions)await db.revisions.put({...revision,id:uid(),namespace,label:`가져온 이력 · ${revision.label}`});
    });
    update(()=>parsed.data);await flush();setEpoch(x=>x+1);
  }
  async function publish(workId:string,sceneIds:string[]){
    await flush();if(cloudConfigured){await syncNow();const row=await db.workspaces.get(namespace);if(row?.dirty||conflictRef.current)throw new Error('클라우드 저장을 확인한 뒤 게시하세요.');}
    const work=dataRef.current!.works.find(w=>w.id===workId)!;await checkpoint(namespace,dataRef.current!,'게시 전 원고');
    const pub=cloudConfigured?await publishCloud(cloudId.current!,workId,sceneIds):makePublication(work,sceneIds);
    update(s=>({...s,works:s.works.map(w=>w.id===workId?{...w,publications:[...w.publications,pub].slice(-100),activePublicationId:pub.id}:w)}));await flush();return pub;
  }
  async function addAsset(workId:string,docId:string,file:File){
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024)throw new Error('PNG, JPEG, WebP 이미지 10MB 이하만 첨부할 수 있습니다.');
    const id=uid();await db.assets.put({id,namespace,blob:file});
    if(cloudConfigured){const {error:uploadError}=await cloud().storage.from('private-assets').upload(`${user}/${id}`,file,{contentType:file.type});if(uploadError)throw uploadError;}
    const meta:AssetMeta={id,workId,name:file.name,type:file.type as AssetMeta['type'],size:file.size};
    update(s=>({...s,assets:[...s.assets,meta],works:s.works.map(w=>w.id===workId?{...w,documents:w.documents.map(d=>d.id===docId?{...d,assetIds:[...d.assetIds,id]}:d)}:w)}));
  }
  async function resolve(choice:'local'|'remote'){
    const c=conflictRef.current;if(!c)return;
    await checkpoint(namespace,c.local,'충돌 해결 전 · 기기 원고');await checkpoint(namespace,c.remote,'충돌 해결 전 · 다른 원고');
    const row=await db.workspaces.get(namespace);if(!row)throw new Error('기기 원고가 없습니다.');
    recordRef.current={...row,cloudVersion:c.remoteCloudVersion??row.cloudVersion};await db.workspaces.put(recordRef.current);
    conflictRef.current=null;setConflict(null);update(()=>structuredClone(choice==='local'?c.local:c.remote));await flush();setEpoch(x=>x+1);
  }
  return <Context.Provider value={{state,namespace,loading,status,error,conflict,user,canUse,epoch,lastExportAt,update,
    snapshot:async(label)=>{await flush();await checkpoint(namespace,dataRef.current!,label);},revisions:()=>listRevisions(namespace),restore,exportBackup,importBackup,publish,addAsset,resolve,
    login:async(email,password)=>{const {error}=await cloud().auth.signInWithPassword({email,password});if(error)throw error;},
    logout:async()=>{await flush();await syncNow();await cloud().auth.signOut();},flush,syncNow,clearError:()=>setError('')}}>{children}</Context.Provider>;
}
