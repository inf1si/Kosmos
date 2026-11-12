import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatMentionQuery,insertChatMention } from '../src/lib/ai-source-mentions';
import { chatContext,ChatContextError } from '../src/lib/ai-chat-context';
import { aiWorkspaceFixture } from './fixtures/ai-workspace';
import { addNote,newNote } from '../src/lib/personal-notes';
import { fromText,uid } from '../src/lib/model';

test('@ 자료 검색은 커서 앞의 질의를 읽고 이메일·선택·줄바꿈은 그대로 둔다',()=>{
  const text='앞 문장 @기억 뒤 문장',caret=text.indexOf(' 뒤');
  assert.deepEqual(chatMentionQuery(text,caret,caret),{from:5,to:caret,text:'기억'});
  assert.deepEqual(chatMentionQuery('문장@',3,3),{from:2,to:3,text:''});
  assert.deepEqual(chatMentionQuery('@이름 있는 노트',9,9)?.text,'이름 있는 노트');
  assert.deepEqual(chatMentionQuery('🚀 @기억 후',6,6),{from:3,to:6,text:'기억'});

  for(const [value,start,end] of [['name@example.com',16,16],['@노트\n다음',6,6],['@노트',0,3]] as const)assert.equal(chatMentionQuery(value,start,end),null);
});

test('자료 선택은 @ 질의만 제목으로 바꾸고 뒤 문장과 커서 위치를 보존한다',()=>{
  const value='비교 @기억 뒤 문장',caret=value.indexOf(' 뒤'),query=chatMentionQuery(value,caret,caret)!;
  const next=insertChatMention(value,query,'관측 노트');
  assert.equal(next?.value,'비교 @관측 노트 뒤 문장');
  assert.equal(next?.caret,'비교 @관측 노트 '.length);
  assert.equal(insertChatMention('바뀐 질문',query,'관측 노트'),null);
});

test('집필실 AI는 직접 고른 개인 노트만 보내고 다른 작품·삭제된 자료는 거절한다',()=>{
  const reference={...newNote(),title:'공통 설정',content:fromText('다른 공간에도 쓰는 합성 자료.')},unselected={...newNote(),content:fromText('선택하지 않은 노트는 보내지 않는다.')};
  const state=addNote(addNote(aiWorkspaceFixture(),reference),unselected),work=state.works[0],doc=work.documents[0];
  const input={workId:work.id,docId:doc.id,version:doc.updatedAt,provider:'gemini' as const,message:'비교해줘',includeManuscript:false,sourceIds:[reference.id,reference.id],history:[]};
  const context=chatContext(state,input);
  assert.equal(context.input.manuscript,'');assert.equal(context.input.references.length,1);
  assert.equal(context.input.references[0].kind,'note');assert.equal(context.input.references[0].text,'다른 공간에도 쓰는 합성 자료.');
  assert.deepEqual(context.sources,[{id:reference.id,title:reference.title}]);
  assert(!JSON.stringify(context.input).includes('선택하지 않은 노트는 보내지 않는다.'));

  for(const sourceId of [state.works[1].documents[0].id,uid()])assert.throws(()=>chatContext(state,{...input,sourceIds:[sourceId]}),e=>e instanceof ChatContextError&&e.status===400);
  assert.throws(()=>chatContext({...state,notes:state.notes!.filter(n=>n.id!==reference.id)},input),e=>e instanceof ChatContextError&&e.status===400);
});
