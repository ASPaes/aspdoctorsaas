/**
 * Botão Sotaque do editor de e-mail (16/09/2026, mockup aprovado).
 * Os estados espelham `supabase/functions/gerar-email-chat/sotaque.ts`, que
 * confere a sigla de novo e guarda as dicas que orientam a IA: mudou um, mude o outro.
 */

export type IntensidadeSotaque = "leve" | "raiz";
export type IdiomaEmail = "en" | "es";
export type TamanhoEmail = "curto" | "detalhado";

/**
 * O que está aplicado no corpo (Sotaque e Ajustar, 16/09/2026). A reescrita
 * sempre parte do texto original guardado aqui, numa chamada só; idioma e
 * sotaque não convivem (sotaque é jeito de falar do português).
 */
export interface AjustesTexto {
  sotaque: { uf: string; intensidade: IntensidadeSotaque } | null;
  idioma: IdiomaEmail | null;
  tamanho: TamanhoEmail | null;
}

export const ROTULO_IDIOMA: Record<IdiomaEmail, string> = { en: "Inglês", es: "Espanhol" };
export const ROTULO_TAMANHO: Record<TamanhoEmail, string> = { curto: "Mais curto", detalhado: "Mais detalhado" };

export const semAjustes = (a: AjustesTexto) => !a.sotaque && !a.idioma && !a.tamanho;

/** próxima combinação quando a pessoa escolhe um sotaque */
export const comSotaque = (a: AjustesTexto, uf: string, intensidade: IntensidadeSotaque): AjustesTexto => ({
  sotaque: { uf, intensidade },
  idioma: null,
  tamanho: a.tamanho,
});

/** clicar no idioma já aplicado tira; escolher um idioma tira o sotaque */
export const alternarIdioma = (a: AjustesTexto, idioma: IdiomaEmail): AjustesTexto =>
  a.idioma === idioma ? { ...a, idioma: null } : { sotaque: null, idioma, tamanho: a.tamanho };

export const alternarTamanho = (a: AjustesTexto, tamanho: TamanhoEmail): AjustesTexto => ({
  ...a,
  tamanho: a.tamanho === tamanho ? null : tamanho,
});

export const SEM_AJUSTES: AjustesTexto = { sotaque: null, idioma: null, tamanho: null };

export const REGIOES: { nome: string; ufs: string[] }[] = [
  { nome: "Sul", ufs: ["PR", "RS", "SC"] },
  { nome: "Sudeste", ufs: ["ES", "MG", "RJ", "SP"] },
  { nome: "Centro-Oeste", ufs: ["DF", "GO", "MS", "MT"] },
  { nome: "Nordeste", ufs: ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"] },
  { nome: "Norte", ufs: ["AC", "AM", "AP", "PA", "RO", "RR", "TO"] },
];

export const NOME_ESTADO: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AM: "Amazonas", AP: "Amapá", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal",
  ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MG: "Minas Gerais", MS: "Mato Grosso do Sul", MT: "Mato Grosso",
  PA: "Pará", PB: "Paraíba", PE: "Pernambuco", PI: "Piauí", PR: "Paraná", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RO: "Rondônia", RR: "Roraima", RS: "Rio Grande do Sul", SC: "Santa Catarina", SE: "Sergipe", SP: "São Paulo", TO: "Tocantins",
};

/** uma amostra para a pessoa ter ideia antes de gastar IA */
export const EXEMPLO_ESTADO: Record<string, string> = {
  AL: "oxe, vixe", AM: "mano, égua", AP: "égua, maninho", BA: "oxe, massa, meu rei", CE: "macho, arretado",
  DF: "véi, massa", GO: "uai, trem", MA: "égua, rapaz", MG: "uai, trem, sô, bão", MT: "pau rodado, tchá por Deus",
  PA: "égua, pai d'égua", PB: "oxe, visse", PE: "oxente, massa, visse", PI: "oxe, rapaz", PR: "piá, daí",
  RJ: "mermão, caraca, maneiro", RN: "oxe, massa", RS: "bah, tchê, tri", SC: "bah, ó", SE: "oxe, vixe",
  SP: "meu, mano, da hora", TO: "uai, égua",
};

export const siglaValida = (uf: string | null | undefined): uf is string => !!uf && uf.toUpperCase() in NOME_ESTADO;
