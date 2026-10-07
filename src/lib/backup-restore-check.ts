import { db } from './database';
import { readBackup } from './backup';

/** Round trip into an isolated IndexedDB namespace, without cloud writes or current workspace changes. */
export async function verifyBackupRestore(file:Blob){
  const parsed=await readBackup(file),namespace=`restore-check:${crypto.randomUUID()}`;
  const revisions=parsed.revisions.map(r=>({...r,id:crypto.randomUUID(),namespace}));

  try{
    await db.transaction('rw',db.workspaces,db.revisions,db.assets,async()=>{
      await db.workspaces.add({namespace,data:parsed.data,localVersion:1,cloudVersion:0,dirty:false,lastExportAt:null});
      await db.revisions.bulkAdd(revisions);await db.assets.bulkAdd(parsed.assets.map(a=>({...a,namespace})));
    });
    const stored=await db.workspaces.get(namespace);

    if(!stored||JSON.stringify(stored.data)!==JSON.stringify(parsed.data))throw new Error('복원한 원고가 백업과 다릅니다.');

    for(const revision of revisions){const restored=await db.revisions.get(revision.id);

if(!restored||JSON.stringify(restored.data)!==JSON.stringify(revision.data))throw new Error('복구 이력을 다시 읽지 못했습니다.');}

    for(const asset of parsed.assets){const restored=await db.assets.get([namespace,asset.id]);

if(!restored||restored.blob.size!==asset.blob.size)throw new Error('복원한 첨부 크기가 다릅니다.');const original=new Uint8Array(await crypto.subtle.digest('SHA-256',await asset.blob.arrayBuffer())),actual=new Uint8Array(await crypto.subtle.digest('SHA-256',await restored.blob.arrayBuffer()));

if(original.some((byte,i)=>byte!==actual[i]))throw new Error('복원한 첨부 내용이 다릅니다.');}

    return{works:stored.data.works.length,documents:stored.data.works.reduce((n,w)=>n+w.documents.length,0),notes:stored.data.notes?.length||0,revisions:revisions.length,assets:parsed.assets.length};
  }finally{await db.transaction('rw',db.workspaces,db.revisions,db.assets,async()=>{await db.workspaces.delete(namespace);await db.revisions.where('namespace').equals(namespace).delete();await db.assets.where('namespace').equals(namespace).delete();});}
}
