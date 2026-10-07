import Dexie, { type Table } from 'dexie';
import type { LocalRecord, Revision, Workspace } from './model';

export type StoredAsset={id:string;namespace:string;blob:Blob};

class StudioDatabase extends Dexie {
  workspaces!:Table<LocalRecord,string>;
  revisions!:Table<Revision,string>;
  assets!:Table<StoredAsset,[string,string]>;
  constructor(){super('orbit-novel-studio-v1');this.version(1).stores({workspaces:'namespace',revisions:'id,namespace,createdAt',assets:'[namespace+id],namespace,id'});}
}

export const db=new StudioDatabase();

export class LocalConflict extends Error {constructor(public remote:LocalRecord){super('다른 창에서 원고가 변경되었습니다.');}}

export async function writeLocal(namespace:string,data:Workspace,baseVersion:number):Promise<LocalRecord>{
  return db.transaction('rw',db.workspaces,async()=>{
    const old=await db.workspaces.get(namespace);

    if((old?.localVersion||0)!==baseVersion)throw new LocalConflict(old!);
    const next:LocalRecord={namespace,data:structuredClone(data),localVersion:baseVersion+1,cloudVersion:old?.cloudVersion||0,dirty:true,lastExportAt:old?.lastExportAt||null,pendingRequest:old?.pendingRequest};
    await db.workspaces.put(next);

return next;
  });
}

export async function checkpoint(namespace:string,data:Workspace,label:string){
  const row:Revision={id:crypto.randomUUID(),namespace,data:structuredClone(data),createdAt:new Date().toISOString(),label};
  await db.revisions.add(row);
  const rows=await db.revisions.where('namespace').equals(namespace).sortBy('createdAt');

  if(rows.length>50)await db.revisions.bulkDelete(rows.slice(0,rows.length-50).map(r=>r.id));

  return row;
}

export async function listRevisions(namespace:string){return (await db.revisions.where('namespace').equals(namespace).sortBy('createdAt')).reverse();}
