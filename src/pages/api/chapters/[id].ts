import type { APIRoute } from "astro";
import { and, eq } from "drizzle-orm";
import { db } from "../../../lib/db/client";
import { chapter, link } from "../../../lib/db/schema";
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
  if (typeof body.number === "number" && body.number >= 1) patch.number = body.number;
  if (body.contentJson !== undefined) patch.contentJson = body.contentJson as any;
  if (typeof body.contentHtml === "string") patch.contentHtml = body.contentHtml;
  if (body.status === "초안" || body.status === "예약" || body.status === "발행") {
    patch.status = body.status;
    const existing = await db.select({ publishedAt: chapter.publishedAt }).from(chapter).where(eq(chapter.id, id)).get();
    if (body.status === "발행" && !existing?.publishedAt) patch.publishedAt = new Date();
  }
  patch.updatedAt = new Date();

  if (Object.keys(patch).length === 1) return json({ error: "nothing to update" }, 400);

  try {
    await db.update(chapter).set(patch).where(eq(chapter.id, id));
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      return json({ error: "chapter number already exists for this series" }, 409);
    }
    throw e;
  }

  if (body.contentJson !== undefined) {
    await syncWikiLinks("chapter", id, body.contentJson);
  }

  return json({ id }, 200);
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try { await requireAuth(request); } catch (res) { return res as Response; }

  const id = params.id;
  if (!id) return json({ error: "id required" }, 400);

  await db.delete(link).where(and(eq(link.fromType, "chapter"), eq(link.fromId, id)));
  await db.delete(chapter).where(eq(chapter.id, id));
  return json({ ok: true }, 200);
};

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
