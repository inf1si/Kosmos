import type { APIRoute } from "astro";
import { db } from "../../../lib/db/client";
import { wikiPage } from "../../../lib/db/schema";
import { requireAuth } from "../../../lib/auth/guard";
import { syncWikiLinks } from "../../../lib/wiki/links";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    await requireAuth(request);
  } catch (res) {
    return res as Response;
  }

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "invalid body" }, 400);

  const { slug, title, summary, seriesId, contentJson, contentHtml, status } = body as Record<string, unknown>;

  if (typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug)) {
    return json({ error: "invalid slug" }, 400);
  }
  if (typeof title !== "string" || !title.trim()) {
    return json({ error: "title required" }, 400);
  }

  const finalStatus = status === "초안" ? "초안" : "발행";

  const id = crypto.randomUUID();
  try {
    await db.insert(wikiPage).values({
      id,
      slug,
      title,
      summary: typeof summary === "string" && summary.length ? summary : null,
      seriesId: typeof seriesId === "string" && seriesId.length ? seriesId : null,
      contentJson: (contentJson as any) ?? null,
      contentHtml: typeof contentHtml === "string" ? contentHtml : null,
      status: finalStatus,
    });
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      return json({ error: "slug already exists" }, 409);
    }
    throw e;
  }

  await syncWikiLinks("wiki", id, contentJson);

  return json({ id, slug }, 201);
};

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
