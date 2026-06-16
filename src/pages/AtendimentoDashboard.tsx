export default function AtendimentoDashboard() {
  return (
    <div className="container mx-auto p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Indicadores de atendimento — em construção.
        </p>
      </div>
      <div className="rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
        Em breve: tempo real, performance do agente e SLA.
      </div>
    </div>
  );
}
