import type { APIRoute } from "astro";
import { and, eq, or } from "drizzle-orm";
import { db } from "../../../lib/db/client";
import { wikiPage, link } from "../../../lib/db/schema";
import { requireAuth } from "../../../lib/auth/guard";
import { syncWikiLinks } from "../../../lib/wiki/links";

export const prerender = false;

export const PATCH: APIRoute = async ({ request, params }) => {
  try { await requireAuth(request); } catch (res) { return res as Response; }

  const id = params.id;
  if (!id) return json({ error: "id required" }, 400);

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "invalid body" }, 400);

  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title;
  if (typeof body.slug === "string" && /^[a-z0-9-]+$/.test(body.slug)) patch.slug = body.slug;
  if (typeof body.summary === "string") patch.summary = body.summary || null;
  if (typeof body.seriesId === "string" || body.seriesId === null) patch.seriesId = body.seriesId || null;
  if (body.contentJson !== undefined) patch.contentJson = body.contentJson as any;
  if (typeof body.contentHtml === "string") patch.contentHtml = body.contentHtml;
  if (body.status === "초안" || body.status === "발행") patch.status = body.status;
  patch.updatedAt = new Date();

  if (Object.keys(patch).length === 1) return json({ error: "nothing to update" }, 400);

  try {
    await db.update(wikiPage).set(patch).where(eq(wikiPage.id, id));
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      return json({ error: "slug already exists" }, 409);
    }
    throw e;
  }

  if (body.contentJson !== undefined) {
    await syncWikiLinks("wiki", id, body.contentJson);
  }

  return json({ id }, 200);
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try { await requireAuth(request); } catch (res) { return res as Response; }

  const id = params.id;
  if (!id) return json({ error: "id required" }, 400);

  // Remove links both outgoing from this wiki and incoming to it
  await db
    .delete(link)
    .where(
      or(
        and(eq(link.fromType, "wiki"), eq(link.fromId, id)),
        and(eq(link.toType, "wiki"), eq(link.toId, id)),
      ),
    );
  await db.delete(wikiPage).where(eq(wikiPage.id, id));
  return json({ ok: true }, 200);
};

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
