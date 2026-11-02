import {z} from 'zod';
import {bookDownloadColumns,bookDownloadSchema} from '@/lib/book-downloads';
import {publicBooksClient} from '@/lib/public-books';

export const dynamic='force-dynamic';

export async function GET(){
  const client=publicBooksClient(),headers={'Cache-Control':'no-store'};

  if(!client)return Response.json([],{headers});

  const {data,error}=await client.from('book_downloads').select(bookDownloadColumns).order('format');

  if(error)return Response.json({error:'다운로드 목록을 불러오지 못했습니다.'},{status:503,headers});

  const parsed=z.array(bookDownloadSchema).safeParse(data);

  return parsed.success?Response.json(parsed.data,{headers}):Response.json({error:'파일 정보를 확인하세요.'},{status:502,headers});
}
