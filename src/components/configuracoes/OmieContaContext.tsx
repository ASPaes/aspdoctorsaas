import { createContext, useContext } from "react";

/**
 * Qual conta Omie as abas de Integrações → Omie estão olhando.
 *
 * Um tenant pode ter uma conta Omie por unidade base (Digi Office e Digi Up, hoje). Cada uma tem
 * chave, de/para, espelho e reconciliação próprios, e nada de uma pode aparecer na outra. Quem
 * escolhe é o seletor no topo de OmieIntegrationTab; as sub-abas leem daqui.
 *
 * Por que as edge functions recebem `unidade_base_id` e não o id da conta: elas resolvem a chave
 * por `obter_chave_omie(tenant, unidade)`, que é a RPC que mantém o portão admin-only por dentro.
 * Mandar uma unidade qualquer da conta resolve para a conta certa — a busca é
 * `unidade = ANY(unidades_base_ids)` —, então funciona igual quando uma conta cobre mais de uma
 * unidade. A `recon-omie-escrever` é a exceção e nem usa isso: ela deriva a conta do contrato.
 */
export type OmieConta = {
  id: string;
  ativo: boolean;
  ultimo_status: string;
  ultimo_teste_at: string | null;
  integracao_pausada: boolean;
  unidades_base_ids: number[] | null;
  /** Nome da unidade (ou das unidades) que esta conta atende. Só para exibição. */
  rotulo: string;
};

type OmieContaValor = {
  conta: OmieConta | null;
  /** Quantas contas o tenant tem. 0 = nenhuma integração configurada. */
  totalContas: number;
  /** Unidade representante da conta selecionada — é o que vai no body das functions. */
  unidadeBaseId: number | null;
  /**
   * Pedaço pronto para espalhar no body: `{ ...contaBody }`. Fica vazio quando o tenant tem uma
   * conta só, para o payload continuar idêntico ao de antes do multi-conta.
   */
  contaBody: Record<string, unknown>;
};

const vazio: OmieContaValor = {
  conta: null,
  totalContas: 0,
  unidadeBaseId: null,
  contaBody: {},
};

const OmieContaContext = createContext<OmieContaValor>(vazio);

export function OmieContaProvider({
  conta,
  totalContas,
  children,
}: {
  conta: OmieConta | null;
  totalContas: number;
  children: React.ReactNode;
}) {
  const unidadeBaseId = conta?.unidades_base_ids?.[0] ?? null;
  return (
    <OmieContaContext.Provider
      value={{
        conta,
        totalContas,
        unidadeBaseId,
        // Com uma conta só, não manda nada: o backend cai no caminho de compatibilidade e o
        // comportamento fica igual ao de antes.
        contaBody: totalContas > 1 && unidadeBaseId !== null ? { unidade_base_id: unidadeBaseId } : {},
      }}
    >
      {children}
    </OmieContaContext.Provider>
  );
}

/** Fora do provider devolve o valor vazio em vez de estourar — há telas que chamam o Omie de fora. */
export function useOmieConta() {
  return useContext(OmieContaContext);
}
