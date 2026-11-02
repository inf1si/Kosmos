import {z} from 'zod';

export const bookFormatSchema=z.enum(['pdf','epub','html']);

export const bookDownloadBucket='book-downloads';

export const bookDownloadTypes={pdf:'application/pdf',epub:'application/epub+zip',html:'text/html'};

export const bookDownloadSchema=z.object({
  work_id:z.uuid(),format:bookFormatSchema,file_id:z.uuid(),
  filename:z.string().min(1).max(200).regex(/^[^<>:"/\\|?*\u0000-\u001f\u007f]+$/),
  size:z.number().int().positive().max(50*1024*1024),updated_at:z.iso.datetime({offset:true}),
}).refine(file=>file.filename.endsWith(`.${file.format}`),'파일 형식을 확인하세요.');

export type BookDownload=z.infer<typeof bookDownloadSchema>;

export const storedBookDownloadSchema=bookDownloadSchema.and(z.object({owner_id:z.uuid(),object_path:z.string()})).refine(file=>file.object_path===`${file.owner_id}/${file.file_id}.${file.format}`,'파일 경로를 확인하세요.');

export const bookDownloadColumns='work_id,format,file_id,filename,size,updated_at';

export function bookDownloadUrl(file:Pick<BookDownload,'work_id'|'format'>){return `/api/books/${file.work_id}/${file.format}`;}

export function bookFileSize(bytes:number){return bytes<1024*1024?`${Math.ceil(bytes/1024)}KB`:`${(bytes/1024/1024).toFixed(1)}MB`;}

export function bookAttachment(filename:string){return `attachment; filename="book.${filename.split('.').at(-1)}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`;}
