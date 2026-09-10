import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { History, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateLabel, formatTime } from "@/lib/formatDateWithTimezone";

const TZ = "America/Sao_Paulo";

// Só o que é ação desta tela. Um audit_events com tudo dentro vira lixo visual:
// o WHATSAPP_MARK_BUCKET_READ sozinho são 797 linhas.
const EVENTOS = [
  "profiles.insert",
  "profiles.update",
  "funcionarios.update",
  "user_permissions.update",
  "unidades.update",
  "LOGIN_EMAIL_CHANGED",
  "ACCESS_INVITE_CREATED",
  "ACCESS_INVITE_ACCEPTED",
  "ACCESS_INVITE_CANCELED",
] as const;

const LABEL_CAMPO: Record<string, string> = {
  role: "Papel",
  access_status: "Acesso",
  status: "Status",
  funcionario_id: "Funcionário vinculado",
  tenant_id: "Tenant",
  max_concurrent_chats: "Limite de chats",
  skills: "Competências",
  acesso_todas_unidades: "Todas as unidades",
  is_super_admin: "Super admin",
  department_id: "Setor",
  funcionario_email: "E-mail de contato",
  funcionario_ativo: "Funcionário ativo",
  funcionario_nome: "Nome do funcionário",
  funcionario_cargo: "Cargo",
  // Fallback das 164 linhas antigas, gravadas quando módulos era o único
  // acesso desta coluna e o metadata podia não trazer o recurso.
  permissao: "Permissão de módulos",
  unidades: "Unidades",
  email_de_login: "E-mail de acesso",
};

// A coluna Integração guarda mais de um acesso desde 09/09/2026. Sem isto, a
// linha de qualquer um deles saía como "Permissão de módulos", e o histórico
// não distinguia quem liberou aprovação do OEM de quem liberou módulos.
const LABEL_RECURSO: Record<string, string> = {
  "clientes.modulos": "Integração · Módulos",
  "clientes.oem_aprovacao": "Integração · Aprovação OEM",
};

const LABEL_EVENTO: Record<string, string> = {
  "profiles.insert": "Usuário criado",
  "profiles.update": "Usuário alterado",
  "funcionarios.update": "Funcionário alterado",
  "user_permissions.update": "Permissão alterada",
  "unidades.update": "Unidades alteradas",
  LOGIN_EMAIL_CHANGED: "E-mail de acesso alterado",
  ACCESS_INVITE_CREATED: "Convite enviado",
  ACCESS_INVITE_ACCEPTED: "Convite aceito",
  ACCESS_INVITE_CANCELED: "Convite cancelado",
};

interface AuditRow {
  id: string;
  created_at: string;
  event_type: string;
  actor_user_id: string | null;
  target_user_id: string | null;
  metadata: Record<string, any> | null;
}

interface LinhaHistorico {
  key: string;
  created_at: string;
  event_type: string;
  actor_user_id: string | null;
  target_user_id: string | null;
  campo: string;
  antes: string;
  depois: string;
}

export interface HistoricoUser {
  user_id: string;
  funcionario_nome: string | null;
  email: string | null;
}

/** Converte o valor cru do metadata em algo legível na tela. */
function formatarValor(campo: string, valor: any, unidades: Map<number, string>): string {
  // Permissão sem linha não é "vazio": quem decidia era o papel da pessoa. Vem
  // antes da guarda de nulo porque a primeira liberação de alguém sempre tem
  // `de: null`, e "vazio → Liberado" não diz de onde ela saiu.
  if (campo === "permissao" && (valor === null || valor === undefined)) {
    return "Definido pelo papel";
  }

  if (valor === null || valor === undefined) return "vazio";

  if (campo === "unidades" && typeof valor === "object") {
    if (valor.todas) return "Todas as unidades";
    const ids: number[] = Array.isArray(valor.ids) ? valor.ids : [];
    if (ids.length === 0) return "nenhuma";
    return ids.map((id) => unidades.get(id) ?? `#${id}`).join(", ");
  }

  // O setor é gravado com id e nome juntos, para o histórico não virar um id
  // órfão quando alguém renomear ou apagar o setor depois.
  if (campo === "department_id" && typeof valor === "object") {
    return valor.nome ?? (valor.id ? `#${valor.id}` : "vazio");
  }

  if (campo === "permissao" && typeof valor === "object") {
    return (valor.can_view ?? valor.view) ? "Liberado" : "Bloqueado";
  }

  if (Array.isArray(valor)) return valor.length ? valor.join(", ") : "nenhuma";
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  return String(valor);
}

/** Uma linha por campo alterado. O evento pode ter mexido em vários de uma vez. */
function expandir(row: AuditRow, unidades: Map<number, string>): LinhaHistorico[] {
  const base = {
    created_at: row.created_at,
    event_type: row.event_type,
    actor_user_id: row.actor_user_id,
    target_user_id: row.target_user_id,
  };
  const meta = row.metadata ?? {};

  // Nome do campo. Permissão é o único que depende do recurso: a coluna
  // Integração guarda mais de um, e sem isso todos virariam a mesma linha.
  const nomeCampo = (campo: string): string => {
    if (campo === "permissao" && typeof meta.resource_key === "string") {
      return LABEL_RECURSO[meta.resource_key] ?? `Integração · ${meta.resource_key}`;
    }
    return LABEL_CAMPO[campo] ?? campo;
  };

  // Formato novo: {"changes": {"campo": {"de": x, "para": y}}}
  if (meta.changes && typeof meta.changes === "object") {
    return Object.entries(meta.changes as Record<string, any>).map(([campo, val], i) => ({
      ...base,
      key: `${row.id}-${i}`,
      campo: nomeCampo(campo),
      antes: formatarValor(campo, val?.de, unidades),
      depois: formatarValor(campo, val?.para, unidades),
    }));
  }

  // Formato antigo, das 164 linhas gravadas antes de setembro/2026:
  // {"old": {...}, "new": {...}} com todos os campos, mudados ou não.
  if (meta.old && meta.new) {
    const campos = Array.from(
      new Set([...Object.keys(meta.old), ...Object.keys(meta.new)])
    ).filter((c) => JSON.stringify(meta.old[c]) !== JSON.stringify(meta.new[c]));
    return campos.map((campo, i) => ({
      ...base,
      key: `${row.id}-${i}`,
      campo: nomeCampo(campo),
      antes: formatarValor(campo, meta.old[campo], unidades),
      depois: formatarValor(campo, meta.new[campo], unidades),
    }));
  }

  // Eventos sem par de/para (convite enviado, aceito, cancelado, criação).
  const detalhe = meta.email ?? meta.role ?? meta.access_status ?? null;
  return [
    {
      ...base,
      key: row.id,
      campo: LABEL_EVENTO[row.event_type] ?? row.event_type,
      antes: "—",
      depois: detalhe ? String(detalhe) : "—",
    },
  ];
}

