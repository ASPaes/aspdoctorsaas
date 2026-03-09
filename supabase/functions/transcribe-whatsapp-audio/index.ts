import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const FUNCTION_NAME = 'transcribe-whatsapp-audio';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    if (!lovableApiKey) {
      console.error(`[${FUNCTION_NAME}][${requestId}] LOVABLE_API_KEY not configured`);
      return new Response(JSON.stringify({ error: 'AI service not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { messageId } = await req.json();

    if (!messageId) {
      return new Response(JSON.stringify({ error: 'messageId is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[${FUNCTION_NAME}][${requestId}] Starting transcription for message: ${messageId}`);

    // Mark as processing
    await supabase
      .from('whatsapp_messages')
      .update({ transcription_status: 'processing' })
      .eq('id', messageId);

    // Fetch message details
    const { data: message, error: msgError } = await supabase
      .from('whatsapp_messages')
      .select('id, media_url, media_mimetype, message_type, conversation_id')
      .eq('id', messageId)
      .single();

    if (msgError || !message) {
      console.error(`[${FUNCTION_NAME}][${requestId}] Message not found:`, msgError);
      return new Response(JSON.stringify({ error: 'Message not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (message.message_type !== 'audio') {
      console.log(`[${FUNCTION_NAME}][${requestId}] Not an audio message, skipping`);
      return new Response(JSON.stringify({ message: 'Not an audio message' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!message.media_url) {
      console.error(`[${FUNCTION_NAME}][${requestId}] No media_url for message`);
      await supabase.from('whatsapp_messages').update({ transcription_status: 'failed' }).eq('id', messageId);
      return new Response(JSON.stringify({ error: 'No media URL' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Download audio from Supabase Storage
    const mediaPath = message.media_url;
    console.log(`[${FUNCTION_NAME}][${requestId}] Downloading audio from storage: ${mediaPath}`);

    const { data: fileData, error: downloadError } = await supabase.storage
      .from('whatsapp-media')
      .download(mediaPath);

    if (downloadError || !fileData) {
      console.error(`[${FUNCTION_NAME}][${requestId}] Download error:`, downloadError);
      await supabase.from('whatsapp_messages').update({ transcription_status: 'failed' }).eq('id', messageId);
      return new Response(JSON.stringify({ error: 'Failed to download audio' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Convert to base64
    const arrayBuffer = await fileData.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64Audio = btoa(binary);

    const mimetype = message.media_mimetype || 'audio/ogg';
    console.log(`[${FUNCTION_NAME}][${requestId}] Audio downloaded, size: ${bytes.length} bytes, mime: ${mimetype}`);

    // Send to Gemini for transcription via multimodal
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: 'Você é um transcritor de áudio. Transcreva o áudio fornecido de forma precisa, mantendo o idioma original. Retorne APENAS o texto transcrito, sem formatação, sem aspas, sem prefixos como "Transcrição:" ou "Texto:". Se o áudio estiver inaudível ou vazio, retorne "[áudio inaudível]".'
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: {
                  data: base64Audio,
                  format: mimetype.includes('ogg') ? 'ogg' :
                         mimetype.includes('mp3') || mimetype.includes('mpeg') ? 'mp3' :
                         mimetype.includes('wav') ? 'wav' :
                         mimetype.includes('mp4') ? 'mp4' : 'ogg'
                }
              },
              {
                type: 'text',
                text: 'Transcreva este áudio.'
              }
            ]
          }
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error(`[${FUNCTION_NAME}][${requestId}] AI error ${aiResponse.status}:`, errorText);
      await supabase.from('whatsapp_messages').update({ transcription_status: 'failed' }).eq('id', messageId);
      return new Response(JSON.stringify({ error: 'Transcription failed' }), {
        status: aiResponse.status === 429 ? 429 : aiResponse.status === 402 ? 402 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const aiData = await aiResponse.json();
    const transcription = aiData.choices?.[0]?.message?.content?.trim();

    if (!transcription) {
      console.error(`[${FUNCTION_NAME}][${requestId}] Empty transcription from AI`);
      await supabase.from('whatsapp_messages').update({ transcription_status: 'failed' }).eq('id', messageId);
      return new Response(JSON.stringify({ error: 'Empty transcription' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Save transcription
    const { error: updateError } = await supabase
      .from('whatsapp_messages')
      .update({
        audio_transcription: transcription,
        transcription_status: 'completed',
      })
      .eq('id', messageId);

    if (updateError) {
      console.error(`[${FUNCTION_NAME}][${requestId}] Error saving transcription:`, updateError);
      return new Response(JSON.stringify({ error: 'Failed to save transcription' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`[${FUNCTION_NAME}][${requestId}] Transcription saved successfully (${transcription.length} chars)`);

    return new Response(
      JSON.stringify({ success: true, transcription }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error(`[${FUNCTION_NAME}][${requestId}] Unexpected error:`, error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
