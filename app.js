/**
 * Controle de Pontas — Grande Aço (frontend)
 * Depende de: corte.js (otimizador), QRious, Html5Qrcode, SheetJS, jsPDF + autotable.
 * Toda leitura/escrita passa pelo Apps Script (Code.gs v3), autenticada por token.
 */
"use strict";

const CONFIG = {
  SCRIPT_URL: "https://script.google.com/macros/s/AKfycbyndMAA1_NxoOwvyuz-gEOfTsE0JWdqfrFgeliM3i37zvDPOqAYcOvM1uHMrQHdLRnF/exec",
  FATOR_PESO_ACO: 162,
  SOBRA_MINIMA: 0.05,           // m — mesma regra do servidor
  BITOLAS_COMERCIAIS: [4.2, 5, 6.3, 8, 10, 12.5, 16, 20, 25, 32],
  BITOLA_PADRAO: 8,
  BARRA_NOVA_M: 12,             // barra inteira do estoque principal (mesmo valor do Code.gs)
  RESERVA_HORAS: 2,             // validade da reserva (mesmo valor do Code.gs)
  HISTORICO_PAGINA: 50,
  TIMEOUT_MS: 45000,
  MAX_PECAS_PEDIDO: 500,
  LOTE_CONFIRMAR_IMPRESSAO: 30
};

const state = {
  sessao: null,          // { token, role, expira }
  estoque: [],
  vendidos: [],
  carrinho: [],          // [{ medida, qtde }]
  plano: null,
  selecionados: new Set(),
  listaFiltrada: [],
  historicoLimite: CONFIG.HISTORICO_PAGINA,
  ultimasSobras: [],
  reservaAtual: null,    // código da reserva ligada ao pedido em tela
  ultimosCadastrados: []
};

const $ = (id) => document.getElementById(id);

/** Ícone do conjunto SVG do index.html (traço 2px). */
const icon = (nome, classe = "") => `<svg class="icon ${classe}" aria-hidden="true"><use href="#i-${nome}"/></svg>`;

// ============================================================================
// ARMAZENAMENTO LOCAL (pode falhar em aba anônima / bloqueado)
// ============================================================================
const Armazenamento = {
  // Cópia em memória: se o navegador bloquear o armazenamento, a sessão em curso
  // continua funcionando (as reservas só se perdem ao fechar ou recarregar a página).
  // A memória só é lida depois que o navegador recusar uma leitura ou gravação.
  memoria: new Map(),
  bloqueado: false,
  falhou() {
    if (this.bloqueado) return;
    this.bloqueado = true;
    setTimeout(() => UI.notificar("Este navegador não deixa guardar dados: as reservas feitas aqui somem se a página for fechada ou recarregada.", true), 0);
  },
  ler(chave, padrao = null) {
    if (!this.bloqueado) {
      try { const v = localStorage.getItem(chave); return v === null ? padrao : v; } catch (e) { this.falhou(); }
    }
    return this.memoria.has(chave) ? this.memoria.get(chave) : padrao;
  },
  lerJSON(chave) {
    try { return JSON.parse(this.ler(chave)); } catch (e) { return null; }
  },
  gravar(chave, valor) {
    const texto = typeof valor === "string" ? valor : JSON.stringify(valor);
    this.memoria.set(chave, texto);
    if (this.bloqueado) return;
    try { localStorage.setItem(chave, texto); } catch (e) { this.falhou(); }
  },
  remover(chave) {
    this.memoria.delete(chave);
    try { localStorage.removeItem(chave); } catch (e) { /* bloqueado: a memória já foi limpa */ }
  }
};

// ============================================================================
// UTILITÁRIOS
// ============================================================================
const Utils = {
  escapeHTML(v) {
    if (v === null || v === undefined) return "";
    return String(v).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
  },
  num(v) {
    if (typeof v === "number") return isFinite(v) ? v : NaN;
    if (v === null || v === undefined || String(v).trim() === "") return NaN;
    return parseFloat(String(v).replace(",", "."));
  },
  arred(v) { return Math.round(v * 1000) / 1000; },
  fmt(v, casas = 2) { return Number(v || 0).toFixed(casas); },
  peso(bitola, medida) {
    if (!bitola || !medida) return 0;
    return (bitola * bitola / CONFIG.FATOR_PESO_ACO) * medida;
  },
  moeda(v) { return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); },
  /** yyyy-mm-dd no fuso LOCAL (toISOString usaria UTC e erraria o dia à noite). */
  dataISO(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },
  hojeBR() { return new Date().toLocaleDateString("pt-BR"); },
  parseDataBR(str) {
    if (!str || str === "-") return null;
    const p = String(str).split(" ")[0].split("/");
    if (p.length === 3) {
      const d = new Date(Number(p[2]), Number(p[1]) - 1, Number(p[0]));
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  },
  /** [1.5, 1.5, 0.8] → "2x de 1.50m + 1x de 0.80m" */
  descreverCortes(cortes) {
    const cont = new Map();
    cortes.forEach((c) => { const k = this.arred(c); cont.set(k, (cont.get(k) || 0) + 1); });
    return [...cont.entries()].sort((a, b) => b[0] - a[0]).map(([m, q]) => `${q}x de ${this.fmt(m)}m`).join(" + ");
  },
  async copiarTexto(texto) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(texto);
    const ta = document.createElement("textarea");
    ta.value = texto;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (!ok) throw new Error("copy");
  }
};

// ============================================================================
// INTERFACE GERAL: toast, abas, tema, modais, confirmação
// ============================================================================
const UI = {
  toastTimer: null,

  notificar(msg, erro = false) {
    const t = $("toast");
    clearTimeout(this.toastTimer);
    t.className = "";
    void t.offsetWidth; // reinicia a animação
    t.textContent = msg || "Operação concluída!";
    t.className = erro ? "show error" : "show";
    this.toastTimer = setTimeout(() => { t.className = ""; }, erro ? 6000 : 4000);
  },

  alternarAba(id) {
    let tab = document.querySelector(`.tab[data-target="${id}"]`);
    if (!tab || getComputedStyle(tab).display === "none") {
      id = "consulta";
      tab = document.querySelector('.tab[data-target="consulta"]');
    }
    document.querySelectorAll(".tab").forEach((t) => {
      const ativo = t === tab;
      t.classList.toggle("active", ativo);
      t.setAttribute("aria-selected", ativo ? "true" : "false");
    });
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.toggle("active", c.id === id));
    // Abas que buscam dados próprios ao abrir
    if (id === "painel") PainelUI.carregar();
    if (id === "historico") Historico.carregarMovimentos();
    // No celular a barra de abas rola: garante que a aba ativa fique à vista
    if (tab.scrollIntoView) tab.scrollIntoView({ block: "nearest", inline: "nearest" });
  },

  alternarTema() {
    const novo = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", novo);
    Armazenamento.gravar("theme", novo);
    this.atualizarIconeTema();
  },

  atualizarIconeTema() {
    const escuro = document.documentElement.getAttribute("data-theme") === "dark";
    $("btnTheme").innerHTML = icon(escuro ? "sun" : "moon");
    $("btnTheme").title = escuro ? "Usar tema claro" : "Usar tema escuro";
  },

  /** Diálogo de confirmação. Retorna Promise<boolean>. */
  confirmar({ titulo, html, ok = "Confirmar", perigo = false }) {
    return new Promise((resolve) => {
      let resolvido = false;
      const finalizar = (v) => { if (!resolvido) { resolvido = true; resolve(v); } };
      $("confirmTitulo").textContent = titulo;
      $("confirmCorpo").innerHTML = html;
      const btnOk = $("confirmOk");
      btnOk.textContent = ok;
      btnOk.className = perigo ? "btn-danger" : "btn";
      btnOk.onclick = () => { finalizar(true); Modal.fechar("modalConfirmar"); };
      $("confirmCancelar").onclick = () => Modal.fechar("modalConfirmar");
      Modal.abrir("modalConfirmar", { aoFechar: () => finalizar(false), foco: $("confirmCancelar") });
    });
  }
};

const Modal = {
  pilha: [], // [{ id, aoFechar, podeFechar, focoAnterior }]

  abrir(id, { aoFechar = null, podeFechar = true, foco = null } = {}) {
    const el = $(id);
    if (!el) return;
    const existente = this.pilha.find((m) => m.id === id);
    if (existente) { existente.aoFechar = aoFechar; existente.podeFechar = podeFechar; }
    else this.pilha.push({ id, aoFechar, podeFechar, focoAnterior: document.activeElement });
    el.classList.add("active");
    const alvo = foco || el.querySelector("input:not([type=hidden]):not([type=radio]), select, button");
    setTimeout(() => alvo && alvo.focus(), 30);
  },

  fechar(id, forcar = false) {
    const idx = this.pilha.findIndex((m) => m.id === id);
    if (idx === -1) { $(id) && $(id).classList.remove("active"); return; }
    const m = this.pilha[idx];
    if (!m.podeFechar && !forcar) return;
    this.pilha.splice(idx, 1);
    $(id).classList.remove("active");
    if (m.aoFechar) m.aoFechar();
    if (m.focoAnterior && m.focoAnterior.isConnected) m.focoAnterior.focus();
  },

  topo() { return this.pilha[this.pilha.length - 1] || null; },

  configurar() {
    document.addEventListener("keydown", (e) => {
      const topo = this.topo();
      if (!topo) return;
      if (e.key === "Escape") { this.fechar(topo.id); return; }
      if (e.key === "Tab") { // mantém o foco dentro do modal
        const foc = [...$(topo.id).querySelectorAll("button, input, select, [tabindex]:not([tabindex='-1'])")]
          .filter((x) => !x.disabled && x.offsetParent !== null);
        if (!foc.length) return;
        const primeiro = foc[0], ultimo = foc[foc.length - 1];
        if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
        else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
      }
    });
    document.querySelectorAll(".modal-overlay").forEach((ov) => {
      ov.addEventListener("click", (e) => { if (e.target === ov) this.fechar(ov.id); });
    });
  }
};

/** Desabilita o botão durante a operação e mostra erros sem perder o que foi digitado. */
async function executar(btn, textoCarregando, fn) {
  if (btn && btn.disabled) return null;
  const original = btn ? btn.innerHTML : "";
  if (btn) { btn.disabled = true; btn.textContent = textoCarregando; }
  try {
    return await fn();
  } catch (e) {
    UI.notificar(e.message || "Erro inesperado.", true);
    return null;
  } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = original; }
  }
}

// ============================================================================
// API (Apps Script)
// ============================================================================
class ErroAPI extends Error {
  constructor(mensagem, codigo) { super(mensagem); this.codigo = codigo || "ERRO"; }
}

const API = {
  async chamar(action, dados = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.TIMEOUT_MS);
    let res;
    try {
      res = await fetch(CONFIG.SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // evita preflight CORS no Apps Script
        body: JSON.stringify({ ...dados, action, token: Auth.token() }),
        signal: ctrl.signal
      });
    } catch (e) {
      throw new ErroAPI(e.name === "AbortError"
        ? "O servidor demorou demais para responder. Sincronize e confira antes de repetir a operação."
        : "Sem conexão com o servidor. Verifique a internet.", "REDE");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new ErroAPI(`O servidor respondeu com erro (${res.status}).`, "HTTP");

    let json;
    try { json = await res.json(); } catch (e) {
      throw new ErroAPI("Resposta inválida do servidor. Confira se o Apps Script v3 foi implantado.", "FORMATO");
    }
    const ok = json.sucesso !== undefined ? json.sucesso : json.success;
    if (!ok) {
      let msg = json.mensagem || json.message || "Operação não realizada.";
      if (/^Ação desconhecida/.test(msg)) msg = "O Apps Script está desatualizado: implante o Code.gs v3 (nova versão).";
      if (json.codigo === "AUTH") Auth.sessaoExpirada();
      throw new ErroAPI(msg, json.codigo);
    }
    return json;
  }
};

