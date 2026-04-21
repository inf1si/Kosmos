import type { Editor } from "@tiptap/react";
import AiMenu from "./AiMenu";

type Props = { editor: Editor | null; aiMode?: "chapter" | "wiki" };

type BtnProps = {
  active?: boolean;
  onClick: () => void;
  title: string;
  label: React.ReactNode;
  disabled?: boolean;
};

function Btn({ active, onClick, title, label, disabled }: BtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`min-w-[32px] h-8 px-2 text-sm rounded border transition-colors disabled:opacity-40 ${
        active ? "bg-gray-900 text-white border-gray-900" : "bg-white hover:bg-gray-100 border-gray-300"
      }`}
    >
      {label}
    </button>
  );
}

function Sep() {
  return <span aria-hidden className="w-px h-6 bg-gray-300 mx-1 self-center" />;
}

export default function EditorToolbar({ editor, aiMode }: Props) {
  if (!editor) return null;

  const c = editor.chain().focus();

  const promptRuby = () => {
    const base = window.prompt("원문 (예: 龍, 양명)");
    if (!base) return;
    const reading = window.prompt("독음 (예: 용, ヤンミン)");
    if (reading === null) return;
    editor.chain().focus().setRuby({ base, reading }).run();
  };

  const promptFootnote = () => {
    const content = window.prompt("각주 내용");
    if (!content) return;
    editor.chain().focus().setFootnote(content).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-1 p-2 border-b bg-gray-50 rounded-t">
      <Btn active={editor.isActive("bold")} onClick={() => c.toggleBold().run()} title="굵게 (Ctrl+B)" label={<b>B</b>} />
      <Btn active={editor.isActive("italic")} onClick={() => c.toggleItalic().run()} title="기울임 (Ctrl+I)" label={<i>I</i>} />
      <Btn active={editor.isActive("strike")} onClick={() => c.toggleStrike().run()} title="취소선" label={<s>S</s>} />
      <Btn active={editor.isActive("code")} onClick={() => c.toggleCode().run()} title="인라인 코드" label="{ }" />

      <Sep />

      <Btn active={editor.isActive("heading", { level: 1 })} onClick={() => c.toggleHeading({ level: 1 }).run()} title="제목 1" label="H1" />
      <Btn active={editor.isActive("heading", { level: 2 })} onClick={() => c.toggleHeading({ level: 2 }).run()} title="제목 2" label="H2" />
      <Btn active={editor.isActive("heading", { level: 3 })} onClick={() => c.toggleHeading({ level: 3 }).run()} title="제목 3" label="H3" />

      <Sep />

      <Btn active={editor.isActive("bulletList")} onClick={() => c.toggleBulletList().run()} title="글머리 기호" label="•" />
      <Btn active={editor.isActive("orderedList")} onClick={() => c.toggleOrderedList().run()} title="번호 매기기" label="1." />
      <Btn active={editor.isActive("blockquote")} onClick={() => c.toggleBlockquote().run()} title="인용" label="❝" />

      <Sep />

      <Btn onClick={() => c.setSceneBreak().run()} title="장면 전환 (◆◆◆)" label="◆◆◆" />
      <Btn active={editor.isActive("spoiler")} onClick={() => c.toggleSpoiler().run()} title="스포일러 (클릭해서 가림)" label="🫥" />
      <Btn active={editor.isActive("aside")} onClick={() => c.toggleAside().run()} title="작가의 말 / 주의 박스" label="📣" />
      <Btn onClick={promptRuby} title="루비 문자 (독음)" label="ル" />
      <Btn onClick={promptFootnote} title="각주" label="†" />

      <Sep />

      <Btn onClick={() => c.undo().run()} disabled={!editor.can().undo()} title="되돌리기 (Ctrl+Z)" label="↶" />
      <Btn onClick={() => c.redo().run()} disabled={!editor.can().redo()} title="다시 실행 (Ctrl+Shift+Z)" label="↷" />

      {aiMode && <span className="ml-auto"><AiMenu editor={editor} mode={aiMode} /></span>}
    </div>
  );
}
