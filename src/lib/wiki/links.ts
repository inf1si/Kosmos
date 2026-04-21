import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { link } from "../db/schema";

type LinkSource = "chapter" | "wiki";

export function extractWikiLinkIds(contentJson: unknown): string[] {
  const ids = new Set<string>();
  const visit = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (node.type === "wikiLink" && node.attrs?.wikiId) {
      ids.add(node.attrs.wikiId as string);
    }
    if (Array.isArray(node.content)) node.content.forEach(visit);
  };
  visit(contentJson);
  return [...ids];
}

export async function syncWikiLinks(
  fromType: LinkSource,
  fromId: string,
  contentJson: unknown,
) {
  const wikiIds = extractWikiLinkIds(contentJson);

  await db
    .delete(link)
    .where(and(eq(link.fromType, fromType), eq(link.fromId, fromId)));

  if (wikiIds.length === 0) return;

  await db.insert(link).values(
    wikiIds.map((toId) => ({
      id: crypto.randomUUID(),
      fromType,
      fromId,
      toType: "wiki" as const,
      toId,
    })),
  );
}
