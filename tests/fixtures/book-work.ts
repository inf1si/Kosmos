import {seedWorkspace} from '../../src/lib/seed';
import {newDocument,fromText,uid,type RichNode} from '../../src/lib/model';
import {applyNavigation,defaultSections} from '../../src/lib/document-navigation';

export function bookFixture(){
  const data=seedWorkspace(),work=data.works[0],first=newDocument('scene','첫 번째 장'),second=newDocument('scene','두 번째 장'),memo=newDocument('memo','선택하지 않은 메모');
  work.title='우주 너머의 책';data.authorProfile={name:'합성 작가',bio:''};first.chapter='본문';
  const paragraph:RichNode={type:'paragraph',content:[{type:'text',text:'한글과 English words를 함께 조판합니다. ',marks:[{type:'bold'}]},{type:'text',text:'웹 자료',marks:[{type:'link',attrs:{href:'https://example.invalid/reference?q=1&b=2'}}]},{type:'text',text:'와 각주'},{type:'footnote',attrs:{noteId:uid(),text:'각주 설명 <특수> & 문자.\n두 번째 줄.'}},{type:'text',text:' 뒤의 문장은 남습니다.'},{type:'internalReference',attrs:{kind:'note',targetId:'99999999-9999-4999-8999-999999999999',workId:null,label:'비공개참조제목'}},{type:'text',text:' 설정 이름',marks:[{type:'wikiLink',attrs:{targetId:'88888888-8888-4888-8888-888888888888'}}]}]};
  first.content={type:'doc',content:[paragraph,...fromText(Array.from({length:18},(_,i)=>`문단 ${i+1}. 어둠 너머에는 별이 있었다. The spacecraft returned across the silent sea. 새로운 세계를 기다리는 사람들의 기록입니다.`).join('\n\n')).content!]};
  second.content={type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'관측 기록'}]},...fromText('두 번째 장의 첫 문장.').content!,{type:'table',content:[{type:'tableRow',content:[{type:'tableHeader',attrs:{rowspan:2},content:fromText('분류').content},{type:'tableHeader',content:fromText('값').content}]},{type:'tableRow',content:[{type:'tableCell',content:fromText('별빛 42').content}]},{type:'tableRow',content:[{type:'tableCell',attrs:{colspan:2},content:fromText('병합한 마지막 행').content}]}]},...fromText('마지막 문장까지 보존합니다.').content!]};
  memo.content=fromText('미선택 비밀 원고');
  work.documents=[second,memo,first];
  Object.assign(work,applyNavigation(work,{version:1,sections:structuredClone(defaultSections),nodes:[{id:first.id,type:'document',sectionId:'scene',parentId:null},{id:second.id,type:'document',sectionId:'scene',parentId:null},{id:memo.id,type:'document',sectionId:'memo',parentId:null}]}));
  data.works=[work];data.notes=[];data.assets=[];

  return {data,work,first,second,memo};
}
