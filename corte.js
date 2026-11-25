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

  /**
   * Custo lexicográfico (o primeiro critério sempre domina o seguinte):
   *   1) menos barras novas            → PENALIDADE_NOVA por barra nova aberta
   *   2) menos metros cortados de barra nova (o que couber vai para as pontas) → PESO_NOVA_M por metro
   *   3) menor comprimento de pontas consumidas (= menor sobra) → 1 por metro
   */
  const PENALIDADE_NOVA = 1e7;
  const PESO_NOVA_M = 1e4;

  function novoBin(barra) {
    return { barra, L: barra.medida, soma: 0, cortes: [] };
  }

  /** Custo de uma barra já montada (ver critérios acima). */
  const custoBin = (b) => (b.barra.nova ? PENALIDADE_NOVA + PESO_NOVA_M * b.soma : b.L);
  /** Quanto custa colocar a peça p numa barra já aberta. */
  const custoEncaixe = (b, p) => (b.barra.nova ? PESO_NOVA_M * p : 0);

  /** Grupos de pontas por medida (crescente) e, por último, o grupo ilimitado de barra nova. */
  function agruparEstoque(barras, barraNova) {
    const mapa = new Map();
    barras.forEach((b) => {
      const k = arred(b.medida);
      if (!mapa.has(k)) mapa.set(k, { medida: k, barras: [], usados: 0 });
      mapa.get(k).barras.push(b);
    });
    const grupos = [...mapa.values()].sort((a, b) => a.medida - b.medida);
    grupos.forEach((g) => g.barras.sort((a, b) => a.id - b.id));
    if (barraNova && barraNova.medida > 0) grupos.push({ medida: arred(barraNova.medida), barras: [], usados: 0, nova: true });
    return grupos;
  }

  const disponivel = (g) => g.nova || g.usados < g.barras.length;
  /** Custo de abrir uma barra do grupo g com a peça p dentro. */
  const custoAbrir = (g, p) => (g.nova ? PENALIDADE_NOVA + PESO_NOVA_M * p : g.medida);

  function abrir(g) {
    if (g.nova) return novoBin({ id: null, nova: true, medida: g.medida });
    return novoBin(g.barras[g.usados++]);
  }

  function fechar(g) {
    if (!g.nova) g.usados--;
  }

  function custoDe(bins) {
    return bins.reduce((s, b) => s + custoBin(b), 0);
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
        const g = grupos.find((gr) => disponivel(gr) && p <= gr.medida + EPS);
        if (g) {
          melhor = abrir(g);
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
    const grupoNovo = grupos.find((g) => g.nova);
    const medidaNova = grupoNovo ? grupoNovo.medida : 0;
    const capPontasFechadas = () => grupos.reduce((s, g) => s + (g.nova ? 0 : g.medida * (g.barras.length - g.usados)), 0);

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

      // Limite inferior (relaxação fracionária): o que falta encaixar vai, do mais barato ao mais caro,
      // para o espaço livre das pontas abertas (custo 0), pontas ainda fechadas (≥ 1 por metro),
      // espaço livre de barras novas abertas (PESO_NOVA_M por metro) e, por fim, barras novas a abrir.
      let capPontaAberta = 0;
      let capNovaAberta = 0;
      for (const bin of bins) {
        const l = Math.max(0, livre(bin, kerf));
        if (bin.barra.nova) capNovaAberta += l; else capPontaAberta += l;
      }
      let resto = Math.max(0, sufixo[i] - capPontaAberta);
      const emPontas = Math.min(resto, capPontasFechadas());
      resto -= emPontas;
      const emNovaAberta = Math.min(resto, capNovaAberta);
      resto -= emNovaAberta;
      let novasAAbrir = 0;
      if (resto > EPS) {
        if (!medidaNova) return;                                                // não há como completar
        novasAAbrir = Math.ceil(resto / medidaNova - EPS);
      }
      const limite = custo + emPontas + PESO_NOVA_M * (emNovaAberta + resto) + PENALIDADE_NOVA * novasAAbrir;
      if (limite > melhorCusto + EPS) return;                                   // não melhora o custo
      if (limite >= melhorCusto - EPS && bins.length + novasAAbrir >= melhorQtd) return; // empata sem usar menos barras

      const p = pecas[i];

      // 1) Encaixar em barra já aberta (menor espaço livre primeiro; ignora espaços repetidos).
      const candidatos = bins.filter((b) => cabe(b, p, kerf)).sort((a, b) => livre(a, kerf) - livre(b, kerf));
      const vistos = new Set();
      for (const bin of candidatos) {
        const chave = arred(livre(bin, kerf));
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        const extra = custoEncaixe(bin, p);
        bin.soma += p;
        bin.cortes.push(p);
        custo += extra;
        dfs(i + 1);
        custo -= extra;
        bin.cortes.pop();
        bin.soma -= p;
        if (abortado) return;
      }

      // 2) Abrir outra barra (uma tentativa por medida distinta, da mais barata para a mais cara;
      //    a barra nova é o último grupo e a mais cara de todas).
      for (const g of grupos) {
        if (!disponivel(g) || p > g.medida + EPS) continue;
        const c = custoAbrir(g, p);
        if (custo + c > melhorCusto + EPS) break; // grupos estão em ordem crescente de custo
        const bin = abrir(g);
        bin.soma = p;
        bin.cortes.push(p);
        bins.push(bin);
        custo += c;
        dfs(i + 1);
        custo -= c;
        bins.pop();
        fechar(g);
        if (abortado) return;
      }
    }

    dfs(0);
    return { bins: melhorBins, provado: !abortado, nos };
  }

  /**
   * @param {Array<{id:number, medida:number}>} barras  estoque da bitola escolhida
   * @param {number[]} pecas  medidas das peças (uma entrada por peça)
   * @param {{kerf?:number, limiteNos?:number, barraNova?:{medida:number}|null}} [opcoes]
   *        barraNova: completa o pedido com barras novas (ilimitadas) só quando as pontas não bastam.
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

    const barraNova = opcoes && opcoes.barraNova && opcoes.barraNova.medida > 0 ? opcoes.barraNova : null;
    const menor = ps[ps.length - 1];
    const grupos = agruparEstoque(barras.filter((b) => b.medida + EPS >= menor), barraNova);
    const formatar = (bins) => bins
      .map((b) => ({ barra: b.barra, cortes: b.cortes.slice(), sobra: sobraDe(b, kerf) }))
      .sort((a, b) => (a.barra.nova ? 1 : 0) - (b.barra.nova ? 1 : 0) || (a.barra.id || 0) - (b.barra.id || 0));

    // Peças maiores que qualquer barra nunca serão atendidas: saem já como faltantes.
    const maiorBarra = grupos.reduce((m, gr) => Math.max(m, gr.medida), 0);
    const impossiveis = ps.filter((p) => p > maiorBarra + EPS);
    const atendiveis = ps.filter((p) => p <= maiorBarra + EPS);
    if (!atendiveis.length) return { completo: false, otimo: true, barras: [], faltantes: impossiveis };

    const g = guloso(grupos, atendiveis, kerf);
    const parcial = (otimo) => ({ completo: false, otimo, barras: formatar(g.bins), faltantes: impossiveis.concat(g.faltantes) });

    // Material total insuficiente (sem barra nova, o estoque é finito).
    const totalEstoque = barraNova ? Infinity : grupos.reduce((s, gr) => s + gr.medida * gr.barras.length, 0);
    const totalPecas = atendiveis.reduce((s, p) => s + p, 0);
    if (totalPecas > totalEstoque + EPS) return parcial(true);

    const r = buscar(grupos, atendiveis, kerf, g.faltantes.length ? null : g.bins, limiteNos);
    if (r.bins) {
      return { completo: !impossiveis.length, otimo: r.provado, barras: formatar(r.bins), faltantes: impossiveis };
    }
    return parcial(r.provado);
  }

  const Corte = { planejar, _interno: { guloso, buscar, agruparEstoque } };
  if (typeof module !== "undefined" && module.exports) module.exports = Corte;
  else raiz.Corte = Corte;
})(typeof window !== "undefined" ? window : globalThis);
