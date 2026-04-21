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

type SeriesOption = { id: string; title: string };

type Props = {
  seriesList: SeriesOption[];
  initial?: {
    id: string;
    title: string;
    slug: string;
    summary: string | null;
    seriesId: string | null;
    contentJson: unknown;
  };
};

export default function WikiForm({ seriesList, initial }: Props) {
  const isEdit = !!initial;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [seriesId, setSeriesId] = useState<string>(initial?.seriesId ?? "");
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

  const submit = async () => {
    if (!editor) return;
    if (!title.trim() || !slug.trim()) {
      setMsg("제목과 슬러그를 입력해주세요.");
      return;
    }
    setBusy(true);
    setMsg("");

    const payload = {
      slug,
      title,
      summary: summary || null,
      seriesId: seriesId || null,
      contentJson: editor.getJSON(),
      contentHtml: editor.getHTML(),
      status: "발행",
    };

    const res = await fetch(
      isEdit ? `/api/wiki/${initial!.id}` : "/api/wiki",
      {
        method: isEdit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    setBusy(false);

    if (res.ok) {
      window.location.href = `/wiki/${slug}`;
      return;
    }
    const err = await res.json().catch(() => ({ error: "저장 실패" }));
    setMsg(err.error ?? "오류");
  };

  const remove = async () => {
    if (!isEdit) return;
    if (!window.confirm("이 위키 문서를 정말 삭제할까요?")) return;
    const res = await fetch(`/api/wiki/${initial!.id}`, { method: "DELETE" });
    if (res.ok) {
      window.location.href = "/admin";
    } else {
      setMsg("삭제 실패");
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="label">
          <span className="label-text">제목</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="input"
          />
        </label>
        <label className="label">
          <span className="label-text">슬러그 (URL)</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            pattern="[a-z0-9-]+"
            className="input input-mono"
            placeholder="character-name"
          />
        </label>
      </div>

      <label className="label">
        <span className="label-text">한 줄 요약 (선택)</span>
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          className="input"
        />
      </label>

      <label className="label">
        <span className="label-text">소속 작품 (비워두면 전역)</span>
        <select
          value={seriesId}
          onChange={(e) => setSeriesId(e.target.value)}
          className="input"
        >
          <option value="">— 전역 —</option>
          {seriesList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </label>

      <div className="border border-gray-300 rounded bg-white overflow-hidden">
        <EditorToolbar editor={editor} aiMode="wiki" />
        <EditorContent editor={editor} />
      </div>

      <div className="flex items-center gap-2">
        <button type="button" disabled={busy} onClick={submit} className="btn btn-primary">
          {isEdit ? "저장" : "생성"}
        </button>
        {isEdit && (
          <button type="button" disabled={busy} onClick={remove} className="btn-danger">
            삭제
          </button>
        )}
        <a href="/admin" className="ml-auto text-sm text-gray-500 hover:text-gray-900">
          취소
        </a>
      </div>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </div>
  );
}
