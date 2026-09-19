import { SEM_CATEGORIA_ID, useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";

/**
 * Aviso das abas que contam atendimento (Agentes, Chats): categoria mora no
 * ticket, então o filtro muda QUAIS atendimentos entram, e a tela precisa dizer.
 */
export function AvisoCategoria() {
  const { categoryIds, subcategoryIds } = useAtendimentoFilter();
  if (categoryIds.length === 0 && subcategoryIds.length === 0) return null;

  const temSem = categoryIds.includes(SEM_CATEGORIA_ID);
  const soSem = temSem && categoryIds.length === 1 && subcategoryIds.length === 0;
  const texto = soSem
    ? "Mostrando só os atendimentos que não viraram ticket categorizado."
    : temSem
      ? "Categoria vem do ticket. Entram os atendimentos das categorias marcadas e também os que não viraram ticket categorizado."
      : "Categoria e subcategoria vêm do ticket. Com esse filtro, só entram os atendimentos que viraram ticket categorizado; os outros ficam fora de todos os números desta aba.";

  return (
    <p className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
      {texto}
    </p>
  );
}
