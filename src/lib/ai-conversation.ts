import { z } from 'zod';
import { reviewSchema } from './ai';
import { systemPromptSchema } from './ai-settings';
import { promptPresetIdSchema } from './ai-prompt-presets';

export const conversationProviderSchema=z.enum(['openai','anthropic','gemini']);

export const chatMessageSchema=z.discriminatedUnion('role',[
  z.object({id:z.uuid(),role:z.literal('user'),text:z.string().min(1).max(2000),createdAt:z.string()}),
  z.object({id:z.uuid(),role:z.literal('assistant'),result:reviewSchema,createdAt:z.string(),provider:conversationProviderSchema,model:z.string().max(200),version:z.string().max(100),sources:z.array(z.object({id:z.uuid(),title:z.string().max(300)})).max(8),promptPreset:z.object({id:z.string().max(100),title:z.string().max(80),revision:z.string().max(100)}).optional()}),
]);

export type ChatMessage=z.infer<typeof chatMessageSchema>;

export const chatMessagesSchema=z.array(chatMessageSchema).max(40).superRefine((v,ctx)=>{if(v.length%2||v.some((m,i)=>m.role!==(i%2?'assistant':'user')))ctx.addIssue({code:'custom',message:'AI 대화의 질문·답변 순서를 확인하세요.'});});

export const conversationSchema=z.object({docId:z.uuid(),messages:chatMessagesSchema});

export type Conversation=z.infer<typeof conversationSchema>;

export type EditorAIScope={noteId:string;docId:string;workId?:never}|{workId:string;docId:string;noteId?:never};

const editorRangeSchema=z.object({kind:z.enum(['selection','paragraph']),from:z.number().int().nonnegative(),to:z.number().int().nonnegative(),text:z.string().max(12000)});

export const chatInputSchema=z.object({
  workId:z.uuid().optional(),noteId:z.uuid().optional(),docId:z.uuid(),version:z.string().max(100),provider:conversationProviderSchema,
  message:z.string().trim().min(1).max(2000),includeManuscript:z.boolean(),
  sourceIds:z.array(z.uuid()).max(8),
  history:z.array(z.object({role:z.enum(['user','assistant']),content:z.string().min(1).max(15000)})).max(10),
  systemPrompt:systemPromptSchema.optional(),
  promptPresetId:promptPresetIdSchema.optional(),
  noteRange:editorRangeSchema.optional(),
  documentRange:editorRangeSchema.optional(),
}).superRefine((v,ctx)=>{
  if(!!v.workId===!!v.noteId||(v.noteId&&v.noteId!==v.docId))ctx.addIssue({code:'custom',message:'대화할 작품 문서 또는 노트를 선택하세요.'});

  if(v.noteRange&&(!v.noteId||!v.includeManuscript||v.noteRange.to<v.noteRange.from||(v.noteRange.kind==='selection'&&v.noteRange.from===v.noteRange.to)))ctx.addIssue({code:'custom',message:'선택한 노트 글의 범위를 확인하세요.'});

  if(v.documentRange&&(!v.workId||!v.includeManuscript||v.documentRange.to<v.documentRange.from||(v.documentRange.kind==='selection'&&v.documentRange.from===v.documentRange.to)))ctx.addIssue({code:'custom',message:'선택한 문서 글의 범위를 확인하세요.'});

  if(v.history.some((m,i)=>m.role!==(i%2?'assistant':'user'))||v.history.length%2)ctx.addIssue({code:'custom',message:'대화 순서를 확인하세요.'});

  if(v.history.reduce((n,m)=>n+m.content.length,0)>24000)ctx.addIssue({code:'custom',message:'이전 대화가 너무 깁니다.'});
});

export type ChatInput=z.infer<typeof chatInputSchema>;

/** Replay complete pairs only; older text stays in the saved conversation. */
export function recentChatHistory(messages:ChatMessage[]):ChatInput['history']{
  const history:ChatInput['history']=[];let chars=0;

  for(let i=messages.length-2;i>=0;i-=2){const user=messages[i],assistant=messages[i+1];

if(user.role!=='user'||assistant.role!=='assistant')break;const pair=[{role:'user' as const,content:user.text},{role:'assistant' as const,content:assistant.result.review}];const size=pair.reduce((n,m)=>n+m.content.length,0);

if(chars+size>24000||history.length+2>10)break;history.unshift(...pair);chars+=size;}

  return history;
}