// ============================================================================
// AUTENTICAÇÃO (a senha é verificada no servidor; aqui só guardamos o token)
// ============================================================================
const Auth = {
  roleModal: "vendedor",

  carregar() {
    const s = Armazenamento.lerJSON("pontas_sessao");
    if (s && s.token && s.expira > Date.now() && (s.role === "vendedor" || s.role === "operador")) state.sessao = s;
    else Armazenamento.remover("pontas_sessao");
    Armazenamento.remover("pontas_userRole"); // chave antiga, não é mais usada
  },

  token() { return state.sessao ? state.sessao.token : null; },
  role() { return state.sessao ? state.sessao.role : null; },
  nomeRole(r) { return r === "operador" ? "Operador" : "Vendedor"; },

  aplicarUI() {
    const r = this.role();
    if (r) document.documentElement.setAttribute("data-role", r);
    else document.documentElement.removeAttribute("data-role");
    $("profileRole").textContent = r ? this.nomeRole(r) : "Entrar";
    const ativa = document.querySelector(".tab.active");
    if (r !== "operador" && ativa && ativa.classList.contains("so-operador")) UI.alternarAba("consulta");
  },

  selecionarRole(r) {
    this.roleModal = r;
    document.querySelectorAll(".role-tab").forEach((b) => {
      const ativo = b.dataset.role === r;
      b.classList.toggle("active", ativo);
      b.setAttribute("aria-checked", ativo ? "true" : "false");
    });
  },

  abrirLogin(obrigatorio = false, aviso = "") {
    this.selecionarRole(this.role() || this.roleModal);
    $("authPassword").value = "";
    $("authErro").textContent = "";
    $("loginSubtitulo").textContent = aviso || (state.sessao
      ? `Sessão ativa como ${this.nomeRole(this.role())}. Entre com outro perfil ou saia.`
      : "Selecione o perfil e informe a senha");
    $("btnSair").hidden = !state.sessao;
    $("btnCancelarLogin").hidden = obrigatorio || !state.sessao;
    $("modalLogin").classList.toggle("is-gate", obrigatorio || !state.sessao);
    Modal.abrir("modalLogin", { podeFechar: !obrigatorio && !!state.sessao, foco: $("authPassword") });
  },

  async entrar() {
    const senha = $("authPassword").value;
    if (!senha) { $("authErro").textContent = "Digite a senha."; return; }
    $("authErro").textContent = "";
    await executar($("btnEntrar"), "Verificando...", async () => {
      try {
        const r = await API.chamar("login", { role: this.roleModal, senha });
        state.sessao = { token: r.token, role: r.role, expira: r.expira };
        Armazenamento.gravar("pontas_sessao", state.sessao);
        this.aplicarUI();
        Modal.fechar("modalLogin", true);
        UI.notificar(`Perfil ativo: ${this.nomeRole(r.role)}`);
        Dados.carregar();
      } catch (e) {
        $("authErro").textContent = e.message;
        $("authPassword").select();
      }
    });
  },

  sair() {
    state.sessao = null;
    Armazenamento.remover("pontas_sessao");
    Dados.limpar();
    this.aplicarUI();
    this.abrirLogin(true);
  },

  sessaoExpirada() {
    if (!state.sessao) return;
    state.sessao = null;
    Armazenamento.remover("pontas_sessao");
    this.aplicarUI();
    Modal.fechar("modalConfirmar", true);
    this.abrirLogin(true, "Sua sessão expirou. Entre novamente para continuar.");
  }
};

