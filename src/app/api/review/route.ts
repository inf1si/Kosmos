import { z } from 'zod';
import { workspaceSchema,plainText,wikiReferences,povSettings } from '@/lib/model';
import { writerClient } from '@/lib/server-auth';
import { providerSchema } from '@/lib/ai-provider';
import { requestReview } from '@/lib/ai-vertex';
import { requestProviderConfig } from '@/lib/ai-credentials';
import { readLimitedJson,BodyLimitError } from '@/lib/http';

export const maxDuration=60;

const inputSchema=z.object({workId:z.uuid(),docId:z.uuid(),version:z.string().max(100),goal:z.enum(['style','continuity']),provider:providerSchema.default('gemini')});

export async function POST(request:Request){
  const author=await writerClient(request);

if(!author)return Response.json({error:'작가 로그인이 필요합니다.'},{status:401});const client=author.client;

  try{
    const input=inputSchema.parse(await readLimitedJson(request,10000));
    const config=requestProviderConfig(request,input.provider,author.userId);

if(!config)return Response.json({error:'Vertex AI 서버 인증과 모델을 설정하세요.'},{status:503});
    const {data,error}=await client.from('workspaces').select('payload').single();

if(error||!data)return Response.json({error:'작가 권한을 확인하세요.'},{status:403});
    const state=workspaceSchema.parse(data.payload);const work=state.works.find(w=>w.id===input.workId);const doc=work?.documents.find(d=>d.id===input.docId);

    if(!work||!doc)return Response.json({error:'문서가 없습니다.'},{status:404});

    if(doc.updatedAt!==input.version)return Response.json({error:'원고를 동기화한 뒤 다시 검토하세요.'},{status:409});
    const text=plainText(doc.content);

    const linked=wikiReferences(doc.content);const pov=new Set(povSettings(work.documents,doc.pov).map(d=>d.id)),references=work.documents.filter(d=>d.kind==='wiki'&&(linked.includes(d.id)||pov.has(d.id)));
    const context=references.map(d=>({id:d.id,title:d.title,text:plainText(d.content)}));

    try{const result=await requestReview(config,{goal:input.goal==='style'?'문장과 호흡 검토':'시간, 인물의 지식, 기술 제약 검토',title:doc.title,manuscript:text,references:context});

      return Response.json({result,provider:input.provider,model:config.model,version:doc.updatedAt,sources:context.map(({id,title})=>({id,title}))});
    }catch{return Response.json({error:'AI 응답을 완료하지 못했습니다.'},{status:502});}
  }catch(e){if(e instanceof BodyLimitError)return Response.json({error:'요청이 너무 큽니다.'},{status:413});

if(e instanceof z.ZodError||e instanceof SyntaxError)return Response.json({error:'요청 형식을 확인하세요.'},{status:400});

return Response.json({error:'AI 검토를 완료하지 못했습니다.'},{status:502});}
}
