import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Verify user JWT
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { studentId, gearIds } = await req.json();

  const adminClient = createClient(supabaseUrl, serviceKey);

  for (const gearId of gearIds) {
    const { data: gear } = await adminClient
      .from("gear")
      .select("*")
      .eq("id", gearId)
      .single();

    if (!gear) continue;

    const isCheckout = !gear.checked_out_by;
    const isReturn = gear.checked_out_by === studentId;

    if (!isCheckout && !isReturn) continue;

    await adminClient
      .from("gear")
      .update({
        checked_out_by: isCheckout ? studentId : null,
        checked_out_at: isCheckout ? new Date().toISOString() : null,
        status: isCheckout ? "checked_out" : "available",
      })
      .eq("id", gearId);

    await adminClient.from("gear_logs").insert({
      gear_id: gearId,
      action_type: isCheckout ? "checkout" : "return",
      checked_out_by: studentId,
      tenant_id: gear.tenant_id,
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
