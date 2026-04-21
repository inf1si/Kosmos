import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    ruby: {
      setRuby: (attrs: { base: string; reading: string }) => ReturnType;
    };
  }
}

export const Ruby = Node.create({
  name: "ruby",
  group: "inline",
  inline: true,
  selectable: true,
  atom: true,

  addAttributes() {
    return {
      base: { default: "" },
      reading: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "ruby",
        getAttrs: (el) => {
          if (typeof el === "string") return false;
          const rt = el.querySelector("rt");
          const rtText = rt?.textContent ?? "";
          const full = el.textContent ?? "";
          const base = full.replace(rtText, "").trim();
          return { base, reading: rtText };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "ruby",
      mergeAttributes(HTMLAttributes),
      node.attrs.base ?? "",
      ["rt", {}, node.attrs.reading ?? ""],
    ];
  },

  renderText({ node }) {
    return `${node.attrs.base ?? ""}(${node.attrs.reading ?? ""})`;
  },

  addCommands() {
    return {
      setRuby:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
