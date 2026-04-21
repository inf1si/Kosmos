import type { APIRoute } from "astro";
import { db } from "../../../lib/db/client";
import { series } from "../../../lib/db/schema";
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

  const { slug, title, kind, synopsis, status } = body as Record<string, unknown>;

  if (typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug)) {
    return json({ error: "invalid slug" }, 400);
  }
  if (typeof title !== "string" || !title.trim()) {
    return json({ error: "title required" }, 400);
  }
  if (kind !== "단편" && kind !== "장편") {
    return json({ error: "invalid kind" }, 400);
  }

  const id = crypto.randomUUID();
  try {
    await db.insert(series).values({
      id,
      slug,
      title,
      kind,
      synopsis: typeof synopsis === "string" && synopsis.length ? synopsis : null,
      status: status === "완결" || status === "휴재" ? status : "연재중",
    });
  } catch (e: any) {
    if (String(e?.message ?? "").includes("UNIQUE")) {
      return json({ error: "slug already exists" }, 409);
    }
    throw e;
  }

  return json({ id, slug }, 201);
};

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
