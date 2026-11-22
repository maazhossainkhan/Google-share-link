// Supabase Edge Function: validate Telegram Mini App initData and register access requests.
// Required server-side secrets: TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(keyBytes: Uint8Array, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
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
  const expectedHash = await hmac(
    new Uint8Array(secret.match(/.{2}/g)!.map((byte) => parseInt(byte, 16))),
    checkString,
  );
  if (expectedHash !== receivedHash) throw new Error("Invalid Telegram signature");

  const authDate = Number(params.get("auth_date") || 0);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || authDate > now + 30 || now - authDate > 86400) {
    throw new Error("Telegram session expired; reopen the Mini App");
  }
  return Object.fromEntries(params.entries());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { initData } = await req.json();
    if (typeof initData !== "string" || !initData) throw new Error("Missing initData");

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!botToken || !supabaseUrl || !serviceKey) throw new Error("Server configuration is incomplete");

    const data = await verifyInitData(initData, botToken);
    const telegramUser = JSON.parse(data.user || "{}");
    const telegramId = Number(telegramUser.id);
    if (!Number.isSafeInteger(telegramId) || telegramId <= 0) throw new Error("Invalid Telegram user");

    const db = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: existing, error: lookupError } = await db
      .from("canvau_users").select("telegram_id, access_status")
      .eq("telegram_id", telegramId).maybeSingle();
    if (lookupError) throw lookupError;

    if (!existing) {
      const { error: insertError } = await db.from("canvau_users").insert({
        telegram_id: telegramId,
        username: telegramUser.username ?? null,
        first_name: telegramUser.first_name ?? null,
        last_name: telegramUser.last_name ?? null,
        access_status: "pending",
      });
      if (insertError) throw insertError;

      const { error: requestError } = await db.from("canvau_access_requests").insert({
        telegram_id: telegramId,
        status: "pending",
      });
      if (requestError) throw requestError;
    } else {
      const { error: updateError } = await db.from("canvau_users").update({
        username: telegramUser.username ?? null,
        first_name: telegramUser.first_name ?? null,
        last_name: telegramUser.last_name ?? null,
        updated_at: new Date().toISOString(),
      }).eq("telegram_id", telegramId);
      if (updateError) throw updateError;
    }

    const status = existing?.access_status ?? "pending";
    return new Response(JSON.stringify({
      ok: true,
      telegramUser: {
        id: telegramId,
        username: telegramUser.username ?? null,
        first_name: telegramUser.first_name ?? null,
      },
      accessStatus: status,
      message: status === "approved"
        ? "Access approved"
        : status === "pending" ? "Your access request is awaiting approval" : "Access is not approved",
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Authentication failed" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
