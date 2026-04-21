import type { APIRoute } from "astro";
import { and, eq } from "drizzle-orm";
import { db } from "../../../lib/db/client";
import { series, link, chapter } from "../../../lib/db/schema";
import { requireAuth } from "../../../lib/auth/guard";

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
  if (typeof body.synopsis === "string") patch.synopsis = body.synopsis || null;
  if (body.kind === "단편" || body.kind === "장편") patch.kind = body.kind;
  if (body.status === "연재중" || body.status === "완결" || body.status === "휴재") {
    patch.status = body.status;
  }
  patch.updatedAt = new Date();

  if (Object.keys(patch).length === 1) return json({ error: "nothing to update" }, 400);

  try {
    await db.update(series).set(patch).where(eq(series.id, id));
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      return json({ error: "slug already exists" }, 409);
    }
    throw e;
  }

  return json({ id }, 200);
};

export const DELETE: APIRoute = async ({ request, params }) => {
  try { await requireAuth(request); } catch (res) { return res as Response; }

  const id = params.id;
  if (!id) return json({ error: "id required" }, 400);

  // Remove backlinks originating from chapters of this series
  const chapters = await db.select({ id: chapter.id }).from(chapter).where(eq(chapter.seriesId, id)).all();
  for (const c of chapters) {
    await db.delete(link).where(and(eq(link.fromType, "chapter"), eq(link.fromId, c.id)));
  }

  await db.delete(series).where(eq(series.id, id));
  return json({ ok: true }, 200);
};

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
