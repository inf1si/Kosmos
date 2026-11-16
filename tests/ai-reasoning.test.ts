import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reasoningLevels,reasoningChoice,reasoningEvent,eventReasoning,isReasoningEvent,reasoningLevelSchema,type ReasoningLevel } from '../src/lib/ai-reasoning';
import { requestChat } from '../src/lib/ai-vertex';
import { chatInputSchema } from '../src/lib/ai-conversation';
import { agentMessageInputSchema } from '../src/lib/writing-agent';
import type { ProviderConfig } from '../src/lib/ai-provider';
import { vertexTestAuth,vertexReviewResponse } from './fixtures/vertex';

const review={review:'확인',suggestions:[]};

// The last column marks models whose levels only the agent offers: their JSON answers use a forced tool call, which Claude refuses while thinking.
const models:[ProviderConfig['provider'],string,ReasoningLevel[],boolean?][]=[
  ['gemini','gemini-3.1-pro-preview',['low','medium','high']],
  ['gemini','gemini-3.8-flash',['low','medium','high']],
  ['gemini','gemini-3.5-flash-lite',['low','medium','high']],
  ['gemini','gemini-4-argon',['low','medium','high']],
  ['gemini','gemini-4-carbon',['low','medium','high']],
  ['gemini','gemini-2.5-pro',['low','medium','high']],
  ['gemini','gemini-2.5-flash',['low','medium','high']],
  ['gemini','gemini-2.0-flash',[]],
  ['gemini','gemini-3-pro-image-preview',[]],
  ['anthropic','claude-opus-5-5',['low','medium','high','xhigh','max']],
  ['anthropic','claude-sonnet-5-5@20260901',['low','medium','high','xhigh','max']],
  ['anthropic','claude-haiku-5-5',['low','medium','high','xhigh','max'],true],
  ['anthropic','claude-fable-5-1',['low','medium','high','xhigh','max']],
  ['anthropic','claude-opus-4-8',['low','medium','high','xhigh','max'],true],
  ['anthropic','claude-opus-5',['low','medium','high','xhigh','max'],true],
  ['anthropic','claude-sonnet-5@20260301',['low','medium','high','xhigh','max'],true],
  ['anthropic','claude-fable-5',['low','medium','high','xhigh','max'],true],
  ['anthropic','claude-test@20260101',['low','medium','high','xhigh','max'],true],
  ['anthropic','claude-sonnet-4-6',['low','medium','high','max'],true],
  ['anthropic','claude-opus-4-6',['low','medium','high','max'],true],
  ['anthropic','claude-sonnet-4-5@20250929',['low','medium','high'],true],
  ['anthropic','claude-haiku-4-5@20251001',['low','medium','high'],true],
  ['anthropic','claude-opus-4-1@20250805',['low','medium','high'],true],
  ['anthropic','claude-sonnet-4@20250514',['low','medium','high'],true],
  ['anthropic','claude-3-haiku@20240307',[]],
];

test('모델마다 지원하는 생각 단계만 내놓고 즉시 응답은 높음에서 멈춘다',()=>{
  for(const [provider,model,levels,agentOnly] of models){
    assert.deepEqual(reasoningLevels(provider,model,true),['auto',...levels],model);
    assert.deepEqual(reasoningLevels(provider,model),['auto',...agentOnly?[]:levels.filter(level=>!['xhigh','max'].includes(level))],model);
  }

  assert.deepEqual(reasoningLevels('openai','gpt-test',true),['auto']);
});

test('저장한 단계가 지금 모델에 없으면 가까운 아래 단계, 그것도 없으면 자동으로 간다',()=>{
  const claude=reasoningLevels('anthropic','claude-opus-5-5',true),gemini=reasoningLevels('gemini','gemini-3.1-pro-preview',true);
  assert.equal(reasoningChoice('max',claude),'max');assert.equal(reasoningChoice('max',gemini),'high');assert.equal(reasoningChoice('xhigh',reasoningLevels('anthropic','claude-sonnet-4-6',true)),'high');
  assert.equal(reasoningChoice('max',reasoningLevels('anthropic','claude-opus-5-5')),'high');assert.equal(reasoningChoice('medium',gemini),'medium');
  assert.equal(reasoningChoice('high',reasoningLevels('gemini','gemini-2.0-flash')),'auto');assert.equal(reasoningChoice(undefined,claude),'auto');assert.equal(reasoningChoice('auto',claude),'auto');
});