// ============================================================================
// DADOS (sincronização com a planilha via Apps Script)
// ============================================================================
const Dados = {
  promessa: null,
  repetir: false,

  carregar(opcoes = {}) {
    if (!Auth.token()) return Promise.resolve();
    if (this.promessa) { this.repetir = true; return this.promessa; }
    this.promessa = this._carregar(opcoes).finally(() => {
      this.promessa = null;
      if (this.repetir) { this.repetir = false; this.carregar({ silencioso: true }); }
    });
    return this.promessa;
  },

  async _carregar({ silencioso = false } = {}) {
    const btn = $("btnRecarregar");
    if (!silencioso) { btn.disabled = true; btn.innerHTML = `${icon("sync", "is-spinning")}<span class="nav-label">Sincronizando…</span>`; }
    try {
      const r = await API.chamar("listar");
      if (r.role && r.role !== Auth.role()) { state.sessao.role = r.role; Armazenamento.gravar("pontas_sessao", state.sessao); Auth.aplicarUI(); }
      const itens = (r.itens || []).map((i) => ({
        id: Number(i.id),
        data: i.data || "",
        bitola: Number(i.bitola),
        medida: Number(i.medida),
        peso: Number(i.peso) || Utils.peso(Number(i.bitola), Number(i.medida)),
        status: i.status,
        obs: i.obs || "",
        dataSaida: i.dataSaida || "",
        idOrigem: i.idOrigem ? Number(i.idOrigem) : null,
        reserva: i.reserva ? { ate: Number(i.reserva.ate), para: i.reserva.para || "", codigo: i.reserva.codigo || null } : null,
        ordem: Number(i.ordem) || 0
      }));
      state.estoque = itens.filter((i) => i.status === "estoque");
      state.vendidos = itens.filter((i) => i.status === "vendido");

      const idsEstoque = new Set(state.estoque.map((i) => i.id));
      [...state.selecionados].forEach((id) => { if (!idsEstoque.has(id)) state.selecionados.delete(id); });

      $("contadorEstoque").textContent = state.estoque.length;
      Estoque.atualizarSelects();
      Estoque.renderizar();
      Historico.renderizar();
      BaixaManual.prever();
      Reservas.sincronizar(state.estoque);
      Plano.validarContraEstoque(idsEstoque);
      if ($("painel").classList.contains("active")) PainelUI.renderizarParadas();
    } catch (e) {
      if (e.codigo !== "AUTH") UI.notificar("Erro ao sincronizar: " + e.message, true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon("sync")}<span class="nav-label">Sincronizar</span>`;
    }
  },

  limpar() {
    state.estoque = [];
    state.vendidos = [];
    state.selecionados.clear();
    state.plano = null;
    $("contadorEstoque").textContent = "0";
    $("areaResultados").innerHTML = "";
    Estoque.atualizarSelects();
    Estoque.renderizar();
    Historico.renderizar();
  }
};

// ============================================================================
// PLANO DE CORTE
// ============================================================================
// ============================================================================
// RESERVAS (guardadas neste navegador; o código é a prova de quem reservou)
// ============================================================================
const Reservas = {
  CHAVE: "pontas_reservas",

  /** Reservas ativas deste computador. As vencidas saem da lista com aviso. */
  todas() {
    const lista = Armazenamento.lerJSON(this.CHAVE) || [];
    const desvio = this.desvio();
    const vale = (r) => r && r.codigo && ReservaLogica.ativa(r, Date.now(), desvio); // relógio do servidor
    const ativas = lista.filter(vale);
    if (ativas.length !== lista.length) {
      this.gravar(ativas);
      lista.filter((r) => r && !vale(r)).forEach((r) => UI.notificar(`A reserva de ${r.cliente} expirou.`));
    }
    return ativas;
  },
  /** Diferença (servidor − este PC), medida na última reserva feita. */
  desvio() { return Number(Armazenamento.ler("pontas_relogio_desvio", "0")) || 0; },
  gravar(lista) { Armazenamento.gravar(this.CHAVE, lista); },
  salvar(r) { this.gravar(this.todas().filter((x) => x.codigo !== r.codigo).concat([r])); },
  remover(codigo) { this.gravar(this.todas().filter((x) => x.codigo !== codigo)); },
  doCodigo(codigo) { return this.todas().find((x) => x.codigo === codigo); },
  hora(ms) { return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); },

  /** Depois de sincronizar: reserva cujas barras não estão mais reservadas foi encerrada em outro lugar. */
  sincronizar(estoque) {
    const porId = new Map(estoque.map((b) => [b.id, b]));
    this.todas().forEach((r) => {
      const viva = r.ids.some((id) => ReservaLogica.pertence(porId.get(id), r));
      if (!viva) { this.remover(r.codigo); UI.notificar(`A reserva de ${r.cliente} foi encerrada.`); }
    });
    this.renderizar();
  },

  /** Tira da tela as reservas que venceram, inclusive a faixa do plano aberto. */
  verificarVencidas() {
    this.renderizar();
    if (state.reservaAtual && !this.doCodigo(state.reservaAtual)) {
      state.reservaAtual = null;
      if (state.plano && state.plano.reserva) { state.plano.reserva = null; Plano.renderizar(); }
    }
  },

  renderizar() {
    const area = $("minhasReservas");
    const lista = this.todas().sort((a, b) => a.expira - b.expira);
    area.hidden = lista.length === 0;
    area.innerHTML = `
      <div class="box-header">
        <h3 class="box-title">Minhas reservas</h3>
        <span class="box-subtitle">Feitas neste computador · valem ${CONFIG.RESERVA_HORAS} h</span>
      </div>
      ${lista.map((r) => `
        <div class="reserva-item${r.codigo === state.reservaAtual ? " atual" : ""}">
          <span class="badge">Ø ${Utils.fmt(r.bitola)}</span>
          <strong class="reserva-cliente">${Utils.escapeHTML(r.cliente)}</strong>
          <span class="mono td-dim">${r.ids.length} ponta(s) · até ${this.hora(r.expira)}</span>
          <span class="reserva-acoes">
            <button type="button" class="btn-pearl btn-sm" data-action="abrir-reserva" data-codigo="${r.codigo}">Abrir</button>
            <button type="button" class="btn-pearl btn-sm" data-action="cancelar-reserva" data-codigo="${r.codigo}">Cancelar</button>
          </span>
        </div>`).join("")}`;
  }
};

const Plano = {
  /** Barra pode entrar no cálculo: livre, ou reservada pela reserva deste pedido. */
  livre(b) {
    if (!b.reserva) return true;
    const minha = state.reservaAtual && Reservas.doCodigo(state.reservaAtual);
    return ReservaLogica.pertence(b, minha);
  },

  /** A reserva do pedido em tela só vale para o cliente dela. Devolve false (e avisa) se o cliente for outro. */
  conferirClienteDaReserva(cliente) {
    const reserva = state.plano && state.plano.reserva && Reservas.doCodigo(state.plano.reserva);
    if (!reserva || ReservaLogica.clienteConfere(cliente, reserva)) return true;
    UI.notificar(`Este pedido está ligado à reserva de ${reserva.cliente}. Para outro cliente, clique em "Novo pedido".`, true);
    return false;
  },

  /** Começa um pedido do zero, soltando a reserva que estava aberta (ela continua valendo na lista). */
  novoPedido() {
    state.reservaAtual = null;
    state.plano = null;
    state.carrinho = [];
    this.renderizarCarrinho();
    $("buscaMedida").value = "";
    $("buscaQtde").value = "1";
    $("areaResultados").innerHTML = "";
    Reservas.renderizar();
    $("buscaMedida").focus();
  },

  entradas() {
    return {
      bitola: Utils.num($("buscaBitola").value),
      medida: Utils.num($("buscaMedida").value),
      qtde: parseInt($("buscaQtde").value, 10) || 1,
      precoKg: Utils.num($("buscaPrecoKg").value) || 0,
      kerfMm: Math.min(20, Math.max(0, Utils.num($("buscaKerf").value) || 0)),
      barraNova: $("buscaBarraNova").checked
    };
  },

  validarMedida(medida, qtde) {
    if (isNaN(medida) || medida < CONFIG.SOBRA_MINIMA || medida > 50) return "Informe uma medida entre 0,05 e 50 m.";
    if (!(qtde >= 1 && qtde <= CONFIG.MAX_PECAS_PEDIDO)) return `Quantidade deve ser entre 1 e ${CONFIG.MAX_PECAS_PEDIDO}.`;
    return null;
  },

  adicionar() {
    const e = this.entradas();
    if (!e.bitola) return UI.notificar("Selecione a bitola.", true);
    const erro = this.validarMedida(e.medida, e.qtde);
    if (erro) return UI.notificar(erro, true);
    const medida = Utils.arred(e.medida);
    const ex = state.carrinho.find((i) => i.medida === medida);
    if (ex) ex.qtde += e.qtde; else state.carrinho.push({ medida, qtde: e.qtde });
    $("buscaMedida").value = "";
    $("buscaQtde").value = "1";
    $("buscaMedida").focus();
    this.renderizarCarrinho();
    this.invalidar();
  },

  remover(idx) {
    state.carrinho.splice(idx, 1);
    // Esvaziar o pedido = começar outro; a reserva aberta deixa de ser a do pedido em tela.
    if (!state.carrinho.length && state.reservaAtual) { state.reservaAtual = null; Reservas.renderizar(); }
    this.renderizarCarrinho();
    this.invalidar();
  },

  renderizarCarrinho() {
    $("areaCarrinhoCortes").hidden = state.carrinho.length === 0;
    $("listaCarrinhoCortes").innerHTML = state.carrinho.map((item, idx) => `
      <div class="cart-chip mono">
        <span><strong>${item.qtde}x</strong> de <strong>${Utils.fmt(item.medida)}m</strong></span>
        <button type="button" data-action="remover-carrinho" data-idx="${idx}" aria-label="Remover ${item.qtde}x ${Utils.fmt(item.medida)}m">${icon("x")}</button>
      </div>`).join("");
  },

  /** O pedido mudou depois do cálculo: o plano antigo não pode mais ser confirmado. */
  invalidar(motivo = 'O pedido mudou. Clique em "Calcular Aproveitamento" para refazer o plano.') {
    if (!state.plano) return;
    state.plano = null;
    $("areaResultados").innerHTML = `<div class="notice warning">${icon("alert")}<span>${Utils.escapeHTML(motivo)}</span></div>`;
  },

  validarContraEstoque(idsEstoque) {
    if (!state.plano) return;
    const perdida = state.plano.barras.some((b) => {
      if (b.nova) return false;
      const item = idsEstoque.has(b.id) && state.estoque.find((i) => i.id === b.id);
      return !item || !this.livre(item);
    });
    if (perdida) this.invalidar("O estoque mudou e alguma barra do plano não está mais disponível (vendida ou reservada). Recalcule o plano.");
  },

  calcular() {
    const e = this.entradas();
    if (!e.bitola) return UI.notificar("Selecione a bitola.", true);

    const lista = state.carrinho.slice();
    if (!isNaN(e.medida)) {
      const erro = this.validarMedida(e.medida, e.qtde);
      if (erro) return UI.notificar(erro, true);
      lista.push({ medida: Utils.arred(e.medida), qtde: e.qtde });
    }
    if (!lista.length) return UI.notificar("Adicione itens ao pedido.", true);

    const pecas = [];
    lista.forEach((p) => { for (let i = 0; i < p.qtde; i++) pecas.push(p.medida); });
    if (pecas.length > CONFIG.MAX_PECAS_PEDIDO) return UI.notificar(`Máximo de ${CONFIG.MAX_PECAS_PEDIDO} peças por pedido.`, true);

    const kerf = e.kerfMm / 1000;
    // Barras reservadas para outros pedidos ficam de fora.
    const barras = state.estoque.filter((b) => b.bitola === e.bitola && this.livre(b));
    const r = Corte.planejar(barras, pecas, { kerf, barraNova: e.barraNova ? { medida: CONFIG.BARRA_NOVA_M } : null });

    state.plano = {
      bitola: e.bitola,
      kerf,
      precoKg: e.precoKg,
      pedido: lista,
      reserva: state.reservaAtual,
      completo: r.completo,
      otimo: r.otimo,
      faltantes: r.faltantes,
      totalPecas: pecas.length,
      barras: r.barras.map((x) => {
        const somaCortes = x.cortes.reduce((s, c) => s + c, 0);
        return {
          id: x.barra.id,
          nova: !!x.barra.nova,
          bitola: e.bitola,
          medidaOriginal: x.barra.medida,
          cortes: x.cortes,
          descricao: Utils.descreverCortes(x.cortes),
          sobra: x.sobra,
          geraSobra: x.sobra >= CONFIG.SOBRA_MINIMA,
          pesoTotal: Utils.peso(e.bitola, x.barra.medida),
          pesoPecas: Utils.peso(e.bitola, somaCortes)
        };
      })
    };
    this.renderizar();
  },

  /** Rótulo curto da barra: "#123" ou "Barra nova 12 m". */
  rotulo(b) {
    return b.nova ? `Barra nova ${Utils.fmt(b.medidaOriginal, 0)} m` : `#${b.id}`;
  },

  renderizar() {
    const p = state.plano;
    const area = $("areaResultados");
    if (!p) { area.innerHTML = ""; return; }
    const clienteAnterior = $("inputClienteCorte") ? $("inputClienteCorte").value : "";

    let aviso = "";
    if (!p.completo) {
      const falt = Utils.descreverCortes(p.faltantes);
      aviso = `<div class="notice danger">${icon("alert")}<span>Estoque insuficiente na bitola Ø ${Utils.fmt(p.bitola)} mm: faltaram <strong>${p.faltantes.length}</strong> peça(s) (${falt}).
        ${p.otimo ? "Todas as combinações foram verificadas." : "A busca atingiu o limite de tentativas; pode haver combinação melhor."}
        ${p.barras.length ? "Abaixo, o que é possível atender com o estoque atual." : ""}</span></div>`;
      if (!p.barras.length) { area.innerHTML = aviso; return; }
    }

    const pBruto = p.barras.reduce((s, b) => s + b.pesoTotal, 0);
    const pPecas = p.barras.reduce((s, b) => s + b.pesoPecas, 0);
    const pRetorno = p.barras.reduce((s, b) => s + (b.geraSobra ? Utils.peso(b.bitola, b.sobra) : 0), 0);
    const pPerda = Math.max(0, pBruto - pPecas - pRetorno);
    const novas = p.barras.filter((b) => b.nova).length;
    const temPontas = p.barras.length > novas;
    const reserva = p.reserva ? Reservas.doCodigo(p.reserva) : null;
    const idsPontas = p.barras.filter((b) => !b.nova).map((b) => b.id);
    const rotuloReservar = !reserva ? `Reservar por ${CONFIG.RESERVA_HORAS}h`
      : ReservaLogica.mesmasBarras(idsPontas, reserva) ? `Renovar reserva (${CONFIG.RESERVA_HORAS}h)` : "Atualizar reserva";
    const qualidade = (p.completo
      ? (p.otimo ? "Melhor combinação possível" : "Combinação aproximada (pedido muito grande para verificar todas)")
      : "Plano parcial") + (novas ? ` · ${novas} barra(s) nova(s) de ${CONFIG.BARRA_NOVA_M} m` : "");

    area.innerHTML = `
      <div class="box">
        <div class="box-header">
          <h3 class="box-title">Plano sugerido · Ø ${Utils.fmt(p.bitola)} mm</h3>
          <span class="box-subtitle">${qualidade}${p.kerf ? ` · perda de ${Utils.fmt(p.kerf * 1000, 1)} mm por corte` : ""}</span>
        </div>
        ${aviso}
        <div class="summary-grid">
          <div class="kpi-card"><div class="kpi-label">Barras usadas</div><div class="kpi-value">${p.barras.length}</div></div>
          <div class="kpi-card"><div class="kpi-label">Peso bruto</div><div class="kpi-value">${Utils.fmt(pBruto)} kg</div></div>
          <div class="kpi-card"><div class="kpi-label">Peso das peças</div><div class="kpi-value destaque">${Utils.fmt(pPecas)} kg</div></div>
          <div class="kpi-card"><div class="kpi-label">Volta ao estoque</div><div class="kpi-value">${Utils.fmt(pRetorno)} kg</div></div>
          <div class="kpi-card"><div class="kpi-label">Perda</div><div class="kpi-value">${Utils.fmt(pPerda)} kg</div><div class="kpi-sub">corte + sucata &lt; ${Utils.fmt(CONFIG.SOBRA_MINIMA)} m</div></div>
          ${p.precoKg > 0 ? `<div class="kpi-card"><div class="kpi-label">Valor das peças</div><div class="kpi-value destaque">${Utils.moeda(pPecas * p.precoKg)}</div></div>` : ""}
        </div>
        ${p.barras.map((b) => this.htmlBarra(b)).join("")}
        <div class="form-group" style="margin-top:20px;">
          <label for="inputClienteCorte">Cliente / Nº do pedido</label>
          <input type="text" id="inputClienteCorte" maxlength="100" placeholder="Ex: João / Pedido 4510" value="${Utils.escapeHTML(clienteAnterior || (reserva ? reserva.cliente : ""))}">
        </div>
        ${reserva ? `
        <div class="reserva-faixa" role="status">
          ${icon("tag")}<span>Reservado para <strong>${Utils.escapeHTML(reserva.cliente)}</strong> até <strong class="mono">${Reservas.hora(reserva.expira)}</strong></span>
          <span class="reserva-acoes">
            <button type="button" class="btn-pearl btn-sm" data-action="novo-pedido" title="Atender outro cliente; esta reserva continua valendo">${icon("plus")}Novo pedido</button>
            <button type="button" class="btn-pearl btn-sm" data-action="cancelar-reserva" data-codigo="${reserva.codigo}">${icon("x")}Cancelar reserva</button>
          </span>
        </div>` : ""}
        <div class="actions-row">
          <button type="button" class="btn-secondary" data-action="copiar-whatsapp">${icon("copy")}Copiar p/ WhatsApp</button>
          <button type="button" class="btn-secondary" data-action="imprimir-ordem">${icon("printer")}Imprimir ordem de corte</button>
          ${temPontas ? `<button type="button" class="btn-secondary" data-action="reservar-plano">${icon("tag")}${rotuloReservar}</button>` : ""}
          <button type="button" class="btn" data-action="confirmar-baixa-plano">${icon("check")}Confirmar baixa</button>
        </div>
        <p class="input-hint" style="margin-top:12px; text-align:right;">As etiquetas das sobras saem depois da confirmação, com os IDs definitivos da planilha.</p>
      </div>`;
  },

  /** Uma barra do plano: cabeçalho + a barra de aço cortada sobre a trena. */
  htmlBarra(b) {
    const L = b.medidaOriginal;
    const sucata = b.sobra > 0 && !b.geraSobra;
    const rotuloSobra = b.geraSobra ? "Sobra · nova ponta" : sucata ? "Sucata" : "Sem sobra";
    const segmentos = b.cortes.map((c) => {
      const largo = c / L >= 0.09;
      return `<div class="cut-segment" style="flex:${c} 1 0" title="${Utils.fmt(c)} m">${largo ? Utils.fmt(c) : ""}</div>`;
    }).join("");
    const resto = b.sobra > 0.005
      ? `<div class="cut-leftover${sucata ? " sucata" : ""}" style="flex:${b.sobra} 1 0" title="${rotuloSobra}: ${Utils.fmt(b.sobra)} m">${b.sobra / L >= 0.09 ? Utils.fmt(b.sobra) : ""}</div>`
      : "";
    return `
      <div class="result-card">
        <div class="result-header">
          <div class="result-info">
            <h3>${b.nova ? `<span class="badge nova">BARRA NOVA</span>` : `<span class="badge">#${b.id}</span>`} Barra de <strong class="mono">${Utils.fmt(L)} m</strong></h3>
            <p>Cortar <strong class="mono">${b.descricao}</strong> · <span class="mono">${Utils.fmt(b.pesoTotal)} kg</span></p>
          </div>
          <div class="sobra-box">
            <p class="sobra-label">${rotuloSobra}</p>
            <div class="sobra-val ${b.geraSobra ? "reaproveita" : sucata ? "sucata" : ""}">${Utils.fmt(b.sobra)} m</div>
          </div>
        </div>
        <div class="barra-corte" role="img" aria-label="Barra de ${Utils.fmt(L)} metros: ${b.descricao}; sobra de ${Utils.fmt(b.sobra)} metros">
          <div class="cut-bar-visual">${segmentos}${resto}</div>
          ${this.htmlTrena(L)}
        </div>
      </div>`;
  },

  /** Trena graduada: marcas a cada 0,5 m (1 m em barras longas), números espaçados para não encavalar. */
  htmlTrena(L) {
    const passo = L > 6 ? 1 : 0.5;
    const passoRotulo = L > 6 ? 2 : 1;
    const marcas = [];
    for (let t = 0; t <= L + 1e-9; t = Utils.arred(t + passo)) {
      const inteiro = Math.abs(t - Math.round(t)) < 1e-9;
      const rotular = inteiro && Math.round(t) % passoRotulo === 0 && (t === 0 || L - t >= passoRotulo * 0.6);
      marcas.push(`<span class="trena-tick${inteiro ? " major" : ""}${t === 0 ? " inicio" : ""}" style="left:${(t / L) * 100}%">${rotular ? `<span>${t}</span>` : ""}</span>`);
    }
    marcas.push(`<span class="trena-tick major fim" style="left:100%"><span>${Utils.fmt(L)} m</span></span>`);
    return `<div class="trena" aria-hidden="true">${marcas.join("")}</div>`;
  },

  cliente() {
    return ($("inputClienteCorte") ? $("inputClienteCorte").value : "").trim();
  },

  async copiarWhatsApp() {
    const p = state.plano;
    if (!p || !p.barras.length) return;
    const c = this.cliente();
    const linhas = [`✂️ *ORDEM DE CORTE - GRANDE AÇO*`, `Bitola: Ø ${Utils.fmt(p.bitola)} mm`];
    if (c) linhas.push(`👤 *Cliente:* ${c}`);
    linhas.push("------------------");
    p.barras.forEach((b) => linhas.push(`▪ *${b.nova ? "BARRA NOVA" : "ID #" + b.id}* (${Utils.fmt(b.medidaOriginal)}m) ↳ ${b.descricao} | Sobra: ${Utils.fmt(b.sobra)}m`));
    if (!p.completo) linhas.push(`⚠️ Faltaram ${p.faltantes.length} peça(s): ${Utils.descreverCortes(p.faltantes)}`);
    try {
      await Utils.copiarTexto(linhas.join("\n"));
      UI.notificar("Ordem copiada! Cole no WhatsApp.");
    } catch (e) {
      UI.notificar("Não foi possível copiar automaticamente.", true);
    }
  },

  imprimirOrdem() {
    const p = state.plano;
    if (!p || !p.barras.length) return;
    const c = Utils.escapeHTML(this.cliente() || "Balcão");
    Impressao.imprimir(`
      <div class="print-section-title"><img src="assets/logo-preto.png" alt="Grande Aço">ORDEM DE CORTE - ${c} (${Utils.hojeBR()}) - Ø ${Utils.fmt(p.bitola)} mm</div>
      ${p.barras.map((b) => `<div class="print-order-item"><strong>${b.nova ? "BARRA NOVA" : "ID #" + b.id}</strong> (${Utils.fmt(b.medidaOriginal)}m) ➔ Cortar: <strong>${b.descricao}</strong> | Sobra: <strong>${Utils.fmt(b.sobra)}m</strong>${b.geraSobra ? " (volta ao estoque)" : ""}</div>`).join("")}
      ${!p.completo ? `<div class="print-order-item"><strong>ATENÇÃO:</strong> faltaram ${p.faltantes.length} peça(s): ${Utils.descreverCortes(p.faltantes)}</div>` : ""}`);
  },

  async confirmarBaixa(btn) {
    const p = state.plano;
    if (!p || !p.barras.length) return;
    const cliente = this.cliente();
    if (!this.conferirClienteDaReserva(cliente)) return;
    const sobras = p.barras.filter((b) => b.geraSobra).length;
    const ok = await UI.confirmar({
      titulo: "Confirmar baixa",
      html: `${!p.completo ? '<div class="notice warning">Plano parcial: nem todas as peças do pedido serão atendidas.</div>' : ""}
        <p>${p.barras.length} barra(s) serão marcadas como <strong>vendidas</strong>${cliente ? ` para <strong>${Utils.escapeHTML(cliente)}</strong>` : ""}:</p>
        <ul>${p.barras.map((b) => `<li class="mono">${this.rotulo(b)} — ${Utils.fmt(b.medidaOriginal)}m → ${b.descricao}</li>`).join("")}</ul>
        <p>${sobras ? `${sobras} sobra(s) voltarão ao estoque com novo ID.` : "Nenhuma sobra voltará ao estoque."}</p>`,
      ok: "Confirmar Baixa",
      perigo: true
    });
    if (!ok) return;

    await executar(btn, "Processando...", async () => {
      const r = await API.chamar("baixar", {
        cliente,
        kerf: p.kerf,
        precoKg: p.precoKg || undefined,
        reserva: p.reserva || undefined,
        instrucoes: p.barras.map((b) => (b.nova
          ? { nova: true, bitola: b.bitola, cortes: b.cortes }
          : { id: b.id, cortes: b.cortes }))
      });
      UI.notificar(r.mensagem);
      if (p.reserva) Reservas.remover(p.reserva);
      state.reservaAtual = null;
      Reservas.renderizar();
      state.plano = null;
      state.carrinho = [];
      state.ultimasSobras = r.sobras || [];
      this.renderizarCarrinho();
      $("buscaMedida").value = "";
      $("buscaQtde").value = "1";
      $("areaResultados").innerHTML = `
        <div class="result-panel">
          <h4>${icon("check")}Baixa registrada</h4>
          <p>${Utils.escapeHTML(r.mensagem)}</p>
          ${state.ultimasSobras.length ? `
            <p>Novas pontas: ${state.ultimasSobras.map((s) => `<strong class="mono">#${s.id}</strong> (${Utils.fmt(s.medida)}m, ${s.idOrigem ? "da #" + s.idOrigem : "de barra nova"})`).join(" · ")}</p>
            <button type="button" class="btn" data-action="imprimir-sobras">${icon("tag")}Imprimir etiquetas das sobras</button>` : ""}
        </div>`;
      await Dados.carregar({ silencioso: true });
    });
  },

  /** Reserva (ou atualiza a reserva de) as pontas do plano por RESERVA_HORAS. */
  async reservar(btn) {
    const p = state.plano;
    if (!p) return;
    const ids = p.barras.filter((b) => !b.nova).map((b) => b.id);
    if (!ids.length) return UI.notificar("Este plano usa só barra nova: não há pontas para reservar.", true);
    const cliente = this.cliente();
    if (!cliente) {
      UI.notificar("Informe o cliente ou o nº do pedido para reservar.", true);
      $("inputClienteCorte").focus();
      return;
    }
    if (!this.conferirClienteDaReserva(cliente)) return;
    await executar(btn, "Reservando...", async () => {
      const r = await API.chamar("reservar", { ids, cliente, codigo: p.reserva || undefined });
      Armazenamento.gravar("pontas_relogio_desvio", String(ReservaLogica.desvioRelogio(r.expira, CONFIG.RESERVA_HORAS, Date.now())));
      Reservas.salvar({
        codigo: r.codigo, cliente, bitola: p.bitola, kerfMm: p.kerf * 1000, precoKg: p.precoKg,
        barraNova: $("buscaBarraNova").checked, carrinho: p.pedido, ids: r.ids, expira: r.expira
      });
      state.reservaAtual = r.codigo;
      p.reserva = r.codigo;
      UI.notificar(r.mensagem);
      Reservas.renderizar();
      this.renderizar();
      await Dados.carregar({ silencioso: true });
    });
  },

  async cancelarReserva(codigo, btn) {
    const r = Reservas.doCodigo(codigo);
    const ok = await UI.confirmar({
      titulo: "Cancelar reserva",
      html: `<p>Liberar as pontas reservadas${r ? ` para <strong>${Utils.escapeHTML(r.cliente)}</strong>` : ""}? Outros vendedores voltam a poder usá-las.</p>`,
      ok: "Cancelar reserva",
      perigo: true
    });
    if (!ok) return;
    await executar(btn, "Cancelando...", async () => {
      const res = await API.chamar("cancelarReserva", { codigo });
      Reservas.remover(codigo);
      if (state.reservaAtual === codigo) {
        state.reservaAtual = null;
        if (state.plano) { state.plano.reserva = null; this.renderizar(); }
      }
      UI.notificar(res.mensagem);
      Reservas.renderizar();
      await Dados.carregar({ silencioso: true });
    });
  },

  /** Recarrega o pedido de uma reserva e refaz o plano para confirmar a baixa. */
  abrirReserva(codigo) {
    const r = Reservas.doCodigo(codigo);
    if (!r) return UI.notificar("Essa reserva já não está ativa.", true);
    state.reservaAtual = codigo;
    $("buscaBitola").value = String(r.bitola);
    $("buscaKerf").value = String(r.kerfMm || 0);
    $("buscaPrecoKg").value = r.precoKg ? String(r.precoKg) : "";
    $("buscaBarraNova").checked = r.barraNova !== false;
    $("buscaMedida").value = "";
    $("buscaQtde").value = "1";
    state.carrinho = (r.carrinho || []).map((i) => ({ medida: i.medida, qtde: i.qtde }));
    this.renderizarCarrinho();
    if ($("inputClienteCorte")) $("inputClienteCorte").value = "";
    this.calcular();
    if ($("inputClienteCorte")) $("inputClienteCorte").value = r.cliente;
    Reservas.renderizar();
    $("areaResultados").scrollIntoView({ behavior: "smooth", block: "start" });
  }
};

