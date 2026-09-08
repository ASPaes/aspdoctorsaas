import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  patchMetaWindowFromInbound,
  metaWindowQueryKey,
  type MetaWindowState,
} from './useMetaWindow';

const CONV = 'conv-1';

const semear = (estado: Partial<MetaWindowState> | null) => {
  const qc = new QueryClient();
  if (estado) {
    qc.setQueryData<MetaWindowState>(metaWindowQueryKey(CONV), {
      isMeta: true,
      windowOpen: false,
      requiresTemplate: true,
      lastInboundAt: null,
      hoursRemaining: null,
      instanceId: 'inst-1',
      ...estado,
    });
  }
  return qc;
};

const ler = (qc: QueryClient) =>
  qc.getQueryData<MetaWindowState>(metaWindowQueryKey(CONV));

describe('patchMetaWindowFromInbound', () => {
  it('destrava o campo assim que a mensagem do cliente chega', () => {
    const qc = semear({});
    const agora = new Date().toISOString();

    patchMetaWindowFromInbound(qc, CONV, agora);

    const estado = ler(qc)!;
    expect(estado.windowOpen).toBe(true);
    expect(estado.requiresTemplate).toBe(false);
    expect(estado.lastInboundAt).toBe(agora);
    expect(estado.hoursRemaining).toBeGreaterThan(23.9);
  });

  it('ignora inbound mais antiga do que a ja conhecida', () => {
    const recente = new Date(Date.now() - 60_000).toISOString();
    const qc = semear({ windowOpen: true, requiresTemplate: false, lastInboundAt: recente });

    patchMetaWindowFromInbound(qc, CONV, new Date(Date.now() - 600_000).toISOString());

    expect(ler(qc)!.lastInboundAt).toBe(recente);
  });

  it('nao abre janela com mensagem de mais de 24h (catch-up de historico)', () => {
    const qc = semear({});

    patchMetaWindowFromInbound(qc, CONV, new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString());

    expect(ler(qc)!.requiresTemplate).toBe(true);
  });

  it('nao mexe em instancia que nao e Meta', () => {
    const qc = semear({ isMeta: false, windowOpen: true, requiresTemplate: false });

    patchMetaWindowFromInbound(qc, CONV, new Date().toISOString());

    expect(ler(qc)!.lastInboundAt).toBeNull();
  });

  it('nao cria cache do nada quando a query ainda nao rodou', () => {
    const qc = semear(null);

    patchMetaWindowFromInbound(qc, CONV, new Date().toISOString());

    expect(ler(qc)).toBeUndefined();
  });

  it('ignora conversa ou timestamp ausente e data invalida', () => {
    const qc = semear({});

    patchMetaWindowFromInbound(qc, null, new Date().toISOString());
    patchMetaWindowFromInbound(qc, CONV, null);
    patchMetaWindowFromInbound(qc, CONV, 'nao-e-data');

    expect(ler(qc)!.requiresTemplate).toBe(true);
  });
});
