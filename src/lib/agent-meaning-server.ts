import { embed } from 'ai';
import { z } from 'zod';
import { providerConfig } from './ai-provider';
import { vertexGemini } from './vertex-runtime';
import { agentAdmin } from './agent-server';
import { wikiFingerprint } from './agent-wiki';
import { MEANING_DIMENSIONS,meaningMatchSchema,meaningMissing,meaningModel,meaningPassages,normalizeEmbedding } from './agent-meaning';
import type { agentDocuments } from './writing-agent';

type MeaningDocument=Pick<ReturnType<typeof agentDocuments>[number],'id'|'title'|'text'|'properties'>;

const unavailable='의미 검색 저장소가 아직 준비되지 않았습니다.';

export const meaningAvailable=()=>!!providerConfig('gemini');

async function embedText(value:string,task:'RETRIEVAL_DOCUMENT'|'RETRIEVAL_QUERY',title?:string){
  const config=providerConfig('gemini');

  if(!config)throw new Error('Vertex AI 연결이 없어 의미 검색을 할 수 없습니다.');
  const model=meaningModel();

  try{
    const result=await embed({model:vertexGemini({...config,location:process.env.VERTEX_EMBEDDING_LOCATION||config.location}).embeddingModel(model),value,maxRetries:1,providerOptions:{vertex:{taskType:task,outputDimensionality:MEANING_DIMENSIONS,...title&&task==='RETRIEVAL_DOCUMENT'&&{title}}}});

    return {values:normalizeEmbedding(result.embedding.slice(0,MEANING_DIMENSIONS)),tokens:result.usage?.tokens||0};
  }catch{throw new Error('Vertex AI 임베딩을 받지 못했습니다. 모델·접근 권한·할당량을 확인하세요.');}
}

/** Runs `work` over items with at most `limit` in flight; gemini-embedding-001 takes one passage per request. */
async function pooled<T,R>(items:T[],limit:number,work:(item:T)=>Promise<R>){
  const results:R[]=[];let next=0;

  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(next<items.length){const index=next++;results[index]=await work(items[index]);}}));

  return results;
}

const batches=<T,>(items:T[],size:number)=>Array.from({length:Math.ceil(items.length/size)},(_,i)=>items.slice(i*size,i*size+size));

/**
 * Brings the passages of the given documents up to date: a document whose fingerprint or model changed is embedded again,
 * at most `budget` passages per call so one tool call stays short. Returns what is still waiting.
 */
export async function indexMeaning(owner:string,workspace:string,docs:MeaningDocument[],live:Set<string>,budget=Number(process.env.AGENT_MEANING_BATCH)||400){
  const db=agentAdmin(),model=meaningModel(),known=new Map<string,string>();

  for(const ids of batches(docs.map(doc=>doc.id),150)){
    const result=await db.from('agent_embeddings').select('document_id,hash,model').eq('owner_id',owner).eq('chunk_index',0).in('document_id',ids);

    if(meaningMissing(result.error))throw new Error(unavailable);

    if(result.error)throw new Error('의미 검색 색인을 읽지 못했습니다.');

    for(const row of z.array(z.object({document_id:z.uuid(),hash:z.string(),model:z.string()})).parse(result.data))known.set(row.document_id,row.model===model?row.hash:'');
  }

  // Passages of documents that left the workspace are removed as soon as a search notices them.
  const all=await db.from('agent_embeddings').select('document_id').eq('owner_id',owner).eq('chunk_index',0);

  if(all.error)throw new Error('의미 검색 색인을 읽지 못했습니다.');
  const gone=z.array(z.object({document_id:z.uuid()})).parse(all.data).map(row=>row.document_id).filter(id=>!live.has(id));

  for(const ids of batches(gone,150)){const removed=await db.from('agent_embeddings').delete().eq('owner_id',owner).in('document_id',ids);

    if(removed.error)throw new Error('의미 검색 색인을 정리하지 못했습니다.');}

  const stale=docs.flatMap(doc=>{const hash=wikiFingerprint(doc),passages=meaningPassages(doc.text);

    return passages.length&&known.get(doc.id)!==hash?[{doc,hash,passages}]:[];});

  let used=0,tokens=0,indexed=0;

  for(const item of stale){
    if(used+item.passages.length>budget&&indexed)break;
    const vectors=await pooled(item.passages,6,passage=>embedText(passage.text,'RETRIEVAL_DOCUMENT',item.doc.title));
    const now=new Date().toISOString(),rows=item.passages.map((passage,index)=>({owner_id:owner,workspace_id:workspace,document_id:item.doc.id,chunk_index:index,hash:item.hash,model,start_offset:passage.start,length:passage.length,embedding:vectors[index].values,updated_at:now}));
    const cleared=await db.from('agent_embeddings').delete().eq('owner_id',owner).eq('document_id',item.doc.id);

    if(cleared.error)throw new Error('의미 검색 색인을 저장하지 못했습니다.');

    for(const chunk of batches(rows,100)){const saved=await db.from('agent_embeddings').insert(chunk);

      if(saved.error)throw new Error('의미 검색 색인을 저장하지 못했습니다.');}

    used+=item.passages.length;tokens+=vectors.reduce((sum,vector)=>sum+vector.tokens,0);indexed++;
  }

  return {indexed,waiting:stale.length-indexed,tokens};
}

/** The passages closest in meaning to the query among the given documents, best first. */
export async function searchMeaning(owner:string,docs:MeaningDocument[],query:string,limit=10){
  const vector=await embedText(query,'RETRIEVAL_QUERY'),byId=new Map(docs.map(doc=>[doc.id,doc]));
  const result=await agentAdmin().rpc('agent_match_passages',{p_owner:owner,p_documents:docs.map(doc=>doc.id),p_model:meaningModel(),p_embedding:vector.values,p_limit:limit});

  if(meaningMissing(result.error))throw new Error(unavailable);

  if(result.error)throw new Error('의미 검색을 하지 못했습니다.');

  return {tokens:vector.tokens,passages:meaningMatchSchema.parse(result.data).flatMap(row=>{const doc=byId.get(row.document_id);

    return doc?[{id:doc.id,title:doc.title,offset:row.start_offset,excerpt:doc.text.slice(row.start_offset,row.start_offset+Math.min(row.length,400)),score:Math.round(row.similarity*1000)/1000}]:[];})};
}