export function HistoricoAcessosDialog({
  open,
  onOpenChange,
  tenantId,
  users,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string | null;
  users: HistoricoUser[];
}) {
  const [filtroUsuario, setFiltroUsuario] = useState<string>("todos");
  const [busca, setBusca] = useState("");

  const { data: unidadesRows } = useQuery({
    queryKey: ["historico-acessos-unidades", tenantId],
    enabled: open,
    queryFn: async () => {
      let q = (supabase.from("unidades_base" as any) as any).select("id, nome");
      if (tenantId) q = q.eq("tenant_id", tenantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Array<{ id: number; nome: string }>;
    },
  });

  const unidades = useMemo(
    () => new Map((unidadesRows ?? []).map((u) => [u.id, u.nome])),
    [unidadesRows]
  );

  const { data: rows, isLoading, error } = useQuery({
    queryKey: ["historico-acessos", tenantId],
    enabled: open,
    queryFn: async () => {
      let q = supabase
        .from("audit_events")
        .select("id, created_at, event_type, actor_user_id, target_user_id, metadata")
        .in("event_type", EVENTOS as unknown as string[])
        .order("created_at", { ascending: false })
        .limit(500);
      // Super admin com "Todos" não passa tenant: quem filtra é o RLS.
      if (tenantId) q = q.eq("tenant_id", tenantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as AuditRow[];
    },
  });

  const nomePorUserId = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.user_id, u.funcionario_nome ?? u.email ?? u.user_id);
    return m;
  }, [users]);

  // Ator de fora do tenant é o suporte simulando o tenant. O RLS esconde o
  // profile dele, então o nome não tem como ser resolvido aqui.
  const nomeAtor = (id: string | null) =>
    id ? nomePorUserId.get(id) ?? "Suporte (fora do tenant)" : "Sistema";

  const linhas = useMemo(() => {
    const todas = (rows ?? []).flatMap((r) => expandir(r, unidades));
    const termo = busca.trim().toLowerCase();
    return todas.filter((l) => {
      if (filtroUsuario !== "todos" && l.target_user_id !== filtroUsuario) return false;
      if (!termo) return true;
      const alvo = [
        l.campo,
        l.antes,
        l.depois,
        nomeAtor(l.actor_user_id),
        l.target_user_id ? nomePorUserId.get(l.target_user_id) ?? "" : "",
      ]
        .join(" ")
        .toLowerCase();
      return alvo.includes(termo);
    });
  }, [rows, unidades, busca, filtroUsuario, nomePorUserId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Histórico de alterações
          </DialogTitle>
          <DialogDescription>
            Toda alteração de acesso, papel, setor, unidade, limite, competências, módulos e
            e-mail de login, com quem fez e o valor antes e depois.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={filtroUsuario} onValueChange={setFiltroUsuario}>
            <SelectTrigger className="w-full sm:w-64">
              <SelectValue placeholder="Todos os usuários" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os usuários</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.user_id} value={u.user_id}>
                  {u.funcionario_nome ?? u.email ?? u.user_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Buscar no histórico..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="w-full sm:max-w-xs"
          />
          <span className="text-xs text-muted-foreground sm:ml-auto">
            {linhas.length} {linhas.length === 1 ? "alteração" : "alterações"}
          </span>
        </div>

        <div className="max-h-[60vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="w-36">Quando</TableHead>
                <TableHead>Quem fez</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>O que mudou</TableHead>
                <TableHead>Antes</TableHead>
                <TableHead>Depois</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin inline" />
                  </TableCell>
                </TableRow>
              )}
              {error && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-destructive text-sm">
                    Erro ao carregar o histórico: {(error as any)?.message}
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && !error && linhas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-sm text-muted-foreground">
                    Nenhuma alteração registrada ainda.
                  </TableCell>
                </TableRow>
              )}
              {linhas.map((l) => (
                <TableRow key={l.key}>
                  <TableCell className="text-xs whitespace-nowrap">
                    {formatDateLabel(l.created_at, TZ)}
                    <span className="text-muted-foreground ml-1">
                      {formatTime(l.created_at, TZ)}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">{nomeAtor(l.actor_user_id)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {l.target_user_id ? nomePorUserId.get(l.target_user_id) ?? "—" : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    <Badge variant="outline" className="font-normal">
                      {l.campo}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-48 truncate">
                    {l.antes}
                  </TableCell>
                  <TableCell className="text-xs font-medium max-w-48 truncate">
                    {l.depois}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <p className="text-xs text-muted-foreground">
          Mostrando as 500 alterações mais recentes.
        </p>
      </DialogContent>
    </Dialog>
  );
}
