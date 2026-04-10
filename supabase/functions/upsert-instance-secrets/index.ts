import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SENSITIVE_FIELDS = [
  'api_key', 'api_url',
  'zapi_token', 'zapi_instance_id', 'zapi_client_token',
  'meta_access_token', 'meta_app_secret', 'meta_verify_token',
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const body = await req.json();
    const { instance_id, ...fields } = body;

    if (!instance_id) {
      return new Response(JSON.stringify({ error: 'instance_id obrigatório' }), { status: 400 });
    }

    for (const field of SENSITIVE_FIELDS) {
      const val = fields[field];
      if (val === undefined || val === null || val === '') continue;

      const secretName = `instance_${instance_id}_${field}`;

      const { data: existing } = await supabase
        .from('whatsapp_instance_vault_refs')
        .select('vault_secret_id')
        .eq('instance_id', instance_id)
        .eq('secret_name', field)
        .maybeSingle();

      let vaultId: string;

      if (existing?.vault_secret_id) {
        const { error } = await supabase.rpc('vault_update_secret', {
          p_id: existing.vault_secret_id,
          p_secret: val,
        });
        if (error) throw error;
        vaultId = existing.vault_secret_id;
      } else {
        const { data: newId, error } = await supabase.rpc('vault_create_secret', {
          p_secret: val,
          p_name: secretName,
        });
        if (error) throw error;
        vaultId = newId;
      }

      await supabase
        .from('whatsapp_instance_vault_refs')
        .upsert(
          { instance_id, secret_name: field, vault_secret_id: vaultId },
          { onConflict: 'instance_id,secret_name' }
        );
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    console.error('[upsert-instance-secrets]', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
