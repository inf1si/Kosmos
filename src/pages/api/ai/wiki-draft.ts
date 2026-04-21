import type { APIRoute } from "astro";
import { requireAuth } from "../../../lib/auth/guard";
import { wikiDraft } from "../../../lib/ai/prompts";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try { await requireAuth(request); } catch (res) { return res as Response; }
  if (!import.meta.env.ANTHROPIC_API_KEY) {
    return json({ error: "ANTHROPIC_API_KEY not set in .env" }, 500);
  }

  const body = (await request.json().catch(() => null)) as {
    title?: string;
    hint?: string;
  } | null;
  if (!body?.title?.trim()) return json({ error: "title required" }, 400);

  try {
    const text = await wikiDraft(body.title, body.hint);
    return json({ text }, 200);
  } catch (e: any) {
    return json({ error: e?.message ?? "AI call failed" }, 502);
  }
};

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
