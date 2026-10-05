import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import { Node } from '@tiptap/pm/model';
import { editorExtensions,noteExtensions,NoteImage } from '../src/lib/editor-extensions';
import { editorRangeText } from '../src/lib/editor-target';
const noteRangeText=(content:RichNode,from:number,to:number)=>editorRangeText(content,from,to,'note');
import { chatContext,ChatContextError } from '../src/lib/ai-chat-context';
import { chatInputSchema } from '../src/lib/ai-conversation';
import { seedWorkspace } from '../src/lib/seed';
import { addNote,newNote } from '../src/lib/personal-notes';
import { fromText,type RichNode,uid } from '../src/lib/model';

test('선택 범위는 반복 문장·서식·이모지·각주·중첩 표의 실제 편집기 위치를 따른다',()=>{
  const content:RichNode={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'반복 문장',marks:[{type:'bold'}]},{type:'footnote',attrs:{noteId:uid(),text:'전송 제외'}},{type:'hardBreak'},{type:'text',text:'🚀다음'}]},{type:'paragraph',content:[{type:'text',text:'반복 문장'}]},{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',content:[{type:'paragraph',content:[{type:'text',text:'표 안의 글'}]}]}]}]},{type:'noteImage',attrs:{assetId:uid(),alt:'이미지'}}]};
  const doc=Node.fromJSON(getSchema([...editorExtensions,...noteExtensions,NoteImage]),content);
  let repeated=0;doc.descendants((node,pos)=>{if(node.isText){if(node.text==='반복 문장')repeated++;assert.equal(noteRangeText(content,pos,pos+node.nodeSize),node.text);}});assert.equal(repeated,2);
  assert.equal(noteRangeText(content,0,doc.content.size),doc.textBetween(0,doc.content.size,'\n',node=>node.type.name==='hardBreak'?'\n':''));
  assert(!noteRangeText(content,0,doc.content.size).includes('전송 제외'));
  for(const [from,to] of [[-1,2],[1,0],[0,doc.content.size+1],[1.5,2]])assert.throws(()=>noteRangeText(content,from,to));
});
function fixture(){const note={...newNote(),content:fromText('짧은 선택\n\n'+ '긴 원고'.repeat(4000))};const state=addNote(seedWorkspace(),note);const input=chatInputSchema.parse({noteId:note.id,docId:note.id,version:note.updatedAt,provider:'openai',message:'요약',includeManuscript:true,sourceIds:[],history:[],noteRange:{kind:'selection',from:1,to:6,text:'짧은 선택'}});return {note,state,input};}
test('12,000자가 넘는 노트에서도 선택한 글만 제공자에게 전달한다',()=>{const {state,input}=fixture(),context=chatContext(state,input);assert.equal(context.input.manuscript,'짧은 선택');assert.deepEqual(context.input.references,[]);assert.throws(()=>chatContext(state,{...input,noteRange:undefined}),e=>e instanceof ChatContextError&&e.status===413);});
test('범위·원문·버전 불일치는 AI 호출 전에 거절한다',()=>{const {state,input}=fixture();for(const mutate of [{...input,version:'stale'},{...input,noteRange:{...input.noteRange!,text:'다른 글'}},{...input,noteRange:{...input.noteRange!,to:999999}}])assert.throws(()=>chatContext(state,mutate),e=>e instanceof ChatContextError&&e.status===409);});
test('작품 문서에는 노트 범위를 사용할 수 없고 빈 선택·역전 범위를 막는다',()=>{const {state,input}=fixture();const work=state.works[0];for(const mutate of [{...input,noteId:undefined,workId:work.id,docId:work.documents[0].id},{...input,includeManuscript:false},{...input,noteRange:{...input.noteRange!,to:1}},{...input,noteRange:{...input.noteRange!,to:0}}])assert(!chatInputSchema.safeParse(mutate).success);assert(chatInputSchema.safeParse({...input,noteRange:{kind:'paragraph',from:1,to:1,text:''}}).success);});
