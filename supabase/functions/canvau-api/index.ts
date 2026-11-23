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

async function verifyTelegramInitData(initData: string, botToken: string) {
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
  if (!safeEqual(expectedHash, receivedHash.toLowerCase())) {
    throw new Error("Invalid Telegram signature");
  }

  const authDate = Number(params.get("auth_date") || 0);
  const now = Math.floor(Date.now() / 1000);
  if (!authDate || authDate > now + 30 || now - authDate > 3600) {
    throw new Error("Telegram session expired; reopen the Mini App");
  }

  const userRaw = params.get("user");
  if (!userRaw) throw new Error("Telegram user data is missing");
  const telegramUser = JSON.parse(userRaw);
  const telegramId = Number(telegramUser.id);
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
    throw new Error("Invalid Telegram user");
  }

  return { telegramUser, telegramId };
}

function validateHttpUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.length < 8 || raw.length > 8192) {
    throw new Error("Enter a URL between 8 and 8192 characters");
  }
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
    throw new Error("Only valid HTTP and HTTPS URLs are supported");
  }
  if (url.username || url.password) throw new Error("URLs containing embedded credentials are not allowed");
  return url.toString();
}

function validateGoogleShareUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 2048) throw new Error("Invalid Google share URL");
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !["share.google", "search.app"].includes(host) || url.pathname.length < 2) {
    throw new Error("The URL must be a real share.google or search.app link");
  }
  return url.toString();
}

const CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function makeShortCode(length = 8): string {
  let result = "";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (const byte of bytes) result += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return result;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    if (typeof body?.initData !== "string") throw new Error("Missing Telegram Mini App initData");

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!botToken || !supabaseUrl || !serviceKey) {
      throw new Error("Server configuration is incomplete. Check the Edge Function secrets.");
    }

    const { telegramUser, telegramId } = await verifyTelegramInitData(body.initData, botToken);
    const adminIds = new Set(
      (Deno.env.get("TELEGRAM_ADMIN_IDS") || "")
        .split(",").map((value) => value.trim()).filter(Boolean),
    );
    const isAdmin = adminIds.has(String(telegramId));

    const db = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let { data: user, error: userError } = await db
      .from("canvau_users")
      .select("telegram_id, username, first_name, last_name, access_status")
      .eq("telegram_id", telegramId)
      .maybeSingle();
    if (userError) throw userError;

    if (!user && isAdmin) {
      const { data, error } = await db.from("canvau_users").insert({
        telegram_id: telegramId,
        username: telegramUser.username ?? null,
        first_name: telegramUser.first_name ?? null,
        last_name: telegramUser.last_name ?? null,
        access_status: "approved",
      }).select("telegram_id, username, first_name, last_name, access_status").single();
      if (error) throw error;
      user = data;
    }

    if (!user) {
      throw new Error("No access request found. Open the Mini App again to register.");
    }

    const action = body.action;
    if (action === "whoami") {
      return json({
        ok: true,
        telegramUser: {
          id: telegramId,
          username: telegramUser.username ?? null,
          first_name: telegramUser.first_name ?? null,
        },
        accessStatus: user.access_status,
        isAdmin,
      });
    }

    if (action === "admin_pending") {
      if (!isAdmin) return json({ ok: false, error: "Administrator access required" }, 403);
      const { data: requests, error } = await db
        .from("canvau_access_requests")
        .select("id, telegram_id, message, status, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(100);
      if (error) throw error;
      const ids = (requests ?? []).map((row) => row.telegram_id);
      let users: Record<string, unknown>[] = [];
      if (ids.length) {
        const { data, error: usersError } = await db
          .from("canvau_users")
          .select("telegram_id, username, first_name, last_name, access_status")
          .in("telegram_id", ids);
        if (usersError) throw usersError;
        users = data ?? [];
      }
      const byId = new Map(users.map((row) => [String(row.telegram_id), row]));
      return json({ ok: true, requests: (requests ?? []).map((row) => ({
        ...row, user: byId.get(String(row.telegram_id)) ?? null,
      })) });
    }

    if (action === "admin_review") {
      if (!isAdmin) return json({ ok: false, error: "Administrator access required" }, 403);
      const targetId = Number(body.telegramId);
      const decision = body.decision;
      if (!Number.isSafeInteger(targetId) || targetId <= 0 || !["approved", "rejected"].includes(decision)) {
        throw new Error("Invalid approval request");
      }
      const now = new Date().toISOString();
      const { error: updateUserError } = await db.from("canvau_users").update({
        access_status: decision, reviewed_at: now, reviewed_by: telegramId, updated_at: now,
      }).eq("telegram_id", targetId);
      if (updateUserError) throw updateUserError;
      const requestStatus = decision === "approved" ? "approved" : "rejected";
      const { error: updateRequestError } = await db.from("canvau_access_requests").update({
        status: requestStatus, reviewed_at: now, reviewed_by: telegramId,
      }).eq("telegram_id", targetId).eq("status", "pending");
      if (updateRequestError) throw updateRequestError;
      return json({ ok: true, telegramId: targetId, accessStatus: decision });
    }

    if (!isAdmin && user.access_status !== "approved") {
      return json({
        ok: false,
        accessStatus: user.access_status,
        error: user.access_status === "pending"
          ? "Your access request is awaiting approval"
          : "Your account does not have access",
      }, 403);
    }

    if (action === "list") {
      const { data, error } = await db.from("canvau_links")
        .select("id, original_url, short_code, google_share_url, google_share_status, is_active, click_count, expires_at, created_at")
        .eq("telegram_id", telegramId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const base = (Deno.env.get("CANVAU_BASE_URL") || "https://canvau.com").replace(/\/$/, "");
      return json({ ok: true, links: (data ?? []).map((row) => ({
        ...row, short_url: `${base}/${row.short_code}`,
      })) });
    }

    if (action === "create") {
      const destinationUrl = validateHttpUrl(body.originalUrl);
      const base = (Deno.env.get("CANVAU_BASE_URL") || "https://canvau.com").replace(/\/$/, "");
      for (let attempt = 0; attempt < 5; attempt++) {
        const shortCode = makeShortCode();
        const { data, error } = await db.from("canvau_links").insert({
          telegram_id: telegramId,
          original_url: destinationUrl,
          short_code: shortCode,
          google_share_status: "not_started",
        }).select("id, original_url, short_code, google_share_url, google_share_status, is_active, click_count, created_at")
          .single();
        if (!error) return json({ ok: true, link: { ...data, short_url: `${base}/${shortCode}` } });
        if (error.code !== "23505") throw error;
      }
      throw new Error("Could not allocate a unique short code. Please try again.");
    }

    if (action === "capture_google") {
      const linkId = body.linkId;
      if (typeof linkId !== "string") throw new Error("Missing link ID");
      const googleShareUrl = validateGoogleShareUrl(body.googleShareUrl);
      const { data, error } = await db.from("canvau_links").update({
        google_share_url: googleShareUrl,
        google_share_status: "captured",
        updated_at: new Date().toISOString(),
      }).eq("id", linkId).eq("telegram_id", telegramId)
        .select("id, short_code, google_share_url, google_share_status").maybeSingle();
      if (error) throw error;
      if (!data) return json({ ok: false, error: "Link not found for this account" }, 404);
      return json({ ok: true, link: data });
    }

    if (action === "delete") {
      const linkId = body.linkId;
      if (typeof linkId !== "string") throw new Error("Missing link ID");
      const { data, error } = await db.from("canvau_links").update({
        is_active: false, updated_at: new Date().toISOString(),
      }).eq("id", linkId).eq("telegram_id", telegramId)
        .select("id").maybeSingle();
      if (error) throw error;
      if (!data) return json({ ok: false, error: "Link not found for this account" }, 404);
      return json({ ok: true });
    }

    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request failed";
    const status = message.includes("signature") || message.includes("initData") || message.includes("expired") ? 401 : 400;
    return json({ ok: false, error: message }, status);
  }
});
