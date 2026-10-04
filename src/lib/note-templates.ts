import { uid, type RichNode } from './model';

export type NoteTemplate={id:'character'|'world'|'logline'|'scene'|'brainstorm';title:string;description:string;sections:string[]};
/** 작품 디벨롭용 빈 틀. 제목과 소제목만 채우고 내용은 작가가 쓴다. */
export const noteTemplates:NoteTemplate[]=[
  {id:'character',title:'인물 시트',description:'욕망·두려움·관계·변화',sections:['한 줄 소개','원하는 것','두려워하는 것','외모와 말버릇','과거','관계','이야기 속 변화']},
  {id:'world',title:'세계관 설정',description:'규칙·장소·세력·역사',sections:['개요','규칙','장소','집단과 세력','역사','아직 정하지 않은 것']},
  {id:'logline',title:'로그라인 · 시놉시스',description:'한 문장 요약과 큰 흐름',sections:['로그라인','주인공 · 목표 · 장애물','시작','전개','위기','결말','주제']},
  {id:'scene',title:'장면 아이디어',description:'사건·시점·갈등·남길 이미지',sections:['무엇이 일어나는가','시점 · 장소 · 시간','갈등','남길 이미지와 대사']},
  {id:'brainstorm',title:'브레인스토밍',description:'질문 하나에 떠오르는 대로',sections:['질문','떠오르는 것','고를 것']},
];
export function templateContent(template:NoteTemplate):RichNode {
  return {type:'doc',content:template.sections.flatMap(title=>[
    {type:'heading',attrs:{level:2,blockId:uid()},content:[{type:'text',text:title}]},
    {type:'paragraph',attrs:{blockId:uid()},content:[]},
  ])};
}
