import { anthropic, MODEL } from "./client";

const SYSTEM_REVISE = `당신은 한국어 소설을 퇴고하는 편집자입니다.
주어진 문장을 **같은 의미**를 유지하되 더 자연스럽고 생생하게 다듬어 주세요.
- 원문의 시점·톤·화자를 바꾸지 마세요.
- 결과물만 출력하세요. 설명·메타 코멘트 금지.`;

const SYSTEM_FIX = `당신은 한국어 교정자입니다.
주어진 문장의 맞춤법·띄어쓰기·문법 오류만 고쳐 주세요.
- 문장 구조나 어휘 선택은 원문을 최대한 보존하세요.
- 결과물만 출력하세요. 수정 사항 설명 금지.`;

const SYSTEM_SUMMARIZE = `당신은 한국어 소설 요약가입니다.
주어진 화 본문을 독자에게 "지난 줄거리" 형태로 3~5문장 요약해 주세요.
- 핵심 사건·인물·감정 변화 위주.
- 스포일러 자제, 묘사적이기보다 간결하게.
- 결과물만 출력.`;

const SYSTEM_WIKI_DRAFT = `당신은 세계관 설정 작가입니다.
주어진 용어 제목(과 선택적 한 줄 요약)을 받아, 해당 항목의 위키 초안을 작성해 주세요.
- 200~400자, 2~3문단.
- 사실처럼 단정적인 톤으로 작성 (세계관 내 정식 설명 느낌).
- 결과물만 출력.`;

async function run(system: string, userText: string, maxTokens = 1024) {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: userText }],
  });
  const chunk = res.content.find((c) => c.type === "text");
  return chunk?.type === "text" ? chunk.text : "";
}

export const revise = (text: string) => run(SYSTEM_REVISE, text);
export const fixGrammar = (text: string) => run(SYSTEM_FIX, text);
export const summarize = (chapterText: string) => run(SYSTEM_SUMMARIZE, chapterText, 512);
export const wikiDraft = (title: string, hint?: string) =>
  run(SYSTEM_WIKI_DRAFT, hint ? `제목: ${title}\n한 줄 요약: ${hint}` : `제목: ${title}`);
