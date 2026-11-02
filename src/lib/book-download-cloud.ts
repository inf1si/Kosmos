import {z} from 'zod';
import {cloud} from './cloud';
import {bookDownloadBucket,bookDownloadColumns,bookDownloadSchema,bookDownloadTypes,storedBookDownloadSchema,type BookDownload} from './book-downloads';
import type {BookFormat} from './book-content';
import type {TransferDownload} from './interchange';

export async function authorBookDownloads(ownerId:string,workId:string){
  const {data,error}=await cloud().from('book_downloads').select(bookDownloadColumns).eq('owner_id',ownerId).eq('work_id',workId).order('format');

  if(error)throw new Error('다운로드 파일을 불러오지 못했습니다.');

  return z.array(bookDownloadSchema).parse(data);
}

export async function registerBookDownload(ownerId:string,workId:string,format:BookFormat,file:TransferDownload,previous?:BookDownload){
  if(file.blob.size>50*1024*1024)throw new Error('서재 다운로드 파일은 50MB 이하만 등록할 수 있습니다.');
  const entry=bookDownloadSchema.parse({work_id:workId,format,file_id:crypto.randomUUID(),filename:file.name,size:file.blob.size,updated_at:new Date().toISOString()});
  const row=storedBookDownloadSchema.parse({...entry,owner_id:ownerId,object_path:`${ownerId}/${entry.file_id}.${format}`});
  const {error:uploadError}=await cloud().storage.from(bookDownloadBucket).upload(row.object_path,file.blob,{contentType:bookDownloadTypes[format],cacheControl:'0',upsert:false});

  if(uploadError)throw new Error('파일을 올리지 못했습니다. 다시 시도하세요.');
  const table=cloud().from('book_downloads');
  const result=previous?await table.update(row).eq('owner_id',ownerId).eq('work_id',workId).eq('format',format).eq('file_id',previous.file_id).select(bookDownloadColumns).single():await table.insert(row).select(bookDownloadColumns).single();

  if(result.error){
    // RLS prevents cleanup from deleting a registration that committed before its HTTP response was lost.
    await cloud().storage.from(bookDownloadBucket).remove([row.object_path]);
    throw new Error('등록 결과를 확인하지 못했습니다. 목록을 새로 불러오세요.');
  }

  if(previous)await cloud().storage.from(bookDownloadBucket).remove([`${ownerId}/${previous.file_id}.${format}`]);

  return bookDownloadSchema.parse(result.data);
}

export async function removeBookDownload(ownerId:string,file:BookDownload){
  const {data,error}=await cloud().from('book_downloads').delete().eq('owner_id',ownerId).eq('work_id',file.work_id).eq('format',file.format).eq('file_id',file.file_id).select('file_id').single();

  if(error||!data)throw new Error('공개를 해제하지 못했습니다. 목록을 새로 불러온 뒤 다시 시도하세요.');
  // Removing metadata revokes access first; a failed storage cleanup leaves a private, unreachable object.
  await cloud().storage.from(bookDownloadBucket).remove([`${ownerId}/${file.file_id}.${file.format}`]);
}
