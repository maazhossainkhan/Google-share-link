import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyInitData(initData: string, botToken: string): Promise<Record<string, string>> {
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) throw new Error("Missing Telegram signature");

  params.delete("hash");
  params.delete("signature");
  const checkString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = await hmac(new TextEncoder().encode("WebAppData"), botToken);
  const expectedHash = hex(await hmac(secret, checkString));
  if (!safeEqual(expectedHash, receivedHash.toLowerCase())) throw new Error("Invalid Telegram signature");

  const authDate = Number(params.get("auth_date") || 0);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || authDate > now + 30 || now - authDate > 3600) {
    throw new Error("Telegram session expired; reopen the Mini App");
  }
  return Object.fromEntries(params.entries());
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    if (typeof body?.initData !== "string" || !body.initData) throw new Error("Missing initData");

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!botToken || !supabaseUrl || !serviceKey) {
      throw new Error("Server configuration is incomplete. Add TELEGRAM_BOT_TOKEN to Supabase Edge Function secrets.");
    }

    const data = await verifyInitData(body.initData, botToken);
    const telegramUser = JSON.parse(data.user || "{}");
    const telegramId = Number(telegramUser.id);
    if (!Number.isSafeInteger(telegramId) || telegramId <= 0) throw new Error("Invalid Telegram user");

    const adminIds = new Set(
      (Deno.env.get("TELEGRAM_ADMIN_IDS") || "").split(",").map((value) => value.trim()).filter(Boolean),
    );
    const isAdmin = adminIds.has(String(telegramId));

    const db = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: existing, error: lookupError } = await db
      .from("canvau_users")
      .select("telegram_id, access_status")
      .eq("telegram_id", telegramId)
      .maybeSingle();
    if (lookupError) throw lookupError;

    if (!existing) {
      const { error: insertError } = await db.from("canvau_users").insert({
        telegram_id: telegramId,
        username: telegramUser.username ?? null,
        first_name: telegramUser.first_name ?? null,
        last_name: telegramUser.last_name ?? null,
        access_status: isAdmin ? "approved" : "pending",
      });
      if (insertError) throw insertError;

      if (!isAdmin) {
        const { error: requestError } = await db.from("canvau_access_requests").insert({
          telegram_id: telegramId,
          status: "pending",
        });
        if (requestError) throw requestError;
      }
    } else {
      const { error: updateError } = await db.from("canvau_users").update({
        username: telegramUser.username ?? null,
        first_name: telegramUser.first_name ?? null,
        last_name: telegramUser.last_name ?? null,
        updated_at: new Date().toISOString(),
        ...(isAdmin && existing.access_status !== "approved" ? { access_status: "approved" } : {}),
      }).eq("telegram_id", telegramId);
      if (updateError) throw updateError;
    }

    const accessStatus = isAdmin ? "approved" : (existing?.access_status ?? "pending");
    return json({
      ok: true,
      telegramUser: {
        id: telegramId,
        username: telegramUser.username ?? null,
        first_name: telegramUser.first_name ?? null,
      },
      accessStatus,
      isAdmin,
      message: accessStatus === "approved"
        ? "Access approved"
        : accessStatus === "pending" ? "Your access request is awaiting approval" : "Access is not approved",
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : "Authentication failed" }, 401);
  }
});
