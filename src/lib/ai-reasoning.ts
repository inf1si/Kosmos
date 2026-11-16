import { z } from 'zod';
import type { AIProvider } from './ai-provider';

/** 'auto' sends no setting, so the model keeps its own default. The order is the order of effort. */
export const reasoningLevelSchema=z.enum(['auto','low','medium','high','xhigh','max']);

export type ReasoningLevel=z.infer<typeof reasoningLevelSchema>;

export const reasoningLabels:Record<ReasoningLevel,string>={auto:'자동',low:'낮음',medium:'중간',high:'높음',xhigh:'매우 높음',max:'최대'};

const order=reasoningLevelSchema.options;

function claudeLevels(id:string,deep:boolean):ReasoningLevel[]{
  if(!id.includes('claude-')||/claude-(?:instant|v?2|3)(?=$|[-.:@])/.test(id))return [];

  // The 45-second answers are JSON. The SDK asks most Claude models for it through a forced tool call, and Claude refuses
  // a forced tool call while thinking is on, so only models the SDK asks through native structured output get levels there.
  if(!deep&&!/claude-(?:opus|sonnet)-5-5|claude-fable-5-1/.test(id))return [];

  if(/claude-(?:sonnet|opus)-4-6/.test(id))return ['low','medium','high','max'];

  if(/claude-(?:sonnet|opus|haiku)-4(?:[-@]|$)/.test(id)&&!/claude-opus-4-[78]/.test(id))return ['low','medium','high'];

  return ['low','medium','high','xhigh','max'];
}

function geminiLevels(id:string):ReasoningLevel[]{
  if(!/(^|[/.])gemini-/.test(id)||id.includes('image')||/(^|[/.])gemini-(?:1|2(?!\.5))(?:[.-]|$)/.test(id)||/(^|[/.])gemini-pro(?:-vision)?$/.test(id))return [];

  return ['low','medium','high'];
}

/**
 * The levels the Vertex SDK sends to this model as chosen, without rounding to another level.
 * The 45-second answers (AI 대화·커서 AI 질문) stop at 'high'; the long-running agent passes `deep` for the model's full range.
 */
export function reasoningLevels(provider:AIProvider,model:string,deep=false):ReasoningLevel[]{
  const id=model.toLowerCase(),levels=provider==='anthropic'?claudeLevels(id,deep):provider==='gemini'?geminiLevels(id):[];

  return ['auto',...levels.filter(level=>deep||order.indexOf(level)<=order.indexOf('high'))];
}

/** A saved level the current model lacks falls to the nearest lower one it has, then to 'auto'. */
export function reasoningChoice(level:ReasoningLevel|undefined,levels:ReasoningLevel[]):ReasoningLevel{
  const rank=order.indexOf(level||'auto'),allowed=levels.filter(candidate=>order.indexOf(candidate)<=rank);

  return allowed[allowed.length-1]||'auto';
}

const EVENT='reasoning-';

/** A run keeps its level as a work-log entry, so a queued run is dispatched with the level it was sent with. */
export function reasoningEvent(level:ReasoningLevel){return {id:EVENT+level,title:'생각 단계',detail:reasoningLabels[level]};}

export function eventReasoning(events:{id:string}[]):ReasoningLevel{
  const id=events.find(event=>event.id.startsWith(EVENT))?.id;

  return reasoningLevelSchema.safeParse(id?.slice(EVENT.length)).data||'auto';
}

export const isReasoningEvent=(event:{id:string})=>event.id.startsWith(EVENT);
