import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    aside: {
      toggleAside: () => ReturnType;
    };
  }
}

export const Aside = Node.create({
  name: "aside",
  group: "block",
  content: "block+",
  defining: true,

  parseHTML() {
    return [{ tag: "aside.callout" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "aside",
      mergeAttributes(HTMLAttributes, { class: "callout" }),
      0,
    ];
  },

  addCommands() {
    return {
      toggleAside:
        () =>
        ({ commands, state }) => {
          const { $from } = state.selection;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === this.name) {
              return commands.lift(this.name);
            }
          }
          return commands.wrapIn(this.name);
        },
    };
  },
});
