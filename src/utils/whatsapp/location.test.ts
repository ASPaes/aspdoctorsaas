import { describe, it, expect } from "vitest";
import {
  getMessageLocation,
  isLocationPlaceholderContent,
  googleMapsUrl,
  formatCoords,
} from "./location";

describe("getMessageLocation — campo estruturado", () => {
  it("lê metadata.location", () => {
    expect(getMessageLocation({
      metadata: { source: "self_hosted", location: { latitude: -29.873301, longitude: -51.7102077 } },
      content: "📍 Localização",
    })).toEqual({ latitude: -29.873301, longitude: -51.7102077 });
  });

  it("traz nome, endereço e tempo real", () => {
    expect(getMessageLocation({
      metadata: { location: { latitude: -29.9, longitude: -51.1, name: "Berenice", address: "Av. Piraí", live: true } },
    })).toEqual({ latitude: -29.9, longitude: -51.1, name: "Berenice", address: "Av. Piraí", live: true });
  });

  it("ignora coordenada inválida no metadata", () => {
    expect(getMessageLocation({ metadata: { location: { latitude: 0, longitude: 0 } } })).toBeNull();
    expect(getMessageLocation({ metadata: { location: { latitude: "x", longitude: "y" } } })).toBeNull();
  });
});

describe("getMessageLocation — texto legado da Meta", () => {
  it("recupera as coordenadas do content antigo", () => {
    expect(getMessageLocation({
      metadata: { source: "meta_cloud" },
      content: "📍 Localização: -29.873301,-51.7102077",
    })).toEqual({ latitude: -29.873301, longitude: -51.7102077 });
  });

  // As duas strings abaixo saíram de produção (whatsapp_messages, 01/09/2026):
  // são as únicas mensagens de localização que chegaram com coordenada no texto.
  it("recupera as 2 mensagens reais da Meta que existem no banco", () => {
    expect(getMessageLocation({ content: "📍 Localização: -29.873301,-51.7102077" }))
      .toEqual({ latitude: -29.873301, longitude: -51.7102077 });
    expect(getMessageLocation({ content: "📍 Localização: -29.446760177612,-51.966991424561" }))
      .toEqual({ latitude: -29.446760177612, longitude: -51.966991424561 });
  });

  it("aceita espaço depois da vírgula", () => {
    expect(getMessageLocation({ content: "📍 Localização: -23.5, -46.6" }))
      .toEqual({ latitude: -23.5, longitude: -46.6 });
  });

  it("o campo estruturado tem prioridade sobre o texto", () => {
    expect(getMessageLocation({
      metadata: { location: { latitude: -1, longitude: -2 } },
      content: "📍 Localização: -29.873301,-51.7102077",
    })).toEqual({ latitude: -1, longitude: -2 });
  });

  // Evolution antigo descartava as coordenadas: não há o que recuperar.
  it("devolve null para o rótulo sem números", () => {
    expect(getMessageLocation({ content: "📍 Localização" })).toBeNull();
  });

  it("devolve null para mensagem comum", () => {
    expect(getMessageLocation({ content: "bom dia" })).toBeNull();
    expect(getMessageLocation(null)).toBeNull();
  });
});

describe("isLocationPlaceholderContent", () => {
  it("reconhece o rótulo dos dois webhooks", () => {
    expect(isLocationPlaceholderContent("📍 Localização")).toBe(true);
    expect(isLocationPlaceholderContent("📍 Localização: -29.873301,-51.7102077")).toBe(true);
  });

  it("não esconde texto escrito pelo cliente", () => {
    expect(isLocationPlaceholderContent("📍 Localização da obra é aqui, chega às 9h")).toBe(false);
    expect(isLocationPlaceholderContent("segue a localização")).toBe(false);
    expect(isLocationPlaceholderContent("")).toBe(false);
    expect(isLocationPlaceholderContent(null)).toBe(false);
  });
});

describe("link e formatação", () => {
  it("monta o link universal do Google Maps", () => {
    expect(googleMapsUrl({ latitude: -29.873301, longitude: -51.7102077 }))
      .toBe("https://www.google.com/maps/search/?api=1&query=-29.873301,-51.7102077");
  });

  it("mostra a coordenada sem cauda de zeros", () => {
    expect(formatCoords({ latitude: -29.873301, longitude: -51.7102077 })).toBe("-29.873301, -51.710208");
    expect(formatCoords({ latitude: -23.5, longitude: -46.6 })).toBe("-23.5, -46.6");
  });
});
