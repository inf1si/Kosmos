import { z } from 'zod';
import { DEFAULT_AI_SYSTEM_PROMPT, effectiveSystemPrompt, systemPromptSchema } from './ai-settings';
import type { Workspace } from './model';

export const BUILTIN_PROMPT_IDS=['builtin:default','builtin:line-edit','builtin:continuity','builtin:science','builtin:development','builtin:reader'] as const;
export const DEFAULT_PROMPT_ID=BUILTIN_PROMPT_IDS[0];
export const PROMPT_REVISION='2026-10-03.1';
export const MAX_CUSTOM_PRESETS=20;
export const promptPresetIdSchema=z.union([z.enum(BUILTIN_PROMPT_IDS),z.uuid()]);
const timestamp=z.iso.datetime();
export const customPromptPresetSchema=z.object({id:z.uuid(),title:z.string().trim().min(1).max(80),prompt:systemPromptSchema.trim().min(1),updatedAt:timestamp});
export const aiPreferencesSchema=z.object({version:z.literal(1),activePresetId:promptPresetIdSchema,presets:z.array(customPromptPresetSchema).max(MAX_CUSTOM_PRESETS),updatedAt:timestamp}).superRefine((v,ctx)=>{
  if(new Set(v.presets.map(p=>p.id)).size!==v.presets.length)ctx.addIssue({code:'custom',message:'프리셋 ID가 중복되었습니다.'});
  if(!BUILTIN_PROMPT_IDS.includes(v.activePresetId as typeof BUILTIN_PROMPT_IDS[number])&&!v.presets.some(p=>p.id===v.activePresetId))ctx.addIssue({code:'custom',message:'적용할 프리셋을 찾지 못했습니다.'});
});
export type AIPreferences=z.infer<typeof aiPreferencesSchema>;
export type PromptPreset={id:string;title:string;prompt:string;updatedAt:string;builtin:boolean};
export const BUILTIN_PROMPTS:readonly PromptPreset[]=[
  {id:BUILTIN_PROMPT_IDS[0],title:'기본 집필 동료',focus:''},
  {id:BUILTIN_PROMPT_IDS[1],title:'문장 퇴고',focus:'문체 편집에 집중한다. 시점·시제·어휘를 유지하면서 호흡, 중복, 모호한 지시어, 부자연스러운 대화만 우선 살핀다. 단순히 문장을 짧게 만들지 않는다. 실제 원문에 근거한 중요한 수정 최대 5개와 각 이유를 제시한다.'},
  {id:BUILTIN_PROMPT_IDS[2],title:'설정·시간선 점검',focus:'설정과 연속성 편집에 집중한다. 사건 순서, 인물별 지식 획득 시점, 이동·통신 지연, 명칭, 기술의 제약을 대조한다. 명백한 충돌, 설명이 필요한 틈, 의도적 미스터리를 나눈다. 자료 이름·짧은 근거·서사 영향·가장 작은 해결책을 제시한다. 자료가 없다는 이유만으로 모순이라고 단정하지 않는다.'},
  {id:BUILTIN_PROMPT_IDS[3],title:'SF 가정·개연성',focus:'SF 가정 검토에 집중한다. 먼저 작품의 허구적 전제를 명시하고 그 안의 일관성을 확인한다. 시간·거리·에너지·기준계·정보 전달과 기술 비용을 필요한 만큼 점검한다. 계산에는 가정·단위·대략적 규모를 표시한다. 확실한 사실, 확인이 필요한 가정, 서사적으로 허용한 규칙을 구분한다. 기술의 사회적·윤리적 결과도 제안하되 정답처럼 확정하지 않는다.'},
  {id:BUILTIN_PROMPT_IDS[4],title:'장면·구조 구상',focus:'발전 편집과 구상에 집중한다. 장면의 목적, 선택과 결과, 인물 변화, 작품 길이에 맞는 축적을 살핀다. 요청한 범위 안에서 방향이 다른 2~3개 대안을 내고 각 대안의 주제·시점·호흡에 미치는 영향과 새로 필요한 설정을 표시한다. 작가의 의도 없이 결말이나 장르를 교체하지 않는다. 문장 수정은 명시적으로 요청할 때만 제시한다.'},
  {id:BUILTIN_PROMPT_IDS[5],title:'독자 관점 검토',focus:'첫 독자와 비평적 독자의 관점에 집중한다. 제공된 부분만 읽었음을 전제로 무엇을 이해했는지, 어디서 막혔는지, 어떤 질문이 남는지 구체적으로 말한다. 의도된 낯섦·모호함과 이해에 꼭 필요한 정보 부족을 구분한다. 흥미·감정·정보의 흐름을 위치와 근거로 설명하고 요청 없는 대필이나 문장 교정을 하지 않는다.'},
].map(p=>({id:p.id,title:p.title,prompt:DEFAULT_AI_SYSTEM_PROMPT+(p.focus?'\n\n## 이번 프리셋의 우선 작업\n'+p.focus:''),updatedAt:PROMPT_REVISION,builtin:true}));
export function promptCatalog(preferences?:AIPreferences):PromptPreset[]{return [...BUILTIN_PROMPTS,...(preferences?.presets||[]).map(p=>({...p,builtin:false}))];}
export function activePromptPreset(preferences?:AIPreferences):PromptPreset{return promptCatalog(preferences).find(p=>p.id===(preferences?.activePresetId||DEFAULT_PROMPT_ID))||BUILTIN_PROMPTS[0];}
function preferencesOrDefault(preferences:AIPreferences|undefined,now:string):AIPreferences{return preferences?structuredClone(preferences):{version:1,activePresetId:DEFAULT_PROMPT_ID,presets:[],updatedAt:now};}
export function activatePromptPreset(preferences:AIPreferences|undefined,id:string,now=new Date().toISOString()):AIPreferences {
  const next=preferencesOrDefault(preferences,now);next.activePresetId=promptPresetIdSchema.parse(id);next.updatedAt=now;return aiPreferencesSchema.parse(next);
}
export function savePromptPreset(preferences:AIPreferences|undefined,preset:{id:string;title:string;prompt:string},expectedRevision?:string,now=new Date().toISOString()):AIPreferences {
  const next=preferencesOrDefault(preferences,now),existing=next.presets.find(p=>p.id===preset.id);
  if(existing&&existing.updatedAt!==expectedRevision)throw new Error('다른 창에서 프리셋이 바뀌었습니다. 최신 내용을 불러오거나 새 프리셋으로 저장하세요.');
  if(!existing&&expectedRevision)throw new Error('프리셋이 삭제되었습니다. 새 프리셋으로 저장하세요.');
  const saved=customPromptPresetSchema.parse({...preset,prompt:effectiveSystemPrompt(preset.prompt),updatedAt:now});
  next.presets=existing?next.presets.map(p=>p.id===saved.id?saved:p):[...next.presets,saved];next.activePresetId=saved.id;next.updatedAt=now;
  if(next.presets.length>MAX_CUSTOM_PRESETS)throw new Error('사용자 프리셋은 20개까지 보관할 수 있습니다. 기존 프리셋을 수정하거나 정리하세요.');
  return aiPreferencesSchema.parse(next);
}
export function deletePromptPreset(preferences:AIPreferences|undefined,id:string,expectedRevision:string,now=new Date().toISOString()):AIPreferences {
  const next=preferencesOrDefault(preferences,now),preset=next.presets.find(p=>p.id===id);
  if(!preset||preset.updatedAt!==expectedRevision)throw new Error('프리셋이 바뀌었습니다. 최신 내용을 확인하세요.');
  next.presets=next.presets.filter(p=>p.id!==id);if(next.activePresetId===id)next.activePresetId=DEFAULT_PROMPT_ID;next.updatedAt=now;return aiPreferencesSchema.parse(next);
}
/** Old manuscript-only backups retain the current account's prompt library. */
export function preserveAIPreferences(next:Workspace,previous:Workspace):Workspace {
  return next.aiPreferences===undefined&&previous.aiPreferences?{...next,aiPreferences:structuredClone(previous.aiPreferences)}:next;
}
const OLD_DEFAULT='한국어 SF 출판소설의 집필을 돕는다. 작가의 문체와 시점을 존중한다. 퇴고, 설정 일관성, 장면 구상과 요약을 대화로 돕는다. 새로운 아이디어와 이미 정한 설정을 구분한다. 확실하지 않은 과학적 가정은 확인할 질문으로 제시한다. 간결하게 답하되 수정 이유를 설명한다.';
export function legacyCustomPrompt(raw:unknown):string|null {
  const parsed=systemPromptSchema.safeParse(raw);if(!parsed.success)return null;
  const value=parsed.data.trim();return value&&value!==OLD_DEFAULT&&value!==DEFAULT_AI_SYSTEM_PROMPT?value:null;
}
export function resolveRequestPrompt(preferences:AIPreferences|undefined,input:{promptPresetId?:string;systemPrompt?:string}):{prompt:string;preset:{id:string;title:string;revision:string}} {
  if(!input.promptPresetId)return {prompt:effectiveSystemPrompt(input.systemPrompt),preset:{id:'legacy',title:input.systemPrompt?.trim()?'이전 브라우저 지침':'기본 집필 동료',revision:PROMPT_REVISION}};
  const selected=activePromptPreset(preferences);
  if(selected.id!==input.promptPresetId||(input.systemPrompt!==undefined&&effectiveSystemPrompt(input.systemPrompt)!==selected.prompt))throw new Error('시스템 프롬프트가 바뀌었습니다. 동기화를 확인하고 다시 질문하세요.');
  return {prompt:selected.prompt,preset:{id:selected.id,title:selected.title,revision:selected.updatedAt}};
}
