import { prepararImagensColadas } from "./imagensColadas";

const T = "a0000000-0000-0000-0000-000000000001";

describe("imagem colada no corpo", () => {
  it("troca cada imagem subida por cid, na ordem, e mantém o texto em volta", () => {
    const html =
      `<p>Antes</p><p><img src="blob:http://x/1" data-caminho="${T}/emails/aaa.png">depois</p>` +
      `<p><img src="blob:http://x/2" data-caminho="${T}/emails/bbb.jpg"></p>`;
    const r = prepararImagensColadas(html);
    expect(r.pendentes).toBe(0);
    expect(r.imagens).toEqual([
      { path: `${T}/emails/aaa.png`, mime: "image/png", cid: "ds-img-1" },
      { path: `${T}/emails/bbb.jpg`, mime: "image/jpeg", cid: "ds-img-2" },
    ]);
    expect(r.html).toContain('<p>Antes</p><p><img src="cid:ds-img-1"');
    expect(r.html).toContain(">depois</p>");
    expect(r.html).not.toContain("blob:");
  });

  it("conta a que ainda está subindo, sem mandar", () => {
    const r = prepararImagensColadas('<p><img src="blob:http://x/1"></p>');
    expect(r.pendentes).toBe(1);
    expect(r.imagens).toEqual([]);
  });

  it("imagem de fora continua como link; data: e outros esquemas saem", () => {
    const r = prepararImagensColadas('<img src="https://site.com/a.png"><img src="data:image/png;base64,AAAA"><img src="file:///c.png">');
    expect(r.html).toBe('<img src="https://site.com/a.png">');
    expect(r.imagens).toEqual([]);
  });
});
