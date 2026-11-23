/**
 * Otimizador de plano de corte (Controle de Pontas — Grande Aço).
 *
 * Problema: dado um estoque de pontas (barras com medidas variadas) e uma lista
 * de peças a cortar, escolher quais barras usar e onde encaixar cada peça.
 *
 * Objetivo: atender todas as peças consumindo o MENOR comprimento total de
 * barras (= menor sobra total), desempatando pelo menor número de barras.
 * Entre barras de mesma medida, usa a de menor ID (mais antiga) primeiro.
 *
 * Perda por corte (kerf): cada corte consome `kerf` metros. Em uma barra com n
 * peças são feitos n cortes, exceto quando a última peça termina exatamente no
 * fim da barra (n-1 cortes). Logo:
 *   cabe se   soma + kerf*(n-1) <= medida
 *   sobra  =  max(0, medida - soma - kerf*n)
 * O backend (Code.gs) usa exatamente a mesma regra para recalcular a sobra.
 *
 * Estratégia: solução gulosa (best-fit decrescente) como ponto de partida e,
 * em seguida, busca em profundidade com poda por limite inferior, que encontra
 * a solução ótima ou para ao atingir o limite de nós.
 */
(function (raiz) {
  "use strict";

  const EPS = 1e-6;
  const arred = (v) => Math.round(v * 1000) / 1000;

  /** Espaço útil para a próxima peça (já descontado o corte que ela exige). */
  const livre = (bin, kerf) => bin.L - bin.soma - kerf * bin.cortes.length;
  const cabe = (bin, p, kerf) => p <= livre(bin, kerf) + EPS;
  const sobraDe = (bin, kerf) => Math.max(0, arred(bin.L - bin.soma - kerf * bin.cortes.length));

  function novoBin(barra) {
    return { barra, L: barra.medida, soma: 0, cortes: [] };
  }

  function agruparEstoque(barras) {
    const mapa = new Map();
    barras.forEach((b) => {
      const k = arred(b.medida);
      if (!mapa.has(k)) mapa.set(k, { medida: k, barras: [], usados: 0 });
      mapa.get(k).barras.push(b);
    });
    const grupos = [...mapa.values()].sort((a, b) => a.medida - b.medida);
    grupos.forEach((g) => g.barras.sort((a, b) => a.id - b.id));
    return grupos;
  }

  function custoDe(bins) {
    return bins.reduce((s, b) => s + b.L, 0);
  }

  function copiarBins(bins) {
    return bins.map((b) => ({ barra: b.barra, L: b.L, soma: b.soma, cortes: b.cortes.slice() }));
  }

  /** Best-fit decrescente: rápido, serve de limite superior e de plano parcial. */
  function guloso(grupos, pecas, kerf) {
    grupos.forEach((g) => (g.usados = 0));
    const bins = [];
    const faltantes = [];
    for (const p of pecas) {
      let melhor = null;
      for (const bin of bins) {
        if (cabe(bin, p, kerf) && (!melhor || livre(bin, kerf) < livre(melhor, kerf))) melhor = bin;
      }
      if (!melhor) {
        const g = grupos.find((gr) => gr.usados < gr.barras.length && p <= gr.medida + EPS);
        if (g) {
          melhor = novoBin(g.barras[g.usados++]);
          bins.push(melhor);
        }
      }
      if (melhor) {
        melhor.soma += p;
        melhor.cortes.push(p);
      } else {
        faltantes.push(p);
      }
    }
    return { bins, faltantes };
  }

  /** Busca em profundidade com poda. Retorna a melhor solução completa encontrada. */
  function buscar(grupos, pecas, kerf, incumbente, limiteNos) {
    grupos.forEach((g) => (g.usados = 0));
    const n = pecas.length;
    const sufixo = new Array(n + 1).fill(0);
    for (let i = n - 1; i >= 0; i--) sufixo[i] = sufixo[i + 1] + pecas[i];

    let melhorBins = incumbente ? copiarBins(incumbente) : null;
    let melhorCusto = incumbente ? custoDe(incumbente) : Infinity;
    let melhorQtd = incumbente ? incumbente.length : Infinity;
    const bins = [];
    let custo = 0;
    let nos = 0;
    let abortado = false;

    function registrar() {
      const melhora = custo < melhorCusto - EPS || (Math.abs(custo - melhorCusto) <= EPS && bins.length < melhorQtd);
      if (melhora) {
        melhorCusto = custo;
        melhorQtd = bins.length;
        melhorBins = copiarBins(bins);
      }
    }

    function dfs(i) {
      if (abortado) return;
      if (++nos > limiteNos) { abortado = true; return; }
      if (i === n) { registrar(); return; }

      // Limite inferior: o que falta encaixar além do espaço já aberto precisa de barra nova.
      let capAberta = 0;
      for (const bin of bins) capAberta += Math.max(0, livre(bin, kerf));
      const limite = custo + Math.max(0, sufixo[i] - capAberta);
      if (limite > melhorCusto + EPS) return;                                   // não melhora o custo
      if (limite >= melhorCusto - EPS && bins.length >= melhorQtd) return;      // empata no custo sem usar menos barras

      const p = pecas[i];

      // 1) Encaixar em barra já aberta (menor espaço livre primeiro; ignora espaços repetidos).
      const candidatos = bins.filter((b) => cabe(b, p, kerf)).sort((a, b) => livre(a, kerf) - livre(b, kerf));
      const vistos = new Set();
      for (const bin of candidatos) {
        const chave = arred(livre(bin, kerf));
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        bin.soma += p;
        bin.cortes.push(p);
        dfs(i + 1);
        bin.cortes.pop();
        bin.soma -= p;
        if (abortado) return;
      }

      // 2) Abrir uma barra nova do estoque (uma tentativa por medida distinta, da menor para a maior).
      for (const g of grupos) {
        if (g.usados >= g.barras.length || p > g.medida + EPS) continue;
        if (custo + g.medida > melhorCusto + EPS) break; // grupos estão em ordem crescente
        const bin = novoBin(g.barras[g.usados++]);
        bin.soma = p;
        bin.cortes.push(p);
        bins.push(bin);
        custo += bin.L;
        dfs(i + 1);
        custo -= bin.L;
        bins.pop();
        g.usados--;
        if (abortado) return;
      }
    }

    dfs(0);
    return { bins: melhorBins, provado: !abortado, nos };
  }

  /**
   * @param {Array<{id:number, medida:number}>} barras  estoque da bitola escolhida
   * @param {number[]} pecas  medidas das peças (uma entrada por peça)
   * @param {{kerf?:number, limiteNos?:number}} [opcoes]
   * @returns {{
   *   completo: boolean,          // todas as peças foram atendidas
   *   otimo: boolean,             // a solução foi provada ótima (ou a falta foi provada)
   *   barras: Array<{barra:object, cortes:number[], sobra:number}>,
   *   faltantes: number[]         // peças não atendidas (plano parcial)
   * }}
   */
  function planejar(barras, pecas, opcoes) {
    const kerf = Math.max(0, (opcoes && opcoes.kerf) || 0);
    const limiteNos = (opcoes && opcoes.limiteNos) || 250000;
    const ps = pecas.filter((p) => p > 0).slice().sort((a, b) => b - a);
    if (!ps.length) return { completo: true, otimo: true, barras: [], faltantes: [] };

    const menor = ps[ps.length - 1];
    const grupos = agruparEstoque(barras.filter((b) => b.medida + EPS >= menor));
    const formatar = (bins) => bins
      .map((b) => ({ barra: b.barra, cortes: b.cortes.slice(), sobra: sobraDe(b, kerf) }))
      .sort((a, b) => a.barra.id - b.barra.id);

    const g = guloso(grupos, ps, kerf);

    // Impossível de cara: peça maior que a maior barra, ou material total insuficiente.
    const maiorBarra = grupos.length ? grupos[grupos.length - 1].medida : 0;
    const totalEstoque = grupos.reduce((s, gr) => s + gr.medida * gr.barras.length, 0);
    const totalPecas = ps.reduce((s, p) => s + p, 0);
    if (ps[0] > maiorBarra + EPS || totalPecas > totalEstoque + EPS) {
      return { completo: false, otimo: true, barras: formatar(g.bins), faltantes: g.faltantes };
    }

    const r = buscar(grupos, ps, kerf, g.faltantes.length ? null : g.bins, limiteNos);
    if (r.bins) return { completo: true, otimo: r.provado, barras: formatar(r.bins), faltantes: [] };
    return { completo: false, otimo: r.provado, barras: formatar(g.bins), faltantes: g.faltantes };
  }

  const Corte = { planejar, _interno: { guloso, buscar, agruparEstoque } };
  if (typeof module !== "undefined" && module.exports) module.exports = Corte;
  else raiz.Corte = Corte;
})(typeof window !== "undefined" ? window : globalThis);
