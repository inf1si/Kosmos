export class BodyLimitError extends Error {}
export async function readLimitedBytes(source:Request|Response,maxBytes:number):Promise<Uint8Array>{
  if(Number(source.headers.get('content-length')||0)>maxBytes)throw new BodyLimitError('본문 크기를 초과했습니다.');
  const reader=source.body?.getReader();if(!reader)throw new SyntaxError('빈 요청입니다.');const chunks:Uint8Array[]=[];let bytes=0;
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>maxBytes){await reader.cancel();throw new BodyLimitError('본문 크기를 초과했습니다.');}chunks.push(part.value);}}finally{reader.releaseLock();}
  const result=new Uint8Array(bytes);let offset=0;for(const c of chunks){result.set(c,offset);offset+=c.length;}return result;
}
export async function readLimitedJson(source:Request|Response,maxBytes:number):Promise<unknown>{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readLimitedBytes(source,maxBytes)));}
