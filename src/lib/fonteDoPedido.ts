// De onde veio um pedido que nenhuma pessoa daqui digitou.
//
// `usuario_id` responde "quem" e vem nulo quando a escrita chegou por
// integração (service_role não tem `auth.uid()`). Sem este de-para, a tela
// mostra um traço para uma venda real, ou — pior — cai no rótulo da carga do
// espelho e afirma que a máquina mexeu na licença de um cliente por conta
// própria.
//
// O banco guarda o FATO (`cliente_produto_modulo_eventos.fonte`,
// `oem_sync_fila.payload->>'fonte'`); o rótulo mora aqui, junto dos outros.
export const ORIGEM_DO_PEDIDO: Record<string, string> = {
  calculadora: "Integração Calculadora",
};

export const rotuloDaFonte = (fonte: string | null | undefined): string | null =>
  (fonte && ORIGEM_DO_PEDIDO[fonte]) || null;
