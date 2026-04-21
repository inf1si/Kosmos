import { useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

type Props = {
  seriesId: string;
  seriesSlug: string;
  nextNumber: number;
  isShort?: boolean;
};

export default function ChapterForm({ seriesId, nextNumber, isShort }: Props) {
  const [title, setTitle] = useState(isShort ? "본문" : "");
  const [number, setNumber] = useState(nextNumber);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const editor = useEditor({
    extensions: [StarterKit],
    content: "<p></p>",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "prose max-w-none focus:outline-none min-h-[300px]",
      },
    },
  });

  const submit = async (finalStatus: "초안" | "발행") => {
    if (!editor) return;
    if (!title.trim()) {
      setMsg("제목을 입력해주세요.");
      return;
    }
    setBusy(true);
    setMsg("");

    const res = await fetch("/api/chapters", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        seriesId,
        number,
        title,
        contentJson: editor.getJSON(),
        contentHtml: editor.getHTML(),
        status: finalStatus,
      }),
    });

    setBusy(false);

    if (res.ok) {
      window.location.href = `/admin/series/${seriesId}`;
      return;
    }
    const err = await res.json().catch(() => ({ error: "저장 실패" }));
    setMsg(err.error ?? "오류");
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
        <label className="grid gap-1">
          <span className="text-sm">화 번호</span>
          <input
            type="number"
            value={number}
            onChange={(e) => setNumber(Number(e.target.value))}
            min={1}
            className="border rounded px-3 py-2"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-sm">제목</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="border rounded px-3 py-2"
          />
        </label>
      </div>

      <div className="border border-gray-300 rounded p-4 bg-white">
        <EditorContent editor={editor} />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => submit("초안")}
          className="border rounded px-4 py-2 disabled:opacity-50"
        >
          초안 저장
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => submit("발행")}
          className="bg-black text-white rounded px-4 py-2 disabled:opacity-50"
        >
          발행
        </button>
        <a
          href={`/admin/series/${seriesId}`}
          className="ml-auto text-sm text-gray-600 hover:underline"
        >
          취소
        </a>
      </div>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </div>
  );
}
