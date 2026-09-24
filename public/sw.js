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

const VERSAO = "ds-v1";
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
