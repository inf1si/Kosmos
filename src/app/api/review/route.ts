import { z } from 'zod';
import { workspaceSchema,plainText,wikiReferences,povSettings } from '@/lib/model';
import { writerClient } from '@/lib/server-auth';
import { providerSchema,providerConfig,requestReview } from '@/lib/ai-provider';
import { readLimitedJson,BodyLimitError } from '@/lib/http';

export const maxDuration=60;

const inputSchema=z.object({workId:z.uuid(),docId:z.uuid(),version:z.string().max(100),goal:z.enum(['style','continuity']),provider:providerSchema.default('openai')});

export async function POST(request:Request){
  const author=await writerClient(request);

if(!author)return Response.json({error:'작가 로그인이 필요합니다.'},{status:401});const client=author.client;

  try{
    const input=inputSchema.parse(await readLimitedJson(request,10000));
    const config=providerConfig(input.provider);

if(!config)return Response.json({error:'선택한 AI의 키와 모델이 아직 연결되지 않았습니다.'},{status:503});
    const {data,error}=await client.from('workspaces').select('payload').single();

if(error||!data)return Response.json({error:'작가 권한을 확인하세요.'},{status:403});
    const state=workspaceSchema.parse(data.payload);const work=state.works.find(w=>w.id===input.workId);const doc=work?.documents.find(d=>d.id===input.docId);

    if(!work||!doc)return Response.json({error:'문서가 없습니다.'},{status:404});

    if(doc.updatedAt!==input.version)return Response.json({error:'원고를 동기화한 뒤 다시 검토하세요.'},{status:409});
    const text=plainText(doc.content);

if(text.length>12000)return Response.json({error:'12,000자 이하 문서를 검토할 수 있습니다.'},{status:413});
    const linked=wikiReferences(doc.content);const pov=new Set(povSettings(work.documents,doc.pov).map(d=>d.id)),references=work.documents.filter(d=>d.kind==='wiki'&&(linked.includes(d.id)||pov.has(d.id))).slice(0,8);
    const context=references.map(d=>({id:d.id,title:d.title,text:plainText(d.content).slice(0,1800)}));
    const budget=await client.rpc('reserve_ai_call');

if(budget.error)return Response.json({error:'AI 호출 한도 또는 작가 권한을 확인하세요. 하루 최대 10회입니다.'},{status:429});

    try{const result=await requestReview(config,{goal:input.goal==='style'?'문장과 호흡 검토':'시간, 인물의 지식, 기술 제약 검토',title:doc.title,manuscript:text,references:context});

      return Response.json({result,provider:input.provider,model:config.model,version:doc.updatedAt,sources:context.map(({id,title})=>({id,title})),dailyCalls:budget.data});
    }catch{return Response.json({error:'선택한 AI의 응답을 완료하지 못했습니다. 원고는 저장되어 있습니다.'},{status:502});}
  }catch(e){if(e instanceof BodyLimitError)return Response.json({error:'요청이 너무 큽니다.'},{status:413});

if(e instanceof z.ZodError||e instanceof SyntaxError)return Response.json({error:'요청 형식을 확인하세요.'},{status:400});

return Response.json({error:'AI 검토를 완료하지 못했습니다. 원고 저장에는 영향이 없습니다.'},{status:502});}
}
