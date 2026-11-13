import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import type { PrepareStepInfo } from '@ai-sdk/workflow';
import { agentRunRecord,agentStepSettings,compactToolResults,FINAL_STEP_NOTE } from '../src/lib/agent-context';

type Prompt=PrepareStepInfo['messages'];

const call=(id:string,value:{id:string;title:string;text:string}|{saved:boolean;id:string}):Prompt[number]=>({role:'tool',content:[{type:'tool-result',toolCallId:id,toolName:'readSource',output:{type:'json',value}}]});

const outputs=(messages:Prompt)=>messages.flatMap(m=>m.role==='tool'&&m.content[0].type==='tool-result'&&m.content[0].output.type==='json'?[m.content[0].output.value]:[]);

const callIds=(messages:Prompt)=>messages.flatMap(m=>m.role==='tool'&&m.content[0].type==='tool-result'?[m.content[0].toolCallId]:[]);

const compactedValue=z.object({compacted:z.string()});

test('긴 실행은 오래된 도구 결과부터 줄이고 최근 결과·호출 ID·만든 문서 ID는 남긴다',()=>{
  const big='가'.repeat(5000),messages:Prompt=[{role:'system',content:'지침'},{role:'user',content:[{type:'text',text:'질문'}]},...Array.from({length:8},(_,i)=>call(`c${i}`,{id:`d${i}`,title:`문서 ${i}`,text:big}))];

  assert.deepEqual(compactToolResults(messages,100000),messages,'under budget nothing changes');
  const compact=compactToolResults(messages,20000),values=outputs(compact);

  assert.equal(compact.length,messages.length);assert.deepEqual(compact.map(m=>m.role),messages.map(m=>m.role));
  assert.deepEqual(callIds(compact),Array.from({length:8},(_,i)=>`c${i}`));
  assert.deepEqual(values[0],{id:'d0',title:'문서 0',compacted:'앞선 결과라 문맥에서 줄였다. 다시 필요하면 같은 도구로 다시 읽는다.'});

  for(const value of values.slice(4))assert.equal(z.object({text:z.string()}).parse(value).text,big,'the newest four stay whole');

  for(const value of values.slice(0,4))assert(compactedValue.safeParse(value).success,'older results go first even when the budget is still exceeded');
  assert.equal(outputs(compactToolResults(messages,31000)).filter(value=>compactedValue.safeParse(value).success).length,2,'only as many as the budget needs');
  const small=[call('s',{saved:true,id:'x'})];

  assert.deepEqual(compactToolResults(small,1,0),small,'short results are not worth replacing');
});

test('마지막 단계는 도구 없이 답하게 하고 그 전에는 도구를 그대로 둔다',()=>{
  const messages:Prompt=[{role:'user',content:[{type:'text',text:'질문'}]}];

  assert.deepEqual(agentStepSettings(messages,3,80,1000),{messages});
  const last=agentStepSettings(messages,79,80,1000);

  assert.equal(last.toolChoice,'none');assert.equal(last.messages.length,2);assert(JSON.stringify(last.messages.at(-1)).includes(FINAL_STEP_NOTE));
});

test('지난 실행의 작업 기록은 바꾼 문서와 반영 여부를 적는다',()=>{
  const events=[{id:'focus',title:'열어 둔 문서',detail:'착륙'},{id:'a',title:'문서 읽기',detail:'착륙'},{id:'b',title:'이어 쓰기',detail:'착륙'},{id:'c',title:'문서 만들기',detail:'관측소'}];
  const op={type:'rename' as const,id:'00000000-0000-4000-8000-000000000001',title:'x'};

  assert.equal(agentRunRecord({events,operations:[op],applied_version:null,reverted:false}),'[작업 기록 · 작업본에만 있고 반영되지 않음] 이어 쓰기 「착륙」, 문서 만들기 「관측소」');
  assert(agentRunRecord({events,operations:[op],applied_version:3,reverted:false}).startsWith('[작업 기록 · 원고에 반영됨]'));
  assert(agentRunRecord({events,operations:[op],applied_version:3,reverted:true}).startsWith('[작업 기록 · 되돌림]'));
  assert.equal(agentRunRecord({events:events.slice(0,2),operations:[],applied_version:null,reverted:false}),'');
});
