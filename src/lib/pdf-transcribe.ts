import { z } from 'zod';
import { cloud,cloudConfigured } from './cloud';

/** One request carries a few pages: small enough for the 4MB request limit and for one Gemini answer within a minute. */
export const PDF_PART_PAGES=4,PDF_PART_BYTES=3.5*1024*1024,PDF_MAX_PAGES=300;

export type PdfPart={from:number;to:number;bytes:Uint8Array};

/** Splits a PDF into parts of at most `pages` pages and `maxBytes` bytes, halving a part until it fits. */
export async function pdfParts(bytes:Uint8Array,name:string,pages=PDF_PART_PAGES,maxBytes=PDF_PART_BYTES):Promise<PdfPart[]>{
  const { PDFDocument }=await import('pdf-lib');
  let source;

  try{source=await PDFDocument.load(bytes,{updateMetadata:false});}catch(e){throw new Error(e instanceof Error&&/encrypt/i.test(e.message)?`${name}: 암호가 걸린 PDF는 읽을 수 없습니다.`:`${name}: PDF 파일을 열지 못했습니다.`);}

  const count=source.getPageCount();

  if(!count)throw new Error(`${name}: 쪽이 없는 PDF입니다.`);

  if(count>PDF_MAX_PAGES)throw new Error(`${name}: PDF는 한 파일에 ${PDF_MAX_PAGES}쪽까지 읽습니다. 나누어 가져오세요.`);
  const parts:PdfPart[]=[];

  for(let start=0;start<count;){
    for(let size=Math.min(pages,count-start);;size=Math.ceil(size/2)){
      const part=await PDFDocument.create(),copied=await part.copyPages(source,Array.from({length:size},(_,i)=>start+i));

      for(const page of copied)part.addPage(page);
      const saved=await part.save();

      if(saved.length<=maxBytes){parts.push({from:start+1,to:start+size,bytes:saved});start+=size;break;}

      if(size===1)throw new Error(`${name}: ${start+1}쪽이 너무 커서 읽지 못했습니다. 이미지 해상도를 낮춘 PDF로 가져오세요.`);
    }
  }

  return parts;
}

const answerSchema=z.object({text:z.string(),truncated:z.boolean()});

/** Sends the parts of a PDF to the server, three at a time, and joins their text in page order. */
export async function readPdfText(bytes:Uint8Array,name:string,onProgress?:(done:number,total:number)=>void){
  if(!cloudConfigured)throw new Error('PDF 글자 읽기는 작가 계정으로 로그인한 뒤 사용할 수 있습니다.');
  const token=(await cloud().auth.getSession()).data.session?.access_token;

  if(!token)throw new Error('PDF 글자 읽기는 작가 계정으로 로그인한 뒤 사용할 수 있습니다.');
  const parts=await pdfParts(bytes,name),texts:string[]=[],warnings:string[]=[];let next=0,done=0;

  onProgress?.(0,parts.length);

  await Promise.all(Array.from({length:Math.min(3,parts.length)},async()=>{
    while(next<parts.length){
      const index=next++,part=parts[index];
      const response=await fetch('/api/agent/transcribe',{method:'POST',body:new Blob([Uint8Array.from(part.bytes).buffer],{type:'application/pdf'}),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/pdf'},cache:'no-store'}),value:unknown=await response.json().catch(()=>null);

      if(!response.ok)throw new Error(`${name} ${part.from}쪽: ${z.object({error:z.string()}).safeParse(value).data?.error||'글자를 읽지 못했습니다.'}`);
      const answer=answerSchema.parse(value);texts[index]=answer.text;

      if(answer.truncated)warnings.push(`${name} ${part.from}–${part.to}쪽: 글이 길어 일부만 옮겼습니다.`);
      onProgress?.(++done,parts.length);
    }
  }));

  return {text:texts.filter(Boolean).join('\n\n'),warnings};
}
