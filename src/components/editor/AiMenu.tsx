import { useState } from "react";
import type { Editor } from "@tiptap/react";

type Props = {
  editor: Editor | null;
  mode: "chapter" | "wiki";
};

type Action = "revise" | "fix" | "summarize" | "wiki-draft";

async function call(action: Action, body: unknown) {
  const res = await fetch(`/api/ai/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    text?: string;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error ?? "AI 호출 실패");
  return data.text ?? "";
}

export default function AiMenu({ editor, mode }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [result, setResult] = useState<{ action: Action; text: string } | null>(null);
  const [err, setErr] = useState("");

  const getSelectedText = () => {
    if (!editor) return "";
    const { from, to, empty } = editor.state.selection;
    if (empty) return "";
    return editor.state.doc.textBetween(from, to, "\n");
  };

  const replaceSelection = (text: string) => {
    if (!editor) return;
    editor
      .chain()
      .focus()
      .insertContent(text)
      .run();
  };

  const insertAtCursor = (text: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent(text.replace(/\n/g, "<br>")).run();
  };

  const run = async (action: Action) => {
    if (!editor) return;
    setErr("");
    setResult(null);
    setBusy(action);
    try {
      let text = "";
      if (action === "revise" || action === "fix") {
        const sel = getSelectedText();
        if (!sel) {
          setErr("드래그로 문장을 선택한 뒤 실행해주세요.");
          return;
        }
        text = await call(action, { text: sel });
      } else if (action === "summarize") {
        const fullText = editor.getText();
        if (!fullText.trim()) {
          setErr("먼저 본문을 작성해주세요.");
          return;
        }
        text = await call(action, { text: fullText });
      } else {
        const title = window.prompt("위키 항목 제목");
        if (!title) return;
        const hint = window.prompt("한 줄 힌트 (선택)") ?? "";
        text = await call(action, { title, hint });
      }
      setResult({ action, text });
    } catch (e: any) {
      setErr(e?.message ?? "오류");
    } finally {
      setBusy(null);
      setOpen(false);
    }
  };

  const apply = () => {
    if (!result) return;
    if (result.action === "revise" || result.action === "fix") {
      replaceSelection(result.text);
    } else {
      insertAtCursor(result.text);
    }
    setResult(null);
  };

  const items: { action: Action; label: string; hint: string }[] = [
    { action: "revise", label: "✍️ 선택 영역 퇴고", hint: "드래그 후 실행" },
    { action: "fix", label: "✓ 선택 영역 교정", hint: "드래그 후 실행" },
    { action: "summarize", label: "📝 지난 줄거리 생성", hint: "본문 전체 기반" },
    ...(mode === "wiki"
      ? [{ action: "wiki-draft" as Action, label: "📖 위키 초안 생성", hint: "제목만 있으면 OK" }]
      : []),
  ];

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={!!busy}
        className="h-8 px-3 text-sm rounded border bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        title="AI 도우미"
      >
        {busy ? "생성 중…" : "✨ AI"}
      </button>

      {open && !busy && (
        <div className="absolute right-0 mt-1 z-20 bg-white border border-gray-300 rounded shadow-md min-w-[220px] text-sm">
          {items.map((it) => (
            <button
              key={it.action}
              type="button"
              onClick={() => run(it.action)}
              className="w-full text-left px-3 py-2 hover:bg-gray-100 border-b last:border-b-0"
            >
              <div>{it.label}</div>
              <div className="text-xs text-gray-500">{it.hint}</div>
            </button>
          ))}
        </div>
      )}

      {err && (
        <div className="fixed bottom-4 right-4 bg-red-600 text-white text-sm rounded px-3 py-2 shadow-lg z-30 max-w-sm">
          {err}
          <button onClick={() => setErr("")} className="ml-2 underline">닫기</button>
        </div>
      )}

      {result && (
        <div className="fixed inset-0 bg-black/40 z-30 flex items-center justify-center p-4">
          <div className="bg-white rounded shadow-xl max-w-2xl w-full max-h-[80vh] overflow-auto">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-semibold">
                {result.action === "revise" ? "퇴고 결과"
                  : result.action === "fix" ? "교정 결과"
                  : result.action === "summarize" ? "지난 줄거리"
                  : "위키 초안"}
              </h3>
              <button onClick={() => setResult(null)} className="text-gray-500 hover:text-gray-900">✕</button>
            </div>
            <div className="p-4 whitespace-pre-wrap text-sm leading-relaxed">
              {result.text}
            </div>
            <div className="p-4 border-t flex gap-2 justify-end">
              <button
                onClick={() => navigator.clipboard.writeText(result.text)}
                className="border rounded px-3 py-1.5 text-sm"
              >
                복사
              </button>
              <button
                onClick={apply}
                className="bg-black text-white rounded px-3 py-1.5 text-sm"
              >
                {result.action === "revise" || result.action === "fix"
                  ? "선택 영역에 반영"
                  : "현재 위치에 삽입"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