// ============================================================================
// IMPRESSÃO (etiquetas térmicas e ordens)
// ============================================================================
const Impressao = {
  paperSize: "100x50",

  init() {
    this.paperSize = Armazenamento.ler("pontas_paperSize", "100x50");
    const sel = $("printerPaperSize");
    sel.value = this.paperSize;
    sel.addEventListener("change", (e) => {
      this.paperSize = e.target.value;
      Armazenamento.gravar("pontas_paperSize", this.paperSize);
      this.aplicarEstiloPagina();
      UI.notificar("Formato da etiqueta: " + this.paperSize);
    });
    window.addEventListener("afterprint", () => { $("printArea").innerHTML = ""; });
    this.aplicarEstiloPagina();
  },

  qrSize() {
    if (this.paperSize === "60x40") return 76;
    if (this.paperSize === "80x40") return 98;
    return 122;
  },

  htmlEtiqueta(barra, canvasId) {
    const data = barra.data && barra.data !== "-" ? Utils.escapeHTML(barra.data) : Utils.hojeBR();
    return `
      <div class="thermal-label">
        <div class="thermal-label-info">
          <div class="tl-header"><img class="tl-mark" src="assets/monograma-preto.png" alt="">GRANDE AÇO · PONTA</div>
          <div class="tl-id-box">ID #${Number(barra.id)}</div>
          <div class="tl-specs">
            <div class="tl-row">
              <svg class="tl-icon" viewBox="0 0 24 24" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"></circle><line x1="5" y1="19" x2="19" y2="5"></line></svg>
              <span>${Utils.fmt(barra.bitola)} mm</span>
              <span class="tl-divider">|</span>
              <svg class="tl-icon" viewBox="0 0 24 24" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="11" r="6"></circle><circle cx="9" cy="11" r="2"></circle><path d="M9 17h12v-4H14"></path><line x1="16" y1="17" x2="16" y2="15"></line><line x1="19" y1="17" x2="19" y2="15"></line></svg>
              <span>${Utils.fmt(barra.medida)} m</span>
            </div>
            <div class="tl-row">
              <svg class="tl-icon" viewBox="0 0 24 24" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5h6"></path><path d="M12 5v3"></path><path d="M6 8h12l2 12H4L6 8z"></path></svg>
              <span>Peso: ${Utils.fmt(barra.peso || Utils.peso(barra.bitola, barra.medida))} kg</span>
            </div>
            <div class="tl-row">
              <svg class="tl-icon" viewBox="0 0 24 24" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="9" x2="21" y2="9"></line><circle cx="8" cy="13" r="1" fill="#000"></circle><circle cx="12" cy="13" r="1" fill="#000"></circle><circle cx="16" cy="13" r="1" fill="#000"></circle><circle cx="8" cy="17" r="1" fill="#000"></circle><circle cx="12" cy="17" r="1" fill="#000"></circle><circle cx="16" cy="17" r="1" fill="#000"></circle></svg>
              <span>Data: ${data}</span>
            </div>
          </div>
        </div>
        <div class="thermal-qr-box"><canvas id="${canvasId}"></canvas></div>
      </div>`;
  },

  /** Renderiza na área de impressão, gera os QR codes, espera as fontes e imprime. */
  async imprimir(html, qrs = []) {
    if (qrs.length && typeof QRious === "undefined") {
      return UI.notificar("A biblioteca de QR Code não carregou. Verifique a internet e recarregue.", true);
    }
    $("printArea").innerHTML = html;
    qrs.forEach((q) => new QRious({ element: $(q.canvasId), value: String(q.valor), size: this.qrSize(), level: "M" }));
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) { /* ignora */ }
    // Monograma e logo precisam estar carregados antes de abrir a impressão
    await Promise.all([...$("printArea").querySelectorAll("img")].map((img) =>
      img.complete ? Promise.resolve() : new Promise((r) => { img.onload = img.onerror = r; })));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.print();
  },

  async imprimirEtiquetas(lista) {
    if (!lista || !lista.length) return UI.notificar("Nenhuma etiqueta para imprimir.", true);
    if (lista.length > CONFIG.LOTE_CONFIRMAR_IMPRESSAO) {
      const ok = await UI.confirmar({ titulo: "Imprimir em lote", html: `<p>Imprimir <strong>${lista.length}</strong> etiquetas de uma vez?</p>`, ok: "Imprimir" });
      if (!ok) return;
    }
    const qrs = [];
    const html = `<div class="print-labels-grid">${lista.map((b, i) => {
      const canvasId = `qr_${i}_${Number(b.id)}`;
      qrs.push({ canvasId, valor: b.id });
      return this.htmlEtiqueta(b, canvasId);
    }).join("")}</div>`;
    this.imprimir(html, qrs);
  },

  imprimirTeste() {
    Modal.fechar("modalImpressora");
    const b = state.estoque[0] || { id: 267, bitola: 6.3, medida: 0.84, peso: 0.21, data: Utils.hojeBR() };
    this.imprimirEtiquetas([b]);
  },

  aplicarEstiloPagina() {
    let el = $("dynamicPrintStyle");
    if (!el) {
      el = document.createElement("style");
      el.id = "dynamicPrintStyle";
      document.head.appendChild(el);
    }
    const estilos = {
      "100x50": `
        @page { size: 100mm 50mm; margin: 0mm; }
        .print-labels-grid { display: block !important; margin: 0 !important; }
        .thermal-label { width: 96mm !important; height: 46mm !important; margin: 2mm auto !important; padding: 3.5mm 4mm !important; border-width: 2.5px !important; border-radius: 12px !important; }
        .tl-header { font-size: 10pt !important; margin-bottom: 3px !important; }
        .tl-id-box { font-size: 22pt !important; padding: 2px 10px !important; margin-bottom: 6px !important; }
        .tl-row { font-size: 10.5pt !important; gap: 5px !important; }
        .tl-icon { width: 15px !important; height: 15px !important; }`,
      "80x40": `
        @page { size: 80mm 40mm; margin: 0mm; }
        .print-labels-grid { display: block !important; margin: 0 !important; }
        .thermal-label { width: 76mm !important; height: 36mm !important; margin: 2mm auto !important; padding: 2.5mm 3mm !important; border-width: 2px !important; border-radius: 10px !important; }
        .tl-header { font-size: 8.5pt !important; margin-bottom: 2px !important; }
        .tl-id-box { font-size: 17pt !important; padding: 1px 7px !important; margin-bottom: 4px !important; }
        .tl-row { font-size: 8.5pt !important; gap: 4px !important; }
        .tl-icon { width: 13px !important; height: 13px !important; }
        .thermal-qr-box { padding: 4px !important; }`,
      "60x40": `
        @page { size: 60mm 40mm; margin: 0mm; }
        .print-labels-grid { display: block !important; margin: 0 !important; }
        .thermal-label { width: 57mm !important; height: 36mm !important; margin: 2mm auto !important; padding: 2mm !important; border-width: 2px !important; border-radius: 8px !important; gap: 6px !important; }
        .tl-header { font-size: 7pt !important; margin-bottom: 2px !important; }
        .tl-id-box { font-size: 13pt !important; padding: 1px 5px !important; margin-bottom: 3px !important; }
        .tl-row { font-size: 7pt !important; gap: 3px !important; }
        .tl-icon { width: 11px !important; height: 11px !important; }
        .thermal-qr-box { padding: 3px !important; border-width: 1.5px !important; }`,
      a4: `@page { size: A4; margin: 10mm; }`
    };
    el.textContent = `@media print { ${estilos[this.paperSize] || estilos.a4} }`;
  }
};

