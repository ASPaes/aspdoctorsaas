/*
 * Service worker do DoctorSaaS — o que falta para o telefone oferecer "Instalar
 * aplicativo". Sem um fetch handler o Chrome não considera o site instalável,
 * por mais completo que o manifest esteja.
 *
 * ⚠️ POR QUE ELE É DELIBERADAMENTE CONSERVADOR
 * O deploy aqui é contínuo (push na main publica), e o app já tem o
 * staleChunkReload para o caso de um chunk sumir no meio da sessão. Um service
 * worker que guardasse HTML deixaria o operador preso numa versão antiga
 * exatamente quando uma correção acabou de subir — o oposto do que se quer num
 * chat de atendimento. Por isso:
 *
 *  - HTML/navegação: SEMPRE da rede. O cache só entra quando a rede falha, para
 *    a tela não virar dinossauro do Chrome no elevador.
 *  - /assets/*: cache primeiro, porque o nome traz hash — index-CUHjdPCr.js só
 *    existe com aquele conteúdo. Arquivo novo tem nome novo.
 *  - Supabase, APIs e qualquer método que não seja GET: passa direto, sem tocar.
 *    Mensagem de chat não pode vir de cache.
 */

const VERSAO = "ds-v3";
const CASCA = `casca-${VERSAO}`;
const ARQUIVOS = `arquivos-${VERSAO}`;

self.addEventListener("install", (evento) => {
  // Entra em vigor sem esperar a aba antiga fechar: o operador não fecha o chat.
  self.skipWaiting();
  evento.waitUntil(
    caches.open(CASCA).then((c) => c.addAll(["/", "/favicon.svg"]).catch(() => {}))
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nomes) =>
        Promise.all(nomes.filter((n) => !n.endsWith(VERSAO)).map((n) => caches.delete(n)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (evento) => {
  const req = evento.request;

  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Só o próprio site. Supabase (dados, realtime, storage) nunca passa por aqui.
  if (url.origin !== self.location.origin) return;

  // Navegação: rede primeiro, cache como rede de segurança offline.
  if (req.mode === "navigate") {
    evento.respondWith(
      fetch(req)
        .then((resp) => {
          const copia = resp.clone();
          caches.open(CASCA).then((c) => c.put("/", copia)).catch(() => {});
          return resp;
        })
        .catch(() => caches.match("/").then((r) => r ?? Response.error()))
    );
    return;
  }

  // Arquivos com hash no nome: imutáveis, cache primeiro.
  if (url.pathname.startsWith("/assets/")) {
    evento.respondWith(
      caches.match(req).then(
        (cacheado) =>
          cacheado ??
          fetch(req).then((resp) => {
            if (resp.ok) {
              const copia = resp.clone();
              caches.open(ARQUIVOS).then((c) => c.put(req, copia)).catch(() => {});
            }
            return resp;
          })
      )
    );
  }
});

// A página manda "atualiza agora" quando detecta versão nova (ver src/lib/pwa.ts).
self.addEventListener("message", (evento) => {
  if (evento.data === "atualizar-agora") self.skipWaiting();
});

/*
 * Clique na notificação da barra. Sem este handler o toque na notificação não
 * faz nada — e é o service worker quem precisa responder, porque a notificação
 * agora é criada por ele (ver src/lib/notificacaoDoSistema.ts).
 *
 * Foca a aba que já está aberta em vez de abrir outra, como o WhatsApp: abrir
 * uma segunda janela do chat deixa duas conexões de tempo real no ar e o
 * atendente sem saber qual das duas está atualizada.
 */
self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  const destino = (evento.notification.data && evento.notification.data.url) || "/";

  evento.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((janelas) => {
      for (const janela of janelas) {
        if ("focus" in janela) {
          // navigate() falha em alguns casos (janela em outro escopo); focar já
          // resolve o essencial, que é trazer o chat para a frente.
          janela.navigate?.(destino)?.catch(() => {});
          return janela.focus();
        }
      }
      return self.clients.openWindow(destino);
    })
  );
});

/*
 * Chegada de Web Push — o aviso com o app FECHADO.
 *
 * Diferente do `showNotification` chamado pela página, aqui quem está rodando é
 * só o service worker: a página pode nem existir. Por isso todo o conteúdo do
 * aviso vem dentro do push, já criptografado pelo servidor.
 *
 * `userVisibleOnly: true` é a promessa feita na inscrição: TODO push precisa
 * virar algo visível. Se o payload vier vazio ou quebrado, ainda assim mostramos
 * um aviso genérico — sem isso o Chrome pune a origem e passa a descartar os
 * próximos.
 */
self.addEventListener("push", (evento) => {
  let dados = {};
  try {
    dados = evento.data ? evento.data.json() : {};
  } catch (_) {
    dados = {};
  }

  const titulo = dados.titulo || "Nova mensagem";
  const opcoes = {
    body: dados.corpo || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: dados.tag || "chat",
    renotify: true,
    data: { url: dados.url || "/" },
  };

  evento.waitUntil(self.registration.showNotification(titulo, opcoes));
});
