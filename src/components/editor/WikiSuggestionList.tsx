import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

export type WikiItem = {
  wikiId: string;
  slug: string;
  title: string;
  summary: string | null;
};

type Props = {
  items: WikiItem[];
  command: (item: { wikiId: string; slug: string; title: string }) => void;
  query: string;
};

export type WikiSuggestionHandle = {
  onKeyDown: (p: { event: KeyboardEvent }) => boolean;
};

const WikiSuggestionList = forwardRef<WikiSuggestionHandle, Props>(
  ({ items, command, query }, ref) => {
    const [selected, setSelected] = useState(0);

    useEffect(() => setSelected(0), [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (items.length === 0) return false;
        if (event.key === "ArrowDown") {
          setSelected((s) => (s + 1) % items.length);
          return true;
        }
        if (event.key === "ArrowUp") {
          setSelected((s) => (s - 1 + items.length) % items.length);
          return true;
        }
        if (event.key === "Enter") {
          const pick = items[selected];
          if (pick) {
            command({ wikiId: pick.wikiId, slug: pick.slug, title: pick.title });
          }
          return true;
        }
        return false;
      },
    }));

    return (
      <div className="bg-white border border-gray-300 rounded shadow-md text-sm min-w-[260px] max-h-72 overflow-auto">
        {items.length === 0 ? (
          <div className="px-3 py-2 text-gray-500">
            {query ? `"${query}" 일치 없음` : "위키 없음"}
          </div>
        ) : (
          items.map((item, i) => (
            <button
              key={item.wikiId}
              type="button"
              onMouseEnter={() => setSelected(i)}
              onClick={() =>
                command({ wikiId: item.wikiId, slug: item.slug, title: item.title })
              }
              className={`block w-full text-left px-3 py-2 border-b last:border-b-0 ${
                i === selected ? "bg-gray-100" : "bg-white"
              }`}
            >
              <div className="font-medium">{item.title}</div>
              {item.summary && (
                <div className="text-xs text-gray-500 line-clamp-1">{item.summary}</div>
              )}
              <div className="text-xs text-gray-400 font-mono">/wiki/{item.slug}</div>
            </button>
          ))
        )}
      </div>
    );
  },
);

WikiSuggestionList.displayName = "WikiSuggestionList";

export default WikiSuggestionList;