// ============================================================================
// ESTOQUE
// ============================================================================
const Estoque = {
  atualizarSelects() {
    const bitolas = [...new Set(state.estoque.map((i) => i.bitola))].filter((b) => b > 0).sort((a, b) => a - b);
    const opcoes = bitolas.map((b) => `<option value="${b}">Ø ${Utils.fmt(b)} mm</option>`).join("");

    // Plano de corte: bitolas com pontas + comerciais (a barra nova atende mesmo sem ponta livre).
    const livres = new Map();
    state.estoque.forEach((i) => { if (Plano.livre(i)) livres.set(i.bitola, (livres.get(i.bitola) || 0) + 1); });
    const todas = [...new Set(bitolas.concat(CONFIG.BITOLAS_COMERCIAIS))].sort((a, b) => a - b);
    const sel = $("buscaBitola");
    const atual = sel.value;
    sel.innerHTML = `<option value="">Selecione...</option>` + todas.map((b) => {
      const n = livres.get(b) || 0;
      return `<option value="${b}" title="${n} ponta(s) livre(s)">Ø ${Utils.fmt(b)} mm (${n})</option>`;
    }).join("");
    if (atual && todas.includes(Number(atual))) sel.value = atual;

    const filtro = $("filtroTabelaBitola");
    const filtroAtual = filtro.value;
    filtro.innerHTML = '<option value="TODAS">Todas</option>' + opcoes;
    filtro.value = bitolas.includes(Number(filtroAtual)) ? filtroAtual : "TODAS";
  },

  renderizar() {
    const est = state.estoque;
    $("kpisEstoque").innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Total de Pontas</div><div class="kpi-value">${est.length} un</div></div>
      <div class="kpi-card"><div class="kpi-label">Metragem Linear</div><div class="kpi-value">${est.reduce((s, i) => s + i.medida, 0).toFixed(1)} m</div></div>
      <div class="kpi-card"><div class="kpi-label">Peso total</div><div class="kpi-value destaque">${est.reduce((s, i) => s + i.peso, 0).toFixed(1)} kg</div></div>`;

    const mapa = new Map();
    est.forEach((i) => {
      if (!mapa.has(i.bitola)) mapa.set(i.bitola, { q: 0, m: 0 });
      const g = mapa.get(i.bitola);
      g.q++;
      g.m += i.medida;
    });
    const filtroAtual = $("filtroTabelaBitola").value;
    $("cardsBitolaEstoque").innerHTML = [...mapa.keys()].sort((a, b) => a - b).map((b) => `
      <button type="button" class="bitola-card ${filtroAtual === String(b) ? "active" : ""}" data-action="filtrar-bitola" data-bitola="${b}" aria-pressed="${filtroAtual === String(b)}">
        <span class="bc-title">Ø ${Utils.fmt(b)} mm</span>
        <span class="bc-row"><span>Barras:</span> <strong>${mapa.get(b).q}</strong></span>
        <span class="bc-row"><span>Metros:</span> <strong>${mapa.get(b).m.toFixed(1)} m</strong></span>
      </button>`).join("");
    this.renderizarTabela();
  },

  filtrarBitola(b) {
    const filtro = $("filtroTabelaBitola");
    filtro.value = filtro.value === String(b) ? "TODAS" : String(b);
    this.renderizar();
  },

  /** Busca: "#314" → ID · "3.5" → medida mínima · texto → observação/data. */
  filtrar() {
    const bit = $("filtroTabelaBitola").value;
    const termo = $("filtroTabelaBusca").value.trim().toLowerCase();
    let teste = () => true;
    if (termo.startsWith("#")) {
      const id = termo.slice(1).trim();
      teste = (i) => !id || String(i.id).startsWith(id);
    } else if (/^\d+([.,]\d+)?$/.test(termo)) {
      const min = Utils.num(termo);
      teste = (i) => i.medida >= min - 1e-9;
    } else if (termo) {
      teste = (i) => i.obs.toLowerCase().includes(termo) || i.data.includes(termo);
    }
    return state.estoque
      .filter((i) => (bit === "TODAS" || i.bitola === Number(bit)) && teste(i))
      .sort((a, b) => a.bitola - b.bitola || b.medida - a.medida);
  },

  renderizarTabela() {
    const lista = this.filtrar();
    state.listaFiltrada = lista;
    const corpo = $("tabelaEstoqueBody");

    if (!lista.length) {
      const msg = !Auth.token() ? "Entre com seu perfil para carregar o estoque." : "Nenhuma ponta encontrada.";
      corpo.innerHTML = `<tr><td colspan="8" class="td-dim" style="text-align:center; padding:28px;">${msg}</td></tr>`;
    } else {
      corpo.innerHTML = lista.map((b) => `
        <tr>
          <td style="text-align:center;"><input type="checkbox" class="check-item-estoque" data-id="${b.id}" aria-label="Selecionar #${b.id}" ${state.selecionados.has(b.id) ? "checked" : ""}></td>
          <td><span class="badge">#${b.id}</span></td>
          <td class="mono td-dim">${Utils.escapeHTML(b.data)}</td>
          <td class="mono"><strong>Ø ${Utils.fmt(b.bitola)} mm</strong></td>
          <td class="mono td-medida">${Utils.fmt(b.medida)} m</td>
          <td class="mono">${Utils.fmt(b.peso)} kg</td>
          <td class="td-dim">${b.reserva ? `<span class="selo-reserva">Reservada · ${Utils.escapeHTML(b.reserva.para)} · até ${Reservas.hora(b.reserva.ate)}</span> ` : ""}${Utils.escapeHTML(b.obs)}</td>
          <td><div class="td-acoes">
            <button type="button" class="btn-pearl btn-sm btn-icon" data-action="imprimir-etiqueta" data-id="${b.id}" title="Imprimir etiqueta" aria-label="Imprimir etiqueta #${b.id}">${icon("tag")}</button>
            ${b.reserva
              ? `<button type="button" class="btn-pearl btn-sm so-operador" data-action="cancelar-reserva-id" data-id="${b.id}" title="Liberar esta ponta da reserva">${icon("x")}Liberar</button>`
              : `<button type="button" class="btn-danger contorno btn-sm so-operador" data-action="ir-baixa" data-id="${b.id}">Baixar</button>`}
          </div></td>
        </tr>`).join("");
    }
    this.sincronizarCheckTodas();
    this.atualizarBotaoSelecionadas();
  },

  alternarItem(id, marcado) {
    if (marcado) state.selecionados.add(id); else state.selecionados.delete(id);
    this.sincronizarCheckTodas();
    this.atualizarBotaoSelecionadas();
  },

  alternarTodas(marcado) {
    state.listaFiltrada.forEach((b) => (marcado ? state.selecionados.add(b.id) : state.selecionados.delete(b.id)));
    document.querySelectorAll(".check-item-estoque").forEach((c) => (c.checked = marcado));
    this.atualizarBotaoSelecionadas();
  },

  sincronizarCheckTodas() {
    const lista = state.listaFiltrada;
    const marcadas = lista.filter((b) => state.selecionados.has(b.id)).length;
    const master = $("checkTodasEstoque");
    master.checked = lista.length > 0 && marcadas === lista.length;
    master.indeterminate = marcadas > 0 && marcadas < lista.length;
  },

  atualizarBotaoSelecionadas() {
    $("countSelecionadas").textContent = state.selecionados.size;
    $("btnImprimirSelecionadas").hidden = state.selecionados.size === 0;
  },

  imprimirSelecionadas() {
    Impressao.imprimirEtiquetas(state.estoque.filter((b) => state.selecionados.has(b.id)));
  },

  imprimirVisiveis() {
    Impressao.imprimirEtiquetas(state.listaFiltrada);
  },

  /** Operador libera uma ponta reservada (pelo ID, sem o código). */
  async cancelarReservaId(id, btn) {
    const b = state.estoque.find((i) => i.id === id);
    if (!b || !b.reserva) return;
    const ok = await UI.confirmar({
      titulo: "Liberar ponta reservada",
      html: `<p>Liberar <strong class="mono">#${b.id}</strong>, reservada para <strong>${Utils.escapeHTML(b.reserva.para)}</strong> até ${Reservas.hora(b.reserva.ate)}?</p>`,
      ok: "Liberar",
      perigo: true
    });
    if (!ok) return;
    await executar(btn, "Liberando...", async () => {
      const r = await API.chamar("cancelarReserva", { id });
      UI.notificar(r.mensagem);
      await Dados.carregar({ silencioso: true });
    });
  },

  imprimirUma(id) {
    const b = state.estoque.find((i) => i.id === id);
    if (b) Impressao.imprimirEtiquetas([b]);
  }
};

