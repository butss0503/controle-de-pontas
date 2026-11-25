// Testes dos cálculos do Painel de aproveitamento.  node --test testes/painel.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const Painel = require("../painel.js");

const mov = (o) => ({
  acao: "baixa", estornado: false, origem: "ponta", bitola: 8, medidaOriginal: 5,
  kgPecas: 0, kgSobra: 0, kgSucata: 0, kgPerda: 0, precoKg: null, ...o
});
const peso = (b, m) => (b * b / 162) * m;

test("resumo conta só pontas no aproveitamento", () => {
  const r = Painel.resumir([
    mov({ kgPecas: 1.9, precoKg: 7.8, kgSobra: 0.1, kgSucata: 0.01, kgPerda: 0.002 }),
    mov({ origem: "barra nova", medidaOriginal: 12, kgPecas: 3, kgSobra: 1.5 })
  ]);
  assert.equal(r.kgReaproveitado, 1.9);
  assert.ok(Math.abs(r.kgConsumidoPontas - 1.912) < 1e-9); // peças + sucata + perda (sem a sobra)
  assert.ok(Math.abs(r.taxa - 1.9 / 1.912) < 1e-9);
  assert.ok(Math.abs(r.valorRecuperado - 14.82) < 1e-9);
  assert.equal(r.baixasSemPreco, 0);
  assert.equal(r.kgVoltouPonta, 0.1);
  assert.equal(r.kgVoltouDeBarraNova, 1.5);
  assert.ok(Math.abs(r.kgSucataPerda - 0.012) < 1e-9);
  assert.equal(r.barrasNovas, 1);
  assert.equal(r.kgBarraNova, 3);
});

test("sobra que volta ao estoque não derruba o aproveitamento", () => {
  // ponta de 6 m: corta 1 m, 5 m voltam como ponta nova; nada foi perdido
  const r = Painel.resumir([mov({ medidaOriginal: 6, kgPecas: peso(8, 1), kgSobra: peso(8, 5) })]);
  assert.ok(Math.abs(r.taxa - 1) < 1e-9, `taxa ${r.taxa}`);
});

test("baixa sem preço conta em baixasSemPreco e não entra no valor", () => {
  const r = Painel.resumir([mov({ kgPecas: 2 }), mov({ kgPecas: 1, precoKg: 10 })]);
  assert.equal(r.baixasSemPreco, 1);
  assert.equal(r.valorRecuperado, 10);
});

test("barra nova não conta como baixa sem preço", () => {
  const r = Painel.resumir([mov({ origem: "barra nova", kgPecas: 3 })]);
  assert.equal(r.baixasSemPreco, 0);
  assert.equal(r.valorRecuperado, 0);
});

test("estornados e não-baixas são ignorados", () => {
  const r = Painel.resumir([
    mov({ kgPecas: 2, estornado: true }),
    mov({ acao: "estorno", kgPecas: 9 }),
    mov({ acao: "cadastro", kgPecas: 9 })
  ]);
  assert.equal(r.kgReaproveitado, 0);
  assert.equal(r.kgConsumidoPontas, 0);
});

test("período sem movimentos dá zeros e taxa null", () => {
  const r = Painel.resumir([]);
  for (const k of ["kgReaproveitado", "kgConsumidoPontas", "valorRecuperado", "baixasSemPreco", "kgVoltouPonta",
    "kgVoltouDeBarraNova", "kgSucataPerda", "barrasNovas", "kgBarraNova"]) {
    assert.equal(r[k], 0, k);
  }
  assert.equal(r.taxa, null);
  assert.deepEqual(r.porBitola, []);
});

test("resumo por bitola separa e ordena as bitolas", () => {
  const r = Painel.resumir([
    mov({ bitola: 10, kgPecas: 2 }),
    mov({ bitola: 8, kgPecas: 1 }),
    mov({ bitola: 10, origem: "barra nova", kgPecas: 4 })
  ]);
  assert.deepEqual(r.porBitola.map((b) => b.bitola), [8, 10]);
  const b10 = r.porBitola[1];
  assert.equal(b10.kgReaproveitado, 2);
  assert.equal(b10.kgBarraNova, 4);
  assert.ok(b10.taxa > 0);
});

test("pontasParadas ordena por idade e respeita o mínimo", () => {
  const hoje = new Date(2026, 10, 25);
  const dia = (n) => { const d = new Date(2026, 10, 25 - n); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; };
  const est = [
    { id: 1, data: dia(70) }, { id: 2, data: dia(100) }, { id: 3, data: dia(10) }, { id: 4, data: "" }, { id: 5, data: "lixo" }
  ];
  const r = Painel.pontasParadas(est, hoje);
  assert.deepEqual(r.map((x) => [x.item.id, x.dias]), [[2, 100], [1, 70]]);
  assert.equal(Painel.pontasParadas(est, hoje, 90).length, 1);
});

test("periodo devolve datas locais", () => {
  assert.deepEqual(Painel.periodo("mes", new Date(2026, 10, 25)), { de: "2026-11-01", ate: "2026-11-25" });
  assert.deepEqual(Painel.periodo("mesPassado", new Date(2027, 0, 15)), { de: "2026-12-01", ate: "2026-12-31" });
  assert.deepEqual(Painel.periodo("30dias", new Date(2026, 10, 25)), { de: "2026-10-27", ate: "2026-11-25" });
});

test("baixas sem preço contam pedidos (lotes), não barras", () => {
  const r = Painel.resumir([mov({ lote: "L1", kgPecas: 1 }), mov({ lote: "L1", kgPecas: 1 }), mov({ lote: "L2", kgPecas: 1 })]);
  assert.equal(r.baixasSemPreco, 2);
});
