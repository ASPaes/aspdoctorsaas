import { describe, it, expect } from "vitest";
import { extractLocation } from "./location.ts";

describe("extractLocation — Evolution (Baileys)", () => {
  it("lê degreesLatitude/degreesLongitude do locationMessage", () => {
    expect(extractLocation({
      key: { id: "X" },
      message: { locationMessage: { degreesLatitude: -29.873301, degreesLongitude: -51.7102077 } },
    })).toEqual({ latitude: -29.873301, longitude: -51.7102077 });
  });

  it("traz nome e endereço quando o app manda", () => {
    expect(extractLocation({
      message: {
        locationMessage: {
          degreesLatitude: -29.9, degreesLongitude: -51.1,
          name: "Berenice", address: "Av. Piraí, São Cristóvão",
        },
      },
    })).toEqual({
      latitude: -29.9, longitude: -51.1,
      name: "Berenice", address: "Av. Piraí, São Cristóvão",
    });
  });

  it("marca live=true na localização em tempo real", () => {
    expect(extractLocation({
      message: { liveLocationMessage: { degreesLatitude: -30.03, degreesLongitude: -51.23 } },
    })).toEqual({ latitude: -30.03, longitude: -51.23, live: true });
  });

  it("atravessa envelope efêmero", () => {
    expect(extractLocation({
      message: { ephemeralMessage: { message: { locationMessage: { degreesLatitude: -1.5, degreesLongitude: -2.5 } } } },
    })).toEqual({ latitude: -1.5, longitude: -2.5 });
  });

  // Em protobuf campo ausente vira 0. Sem esta guarda toda localização vazia
  // do Baileys viraria um pino na Ilha Nula, no golfo da Guiné.
  it("recusa 0,0 (campo ausente no protobuf)", () => {
    expect(extractLocation({ message: { locationMessage: { degreesLatitude: 0, degreesLongitude: 0 } } })).toBeNull();
  });

  it("recusa locationMessage sem coordenada", () => {
    expect(extractLocation({ message: { locationMessage: {} } })).toBeNull();
  });
});

describe("extractLocation — Meta Cloud e Z-API", () => {
  it("lê location.latitude/longitude", () => {
    expect(extractLocation({
      id: "wamid.X", type: "location",
      location: { latitude: -29.873301, longitude: -51.7102077 },
    })).toEqual({ latitude: -29.873301, longitude: -51.7102077 });
  });

  it("aceita coordenada em string", () => {
    expect(extractLocation({ location: { latitude: "-29.873301", longitude: "-51.7102077" } }))
      .toEqual({ latitude: -29.873301, longitude: -51.7102077 });
  });

  it("traz nome e endereço", () => {
    expect(extractLocation({
      location: { latitude: -23.5, longitude: -46.6, name: "Sede", address: "Rua X, 100" },
    })).toEqual({ latitude: -23.5, longitude: -46.6, name: "Sede", address: "Rua X, 100" });
  });
});

describe("extractLocation — o que não é localização", () => {
  it("devolve null para mensagem de texto", () => {
    expect(extractLocation({ message: { conversation: "bom dia" } })).toBeNull();
  });

  it("devolve null para payload vazio ou inválido", () => {
    expect(extractLocation(null)).toBeNull();
    expect(extractLocation(undefined)).toBeNull();
    expect(extractLocation("texto")).toBeNull();
    expect(extractLocation({})).toBeNull();
  });

  it("recusa coordenada fora do intervalo", () => {
    expect(extractLocation({ location: { latitude: 91, longitude: 0 } })).toBeNull();
    expect(extractLocation({ location: { latitude: 0, longitude: -181 } })).toBeNull();
  });

  it("recusa coordenada não numérica", () => {
    expect(extractLocation({ location: { latitude: "abc", longitude: "def" } })).toBeNull();
  });
});
