import { z } from 'zod';
import type { PrepareStepInfo } from '@ai-sdk/workflow';
import type { AgentRunView } from './writing-agent';

type Prompt=PrepareStepInfo['messages'];

type PromptMessage=Prompt[number];

type ToolMessage=Extract<PromptMessage,{role:'tool'}>;

type ToolOutput=Extract<ToolMessage['content'][number],{type:'tool-result'}>['output'];

const STAGED=new Set(['문서 만들기','폴더 만들기','문서 이동','이름 변경','이어 쓰기','문장 수정']);

/** What a past run changed, appended to its answer so the next turn knows which documents moved. The app writes it, not the model. */
export function agentRunRecord(run:Pick<AgentRunView,'events'|'operations'|'applied_version'|'reverted'>):string{
  const staged=run.events.filter(event=>STAGED.has(event.title));

  if(!run.operations.length||!staged.length)return '';
  const state=run.reverted?'되돌림':run.applied_version!==null?'원고에 반영됨':'작업본에만 있고 반영되지 않음';
  const items=staged.slice(0,20).map(event=>`${event.title} 「${event.detail||'제목 없음'}」`).join(', ');

  return `[작업 기록 · ${state}] ${items}${staged.length>20?` 외 ${staged.length-20}개`:''}`;
}

const compactable=new Set(['json','text']);

const identifiers=z.object({id:z.string().optional(),title:z.string().optional(),saved:z.boolean().optional()});

function outputSize(output:ToolOutput){return 'value' in output?JSON.stringify(output.value).length:0;}

/** Keeps identifiers so a created document can still be addressed after its result is compacted. */
function compacted(output:ToolOutput):ToolOutput{
  const kept=output.type==='json'?identifiers.safeParse(output.value).data:undefined;

  return {type:'json',value:{...kept,compacted:'앞선 결과라 문맥에서 줄였다. 다시 필요하면 같은 도구로 다시 읽는다.'}};
}

function resultSize(message:ToolMessage){return message.content.reduce((n,part)=>n+(part.type==='tool-result'?outputSize(part.output):0),0);}

/**
 * Older tool results are replaced, oldest first, until the total fits the budget.
 * The newest `keep` tool messages always stay whole. Call IDs and order are unchanged, so providers still pair calls and results.
 */
export function compactToolResults(messages:Prompt,budget:number,keep=4):Prompt{
  const tools=messages.flatMap((message,index)=>message.role==='tool'?[index]:[]);
  let total=messages.reduce((n,message)=>n+(message.role==='tool'?resultSize(message):0),0);

  if(total<=budget)return [...messages];
  const next=[...messages];

  for(const index of tools.slice(0,Math.max(0,tools.length-keep))){
    const message=next[index];

    if(total<=budget)break;

    if(message.role!=='tool')continue;

    const content=message.content.map(part=>{
      if(part.type!=='tool-result'||!compactable.has(part.output.type)||outputSize(part.output)<1000)return part;
      const smaller=compacted(part.output);

      total-=outputSize(part.output)-outputSize(smaller);

      return {...part,output:smaller};
    });

    next[index]={...message,content};
  }

  return next;
}

export const FINAL_STEP_NOTE='(앱 알림) 실행 단계 한도에 이르러 이번이 마지막 응답이다. 도구를 부르지 말고 지금까지 한 일, 준비한 변경, 남은 일을 작가에게 답한다.';

/** Compacts every step and, on the last allowed step, removes tool use so the run ends with an answer instead of a dangling call. */
export function agentStepSettings(messages:Prompt,stepNumber:number,maxSteps:number,budget:number){
  const compact=compactToolResults(messages,budget);

  if(stepNumber<maxSteps-1)return {messages:compact};
  const note:PromptMessage={role:'user',content:[{type:'text',text:FINAL_STEP_NOTE}]};

  return {messages:[...compact,note],toolChoice:'none' as const};
}
