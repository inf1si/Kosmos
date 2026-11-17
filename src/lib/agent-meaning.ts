import { z } from 'zod';

/**
 * Meaning search: documents are cut into passages, each passage is embedded once per content fingerprint,
 * and a query is compared to the passages of the documents a run may read. Only offsets are stored, never the text.
 */
export const MEANING_DIMENSIONS=768;

export const meaningModel=(env:Record<string,string|undefined>=process.env)=>env.VERTEX_EMBEDDING_MODEL||'gemini-embedding-001';

export type MeaningPassage={start:number;length:number;text:string};

/** Passages of about `size` characters that end at paragraph breaks; a paragraph longer than `max` is cut. */
export function meaningPassages(text:string,size=900,max=1500):MeaningPassage[]{
  const passages:MeaningPassage[]=[];

  let start=-1,end=0;

  const flush=()=>{if(start>=0&&end>start){const value=text.slice(start,end);

    if(value.trim())passages.push({start,length:end-start,text:value});}

  start=-1;};

  for(const match of text.matchAll(/[^\n]+/g)){
    let from=match.index;
    const to=from+match[0].length;

    if(start>=0&&to-start>size)flush();

    while(to-from>max){flush();passages.push({start:from,length:max,text:text.slice(from,from+max)});from+=max;}

    if(start<0)start=from;
    end=to;
  }

  flush();

  return passages.filter(passage=>passage.text.trim());
}

/** Reduced Gemini embeddings are not unit length; normalising makes the dot product the cosine similarity. */
export function normalizeEmbedding(values:number[]){
  const length=Math.sqrt(values.reduce((sum,value)=>sum+value*value,0));

  if(!length)throw new Error('임베딩 결과가 비었습니다.');

  return values.map(value=>Math.round(value/length*1e6)/1e6);
}

export const meaningMatchSchema=z.array(z.object({document_id:z.uuid(),chunk_index:z.number().int(),start_offset:z.number().int(),length:z.number().int(),similarity:z.number()}));

export const meaningMissing=(error:{code?:string}|null)=>error?.code==='PGRST205'||error?.code==='PGRST202'||error?.code==='42P01'||error?.code==='42883';
