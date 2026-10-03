import { seedWorkspace } from '../../src/lib/seed';
import { uid } from '../../src/lib/model';
export function aiWorkspaceFixture(){
  const state=seedWorkspace(),work=state.works[0],doc=work.documents[0],source=work.documents.find(d=>d.kind==='wiki')!;
  work.title='UI 검증용 작품';
  work.aiConversations=[{docId:doc.id,messages:[
    {id:uid(),role:'user',text:'원고의 첫 문장을 살펴봐 줘.',createdAt:doc.updatedAt},
    {id:uid(),role:'assistant',createdAt:doc.updatedAt,provider:'openai',model:'mock-model',version:doc.updatedAt,sources:[{id:source.id,title:source.title}],result:{review:'합성 테스트 답변입니다. 실제 AI를 호출하지 않았습니다. 첫 문장의 시간 차이는 이야기의 긴장을 잘 보여 줍니다.',suggestions:[{quote:'항구에 도착했을 때, 지구의 시계는 이미 열일곱 해를 앞서 있었다.',replacement:'항구에 도착했을 때, 지구의 시계는 열일곱 해나 앞서 있었다.',reason:'합성 수정안: 원고 적용과 복구 지점을 확인합니다.'}]}},
    {id:uid(),role:'user',text:'이 장면의 남은 질문도 정리해 줘.',createdAt:doc.updatedAt},
    {id:uid(),role:'assistant',createdAt:doc.updatedAt,provider:'gemini',model:'mock-model',version:doc.updatedAt,sources:[],result:{review:'합성 테스트 답변입니다. 서윤이 마주할 변화와 항구가 그대로 보이는 이유가 남은 질문입니다.',suggestions:[]}},
  ]}];return state;
}
