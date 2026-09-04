// location.ts — extração de coordenadas de mensagens de localização.
//
// Os três provedores mandam a mesma informação em formatos diferentes:
//   Evolution (Baileys) → message.locationMessage.degreesLatitude/degreesLongitude
//   Meta Cloud          → location.latitude/longitude
//   Z-API               → location.latitude/longitude
//
// Até 09/2026 nenhum deles era lido: o Evolution gravava só o rótulo
// "📍 Localização" e descartava as coordenadas; a Meta escrevia os números
// dentro do `content`, como texto. Em nenhum dos dois o atendente conseguia
// abrir o mapa sem copiar número à mão.

export interface LocationInfo {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
  live?: boolean;
}

/** Envelopes do Baileys que só embrulham a mensagem real. */
function unwrap(message: any): any {
  let m = message;
  for (let i = 0; i < 5 && m; i++) {
    const inner = m.ephemeralMessage?.message
      || m.viewOnceMessage?.message
      || m.viewOnceMessageV2?.message
      || m.viewOnceMessageV2Extension?.message
      || m.documentWithCaptionMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m;
}

/**
 * Coordenada válida. Aceita string ("−29.87" vem assim da Meta) e recusa
 * 0,0: em protobuf o campo ausente vira 0, então o Baileys entrega
 * `degreesLatitude: 0` quando simplesmente não mandou coordenada nenhuma.
 */
function toCoord(v: unknown): number | null {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() ? Number(v) : NaN);
  return Number.isFinite(n) ? n : null;
}

function build(lat: unknown, lng: unknown, name: unknown, address: unknown, live: boolean): LocationInfo | null {
  const latitude = toCoord(lat);
  const longitude = toCoord(lng);
  if (latitude === null || longitude === null) return null;
  if (latitude === 0 && longitude === 0) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const info: LocationInfo = { latitude, longitude };
  if (typeof name === 'string' && name.trim()) info.name = name.trim();
  if (typeof address === 'string' && address.trim()) info.address = address.trim();
  if (live) info.live = true;
  return info;
}

/**
 * Lê a localização do payload bruto do provedor. Devolve `null` quando a
 * mensagem não é de localização ou quando as coordenadas não são utilizáveis.
 */
export function extractLocation(rawPayload: unknown): LocationInfo | null {
  if (!rawPayload || typeof rawPayload !== 'object') return null;
  const raw = rawPayload as any;

  // Evolution/Baileys — `rawPayload` é o `data` do webhook, com a mensagem dentro.
  const msg = unwrap(raw.message ?? raw);
  if (msg && typeof msg === 'object') {
    const loc = msg.locationMessage;
    if (loc) {
      const parsed = build(
        loc.degreesLatitude ?? loc.latitude,
        loc.degreesLongitude ?? loc.longitude,
        loc.name, loc.address, false,
      );
      if (parsed) return parsed;
    }
    const live = msg.liveLocationMessage;
    if (live) {
      const parsed = build(
        live.degreesLatitude ?? live.latitude,
        live.degreesLongitude ?? live.longitude,
        live.name, live.address ?? live.caption, true,
      );
      if (parsed) return parsed;
    }
  }

  // Meta Cloud e Z-API — objeto `location` na raiz.
  const flat = raw.location;
  if (flat && typeof flat === 'object') {
    return build(flat.latitude, flat.longitude, flat.name, flat.address, false);
  }

  return null;
}
