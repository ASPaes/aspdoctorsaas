import { createRoot } from "react-dom/client";
import { AuthProvider } from "./contexts/AuthContext";
import App from "./App";
import "./index.css";
import { bootstrapAccentColor } from "@/lib/accentColor";
import { isStaleChunkError, reloadForStaleChunk } from "@/lib/staleChunkReload";
import { registrarServiceWorker, ajustarManifestPeloHost } from "@/lib/pwa";

// Antes do primeiro render: senão o app monta verde e troca de cor quando as
// preferências respondem (DEM-0103).
bootstrapAccentColor();

// PWA: o endereço do chat instala com nome e cores próprios, e o service worker
// é o que faz o telefone oferecer "Instalar aplicativo".
ajustarManifestPeloHost();
registrarServiceWorker();

// Deploy no meio da sessão: o Vite avisa aqui quando o preload de um chunk falha
// (o arquivo com hash antigo já não existe no servidor). Buscar o index.html novo
// é a recuperação certa — a trava de sessão dentro de reloadForStaleChunk impede
// que isso vire loop. Ver src/lib/staleChunkReload.ts.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  reloadForStaleChunk();
});

// Rede de segurança para o import dinâmico que escapa do lazyWithReload
// (import() dentro de handler, por exemplo): a promise rejeitada cai aqui.
window.addEventListener("unhandledrejection", (event) => {
  if (isStaleChunkError(event.reason)) {
    event.preventDefault();
    reloadForStaleChunk();
  }
});

createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <App />
  </AuthProvider>
);
