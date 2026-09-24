import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.85.0";
import webpush from "npm:web-push@3.6.7";

/**
 * Envia o aviso de mensagem para os aparelhos inscritos — é o que faz o telefone
 * avisar com o app FECHADO.
 *
 * Quem dispara é o gatilho de `notification_recipients`: toda notificação que já
 * passou pela régua (quiet hours, preferências, escopo de tenant) chega aqui só
 * para virar push. **Nenhuma decisão de "deve ou não avisar" mora nesta
 * função** — duplicar essa régua aqui seria a forma mais rápida de mandar
 * WhatsApp às 3 da manhã.
 *
 * Assinatura morta é apagada na hora: quando o serviço do navegador responde
 * 404 ou 410, aquele endpoint não existe mais (app desinstalado, dados
 * limpos). Guardá-lo só faria a próxima rodada falhar de novo.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOG = "[send-web-push]";

interface Assinatura {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const publica = Deno.env.get("VAPID_PUBLIC_KEY");
    const privada = Deno.env.get("VAPID_PRIVATE_KEY");
    const contato = Deno.env.get("VAPID_SUBJECT") ?? "mailto:suporte@doctorsaas.com.br";

    if (!publica || !privada) {
      console.error(`${LOG} chaves VAPID ausentes nos secrets`);
      return new Response(JSON.stringify({ error: "VAPID não configurado" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    webpush.setVapidDetails(contato, publica, privada);

    // SÓ o id do destinatário. O conteúdo vem do banco, nunca do corpo da
    // requisição: o gatilho do Postgres chama esta function com a chave anon,
    // que é pública (está no .env do repositório), então aceitar título e texto
    // livres deixaria qualquer um mandar aviso falso para o aparelho de um
    // atendente. Com só o id, o pior que alguém consegue é reenviar um aviso
    // que já existe — e ainda precisaria adivinhar o UUID.
    const { recipient_id } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let destinatario: string | undefined;
    let tituloFinal: string | undefined;
    let corpoFinal: string | undefined;
    let urlFinal: string | undefined;
    let tagFinal: string | undefined;

    if (!recipient_id) {
      return new Response(JSON.stringify({ error: "recipient_id obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    {
      const { data, error } = await supabase
        .from("notification_recipients")
        .select("user_id, notifications(title, body, action_url, conversation_id)")
        .eq("id", recipient_id)
        .maybeSingle();

      if (error || !data) {
        console.error(`${LOG} destinatário não encontrado`, recipient_id, error);
        return new Response(JSON.stringify({ enviados: 0, motivo: "destinatario_inexistente" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const n = (data as any).notifications;
      destinatario = (data as any).user_id;
      tituloFinal = n?.title ?? "Nova mensagem";
      corpoFinal = n?.body ?? "";
      urlFinal = n?.action_url ?? "/";
      tagFinal = n?.conversation_id ? `chat-${n.conversation_id}` : `notif-${recipient_id}`;
    }

    if (!destinatario) {
      return new Response(JSON.stringify({ error: "sem destinatário" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: assinaturas } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", destinatario);

    if (!assinaturas?.length) {
      return new Response(JSON.stringify({ enviados: 0, motivo: "sem_aparelho_inscrito" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const conteudo = JSON.stringify({
      titulo: tituloFinal ?? "Nova mensagem",
      corpo: corpoFinal ?? "",
      url: urlFinal ?? "/",
      tag: tagFinal ?? "chat",
    });

    let enviados = 0;
    const removidas: string[] = [];

    for (const a of assinaturas as Assinatura[]) {
      try {
        await webpush.sendNotification(
          { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
          conteudo,
          // TTL: aviso de atendimento não vale mais depois de meia hora. Sem
          // isso o serviço guarda por dias e entrega fora de contexto.
          { TTL: 1800, urgency: "high" },
        );
        enviados++;
        await supabase
          .from("push_subscriptions")
          .update({ last_success_at: new Date().toISOString(), failures: 0, last_error: null })
          .eq("id", a.id);
      } catch (err) {
        const status = (err as any)?.statusCode;
        if (status === 404 || status === 410) {
          removidas.push(a.id);
        } else {
          console.error(`${LOG} falha ao enviar`, a.id, status, (err as any)?.message);
          await supabase
            .from("push_subscriptions")
            .update({ last_error: String((err as any)?.message ?? err).slice(0, 300) })
            .eq("id", a.id);
        }
      }
    }

    if (removidas.length) {
      await supabase.from("push_subscriptions").delete().in("id", removidas);
      console.log(`${LOG} ${removidas.length} assinatura(s) morta(s) removida(s)`);
    }

    return new Response(JSON.stringify({ enviados, removidas: removidas.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(`${LOG} erro`, err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
