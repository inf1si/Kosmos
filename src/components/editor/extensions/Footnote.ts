import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    footnote: {
      setFootnote: (content: string) => ReturnType;
    };
  }
}

export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  selectable: true,
  atom: true,

  addAttributes() {
    return {
      content: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "sup[data-footnote]",
        getAttrs: (el) => {
          if (typeof el === "string") return false;
          return {
            content: el.getAttribute("data-footnote-content") ?? "",
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "sup",
      mergeAttributes(HTMLAttributes, {
        "data-footnote": "",
        "data-footnote-content": node.attrs.content ?? "",
        class: "footnote",
      }),
      "[*]",
    ];
  },

  renderText({ node }) {
    return `[주석: ${node.attrs.content ?? ""}]`;
  },

  addCommands() {
    return {
      setFootnote:
        (content) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { content },
          }),
    };
  },
});
