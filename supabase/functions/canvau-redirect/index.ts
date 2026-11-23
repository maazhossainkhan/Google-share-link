import { createClient } from "npm:@supabase/supabase-js@2";

function errorPage(status: number, title: string, message: string) {
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font:16px system-ui;max-width:540px;margin:12vh auto;padding:24px;color:#172033"><h1>${title}</h1><p>${message}</p><p><a href="https://canvau.com">Canvau</a></p></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  try {
    const code = new URL(req.url).searchParams.get("code")?.trim() ?? "";
    if (!/^[A-Za-z0-9_-]{5,12}$/.test(code)) {
      return errorPage(404, "Link not found", "This Canvau link is invalid or no longer available.");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("Redirect service is not configured");

    const db = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: link, error } = await db.from("canvau_links")
      .select("original_url, is_active, expires_at")
      .eq("short_code", code)
      .maybeSingle();
    if (error) throw error;
    if (!link || !link.is_active) return errorPage(404, "Link not found", "This Canvau link is invalid or disabled.");
    if (link.expires_at && new Date(link.expires_at).getTime() <= Date.now()) {
      return errorPage(410, "Link expired", "The owner has set this Canvau link to expire.");
    }

    const destination = new URL(link.original_url);
    if (!["http:", "https:"].includes(destination.protocol)) {
      return errorPage(410, "Link unavailable", "The saved destination is not a valid web URL.");
    }

    const { error: clickError } = await db.rpc("increment_canvau_link_click", {
      p_short_code: code,
    });
    if (clickError) console.error("Click counter update skipped:", clickError.message);

    return new Response(null, {
      status: 302,
      headers: {
        Location: destination.toString(),
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    console.error("Canvau redirect error:", error);
    return errorPage(503, "Service unavailable", "Canvau could not process this link right now. Please try again later.");
  }
});
