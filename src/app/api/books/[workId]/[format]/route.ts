import {z} from 'zod';
import {bookAttachment,bookDownloadBucket,bookDownloadTypes,bookFormatSchema,storedBookDownloadSchema} from '@/lib/book-downloads';
import {publicBooksClient} from '@/lib/public-books';

export const dynamic='force-dynamic';

export const runtime='nodejs';

export const maxDuration=60;

export async function GET(request:Request,{params}:{params:Promise<{workId:string;format:string}>}){
  const input=z.object({workId:z.uuid(),format:bookFormatSchema}).safeParse(await params),client=publicBooksClient();
  const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"};
  const missing=()=>Response.json({error:'공개된 다운로드 파일이 없습니다.'},{status:404,headers});

  if(!input.success||!client)return missing();

  const {data,error}=await client.from('book_downloads').select('*').eq('work_id',input.data.workId).eq('format',input.data.format).maybeSingle();

  if(error)return Response.json({error:'파일을 불러오지 못했습니다.'},{status:503,headers});

  if(!data)return missing();
  const parsed=storedBookDownloadSchema.safeParse(data);

  if(!parsed.success)return Response.json({error:'파일 정보를 확인하세요.'},{status:502,headers});
  const file=parsed.data;
  // A download, rather than a signed URL, checks current RLS again and streams without a buffered Function response.
  const result=await client.storage.from(bookDownloadBucket).download(file.object_path,undefined,{signal:request.signal});

  if(result.error||!result.data)return missing();

  return new Response(result.data.stream(),{headers:{...headers,'Content-Type':bookDownloadTypes[file.format],'Content-Disposition':bookAttachment(file.filename)}});
}
