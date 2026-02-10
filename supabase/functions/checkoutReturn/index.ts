import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("ITX_SUPABASE_URL");
    const anonKey = Deno.env.get("ITX_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("ITX_SECRET_KEY");

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return new Response(JSON.stringify({ error: "Server misconfiguration" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify user JWT
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { student_id, gear_barcodes, action_type } = await req.json();
    if (!Array.isArray(gear_barcodes) || !gear_barcodes.length) {
      return new Response(JSON.stringify({ error: "Invalid request" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    const isAdminReturn = action_type === "admin_return";
    let student: { id: string; tenant_id: string } | null = null;

    if (!isAdminReturn) {
      if (!student_id) {
        return new Response(JSON.stringify({ error: "Invalid request" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: studentData, error: studentError } = await adminClient
        .from("students")
        .select("id, tenant_id")
        .eq("student_id", student_id)
        .single();

      if (studentError || !studentData?.id || !studentData.tenant_id) {
        return new Response(JSON.stringify({ error: "Student not found." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      student = studentData;
    }

    for (const barcode of gear_barcodes) {
      const gearQuery = adminClient
        .from("gear")
        .select("*")
        .eq("barcode", barcode);

      const { data: gear } = isAdminReturn
        ? await gearQuery.single()
        : await gearQuery.eq("tenant_id", student!.tenant_id).single();

      if (!gear) continue;

      if (isAdminReturn) {
        if (!gear.checked_out_by) continue;
        await adminClient
          .from("gear")
          .update({
            checked_out_by: null,
            checked_out_at: null,
            status: "available",
          })
          .eq("id", gear.id);

        await adminClient.from("gear_logs").insert({
          gear_id: gear.id,
          action_type: "admin_return",
          checked_out_by: gear.checked_out_by,
          tenant_id: gear.tenant_id,
        });

        continue;
      }

      const isCheckout = !gear.checked_out_by;
      const isReturn = gear.checked_out_by === student.id;

      if (!isCheckout && !isReturn) continue;

      await adminClient
        .from("gear")
        .update({
          checked_out_by: isCheckout ? student.id : null,
          checked_out_at: isCheckout ? new Date().toISOString() : null,
          status: isCheckout ? "checked_out" : "available",
        })
        .eq("id", gear.id);

      await adminClient.from("gear_logs").insert({
        gear_id: gear.id,
        action_type: isCheckout ? "checkout" : "return",
        checked_out_by: student.id,
        tenant_id: gear.tenant_id,
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Request failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
