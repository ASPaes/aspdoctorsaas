import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { normalizeBRPhone } from './phone.ts';

const p = (raw: string) => normalizeBRPhone(raw).phone;

Deno.test('celular BR sem 55 ganha 55', () => {
  assertEquals(p('14991234567'), '5514991234567');
  assertEquals(p('(11) 98765-4321'), '5511987654321');
});

Deno.test('fixo BR sem 55 ganha 55', () => {
  assertEquals(p('1437264877'), '551437264877');
  assertEquals(normalizeBRPhone('1437264877').isLandline, true);
});

Deno.test('numero BR com 55 fica como esta', () => {
  assertEquals(p('5514991234567@s.whatsapp.net'), '5514991234567');
  assertEquals(p('551437264877'), '551437264877');
});

// DEM-0427: +1 (437) 264-8778 era gravado 5514372648778 e nenhum envio saia.
Deno.test('EUA/Canada (+1) nao vira DDD brasileiro', () => {
  assertEquals(p('14372648778'), '14372648778');
  assertEquals(p('14372648778@s.whatsapp.net'), '14372648778');
  assertEquals(p('19177174078'), '19177174078');
});

Deno.test('Australia (+61 4…) nao vira DDD brasileiro', () => {
  assertEquals(p('61414763610'), '61414763610');
});

Deno.test('grupo e LID nao ganham 55', () => {
  assertEquals(p('120363123456789012@g.us'), '120363123456789012');
  assertEquals(p('123456789012345@lid'), '123456789012345');
});
