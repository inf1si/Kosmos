import { Workspace, RichNode, makePublication } from './model';

const ids = {
  workspace:'10000000-0000-4000-8000-000000000001',work:'20000000-0000-4000-8000-000000000001',
  second:'20000000-0000-4000-8000-000000000002',scene1:'30000000-0000-4000-8000-000000000001',
  scene2:'30000000-0000-4000-8000-000000000002',scene3:'30000000-0000-4000-8000-000000000003',
  person:'40000000-0000-4000-8000-000000000001',tech:'40000000-0000-4000-8000-000000000002',
  place:'40000000-0000-4000-8000-000000000003',memo:'50000000-0000-4000-8000-000000000001',
};

const p=(text:string,index:number):RichNode=>({type:'paragraph',attrs:{blockId:`60000000-0000-4000-8000-${String(index).padStart(12,'0')}`},content:[{type:'text',text}]});

const doc=(...paras:RichNode[]):RichNode=>({type:'doc',content:paras});

const at='2026-10-01T03:00:00.000Z';

export function seedWorkspace():Workspace {
  const first=doc(
    p('항구에 도착했을 때, 지구의 시계는 이미 열일곱 해를 앞서 있었다.',1),
    p('서윤은 접안 창 너머를 보았다. 마지막으로 이곳을 떠났을 때와 같은 푸른 불빛이 선체를 훑고 지나갔다. 정박 구역의 번호도, 유리벽에 붙은 낡은 안내문도 그대로였다. 달라진 것은 안내 방송 속 목소리뿐이었다.',2),
    {type:'paragraph',attrs:{blockId:'60000000-0000-4000-8000-000000000003'},content:[{type:'text',text:'“'},{type:'text',text:'관성 항해',marks:[{type:'wikiLink',attrs:{targetId:ids.tech}}]},{type:'text',text:'선 오르트, 귀환을 환영합니다.”'},{type:'footnote',attrs:{noteId:'70000000-0000-4000-8000-000000000001',text:'선박 내부의 경과 시간과 지구의 시간은 다르다. 이 장면에서 서윤이 체감한 항해 기간은 2년 8개월이다.'}}]},
    p('그녀는 환영이라는 단어를 조금 늦게 이해했다. 출항하던 날, 동생은 스물두 살이었다. 지금은 마흔에 가까울 것이다. 그동안 동생이 보냈을 생일과 계절을 헤아리려다가, 서윤은 손잡이를 더 세게 쥐었다.',4),
    p('검역 담당자가 통로 끝에 서 있었다. 흰 제복의 어깨에 작은 은빛 표식이 붙어 있었다. 서윤은 그 표식을 알지 못했다.',5),
    p('“승무원 이서윤 씨?”',6),
    p('“네.”',7),
    p('“입항 전에 확인하셔야 할 사항이 있습니다.”',8),
    p('그가 건넨 화면에는 날짜 하나와 문장 하나가 떠 있었다. 서윤은 날짜를 먼저 읽었다. 숫자는 아무 감정도 없이 정확했다.',9),
    p('귀하의 지정 수신인은 연락 가능 상태가 아닙니다.',10),
    p('항구의 푸른 불빛이 다시 유리창을 지나갔다. 서윤은 그 빛이 익숙하다는 사실이, 지금 가장 낯설었다.',11),
  );

  const base={summary:'',status:'draft' as const,category:'',pov:'',storyTime:'',isPublic:false,publicSummary:'',updatedAt:at,assetIds:[]};

  const state:Workspace={formatVersion:1,id:ids.workspace,updatedAt:at,assets:[],works:[{
    id:ids.work,title:'먼 별의 항구',subtitle:'돌아온 사람과 남겨진 시간',form:'장편',
    description:'지구의 열일곱 해를 건너 귀환한 항해사. 익숙한 항구에서 그녀를 기다리는 것은, 자신이 살지 않은 시간의 흔적이다.',
    activePublicationId:null,publications:[],documents:[
      {...base,id:ids.scene1,kind:'scene',title:'01. 귀환',chapter:'제1부 · 남겨진 시간',content:first,summary:'서윤이 귀환하고 지정 수신인에게 연락할 수 없다는 통보를 받는다.',status:'review',pov:'이서윤',storyTime:'귀환일 · 08:40'},
      {...base,id:ids.scene2,kind:'scene',title:'02. 기록 보관소',chapter:'제1부 · 남겨진 시간',content:doc(p('기록 보관소는 항구의 가장 낮은 층에 있었다. 창문이 없는 복도를 따라 걸으며 서윤은 누군가 자신의 발걸음을 먼저 듣고 있다는 생각을 했다.',12),p('문 앞에는 종이로 인쇄한 명단이 붙어 있었다. 전자 화면 대신 종이를 쓰는 이유를 그녀는 나중에 알게 되었다.',13)),summary:'귀환자를 위한 기록 보관소에서 동생의 마지막 기록을 찾는다.',pov:'이서윤',storyTime:'귀환일 · 14:00'},
      {...base,id:ids.scene3,kind:'scene',title:'03. 두 개의 편지',chapter:'제2부 · 궤도의 바깥',content:doc(p('첫 번째 편지는 그녀가 출항한 이듬해에 쓰였다. 두 번째 편지는 아직 쓰이지 않았다.',14)),summary:'서로 다른 시간에 작성된 편지가 동일한 수신함에 도착한다.',status:'idea',pov:'이서윤',storyTime:'귀환 다음 날'},
      {...base,id:ids.person,kind:'wiki',title:'이서윤',chapter:'',content:doc(p('오르트의 항해사. 출항 당시 29세. 귀환 시 지구 기준으로는 46세지만 신체적으로는 32세에 가깝다.',15),p('비공개 메모: 동생의 선택을 이해하는 과정이 중심 서사다. 결말에서 귀환의 의미를 재정의한다.',16)),category:'인물',isPublic:true,publicSummary:'관성 항해선 오르트의 항해사. 오랜 항해를 마치고 지구로 돌아온다.'},
      {...base,id:ids.tech,kind:'wiki',title:'관성 항해',chapter:'',content:doc(p('성간 이동 기술. 항로의 특정 구간에서 선박의 고유 시간이 외부 시간보다 느리게 흐른다.',17),p('제약: 통신 역시 시간차를 갖는다. 이미 지난 외부 시간을 되돌릴 수 없다. 항해 전후의 시간 기준을 명시해야 한다.',18)),category:'기술',isPublic:true,publicSummary:'선박 안과 바깥에서 흐르는 시간에 차이가 생기는 성간 항해 방식. 귀환자는 지구에서 자신보다 더 많은 시간이 흘렀음을 마주한다.'},
      {...base,id:ids.place,kind:'wiki',title:'제7항구',chapter:'',content:doc(p('궤도 엘리베이터의 북쪽 접안 구역. 귀환자 검역소와 기록 보관소가 연결된다.',19)),category:'장소',isPublic:false},
      {...base,id:ids.memo,kind:'memo',title:'시간차와 인물의 지식',chapter:'리서치',content:doc(p('장면마다 확인: 서윤이 직접 경험한 시간 / 지구의 시간 / 서윤이 아직 모르는 사건. 인물의 대사는 그 시점에 알고 있는 정보로 제한한다.',20))},
    ],
  },{
    id:ids.second,title:'마지막 관측자',subtitle:'관측이 끝난 뒤에도 별은 남는다',form:'단편',description:'한 관측소에 남은 마지막 사람이 보내는 짧은 기록.',activePublicationId:null,publications:[],
    documents:[{...base,id:'30000000-0000-4000-8000-000000000004',kind:'scene',title:'관측 일지',chapter:'',content:doc(p('모든 안테나가 멈춘 날, 별들은 처음으로 조용해졌다.',21)),summary:'관측소의 마지막 밤.',status:'idea'}],
  }]};

  for(const w of state.works)for(const d of w.documents)d.assetIds=[...d.assetIds];
  const initial=makePublication(state.works[0],[ids.scene1]);
  state.works[0].publications=[initial];state.works[0].activePublicationId=initial.id;

  return state;
}
