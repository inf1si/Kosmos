import type { APIRoute } from "astro";
import { or, like } from "drizzle-orm";
import { db } from "../../../lib/db/client";
import { wikiPage } from "../../../lib/db/schema";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get("q")?.trim() ?? "";

  const base = db
    .select({
      wikiId: wikiPage.id,
      slug: wikiPage.slug,
      title: wikiPage.title,
      summary: wikiPage.summary,
    })
    .from(wikiPage);

  const rows =
    q.length === 0
      ? await base.limit(10).all()
      : await base
          .where(or(like(wikiPage.title, `%${q}%`), like(wikiPage.slug, `%${q}%`)))
          .limit(10)
          .all();

  return new Response(JSON.stringify({ items: rows }), {
    headers: { "content-type": "application/json" },
  });
};
