import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

type Props = {
  initialJson?: unknown;
  onChange?: (json: unknown, html: string) => void;
};

export default function Editor({ initialJson, onChange }: Props) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: (initialJson as any) ?? "<p>여기에 내용을 작성하세요…</p>",
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getJSON(), editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: "prose max-w-none focus:outline-none min-h-[240px]",
      },
    },
  });

  return (
    <div className="border border-gray-300 rounded p-4 bg-white">
      <EditorContent editor={editor} />
    </div>
  );
}
