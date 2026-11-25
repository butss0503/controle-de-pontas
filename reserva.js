/**
 * Regras de reserva do lado do navegador (Controle de Pontas — Grande Aço).
 * O servidor é a autoridade; estas funções evitam que a tela confie só na
 * lista local ou no relógio do PC.
 */
(function (raiz) {
  "use strict";

  /** Diferença aceita entre a validade guardada no navegador e a que o servidor mostra. */
  const TOLERANCIA_MS = 60000;

  const normalizar = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

  /**
   * A barra pertence à minha reserva só se está na lista dela E o servidor
   * mostra a mesma validade (senão foi liberada e reservada por outra pessoa).
   */
  function pertence(barra, reserva) {
    if (!reserva || !barra || !barra.reserva) return false;
    return reserva.ids.includes(barra.id) && Math.abs(barra.reserva.ate - reserva.expira) <= TOLERANCIA_MS;
  }

  /** O cliente digitado é o da reserva? (vazio nunca confere) */
  function clienteConfere(digitado, reserva) {
    return !!reserva && normalizar(digitado) !== "" && normalizar(digitado) === normalizar(reserva.cliente);
  }

  /** Desvio (servidor − PC) a partir da validade devolvida pelo servidor ao reservar. */
  function desvioRelogio(expiraServidor, horasReserva, agoraPC) {
    return expiraServidor - horasReserva * 3600000 - agoraPC;
  }

  /** A reserva ainda vale, medindo pelo relógio do servidor. */
  function ativa(reserva, agoraPC, desvio) {
    return reserva.expira > agoraPC + (desvio || 0);
  }

  /** O plano em tela usa exatamente as barras da reserva? (sim = só renova o prazo) */
  function mesmasBarras(ids, reserva) {
    if (!reserva) return false;
    const a = [...new Set(ids)].sort((x, y) => x - y);
    const b = [...new Set(reserva.ids)].sort((x, y) => x - y);
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  const ReservaLogica = { pertence, clienteConfere, desvioRelogio, ativa, mesmasBarras, TOLERANCIA_MS };
  if (typeof module !== "undefined" && module.exports) module.exports = ReservaLogica;
  else raiz.ReservaLogica = ReservaLogica;
})(typeof window !== "undefined" ? window : globalThis);
