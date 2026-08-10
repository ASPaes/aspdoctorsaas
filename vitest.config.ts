import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // _shared das edge functions entra aqui: é TS puro (só Intl/Date), roda no vitest
    // sem Deno e é onde mora regra de negócio que merece teste (horário comercial).
    // A segunda linha pega módulo puro que mora DENTRO de uma function (ex.:
    // evolution-webhook/message-shape.ts). Fica fora do _shared de propósito: o
    // CI deploya todas as functions quando o _shared muda, e só uma quando não.
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "supabase/functions/_shared/**/*.{test,spec}.ts",
      "supabase/functions/*/*.{test,spec}.ts",
    ],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
