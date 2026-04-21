import { Node, mergeAttributes } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import tippy, { type Instance } from "tippy.js";

import WikiSuggestionList, {
  type WikiItem,
  type WikiSuggestionHandle,
} from "../WikiSuggestionList";

type PickedWiki = { wikiId: string; slug: string; title: string };

export const WikiLink = Node.create({
  name: "wikiLink",
  group: "inline",
  inline: true,
  selectable: false,
  atom: true,

  addAttributes() {
    return {
      wikiId: { default: null },
      slug: { default: null },
      title: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "a[data-wiki-link]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        "data-wiki-link": "",
        "data-wiki-id": node.attrs.wikiId,
        href: `/wiki/${node.attrs.slug}`,
        class: "wiki-link",
      }),
      node.attrs.title ?? "",
    ];
  },

  renderText({ node }) {
    return `[[${node.attrs.title ?? ""}]]`;
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<WikiItem, PickedWiki>({
        pluginKey: new PluginKey("wikiLink"),
        editor: this.editor,
        char: "[[",
        allowSpaces: true,
        startOfLine: false,

        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: "wikiLink", attrs: props },
              { type: "text", text: " " },
            ])
            .run();
        },

        items: async ({ query }) => {
          try {
            const res = await fetch(
              `/api/wiki/search?q=${encodeURIComponent(query)}`,
            );
            if (!res.ok) return [];
            const data = (await res.json()) as { items: WikiItem[] };
            return data.items ?? [];
          } catch {
            return [];
          }
        },

        render: () => {
          let component: ReactRenderer<WikiSuggestionHandle> | null = null;
          let popup: Instance | null = null;

          return {
            onStart: (props) => {
              component = new ReactRenderer(WikiSuggestionList, {
                props,
                editor: props.editor,
              });
              if (!props.clientRect) return;

              popup = tippy(document.body, {
                getReferenceClientRect: () =>
                  props.clientRect?.() ?? new DOMRect(),
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
              });
            },

            onUpdate(props) {
              component?.updateProps(props);
              popup?.setProps({
                getReferenceClientRect: () =>
                  props.clientRect?.() ?? new DOMRect(),
              });
            },

            onKeyDown(props) {
              if (props.event.key === "Escape") {
                popup?.hide();
                return true;
              }
              return component?.ref?.onKeyDown({ event: props.event }) ?? false;
            },

            onExit() {
              popup?.destroy();
              popup = null;
              component?.destroy();
              component = null;
            },
          };
        },
      }),
    ];
  },
});