// ============================================================================
// CADASTRO
// ============================================================================
const Cadastro = {
  popularBitolas() {
    $("cadBitolaSelect").innerHTML = CONFIG.BITOLAS_COMERCIAIS
      .map((b) => `<option value="${b}" ${b === CONFIG.BITOLA_PADRAO ? "selected" : ""}>${Utils.fmt(b)} mm</option>`).join("")
      + '<option value="OUTRA">Outra medida...</option>';
  },

  bitola() {
    const sel = $("cadBitolaSelect").value;
    return sel === "OUTRA" ? Utils.num($("cadBitolaCustom").value) : Utils.num(sel);
  },

  atualizarPreview() {
    const bitola = this.bitola();
    const medida = Utils.num($("cadMedida").value);
    const qtde = parseInt($("cadQtde").value, 10) || 1;
    $("previewPesoCadastro").innerHTML = bitola > 0 && medida > 0
      ? `Peso estimado: <strong class="mono">${Utils.fmt(Utils.peso(bitola, medida))} kg/barra</strong> (Total: <strong class="mono">${Utils.fmt(Utils.peso(bitola, medida) * qtde)} kg</strong>)`
      : "";
  },

  async executar(btn) {
    const bitola = this.bitola();
    const medida = Utils.num($("cadMedida").value);
    const qtde = parseInt($("cadQtde").value, 10);
    const obs = $("cadObs").value.trim();
    if (!(bitola >= 1 && bitola <= 100)) return UI.notificar("Informe uma bitola válida (1 a 100 mm).", true);
    if (!(medida >= CONFIG.SOBRA_MINIMA && medida <= 50)) return UI.notificar("Informe uma medida entre 0,05 e 50 m.", true);
    if (!(qtde >= 1 && qtde <= 200)) return UI.notificar("Quantidade deve ser entre 1 e 200.", true);
    if (qtde >= 10) {
      const ok = await UI.confirmar({
        titulo: "Confirmar cadastro",
        html: `<p>Cadastrar <strong>${qtde}</strong> pontas de <strong class="mono">Ø ${Utils.fmt(bitola)} mm × ${Utils.fmt(medida)} m</strong>?</p>`,
        ok: "Cadastrar"
      });
      if (!ok) return;
    }

    await executar(btn, "Salvando...", async () => {
      const r = await API.chamar("cadastrar", { bitola, medida, qtde, obs });
      UI.notificar(r.mensagem);
      state.ultimosCadastrados = r.itens || [];
      $("cadMedida").value = "";
      $("cadObs").value = "";
      $("cadQtde").value = "1";
      this.atualizarPreview();
      $("resultadoCadastro").innerHTML = state.ultimosCadastrados.length ? `
        <div class="result-panel">
          <h4>${icon("check")}${Utils.escapeHTML(r.mensagem)}</h4>
          <button type="button" class="btn" data-action="imprimir-cadastrados">${icon("tag")}Imprimir etiquetas (${state.ultimosCadastrados.length})</button>
        </div>` : "";
      await Dados.carregar({ silencioso: true });
    });
  }
};

// ============================================================================
// PAINEL DE APROVEITAMENTO
// ============================================================================
const PainelUI = {
  movs: [],

  periodoEscolhido() {
    const sel = $("painelPeriodo").value;
    $("painelDatas").hidden = sel !== "custom";
    if (sel !== "custom") return Painel.periodo(sel, new Date());
    const de = $("painelDe").value, ate = $("painelAte").value;
    if (!de || !ate) return null;
    if (de > ate) { UI.notificar("A data inicial é depois da final.", true); return null; }
    return { de, ate };
  },

  async carregar() {
    if (!Auth.token()) return;
    this.renderizarParadas();
    const p = this.periodoEscolhido();
    if (!p) return;
    $("painelResumo").innerHTML = `<p class="td-dim">Carregando…</p>`;
    try {
      const r = await API.chamar("movimentos", p);
      this.movs = r.movimentos || [];
      this.renderizar(p);
    } catch (e) {
      if (e.codigo !== "AUTH") $("painelResumo").innerHTML = `<div class="notice danger">${icon("alert")}<span>${Utils.escapeHTML(e.message)}</span></div>`;
    }
  },

  renderizar(p) {
    const r = Painel.resumir(this.movs);
    const kg = (v) => `${Utils.fmt(v, 1)} kg`;
    const pct = (t) => (t === null ? "—" : `${Math.round(t * 100)}%`);
    const dataBR = (iso) => iso.split("-").reverse().join("/");
    const temBaixa = this.movs.some((m) => m.acao === "baixa" && !m.estornado);
    $("painelBitolasBox").hidden = !temBaixa;
    if (!temBaixa) {
      $("painelResumo").innerHTML = `<div class="painel-vazio">Sem baixas de ${dataBR(p.de)} a ${dataBR(p.ate)}.</div>`;
      return;
    }
    $("painelResumo").innerHTML = `
      <p class="box-subtitle" style="margin:-8px 0 14px">${dataBR(p.de)} a ${dataBR(p.ate)}</p>
      <div class="summary-grid">
        <div class="kpi-card"><div class="kpi-label">Reaproveitado de pontas</div><div class="kpi-value destaque">${kg(r.kgReaproveitado)}</div><div class="kpi-sub">peças + pontas vendidas inteiras</div></div>
        <div class="kpi-card"><div class="kpi-label">Aproveitamento</div><div class="kpi-value">${pct(r.taxa)}</div><div class="kpi-sub">das pontas usadas virou peça</div></div>
        <div class="kpi-card"><div class="kpi-label">Valor recuperado</div><div class="kpi-value destaque">${Utils.moeda(r.valorRecuperado)}</div><div class="kpi-sub">${r.baixasSemPreco ? `${r.baixasSemPreco} baixa(s) sem preço` : "pelo preço informado"}</div></div>
        <div class="kpi-card"><div class="kpi-label">Voltou ao estoque</div><div class="kpi-value">${kg(r.kgVoltouPonta + r.kgVoltouDeBarraNova)}</div><div class="kpi-sub">${r.kgVoltouDeBarraNova ? `${kg(r.kgVoltouDeBarraNova)} de barra nova` : "como novas pontas"}</div></div>
        <div class="kpi-card"><div class="kpi-label">Sucata + perda</div><div class="kpi-value">${kg(r.kgSucataPerda)}</div><div class="kpi-sub">sobras &lt; ${Utils.fmt(CONFIG.SOBRA_MINIMA)} m e cortes</div></div>
        <div class="kpi-card"><div class="kpi-label">Barra nova</div><div class="kpi-value">${r.barrasNovas}</div><div class="kpi-sub">${kg(r.kgBarraNova)} cortados (fora do aproveitamento)</div></div>
      </div>`;
    $("painelBitolas").innerHTML = `
      <div class="table-container"><table class="tabela-blocos">
        <thead><tr><th>Bitola</th><th>Reaproveitado</th><th>Aproveitamento</th><th>Sucata + perda</th><th>Barra nova</th></tr></thead>
        <tbody>${r.porBitola.map((b) => `
          <tr>
            <td class="mono"><strong>Ø ${Utils.fmt(b.bitola)} mm</strong></td>
            <td class="mono td-medida" data-rot="Reaproveitado">${kg(b.kgReaproveitado)}</td>
            <td class="mono" data-rot="Aproveit.">${pct(b.taxa)}</td>
            <td class="mono" data-rot="Sucata">${kg(b.kgSucataPerda)}</td>
            <td class="mono" data-rot="Barra nova">${b.barrasNovas ? `${b.barrasNovas} · ${kg(b.kgBarraNova)}` : "—"}</td>
          </tr>`).join("")}</tbody>
      </table></div>`;
  },

  renderizarParadas() {
    const lista = Painel.pontasParadas(state.estoque, new Date(), 60);
    const kgTotal = lista.reduce((s, x) => s + x.item.peso, 0);
    const n90 = lista.filter((x) => x.dias >= 90).length;
    $("painelParadasResumo").textContent = lista.length
      ? `${lista.length} ponta(s) · ${Utils.fmt(kgTotal, 1)} kg · ${n90} com 90 dias ou mais`
      : "60 dias ou mais no pátio";
    if (!lista.length) {
      $("painelParadas").innerHTML = `<div class="painel-vazio">Nenhuma ponta parada há 60 dias ou mais.</div>`;
      return;
    }
    $("painelParadas").innerHTML = `
      <div class="table-container"><table class="tabela-blocos">
        <thead><tr><th>ID</th><th>Parada há</th><th>Bitola</th><th>Medida</th><th>Peso</th><th>Ações</th></tr></thead>
        <tbody>${lista.map(({ item: b, dias }) => `
          <tr class="${dias >= 90 ? "parada-90" : ""}">
            <td><span class="badge">#${b.id}</span></td>
            <td class="mono" data-rot="Parada há">${dias >= 90 ? `<span class="selo-reserva">${dias} dias</span>` : `${dias} dias`}</td>
            <td class="mono" data-rot="Bitola">Ø ${Utils.fmt(b.bitola)} mm</td>
            <td class="mono td-medida" data-rot="Medida">${Utils.fmt(b.medida)} m</td>
            <td class="mono" data-rot="Peso">${Utils.fmt(b.peso)} kg</td>
            <td class="acoes"><div class="td-acoes">
              <button type="button" class="btn-pearl btn-sm btn-icon" data-action="imprimir-etiqueta" data-id="${b.id}" title="Imprimir etiqueta" aria-label="Imprimir etiqueta #${b.id}">${icon("tag")}</button>
              ${b.reserva ? "" : `<button type="button" class="btn-danger contorno btn-sm so-operador" data-action="ir-baixa" data-id="${b.id}">Baixar</button>`}
            </div></td>
          </tr>`).join("")}</tbody>
      </table></div>`;
  }
};

