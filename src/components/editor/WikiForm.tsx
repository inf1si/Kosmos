import { useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

type SeriesOption = { id: string; title: string };

type Props = { seriesList: SeriesOption[] };

export default function WikiForm({ seriesList }: Props) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [summary, setSummary] = useState("");
  const [seriesId, setSeriesId] = useState<string>("");
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

  const submit = async () => {
    if (!editor) return;
    if (!title.trim() || !slug.trim()) {
      setMsg("제목과 슬러그를 입력해주세요.");
      return;
    }
    setBusy(true);
    setMsg("");

    const res = await fetch("/api/wiki", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug,
        title,
        summary: summary || null,
        seriesId: seriesId || null,
        contentJson: editor.getJSON(),
        contentHtml: editor.getHTML(),
        status: "발행",
      }),
    });

    setBusy(false);

    if (res.ok) {
      const { slug: s } = await res.json();
      window.location.href = `/wiki/${s}`;
      return;
    }
    const err = await res.json().catch(() => ({ error: "저장 실패" }));
    setMsg(err.error ?? "오류");
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-sm">제목</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="border rounded px-3 py-2"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-sm">슬러그 (URL)</span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            pattern="[a-z0-9-]+"
            className="border rounded px-3 py-2 font-mono text-sm"
            placeholder="character-name"
          />
        </label>
      </div>

      <label className="grid gap-1">
        <span className="text-sm">한 줄 요약 (선택)</span>
        <input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          className="border rounded px-3 py-2"
        />
      </label>

      <label className="grid gap-1">
        <span className="text-sm">소속 작품 (비워두면 전역)</span>
        <select
          value={seriesId}
          onChange={(e) => setSeriesId(e.target.value)}
          className="border rounded px-3 py-2"
        >
          <option value="">— 전역 —</option>
          {seriesList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </label>

      <div className="border border-gray-300 rounded p-4 bg-white">
        <EditorContent editor={editor} />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="bg-black text-white rounded px-4 py-2 disabled:opacity-50"
        >
          저장
        </button>
        <a href="/admin" className="ml-auto text-sm text-gray-600 hover:underline">
          취소
        </a>
      </div>
      {msg && <p className="text-sm text-red-600">{msg}</p>}
    </div>
  );
}
