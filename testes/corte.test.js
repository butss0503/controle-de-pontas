// Testes do otimizador de corte. Rodar com:  node --test testes/
const test = require("node:test");
const assert = require("node:assert/strict");
const Corte = require("../corte.js");

const barras = (...medidas) => medidas.map((m, i) => ({ id: i + 1, medida: m }));
const custo = (r) => r.barras.reduce((s, b) => s + b.barra.medida, 0);

test("encontra solução que o guloso antigo não encontrava", () => {
  const r = Corte.planejar(barras(3.0, 3.5), [2, 1.5, 1.5, 1.5]);
  assert.equal(r.completo, true);
  assert.equal(r.barras.length, 2);
});

test("prefere a barra mais curta que atende (máximo rendimento)", () => {
  const r = Corte.planejar(barras(6.0, 3.1), [3.0]);
  assert.equal(r.barras.length, 1);
  assert.equal(r.barras[0].barra.medida, 3.1);
  assert.equal(r.barras[0].sobra, 0.1);
});

test("entre barras de mesma medida usa a de menor ID", () => {
  const r = Corte.planejar([{ id: 9, medida: 4 }, { id: 2, medida: 4 }], [3]);
  assert.equal(r.barras[0].barra.id, 2);
});

test("estoque insuficiente devolve plano parcial e as peças faltantes", () => {
  const r = Corte.planejar(barras(1.0, 2.5), [2, 2]);
  assert.equal(r.completo, false);
  assert.equal(r.otimo, true);
  assert.deepEqual(r.faltantes, [2]);
  assert.equal(r.barras.length, 1);
});

test("perda por corte impede encaixe exato e é descontada da sobra", () => {
  assert.equal(Corte.planejar(barras(3.0), [1.5, 1.5], { kerf: 0.003 }).completo, false);
  const r = Corte.planejar(barras(3.01), [1.5, 1.5], { kerf: 0.003 });
  assert.equal(r.completo, true);
  assert.equal(r.barras[0].sobra, 0.004);
});

test("peça que termina no fim da barra não precisa de corte extra", () => {
  const r = Corte.planejar(barras(3.003), [1.5, 1.5], { kerf: 0.003 });
  assert.equal(r.completo, true);
  assert.equal(r.barras[0].sobra, 0);
});

// Força bruta: testa toda atribuição peça→barra e retorna o menor custo viável.
function forcaBruta(estoque, pecas, kerf) {
  let melhor = Infinity;
  const atrib = new Array(pecas.length).fill(0);
  const total = Math.pow(estoque.length, pecas.length);
  for (let c = 0; c < total; c++) {
    let x = c;
    for (let i = 0; i < pecas.length; i++) { atrib[i] = x % estoque.length; x = Math.floor(x / estoque.length); }
    const soma = new Array(estoque.length).fill(0);
    const qtd = new Array(estoque.length).fill(0);
    atrib.forEach((b, i) => { soma[b] += pecas[i]; qtd[b]++; });
    let ok = true;
    let cst = 0;
    for (let b = 0; b < estoque.length; b++) {
      if (!qtd[b]) continue;
      if (soma[b] + kerf * (qtd[b] - 1) > estoque[b].medida + 1e-6) { ok = false; break; }
      cst += estoque[b].medida;
    }
    if (ok && cst < melhor) melhor = cst;
  }
  return melhor;
}

test("bate com a força bruta em 400 instâncias aleatórias", () => {
  let semente = 42;
  const rnd = () => ((semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648);
  const m = (a, b) => Math.round((a + rnd() * (b - a)) * 20) / 20; // múltiplos de 5 cm
  for (let t = 0; t < 400; t++) {
    const estoque = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, i) => ({ id: i + 1, medida: m(0.5, 6) }));
    const pecas = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => m(0.2, 3));
    const kerf = rnd() < 0.5 ? 0 : 0.005;
    const esperado = forcaBruta(estoque, pecas, kerf);
    const r = Corte.planejar(estoque, pecas, { kerf });
    const ctx = JSON.stringify({ estoque, pecas, kerf });
    if (esperado === Infinity) {
      assert.equal(r.completo, false, ctx);
    } else {
      assert.equal(r.completo, true, ctx);
      assert.ok(Math.abs(custo(r) - esperado) < 1e-6, `custo ${custo(r)} != ótimo ${esperado} — ${ctx}`);
      // cada barra respeita a regra de encaixe
      r.barras.forEach((b) => {
        const soma = b.cortes.reduce((s, c) => s + c, 0);
        assert.ok(soma + kerf * (b.cortes.length - 1) <= b.barra.medida + 1e-6, ctx);
      });
      assert.equal(r.barras.reduce((s, b) => s + b.cortes.length, 0), pecas.length, ctx);
    }
  }
});

test("pedido grande termina rápido", () => {
  let semente = 7;
  const rnd = () => ((semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648);
  const estoque = Array.from({ length: 300 }, (_, i) => ({ id: i + 1, medida: Math.round((0.5 + rnd() * 11.5) * 100) / 100 }));
  const pecas = Array.from({ length: 80 }, () => [0.8, 1.2, 1.5, 2.35, 3][Math.floor(rnd() * 5)]);
  const t0 = Date.now();
  const r = Corte.planejar(estoque, pecas, { kerf: 0.003 });
  const ms = Date.now() - t0;
  assert.equal(r.completo, true);
  assert.ok(ms < 3000, `demorou ${ms} ms`);
});
