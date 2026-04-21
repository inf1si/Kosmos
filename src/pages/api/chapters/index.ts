import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { db } from "../../../lib/db/client";
import { chapter, series } from "../../../lib/db/schema";
import { requireAuth } from "../../../lib/auth/guard";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    await requireAuth(request);
  } catch (res) {
    return res as Response;
  }

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "invalid body" }, 400);

  const { seriesId, number, title, contentJson, contentHtml, status } = body as Record<string, unknown>;

  if (typeof seriesId !== "string") return json({ error: "seriesId required" }, 400);
  const n = Number(number);
  if (!Number.isFinite(n) || n < 1) return json({ error: "invalid number" }, 400);
  if (typeof title !== "string" || !title.trim()) return json({ error: "title required" }, 400);

  const s = await db.select().from(series).where(eq(series.id, seriesId)).get();
  if (!s) return json({ error: "series not found" }, 404);

  const finalStatus = status === "발행" ? "발행" : status === "예약" ? "예약" : "초안";

  const id = crypto.randomUUID();
  try {
    await db.insert(chapter).values({
      id,
      seriesId,
      number: n,
      title,
      contentJson: (contentJson as any) ?? null,
      contentHtml: typeof contentHtml === "string" ? contentHtml : null,
      status: finalStatus,
      publishedAt: finalStatus === "발행" ? new Date() : null,
    });
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      return json({ error: "chapter number already exists for this series" }, 409);
    }
    throw e;
  }

  return json({ id, seriesId, seriesSlug: s.slug, number: n }, 201);
};

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