// ============================================================================
// BAIXA MANUAL
// ============================================================================
const BaixaManual = {
  prever() {
    const valor = $("baixaId").value.trim();
    const prev = $("previewBaixa");
    const btn = $("btnBaixar");
    btn.hidden = true;
    if (!valor) { prev.innerHTML = ""; return; }
    const id = Number(valor);
    const b = state.estoque.find((i) => i.id === id);
    if (b && b.reserva) {
      prev.innerHTML = `<div class="notice warning">${icon("alert")}<span>ID #${b.id} está reservada para <strong>${Utils.escapeHTML(b.reserva.para)}</strong> até ${Reservas.hora(b.reserva.ate)}. Cancele a reserva (botão "Liberar" no Estoque) antes de baixar.</span></div>`;
      return;
    }
    if (b) {
      prev.innerHTML = `<div class="result-card danger-border"><div class="result-info"><h3><span class="badge danger-bg">ID #${b.id}</span></h3><p>Ø ${Utils.fmt(b.bitola)} mm • ${Utils.fmt(b.medida)} m • ${Utils.fmt(b.peso)} kg • ${Utils.escapeHTML(b.obs)}</p></div></div>`;
      btn.hidden = false;
      return;
    }
    const v = state.vendidos.find((i) => i.id === id);
    prev.innerHTML = `<div class="notice danger">${icon("alert")}<span>${v
      ? `ID #${id} já foi vendido${v.dataSaida ? " em " + Utils.escapeHTML(v.dataSaida) : ""} (${Utils.escapeHTML(v.obs)}).`
      : `ID #${Utils.escapeHTML(valor)} não encontrado no estoque.`}</span></div>`;
  },

  irPara(id) {
    UI.alternarAba("gerenciar");
    $("baixaId").value = id;
    this.prever();
    $("baixaClienteManual").focus();
  },

  async executar(btn) {
    const id = Number($("baixaId").value.trim());
    const b = state.estoque.find((i) => i.id === id);
    if (!b) return;
    const cliente = $("baixaClienteManual").value.trim();
    const ok = await UI.confirmar({
      titulo: "Confirmar baixa",
      html: `<p>Marcar a barra inteira como <strong>vendida</strong>${cliente ? ` para <strong>${Utils.escapeHTML(cliente)}</strong>` : ""}?</p>
        <p class="mono"><strong>#${b.id}</strong> — Ø ${Utils.fmt(b.bitola)} mm × ${Utils.fmt(b.medida)} m (${Utils.fmt(b.peso)} kg)</p>`,
      ok: "Confirmar Baixa",
      perigo: true
    });
    if (!ok) return;

    await executar(btn, "Processando...", async () => {
      const r = await API.chamar("baixar", { cliente, instrucoes: [{ id, cortes: [] }] });
      UI.notificar(r.mensagem);
      $("baixaId").value = "";
      $("baixaClienteManual").value = "";
      $("previewBaixa").innerHTML = "";
      $("btnBaixar").hidden = true;
      await Dados.carregar({ silencioso: true });
    });
  }
};

// ============================================================================
// HISTÓRICO
// ============================================================================
const Historico = {
  dataOrdenacao(b) {
    const d = Utils.parseDataBR(b.dataSaida) || Utils.parseDataBR(b.data);
    return d ? d.getTime() : 0;
  },

  renderizar() {
    const termo = $("filtroHistorico").value.trim().toLowerCase();
    let lista = state.vendidos;
    if (termo.startsWith("#")) {
      const id = termo.slice(1).trim();
      lista = lista.filter((b) => !id || String(b.id).startsWith(id));
    } else if (termo) {
      lista = lista.filter((b) => String(b.id).includes(termo) || b.obs.toLowerCase().includes(termo));
    }
    lista = lista.slice().sort((a, b) => this.dataOrdenacao(b) - this.dataOrdenacao(a) || b.ordem - a.ordem);

    const visiveis = lista.slice(0, state.historicoLimite);
    $("historicoRodape").hidden = lista.length <= visiveis.length;
    const corpo = $("tabelaHistoricoBody");
    if (!visiveis.length) {
      corpo.innerHTML = `<tr><td colspan="7" class="td-dim" style="text-align:center; padding:28px;">${termo ? "Nada encontrado." : "Nenhuma saída registrada."}</td></tr>`;
      return;
    }
    corpo.innerHTML = visiveis.map((b) => `
      <tr>
        <td><span class="badge danger-bg">#${b.id}</span></td>
        <td class="mono" style="font-size:13px">${Utils.escapeHTML(b.dataSaida || b.data)}</td>
        <td class="mono">Ø ${Utils.fmt(b.bitola)} mm</td>
        <td class="mono">${Utils.fmt(b.medida)} m</td>
        <td class="mono">${Utils.fmt(b.peso)} kg</td>
        <td style="font-size:13px">${Utils.escapeHTML(b.obs)}</td>
        <td><button type="button" class="btn-pearl btn-sm" data-action="estornar" data-id="${b.id}">Estornar</button></td>
      </tr>`).join("");
  },

  mostrarMais() {
    state.historicoLimite += CONFIG.HISTORICO_PAGINA;
    this.renderizar();
  },

  movsBarraNova: [],

  /** Baixas com barra nova dos últimos 90 dias (não têm linha em "Pontas"; vêm de Movimentos). */
  async carregarMovimentos() {
    if (!Auth.token()) return;
    const hoje = new Date();
    const de = Utils.dataISO(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 90));
    try {
      const r = await API.chamar("movimentos", { de });
      this.movsBarraNova = (r.movimentos || []).filter((m) => m.acao === "baixa" && m.origem === "barra nova")
        .sort((a, b) => (b.dataHora > a.dataHora ? 1 : -1));
    } catch (e) {
      this.movsBarraNova = [];
    }
    this.renderizarBarraNova();
  },

  renderizarBarraNova() {
    const area = $("historicoBarraNova");
    const lista = this.movsBarraNova;
    area.hidden = lista.length === 0;
    if (!lista.length) { area.innerHTML = ""; return; }
    area.innerHTML = `
      <div class="box-header">
        <h3 class="box-title">Barras novas usadas</h3>
        <span class="box-subtitle">Últimos 90 dias</span>
      </div>
      <div class="table-container"><table class="tabela-blocos">
        <thead><tr><th>Origem</th><th>Data</th><th>Bitola</th><th>Cortes</th><th>Cliente / Pedido</th><th>Ação</th></tr></thead>
        <tbody>${lista.map((m) => `
          <tr>
            <td><span class="badge nova">BARRA NOVA</span></td>
            <td class="mono td-dim" data-rot="Data">${new Date(m.dataHora).toLocaleDateString("pt-BR")}</td>
            <td class="mono" data-rot="Bitola">Ø ${Utils.fmt(m.bitola)} mm</td>
            <td class="mono" data-rot="Cortes">${Utils.descreverCortes(m.cortes)}${m.idSobra ? ` · sobra #${m.idSobra}` : ""}</td>
            <td style="font-size:13px" data-rot="Cliente">${Utils.escapeHTML(m.cliente || "—")}</td>
            <td class="acoes">${m.estornado
              ? `<span class="selo-reserva">Estornada</span>`
              : `<button type="button" class="btn-pearl btn-sm so-operador" data-action="estornar-barra-nova" data-mov="${Utils.escapeHTML(m.mov)}">Estornar</button>`}</td>
          </tr>`).join("")}</tbody>
      </table></div>`;
  },

  async estornarBarraNova(btn, mov) {
    const m = this.movsBarraNova.find((x) => x.mov === mov);
    if (!m) return;
    const ok = await UI.confirmar({
      titulo: "Estornar barra nova",
      html: `<p>Desfazer o uso da barra nova de <strong class="mono">Ø ${Utils.fmt(m.bitola)} mm</strong> (${Utils.descreverCortes(m.cortes)})?</p>
        ${m.idSobra ? `<p>A sobra <strong class="mono">#${m.idSobra}</strong> gerada dela será <strong>cancelada</strong>, se ainda estiver no estoque.</p>` : ""}`,
      ok: "Estornar",
      perigo: true
    });
    if (!ok) return;
    await executar(btn, "Estornando...", async () => {
      const r = await API.chamar("estornarBarraNova", { mov });
      UI.notificar(r.mensagem);
      await Dados.carregar({ silencioso: true });
      await this.carregarMovimentos();
    });
  },

  async estornar(btn, id) {
    const b = state.vendidos.find((i) => i.id === id);
    if (!b) return;
    const ok = await UI.confirmar({
      titulo: "Estornar baixa",
      html: `<p>Devolver <strong class="mono">#${b.id}</strong> (Ø ${Utils.fmt(b.bitola)} mm × ${Utils.fmt(b.medida)} m) ao estoque?</p>
        <p>Sobras geradas a partir desta barra que ainda estejam no estoque serão <strong>canceladas</strong>.</p>`,
      ok: "Estornar",
      perigo: true
    });
    if (!ok) return;
    await executar(btn, "Estornando...", async () => {
      const r = await API.chamar("estornar", { id });
      UI.notificar(r.mensagem);
      await Dados.carregar({ silencioso: true });
    });
  }
};

// ============================================================================
// LEITOR DE QR CODE
// ============================================================================
const Scanner = {
  instancia: null,
  lido: false,

  abrir() {
    if (typeof Html5Qrcode === "undefined") return UI.notificar("O leitor de QR Code não carregou. Verifique a internet.", true);
    if (!window.isSecureContext) return UI.notificar("A câmera só funciona com o site aberto em HTTPS.", true);
    this.lido = false;
    Modal.abrir("modalScanner", { aoFechar: () => this.parar() });
    const inst = new Html5Qrcode("qrReader");
    this.instancia = inst;
    inst.start({ facingMode: "environment" }, { fps: 10, qrbox: 220 }, (txt) => {
      if (this.lido) return;
      const id = String(txt).replace(/\D/g, "");
      if (!id) return;
      this.lido = true;
      $("baixaId").value = id;
      BaixaManual.prever();
      UI.notificar(`ID #${id} lido!`);
      Modal.fechar("modalScanner");
    }, () => {}).catch((err) => {
      this.instancia = null;
      Modal.fechar("modalScanner");
      UI.notificar("Não foi possível acessar a câmera: " + (err && err.message ? err.message : err), true);
    });
  },

  parar() {
    const inst = this.instancia;
    this.instancia = null;
    if (!inst) return;
    try {
      inst.stop().then(() => inst.clear()).catch(() => { try { inst.clear(); } catch (e) { /* ignora */ } });
    } catch (e) { /* scanner ainda não tinha iniciado */ }
  }
};

