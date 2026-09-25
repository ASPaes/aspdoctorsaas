import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { CalendarClock, LayoutDashboard, Receipt } from 'lucide-react';
import PainelCobrancaTab from '@/components/financeiro/PainelCobrancaTab';
import TitulosTab from '@/components/financeiro/TitulosTab';
import ReguaTab from '@/components/financeiro/ReguaTab';

/**
 * Financeiro.
 *
 * Mostra o que a empresa tem a receber, lido do sistema de cobrança dela
 * (Omie hoje) e guardado em fin_titulos, e a régua de cobrança.
 *
 * ⚠️ A régua ainda NÃO envia: o motor só simula. A própria aba diz isso no
 * topo, porque quem abre esta página precisa saber se tem robô falando com
 * cliente sem ter que perguntar a ninguém.
 */
export default function Financeiro() {
  const [aba, setAba] = useState('painel');

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Financeiro</h1>
          <p className="text-sm text-muted-foreground">
            Títulos a receber e situação da cobrança, por empresa.
          </p>
        </div>
        <Badge variant="secondary" className="text-xs">
          Em desenvolvimento
        </Badge>
      </div>

      <Tabs value={aba} onValueChange={setAba}>
        <TabsList>
          <TabsTrigger value="painel" className="gap-1.5">
            <LayoutDashboard className="h-4 w-4" />
            Painel de cobrança
          </TabsTrigger>
          <TabsTrigger value="titulos" className="gap-1.5">
            <Receipt className="h-4 w-4" />
            Títulos
          </TabsTrigger>
          <TabsTrigger value="regua" className="gap-1.5">
            <CalendarClock className="h-4 w-4" />
            Régua de cobrança
          </TabsTrigger>
        </TabsList>

        <TabsContent value="painel" className="mt-4">
          <PainelCobrancaTab />
        </TabsContent>
        <TabsContent value="titulos" className="mt-4">
          <TitulosTab />
        </TabsContent>
        <TabsContent value="regua" className="mt-4">
          <ReguaTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
