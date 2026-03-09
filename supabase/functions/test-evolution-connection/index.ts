import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEvolutionAuthHeaders(apiKey: string): Record<string, string> {
  return {
    'apikey': apiKey,
    'Content-Type': 'application/json'
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { api_url, api_key, instance_name, instance_id_external, provider_type } = await req.json();

    console.log('[test-evolution-connection] Testing:', {
      provider_type, api_url, instance_name,
      instance_id_external: instance_id_external ? `${instance_id_external.substring(0, 8)}...` : null,
    });

    if (!api_url || !api_key || !instance_name) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: api_url, api_key, instance_name' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const headers = getEvolutionAuthHeaders(api_key);
    const instanceIdentifier = provider_type === 'cloud' && instance_id_external
      ? instance_id_external
      : instance_name;

    const fullUrl = `${api_url}/instance/connectionState/${instanceIdentifier}`;
    console.log('[test-evolution-connection] Calling:', fullUrl);

    const response = await fetch(fullUrl, { method: 'GET', headers });
    const responseText = await response.text();

    console.log('[test-evolution-connection] Response:', { status: response.status, body: responseText.substring(0, 500) });

    let responseData;
    try { responseData = JSON.parse(responseText); } catch { responseData = { raw: responseText }; }

    if (!response.ok) {
      console.error('[test-evolution-connection] Error:', responseData);
      return new Response(
        JSON.stringify({
          success: false,
          error: responseData?.message || responseText || 'Connection test failed',
          status: response.status,
          details: responseData,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[test-evolution-connection] Success:', responseData);

    return new Response(
      JSON.stringify({
        success: true,
        data: responseData,
        connectionState: responseData?.instance?.state || responseData?.state || 'unknown',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    console.error('[test-evolution-connection] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
