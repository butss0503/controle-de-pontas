/**
 * Cálculos do Painel de aproveitamento (Controle de Pontas — Grande Aço).
 *
 * Entrada: linhas da aba "Movimentos" (ação `movimentos` do Code.gs) e o estoque atual.
 * Regras (do projeto aprovado):
 * - Só contam baixas não estornadas.
 * - "Reaproveitado" e "valor recuperado" contam SÓ origem `ponta` (peças cortadas
 *   de pontas + pontas vendidas inteiras). Barra nova aparece à parte.
 * - Valor só existe quando a baixa teve preço; as demais são contadas como "sem preço".
 */
(function (raiz) {
  "use strict";

  const FATOR_PESO_ACO = 162;
  const peso = (bitola, medida) => (bitola && medida ? (bitola * bitola / FATOR_PESO_ACO) * medida : 0);

  function vazio() {
    return {
      kgReaproveitado: 0, kgBrutoPontas: 0, taxa: null, valorRecuperado: 0, baixasSemPreco: 0,
      kgVoltouPonta: 0, kgVoltouDeBarraNova: 0, kgSucataPerda: 0, barrasNovas: 0, kgBarraNova: 0
    };
  }

  function acumular(t, m) {
    t.kgSucataPerda += (m.kgSucata || 0) + (m.kgPerda || 0);
    if (m.origem === "barra nova") {
      t.barrasNovas += 1;
      t.kgBarraNova += m.kgPecas || 0;
      t.kgVoltouDeBarraNova += m.kgSobra || 0;
      return;
    }
    t.kgReaproveitado += m.kgPecas || 0;
    t.kgBrutoPontas += peso(m.bitola, m.medidaOriginal);
    t.kgVoltouPonta += m.kgSobra || 0;
    if (m.precoKg > 0) t.valorRecuperado += (m.kgPecas || 0) * m.precoKg;
    else t.baixasSemPreco += 1;
  }

  const fecharTaxa = (t) => { t.taxa = t.kgBrutoPontas > 0 ? t.kgReaproveitado / t.kgBrutoPontas : null; return t; };

  /** Resumo do período, geral e por bitola. */
  function resumir(movs) {
    const total = vazio();
    const porBitola = new Map();
    (movs || []).forEach((m) => {
      if (m.acao !== "baixa" || m.estornado) return;
      acumular(total, m);
      if (!porBitola.has(m.bitola)) porBitola.set(m.bitola, vazio());
      acumular(porBitola.get(m.bitola), m);
    });
    fecharTaxa(total);
    total.porBitola = [...porBitola.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([bitola, t]) => {
        fecharTaxa(t);
        return { bitola, kgReaproveitado: t.kgReaproveitado, kgBrutoPontas: t.kgBrutoPontas, taxa: t.taxa,
          kgSucataPerda: t.kgSucataPerda, kgBarraNova: t.kgBarraNova, barrasNovas: t.barrasNovas };
      });
    return total;
  }

  function parseDataBR(str) {
    const p = String(str || "").split(" ")[0].split("/");
    if (p.length !== 3) return null;
    const d = new Date(Number(p[2]), Number(p[1]) - 1, Number(p[0]));
    return isNaN(d.getTime()) ? null : d;
  }

  const DIA = 86400000;
  const inicioDoDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  /** Pontas em estoque há pelo menos `minDias`, da mais antiga para a mais nova. */
  function pontasParadas(estoque, hoje, minDias = 60) {
    const base = inicioDoDia(hoje).getTime();
    return (estoque || [])
      .map((item) => {
        const d = parseDataBR(item.data);
        return d ? { item, dias: Math.round((base - inicioDoDia(d).getTime()) / DIA) } : null;
      })
      .filter((x) => x && x.dias >= minDias)
      .sort((a, b) => b.dias - a.dias);
  }

  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  /** Períodos prontos do seletor: 'mes' (mês atual até hoje), 'mesPassado', '30dias' (hoje incluso). */
  function periodo(nome, hoje) {
    const h = inicioDoDia(hoje);
    if (nome === "mesPassado") {
      return { de: iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), ate: iso(new Date(h.getFullYear(), h.getMonth(), 0)) };
    }
    if (nome === "30dias") return { de: iso(new Date(h.getFullYear(), h.getMonth(), h.getDate() - 29)), ate: iso(h) };
    return { de: iso(new Date(h.getFullYear(), h.getMonth(), 1)), ate: iso(h) };
  }

  const Painel = { resumir, pontasParadas, periodo };
  if (typeof module !== "undefined" && module.exports) module.exports = Painel;
  else raiz.Painel = Painel;
})(typeof window !== "undefined" ? window : globalThis);