test('고른 단계는 Vertex 요청에 그 값 그대로 실리고 자동은 생각 설정을 보내지 않는다',async()=>{
  for(const [provider,model] of models){
    const levels=reasoningLevels(provider,model).slice(1);

    const choices:ReasoningLevel[]=['auto',...levels];

    for(const level of choices){
      let body:any;

      const mock:typeof fetch=async(input,init)=>{body=JSON.parse(String(init?.body??await new Request(input).text()));

return Response.json(vertexReviewResponse(provider,review));};

      await requestChat({provider,model,project:'orbiter-ai',location:'global'},{question:'질문'},[],mock,undefined,{googleAuthOptions:vertexTestAuth()},level);
      const label=`${model} ${level}`,room:Partial<Record<ReasoningLevel,number>>={low:8192,medium:20480,high:32768};

      if(provider==='gemini'){
        const thinking=body.generationConfig.thinkingConfig;
        assert.equal(body.generationConfig.maxOutputTokens,8192+(room[level==='auto'&&levels.length?'high':level]||0),label);

        if(level==='auto')assert.equal(thinking,undefined,label);
        else if(model.includes('2.5')){assert(thinking.thinkingBudget>=1024,label);assert(thinking.thinkingBudget<body.generationConfig.maxOutputTokens,label);}
        else assert.deepEqual(thinking,{thinkingLevel:level},label);
      }else if(level==='auto'){assert.equal(body.thinking,undefined,label);assert.equal(body.output_config?.effort,undefined,label);assert(body.max_tokens<=8192,label);}
      else{assert.equal(body.thinking.type,'adaptive',label);assert.equal(body.output_config.effort,level,label);assert(body.max_tokens>8192,label);assert(!['any','tool'].includes(body.tool_choice?.type),`${label}: Claude refuses a forced tool call while thinking`);}
    }
  }
});

test('JSON을 도구 강제로 받는 Claude 모델은 생각을 켜면 요청이 거절되므로 즉시 답에서는 자동만 둔다',async()=>{
  for(const model of ['claude-sonnet-4-6','claude-opus-4-8','claude-haiku-5-5','claude-test@20260101']){
    let body:any;

    const mock:typeof fetch=async(input,init)=>{body=JSON.parse(String(init?.body??await new Request(input).text()));

return Response.json(vertexReviewResponse('anthropic',review));};

    await requestChat({provider:'anthropic',model,project:'orbiter-ai',location:'global'},{question:'질문'},[],mock,undefined,{googleAuthOptions:vertexTestAuth()},'high');
    assert.equal(body.tool_choice?.type,'any',model);assert.equal(body.thinking?.type,'adaptive',model);assert.deepEqual(reasoningLevels('anthropic',model),['auto'],model);
  }
});

test('자동이어도 Gemini는 기본 생각을 하므로 답 자리를 남기고, 한 번에 끝나지 않은 답은 이어 받는다',async()=>{
  const bodies:any[]=[];

  const mock:typeof fetch=async(input,init)=>{bodies.push(JSON.parse(String(init?.body??await new Request(input).text())));

return Response.json(bodies.length===1?{candidates:[{finishReason:'CONTINUATION',continuationToken:'next',content:{role:'model',parts:[{text:'생각',thought:true}]}}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:32768}}:vertexReviewResponse('gemini',review));};

  assert.deepEqual(await requestChat({provider:'gemini',model:'gemini-4-carbon',project:'orbiter-ai',location:'global'},{question:'질문'},[],mock,undefined,{googleAuthOptions:vertexTestAuth()}),review);
  assert.equal(bodies[0].generationConfig.maxOutputTokens,8192+32768);assert.equal(bodies[0].generationConfig.thinkingConfig,undefined);assert.equal(bodies[1].continuationToken,'next');
});

test('요청 형식은 단계를 받고 모르는 값은 거절하며 실행 기록에서 단계를 되읽는다',()=>{
  const chat={noteId:'9d3b1c0e-5a50-4c0b-9a59-1f6f3d2f7a11',docId:'9d3b1c0e-5a50-4c0b-9a59-1f6f3d2f7a11',version:'v',provider:'gemini',message:'질문',includeManuscript:false,sourceIds:[],history:[]};
  assert.equal(chatInputSchema.parse(chat).reasoning,undefined);assert.equal(chatInputSchema.parse({...chat,reasoning:'high'}).reasoning,'high');assert(!chatInputSchema.safeParse({...chat,reasoning:'huge'}).success);
  const message={id:chat.docId,message:'요청',mode:'review',provider:'anthropic',web:false};
  assert.equal(agentMessageInputSchema.parse({...message,reasoning:'max'}).reasoning,'max');assert(agentMessageInputSchema.safeParse(message).success);assert(!agentMessageInputSchema.safeParse({...message,reasoning:'none'}).success);

  for(const level of reasoningLevelSchema.options){const event=reasoningEvent(level);assert.equal(eventReasoning([{id:'focus'},event]),level);assert(isReasoningEvent(event));}

  assert.equal(eventReasoning([{id:'focus'},{id:'toolu_reasoning'}]),'auto');assert(!isReasoningEvent({id:'focus'}));
});
