// Regras de reserva do lado do navegador.  node --test testes/reserva.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const ReservaLogica = require("../reserva.js");

const T = 1_800_000_000_000;
const minha = { codigo: "C0DE1234", cliente: "Pedido 9", ids: [1, 2], expira: T + 7200000 };

test("barra é minha só se está na minha reserva E o servidor mostra a mesma validade", () => {
  assert.equal(ReservaLogica.pertence({ id: 1, reserva: { ate: T + 7200000 } }, minha), true);
  // liberada pelo operador e reservada por outro vendedor: validade diferente
  assert.equal(ReservaLogica.pertence({ id: 1, reserva: { ate: T + 9000000 } }, minha), false);
  // fora da lista local
  assert.equal(ReservaLogica.pertence({ id: 3, reserva: { ate: T + 7200000 } }, minha), false);
  assert.equal(ReservaLogica.pertence({ id: 1, reserva: { ate: T + 7200000 } }, null), false);
});

test("cliente confere ignorando maiúsculas e espaços; vazio nunca confere", () => {
  assert.equal(ReservaLogica.clienteConfere("  pedido   9 ", minha), true);
  assert.equal(ReservaLogica.clienteConfere("Pedido 10", minha), false);
  assert.equal(ReservaLogica.clienteConfere("", minha), false);
});

test("relógio do servidor corrige o relógio adiantado do PC", () => {
  // servidor respondeu expira = agoraServidor + 2h; PC está 5 min adiantado
  const agoraServidor = T;
  const agoraPC = T + 300000;
  const desvio = ReservaLogica.desvioRelogio(agoraServidor + 7200000, 2, agoraPC);
  assert.equal(desvio, -300000);
  // perto do fim: pelo relógio do PC já venceu, pelo do servidor ainda vale
  const r = { expira: agoraServidor + 7200000 };
  const pcPertoDoFim = agoraPC + 7000000;
  assert.equal(r.expira > pcPertoDoFim, false);
  assert.equal(ReservaLogica.ativa(r, pcPertoDoFim, desvio), true);
  assert.equal(ReservaLogica.ativa(r, agoraPC + 7300000, desvio), false);
});

test("mesmasBarras: o plano usa exatamente as barras da reserva (ordem não importa)", () => {
  assert.equal(ReservaLogica.mesmasBarras([2, 1], minha), true);
  assert.equal(ReservaLogica.mesmasBarras([1], minha), false);
  assert.equal(ReservaLogica.mesmasBarras([1, 2, 3], minha), false);
  assert.equal(ReservaLogica.mesmasBarras([1, 2], null), false);
});