// ============================================================================
// EXPORTAÇÃO
// ============================================================================
const Exportacao = {
  init() {
    const hoje = new Date();
    $("exportDateFrom").value = Utils.dataISO(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 30));
    $("exportDateTo").value = Utils.dataISO(hoje);
  },

  /** Logo positivo como data URL para o PDF (null se não der para carregar, ex.: aberto via file://). */
  carregarLogo() {
    if (this._logo !== undefined) return Promise.resolve(this._logo);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          c.getContext("2d").drawImage(img, 0, 0);
          this._logo = { url: c.toDataURL("image/png"), proporcao: img.naturalWidth / img.naturalHeight };
        } catch (e) { this._logo = null; }
        resolve(this._logo);
      };
      img.onerror = () => { this._logo = null; resolve(null); };
      img.src = "assets/logo-positivo.png";
    });
  },

  async gerar() {
    const formato = document.querySelector('input[name="exportFormat"]:checked').value;
    const logo = formato === "pdf" ? await this.carregarLogo() : null;
    const de = $("exportDateFrom").value;
    const ate = $("exportDateTo").value;
    if (de && ate && de > ate) return UI.notificar("A data inicial é depois da final.", true);

    const noPeriodo = (b) => {
      const d = Utils.parseDataBR(b.dataSaida) || Utils.parseDataBR(b.data);
      if (!d) return false;
      const iso = Utils.dataISO(d);
      return (!de || iso >= de) && (!ate || iso <= ate);
    };
    const estoque = state.estoque.slice().sort((a, b) => a.bitola - b.bitola || b.medida - a.medida);
    const vendas = state.vendidos.filter(noPeriodo).sort((a, b) => Historico.dataOrdenacao(b) - Historico.dataOrdenacao(a));
    const periodoTxt = `${de ? de.split("-").reverse().join("/") : "início"} a ${ate ? ate.split("-").reverse().join("/") : "hoje"}`;
    const nomeArquivo = `Relatorio_Pontas_${Utils.dataISO(new Date())}`;

    try {
      if (formato === "excel") {
        if (typeof XLSX === "undefined") throw new Error("A biblioteca do Excel não carregou.");
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
          ["ID", "Data Entrada", "Bitola (mm)", "Medida (m)", "Peso (kg)", "Origem / Obs", "ID Origem"],
          ...estoque.map((b) => [b.id, b.data, b.bitola, b.medida, Number(b.peso.toFixed(2)), b.obs, b.idOrigem || ""])
        ]), "Estoque");
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
          [`Vendas de ${periodoTxt}`],
          ["ID", "Data Saída", "Data Entrada", "Bitola (mm)", "Medida (m)", "Peso (kg)", "Cliente / Pedido"],
          ...vendas.map((b) => [b.id, b.dataSaida, b.data, b.bitola, b.medida, Number(b.peso.toFixed(2)), b.obs])
        ]), "Vendas");
        XLSX.writeFile(wb, nomeArquivo + ".xlsx");
      } else {
        if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("A biblioteca de PDF não carregou.");
        const doc = new window.jspdf.jsPDF();
        // Cabeçalho da marca: logo, título, linha azul GA
        const cabecalho = (titulo, sub) => {
          let x = 14;
          if (logo) {
            const h = 16;
            doc.addImage(logo.url, "PNG", 14, 9, h * logo.proporcao, h);
            x = 14 + h * logo.proporcao + 6;
          }
          doc.setTextColor(23, 30, 38);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(15);
          doc.text(titulo, x, 16);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(9.5);
          doc.setTextColor(91, 104, 116);
          doc.text(sub, x, 22.5);
          doc.setDrawColor(59, 173, 232);
          doc.setLineWidth(0.9);
          doc.line(14, 29, 196, 29);
        };
        const estiloTabela = {
          startY: 35,
          headStyles: { fillColor: [23, 30, 38], textColor: [255, 255, 255], fontStyle: "bold" },
          alternateRowStyles: { fillColor: [245, 247, 249] },
          styles: { fontSize: 8, textColor: [23, 30, 38], lineColor: [211, 218, 225] }
        };
        cabecalho("Estoque de pontas", `Gerado em ${Utils.hojeBR()} | ${estoque.length} pontas | ${estoque.reduce((s, b) => s + b.peso, 0).toFixed(1)} kg`);
        doc.autoTable({
          ...estiloTabela,
          head: [["ID", "Entrada", "Bitola", "Medida", "Peso", "Observação"]],
          body: estoque.map((b) => [`#${b.id}`, b.data, `Ø ${b.bitola.toFixed(2)}`, `${b.medida.toFixed(2)}m`, `${b.peso.toFixed(2)}kg`, b.obs])
        });
        doc.addPage();
        cabecalho("Vendas de pontas", `Período: ${periodoTxt} | ${vendas.length} saídas | ${vendas.reduce((s, b) => s + b.peso, 0).toFixed(1)} kg`);
        doc.autoTable({
          ...estiloTabela,
          head: [["ID", "Saída", "Bitola", "Medida", "Peso", "Cliente / Pedido"]],
          body: vendas.map((b) => [`#${b.id}`, b.dataSaida || b.data, `Ø ${b.bitola.toFixed(2)}`, `${b.medida.toFixed(2)}m`, `${b.peso.toFixed(2)}kg`, b.obs])
        });
        doc.save(nomeArquivo + ".pdf");
      }
    } catch (e) {
      return UI.notificar((e.message || "Erro ao gerar relatório.") + " Recarregue a página e tente de novo.", true);
    }
    Modal.fechar("modalExportar");
    UI.notificar("Relatório gerado com sucesso!");
  }
};

// ============================================================================
// EVENTOS (delegação: cada botão declara data-action no HTML)
// ============================================================================
const ACOES = {
  "abrir-login": () => Auth.abrirLogin(false),
  "sair": () => Auth.sair(),
  "abrir-modal": (el) => Modal.abrir(el.dataset.modal),
  "fechar-modal": (el) => Modal.fechar(el.closest(".modal-overlay").id),
  "sincronizar": () => Dados.carregar(),
  "alternar-tema": () => UI.alternarTema(),
  "adicionar-carrinho": () => Plano.adicionar(),
  "remover-carrinho": (el) => Plano.remover(Number(el.dataset.idx)),
  "calcular-plano": () => Plano.calcular(),
  "copiar-whatsapp": () => Plano.copiarWhatsApp(),
  "imprimir-ordem": () => Plano.imprimirOrdem(),
  "confirmar-baixa-plano": (el) => Plano.confirmarBaixa(el),
  "reservar-plano": (el) => Plano.reservar(el),
  "cancelar-reserva": (el) => Plano.cancelarReserva(el.dataset.codigo, el),
  "abrir-reserva": (el) => Plano.abrirReserva(el.dataset.codigo),
  "novo-pedido": () => Plano.novoPedido(),
  "cancelar-reserva-id": (el) => Estoque.cancelarReservaId(Number(el.dataset.id), el),
  "estornar-barra-nova": (el) => Historico.estornarBarraNova(el, el.dataset.mov),
  "imprimir-sobras": () => Impressao.imprimirEtiquetas(state.ultimasSobras),
  "imprimir-cadastrados": () => Impressao.imprimirEtiquetas(state.ultimosCadastrados),
  "imprimir-selecionadas": () => Estoque.imprimirSelecionadas(),
  "imprimir-visiveis": () => Estoque.imprimirVisiveis(),
  "imprimir-etiqueta": (el) => Estoque.imprimirUma(Number(el.dataset.id)),
  "imprimir-teste": () => Impressao.imprimirTeste(),
  "filtrar-bitola": (el) => Estoque.filtrarBitola(el.dataset.bitola),
  "ir-baixa": (el) => BaixaManual.irPara(Number(el.dataset.id)),
  "cadastrar": (el) => Cadastro.executar(el),
  "baixar-manual": (el) => BaixaManual.executar(el),
  "abrir-scanner": () => Scanner.abrir(),
  "estornar": (el) => Historico.estornar(el, Number(el.dataset.id)),
  "historico-mais": () => Historico.mostrarMais(),
  "exportar": () => Exportacao.gerar()
};

function ligarEventos() {
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action]");
    if (!el || el.disabled) return;
    const fn = ACOES[el.dataset.action];
    if (fn) fn(el);
  });

  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => UI.alternarAba(t.dataset.target)));
  const barraAbas = document.querySelector(".tabs");
  barraAbas.addEventListener("scroll", () => barraAbas.classList.toggle("rolou", barraAbas.scrollLeft > 4), { passive: true });
  document.querySelectorAll(".role-tab").forEach((b) => b.addEventListener("click", () => Auth.selecionarRole(b.dataset.role)));
  $("authForm").addEventListener("submit", (e) => { e.preventDefault(); Auth.entrar(); });

  // Plano: qualquer mudança no pedido invalida o plano já calculado
  ["buscaBitola", "buscaMedida", "buscaQtde", "buscaKerf"].forEach((id) => $(id).addEventListener("input", () => Plano.invalidar()));
  $("buscaKerf").addEventListener("change", () => Armazenamento.gravar("pontas_kerf_mm", $("buscaKerf").value));
  $("buscaBarraNova").addEventListener("change", () => {
    Armazenamento.gravar("pontas_barra_nova", $("buscaBarraNova").checked ? "1" : "0");
    Plano.invalidar();
  });
  // Painel: período
  ["painelPeriodo", "painelDe", "painelAte"].forEach((id) => $(id).addEventListener("change", () => PainelUI.carregar()));

  // Trocar a bitola começa outro pedido: a reserva aberta deixa de ser a do pedido em tela.
  $("buscaBitola").addEventListener("change", () => { state.reservaAtual = null; Reservas.renderizar(); });
  $("buscaPrecoKg").addEventListener("input", () => {
    if (!state.plano) return;
    state.plano.precoKg = Utils.num($("buscaPrecoKg").value) || 0;
    Plano.renderizar();
  });
  $("buscaMedida").addEventListener("keydown", (e) => { if (e.key === "Enter") Plano.adicionar(); });

  // Estoque
  $("filtroTabelaBitola").addEventListener("change", () => Estoque.renderizar());
  $("filtroTabelaBusca").addEventListener("input", () => Estoque.renderizarTabela());
  $("checkTodasEstoque").addEventListener("change", (e) => Estoque.alternarTodas(e.target.checked));
  $("tabelaEstoqueBody").addEventListener("change", (e) => {
    if (e.target.classList.contains("check-item-estoque")) Estoque.alternarItem(Number(e.target.dataset.id), e.target.checked);
  });

  // Cadastro
  $("cadBitolaSelect").addEventListener("change", (e) => {
    $("grupoBitolaCustom").hidden = e.target.value !== "OUTRA";
    Cadastro.atualizarPreview();
  });
  ["cadBitolaCustom", "cadMedida", "cadQtde"].forEach((id) => $(id).addEventListener("input", () => Cadastro.atualizarPreview()));

  // Baixa manual
  $("baixaId").addEventListener("input", () => BaixaManual.prever());

  // Histórico
  $("filtroHistorico").addEventListener("input", () => {
    state.historicoLimite = CONFIG.HISTORICO_PAGINA;
    Historico.renderizar();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (typeof Corte === "undefined") {
    UI.notificar("Arquivo corte.js não encontrado — publique-o junto com o index.html.", true);
  }
  UI.atualizarIconeTema();
  Modal.configurar();
  Cadastro.popularBitolas();
  Impressao.init();
  Exportacao.init();
  $("buscaKerf").value = Armazenamento.ler("pontas_kerf_mm", "0");
  $("buscaBarraNova").checked = Armazenamento.ler("pontas_barra_nova", "1") !== "0";
  Reservas.renderizar();
  setInterval(() => Reservas.verificarVencidas(), 30000); // reservas vencidas saem da lista e da faixa do plano
  ligarEventos();

  Auth.carregar();
  Auth.aplicarUI();
  if (Auth.token()) Dados.carregar();
  else {
    Dados.limpar();
    Auth.abrirLogin(true);
  }
});
