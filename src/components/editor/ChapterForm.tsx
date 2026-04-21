import { useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import EditorToolbar from "./EditorToolbar";
import { WikiLink } from "./extensions/WikiLink";
import { SceneBreak } from "./extensions/SceneBreak";
import { Spoiler } from "./extensions/Spoiler";
import { Aside } from "./extensions/Aside";
import { Ruby } from "./extensions/Ruby";
import { Footnote } from "./extensions/Footnote";

type Props = {
  seriesId: string;
  seriesSlug: string;
  nextNumber: number;
  isShort?: boolean;
  initial?: {
    id: string;
    number: number;
    title: string;
    contentJson: unknown;
    status: "초안" | "예약" | "발행";
  };
};

export default function ChapterForm({
  seriesId,
  nextNumber,
  isShort,
  initial,
}: Props) {
  const isEdit = !!initial;
  const [title, setTitle] = useState(initial?.title ?? (isShort ? "본문" : ""));
  const [number, setNumber] = useState(initial?.number ?? nextNumber);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const editor = useEditor({
    extensions: [StarterKit, WikiLink, SceneBreak, Spoiler, Aside, Ruby, Footnote],
    content: (initial?.contentJson as any) ?? "<p></p>",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "prose max-w-none focus:outline-none min-h-[300px] px-4 py-3",
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

    const payload = {
      seriesId,
      number,
      title,
      contentJson: editor.getJSON(),
      contentHtml: editor.getHTML(),
      status: finalStatus,
    };

    const res = await fetch(
      isEdit ? `/api/chapters/${initial!.id}` : "/api/chapters",
      {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    setBusy(false);

    if (res.ok) {
      window.location.href = `/admin/series/${seriesId}`;
      return;
    }
    const err = await res.json().catch(() => ({ error: "저장 실패" }));
    setMsg(err.error ?? "오류");
  };

  const remove = async () => {
    if (!isEdit) return;
    if (!window.confirm("이 화를 정말 삭제할까요?")) return;
    const res = await fetch(`/api/chapters/${initial!.id}`, { method: "DELETE" });
    if (res.ok) {
      window.location.href = `/admin/series/${seriesId}`;
    } else {
      setMsg("삭제 실패");
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
        <label className="label">
          <span className="label-text">화 번호</span>
          <input
            type="number"
            value={number}
            onChange={(e) => setNumber(Number(e.target.value))}
            min={1}
            className="input"
          />
        </label>
        <label className="label">
          <span className="label-text">제목</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="input"
          />
        </label>
      </div>

      <div className="border border-gray-300 rounded bg-white overflow-hidden">
        <EditorToolbar editor={editor} aiMode="chapter" />
        <EditorContent editor={editor} />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => submit("초안")}
          className="btn btn-secondary"
        >
          초안 저장
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => submit("발행")}
          className="btn btn-primary"
        >
          {isEdit ? "발행으로 저장" : "발행"}
        </button>
        {isEdit && (
          <button type="button" disabled={busy} onClick={remove} className="btn-danger">
            삭제
          </button>
        )}
        <a
          href={`/admin/series/${seriesId}`}
          className="ml-auto text-sm text-gray-500 hover:text-gray-900"
        >
          취소
        </a>
      </div>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </div>
  );
}
