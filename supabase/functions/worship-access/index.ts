import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const URL = Deno.env.get("SUPABASE_URL")!;
const SECRET = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default;
const admin = createClient(URL, SECRET, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = {
  "Access-Control-Allow-Origin": "https://jtnaanbulacan.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const ALLOWED = new Set([
  "hub_live_session", "hub_song_library", "hub_lyrics_display", "hub_setlist",
  "hub_chords_view", "hub_instrument_tuner", "hub_countdown_timer",
  "hub_background_layout", "hub_settings_customization",
  "presenter_song_presentation", "presenter_presentation_controls",
  "presenter_background_layout", "presenter_settings_customization"
]);

async function requireSuperAdmin(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Sign in as Super Admin first.");
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) throw new Error("Your session is invalid. Please sign in again.");
  const { data: account, error } = await admin.from("worship_accounts")
    .select("user_id,username,username_key,role,status")
    .eq("user_id", authData.user.id).maybeSingle();
  if (error || !account || account.status !== "active" || account.role !== "super_admin" || account.username_key !== "admin@mart") {
    throw new Error("Only the existing Admin@Mart Super Admin account can manage registered accounts.");
  }
  return authData.user;
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  try {
    const caller = await requireSuperAdmin(req);
    const body = await req.json();
    const action = String(body.action || "");
    if (action === "update_permissions") {
      const targetId = String(body.targetUserId || "");
      if (!/^[0-9a-f-]{36}$/i.test(targetId) || targetId === caller.id) return reply({ error: "Choose a valid member account." }, 400);
      if (!Array.isArray(body.permissions) || body.permissions.some((x: unknown) => typeof x !== "string" || !ALLOWED.has(x))) {
        return reply({ error: "The permission list contains an unsupported permission." }, 400);
      }
      const permissions = [...new Set(body.permissions as string[])];
      const { data: target, error: targetError } = await admin.from("worship_accounts")
        .select("user_id,username,username_key,role,status,sections")
        .eq("user_id", targetId).maybeSingle();
      if (targetError || !target || target.role === "super_admin" || target.username_key === "admin@mart") {
        return reply({ error: "The selected member account cannot be changed." }, 404);
      }
      const { data: authTarget, error: authTargetError } = await admin.auth.admin.getUserById(targetId);
      if (authTargetError || !authTarget.user) return reply({ error: "Could not locate the member authentication account." }, 404);
      const previousMeta = authTarget.user.app_metadata || {};
      const { error: authUpdateError } = await admin.auth.admin.updateUserById(targetId, {
        app_metadata: { ...previousMeta, permissions }
      });
      if (authUpdateError) return reply({ error: "Could not update authentication permissions: " + authUpdateError.message }, 400);
      const { error: accountUpdateError } = await admin.from("worship_accounts")
        .update({ sections: permissions }).eq("user_id", targetId);
      if (accountUpdateError) {
        await admin.auth.admin.updateUserById(targetId, { app_metadata: previousMeta });
        return reply({ error: "Could not save account permissions. Authentication metadata was restored." }, 500);
      }
      return reply({ ok: true, targetUserId: targetId, permissions, updatedBy: caller.id });
    }
    if (action === "update_nickname") {
      const targetId = String(body.targetUserId || "");
      const nickname = String(body.nickname || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(targetId) || targetId === caller.id || nickname.length > 40) {
        return reply({ error: "Choose a valid member and a nickname of 40 characters or fewer." }, 400);
      }
      const { data: target, error: targetError } = await admin.from("worship_accounts")
        .select("user_id,username,username_key,role").eq("user_id", targetId).maybeSingle();
      if (targetError || !target || target.role === "super_admin" || target.username_key === "admin@mart") {
        return reply({ error: "The selected account cannot be edited." }, 404);
      }
      const { data: authTarget, error: authTargetError } = await admin.auth.admin.getUserById(targetId);
      if (authTargetError || !authTarget.user) return reply({ error: "Could not locate the member authentication account." }, 404);
      const metadata = { ...(authTarget.user.user_metadata || {}), nickname };
      const { error: authUpdateError } = await admin.auth.admin.updateUserById(targetId, { user_metadata: metadata });
      if (authUpdateError) return reply({ error: authUpdateError.message }, 400);
      const { error: accountUpdateError } = await admin.from("worship_accounts")
        .update({ nickname: nickname || null }).eq("user_id", targetId);
      if (accountUpdateError) return reply({ error: "The profile metadata changed but the account record did not. Please review this member." }, 500);
      return reply({ ok: true, targetUserId: targetId, nickname });
    }
    return reply({ error: "Unknown action." }, 400);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "Unexpected server error." }, 403);
  }
});