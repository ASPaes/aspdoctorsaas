import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { getInstanceSecrets } from '../_shared/providers/index.ts';
import { parseTemplateParams } from '../_shared/meta-template-params.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOG = '[sync-meta-templates]';
const META_API_VERSION = 'v21.0';

interface ParsedTemplate {
  meta_template_id: string | null;
  name: string;
  language: string;
  category: string;
  status: string;
  body_text: string | null;
  body_variables_count: number;
  header_type: string | null;
  header_content: string | null;
  footer_text: string | null;
  buttons: any[] | null;
  components: any;
}

function parseTemplate(t: any): ParsedTemplate {
  const components = t.components || [];
  let body_text: string | null = null;
  let body_variables_count = 0;
  let header_type: string | null = null;
  let header_content: string | null = null;
  let footer_text: string | null = null;
  let buttons: any[] | null = null;

  for (const comp of components) {
    if (comp.type === 'BODY') {
      body_text = comp.text || null;
      const matches = (comp.text || '').match(/\{\{\d+\}\}/g);
      body_variables_count = matches ? matches.length : 0;
    } else if (comp.type === 'HEADER') {
      header_type = comp.format || 'TEXT';
      header_content = comp.text || null;
    } else if (comp.type === 'FOOTER') {
      footer_text = comp.text || null;
    } else if (comp.type === 'BUTTONS') {
      buttons = comp.buttons || null;
    }
  }

  return {
    meta_template_id: t.id || null,
    name: t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    body_text,
    body_variables_count,
    header_type,
    header_content,
    footer_text,
    buttons,
    components,
  };
}

async function resolveWabaId(
  supabase: any,
  instanceId: string,
  phoneNumberId: string,
  accessToken: string,
): Promise<string | null> {
  const resp = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}?fields=whatsapp_business_account`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!resp.ok) {
    console.error(`${LOG} Failed to fetch WABA: ${resp.status}`);
    return null;
  }
  const data = await resp.json();
  const wabaId = data?.whatsapp_business_account?.id || null;
  if (wabaId) {
    await supabase
      .from('whatsapp_instances')
      .update({ meta_waba_id: wabaId, updated_at: new Date().toISOString() })
      .eq('id', instanceId);
    console.log(`${LOG} WABA discovered and saved: ${wabaId}`);
  }
  return wabaId;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { instance_id } = body;

    if (!instance_id) {
      return new Response(
        JSON.stringify({ error: 'instance_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: instance, error: instErr } = await supabase
      .from('whatsapp_instances')
      .select('id, tenant_id, provider_type, meta_phone_number_id, meta_waba_id')
      .eq('id', instance_id)
      .single();

    if (instErr || !instance) {
      return new Response(
        JSON.stringify({ error: 'instance not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (instance.provider_type !== 'meta_cloud') {
      return new Response(
        JSON.stringify({ error: 'sync only supported for meta_cloud instances' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (!instance.meta_phone_number_id) {
      return new Response(
        JSON.stringify({ error: 'instance has no meta_phone_number_id configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const secrets = await getInstanceSecrets(supabase, instance.id);
    const accessToken = (secrets as any).meta_access_token;
    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: 'instance has no meta_access_token configured' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let wabaId: string | null = instance.meta_waba_id;
    if (!wabaId) {
      console.log(`${LOG} WABA not set, resolving via Graph API`);
      wabaId = await resolveWabaId(
        supabase,
        instance.id,
        instance.meta_phone_number_id,
        accessToken,
      );
      if (!wabaId) {
        return new Response(
          JSON.stringify({ error: 'failed to resolve WABA id from Graph API' }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    const templatesUrl =
      `https://graph.facebook.com/${META_API_VERSION}/${wabaId}/message_templates` +
      `?fields=id,name,language,status,category,components&limit=200`;

    const tResp = await fetch(templatesUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!tResp.ok) {
      const errText = await tResp.text();
      console.error(`${LOG} Graph API error: ${tResp.status} ${errText}`);
      return new Response(
        JSON.stringify({ error: 'Graph API request failed', status: tResp.status, detail: errText }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const tData = await tResp.json();
    const remoteTemplates = (tData?.data || []) as any[];
    console.log(`${LOG} Fetched ${remoteTemplates.length} templates from Meta`);

    const now = new Date().toISOString();
    const remoteKeys = new Set<string>();
    let upserts = 0;
    let errors = 0;

    for (const raw of remoteTemplates) {
      const parsed = parseTemplate(raw);
      remoteKeys.add(`${parsed.name}::${parsed.language}`);

      const { error: upErr } = await supabase
        .from('whatsapp_meta_templates')
        .upsert(
          {
            tenant_id: instance.tenant_id,
            instance_id: instance.id,
            meta_template_id: parsed.meta_template_id,
            name: parsed.name,
            language: parsed.language,
            category: parsed.category,
            status: parsed.status,
            body_text: parsed.body_text,
            body_variables_count: parsed.body_variables_count,
            header_type: parsed.header_type,
            header_content: parsed.header_content,
            footer_text: parsed.footer_text,
            buttons: parsed.buttons,
            components: parsed.components,
            synced_at: now,
            updated_at: now,
          },
          { onConflict: 'instance_id,name,language' },
        );

      if (upErr) {
        console.error(`${LOG} Upsert error for ${parsed.name}:`, upErr);
        errors++;
      } else {
        upserts++;
      }
    }

    // Soft-guard delete: só apaga órfãos se houver pelo menos 1 template remoto
    // (evita wipe acidental se Graph API retornar lista vazia por erro transitório)
    let deleted = 0;
    if (remoteTemplates.length > 0) {
      const { data: localTemplates } = await supabase
        .from('whatsapp_meta_templates')
        .select('id, name, language')
        .eq('instance_id', instance.id);

      const orphans = (localTemplates || []).filter(
        (t: any) => !remoteKeys.has(`${t.name}::${t.language}`),
      );

      if (orphans.length > 0) {
        const orphanIds = orphans.map((o: any) => o.id);
        const { error: delErr } = await supabase
          .from('whatsapp_meta_templates')
          .delete()
          .in('id', orphanIds);
        if (!delErr) deleted = orphans.length;
        else console.error(`${LOG} Delete error:`, delErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        waba_id: wabaId,
        total: remoteTemplates.length,
        upserts,
        deleted,
        errors,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error(`${LOG} Unexpected error:`, err);
    return new Response(
      JSON.stringify({ error: 'unexpected', detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
