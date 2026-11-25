// Testa o Code.gs em Node, simulando os serviços do Apps Script.  node --test testes/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

/** Uma aba simulada: grade de linhas com largura (colunas) controlada. */
function criarAba(grade, colsIniciais) {
  let maxCols = colsIniciais;
  const largura = () => { grade.forEach((r) => { while (r.length < maxCols) r.push(""); }); };
  largura();
  const range = (r, c, nr, nc) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (grade[r - 1 + i] || [])[c - 1 + j] ?? "")),
    setValues: (v) => {
      v.forEach((linha, i) => {
        while (grade.length < r + i) grade.push(new Array(maxCols).fill(""));
        linha.forEach((val, j) => { grade[r - 1 + i][c - 1 + j] = val; });
      });
      return range(r, c, nr, nc);
    },
    setFontWeight: () => range(r, c, nr, nc)
  });
  return {
    getRange: range,
    getLastRow: () => grade.length,
    getMaxColumns: () => maxCols,
    insertColumnsAfter: (_, n) => { maxCols += n; largura(); },
    setFrozenRows: () => {}
  };
}

function criarAmbiente(linhasIniciais, opcoes = {}) {
  const grade = [["Nº", "Data", "Nº de Pontas", "Bitola (mm)", "Medida (m)", "Peso Estimado", "Situação", "Cliente"], ...linhasIniciais];
  const grades = { Pontas: grade };
  const abas = { Pontas: criarAba(grade, 8) };
  const planilha = {
    getSheetByName: (nome) => abas[nome] || null,
    insertSheet: (nome) => { grades[nome] = []; abas[nome] = criarAba(grades[nome], 26); return abas[nome]; }
  };
  const props = {};
  const cache = {};
  const b64 = (bytes) => Buffer.from(bytes).toString("base64");
  const b64ws = (x) => Buffer.from(typeof x === "string" ? Buffer.from(x, "utf8") : x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

  const ctx = {
    SpreadsheetApp: { openById: () => planilha, flush: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperties: (o) => Object.assign(props, o) }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: (s) => ({ setMimeType: () => JSON.parse(s) }) },
    Utilities: {
      Charset: { UTF_8: "utf8" },
      DigestAlgorithm: { SHA_256: "sha256" },
      computeDigest: (_, s) => [...crypto.createHash("sha256").update(s, "utf8").digest()],
      computeHmacSha256Signature: (v, k) => [...crypto.createHmac("sha256", k).update(v).digest()],
      base64Encode: b64,
      base64EncodeWebSafe: b64ws,
      base64DecodeWebSafe: (s) => [...Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64")],
      newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes).toString("utf8") }),
      // Formatação real no fuso de São Paulo (UTC-3), para os filtros por data
      formatDate: (d, tz, fmt) => {
        const x = new Date(d.getTime() - 3 * 3600000);
        const p = (n) => String(n).padStart(2, "0");
        return fmt.replace("yyyy", x.getUTCFullYear()).replace("MM", p(x.getUTCMonth() + 1)).replace("dd", p(x.getUTCDate()))
          .replace("HH", p(x.getUTCHours())).replace("mm", p(x.getUTCMinutes()));
      },
      getUuid: () => crypto.randomUUID(),
      sleep: () => {}
    },
    Logger: { log: () => {} }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "Code.gs"), "utf8"), ctx);
  // Relógio controlável (Date.now dentro do Code.gs)
  const setAgora = (ms) => vm.runInContext(`Date.now = () => ${ms};`, ctx);
  if (opcoes.agora) setAgora(opcoes.agora);

  // Equivale a executar configurarSenhas() com senhas de teste
  const salt = "sal";
  Object.assign(props, {
    SALT: salt,
    HASH_VENDEDOR: ctx.hashSenha("venda123", salt),
    HASH_OPERADOR: ctx.hashSenha("opera123", salt),
    TOKEN_SECRET: "segredo-de-teste"
  });

  const post = (body) => ctx.doPost({ postData: { contents: JSON.stringify(body) } });
  const login = (role, senha) => post({ action: "login", role, senha }).token;
  return { grade, gradeDe: (nome) => grades[nome], setAgora, post, login, ctx };
}

const linha = (id, bitola, medida, situacao = "Em estoque", obs = "Em estoque") =>
  [id, "01/11/2026", 1, String(bitola).replace(".", ","), String(medida).replace(".", ","), "", situacao, obs];

test("login: senha errada é recusada, certa devolve token com o perfil", () => {
  const env = criarAmbiente([]);
  assert.equal(env.post({ action: "login", role: "operador", senha: "x" }).sucesso, false);
  const r = env.post({ action: "login", role: "vendedor", senha: "venda123" });
  assert.equal(r.sucesso, true);
  assert.equal(r.role, "vendedor");
  assert.equal(env.ctx.validarToken(r.token), "vendedor");
});

test("token adulterado ou ausente é recusado com código AUTH", () => {
  const env = criarAmbiente([]);
  const t = env.login("vendedor", "venda123");
  const [payload, sig] = t.split(".");
  const falso = Buffer.from(JSON.stringify({ r: "operador", e: Date.now() + 1e9 })).toString("base64url") + "." + sig;
  assert.equal(env.post({ action: "listar", token: falso }).codigo, "AUTH");
  assert.equal(env.post({ action: "listar" }).codigo, "AUTH");
  assert.equal(env.post({ action: "listar", token: payload + "." + sig }).sucesso, true);
});

test("vendedor não pode cadastrar nem estornar", () => {
  const env = criarAmbiente([linha(1, 8, 3)]);
  const t = env.login("vendedor", "venda123");
  assert.equal(env.post({ action: "cadastrar", token: t, bitola: 8, medida: 2, qtde: 1 }).codigo, "PERMISSAO");
  assert.equal(env.post({ action: "estornar", token: t, id: 1 }).codigo, "PERMISSAO");
});

test("cadastrar cria IDs sequenciais e devolve os itens", () => {
  const env = criarAmbiente([linha(10, 8, 3)]);
  const t = env.login("operador", "opera123");
  const r = env.post({ action: "cadastrar", token: t, bitola: 10, medida: 2.5, qtde: 3, obs: "Obra X" });
  assert.equal(r.sucesso, true);
  assert.deepEqual(r.itens.map((i) => i.id), [11, 12, 13]);
  assert.equal(env.grade.length, 5);
  assert.equal(env.grade[4][9], ""); // sem ID de origem
});

test("baixar recalcula a sobra no servidor e cria a nova ponta com ID e origem", () => {
  const env = criarAmbiente([linha(1, 8, 3), linha(2, 8, 5)]);
  const t = env.login("vendedor", "venda123");
  const r = env.post({ action: "baixar", token: t, cliente: "Pedido 9", kerf: 0.003, instrucoes: [{ id: 2, cortes: [1.5, 1.5], sobra: 999 }] });
  assert.equal(r.sucesso, true, r.mensagem);
  assert.equal(r.sobras.length, 1);
  assert.equal(r.sobras[0].id, 3);
  assert.equal(r.sobras[0].medida, 1.994); // 5 - 3 - 2*0.003 (ignora a "sobra: 999" do cliente)
  assert.equal(env.grade[2][6], "Vendido");
  assert.equal(env.grade[2][7], "Vendido: Pedido 9");
  assert.equal(env.grade[2][8], env.ctx.formatDateBR(new Date()));
  assert.equal(env.grade[3][9], 2); // ID origem
});

test("baixar é tudo-ou-nada: um ID já vendido impede a operação inteira", () => {
  const env = criarAmbiente([linha(1, 8, 3), linha(2, 8, 5, "Vendido", "Vendido: X")]);
  const t = env.login("vendedor", "venda123");
  const r = env.post({ action: "baixar", token: t, instrucoes: [{ id: 1, cortes: [] }, { id: 2, cortes: [] }] });
  assert.equal(r.sucesso, false);
  assert.equal(r.codigo, "CONFLITO");
  assert.equal(env.grade[1][6], "Em estoque");
});

test("baixar recusa cortes que não cabem na barra", () => {
  const env = criarAmbiente([linha(1, 8, 3)]);
  const t = env.login("vendedor", "venda123");
  const r = env.post({ action: "baixar", token: t, instrucoes: [{ id: 1, cortes: [2, 1.5] }] });
  assert.equal(r.sucesso, false);
  assert.equal(env.grade[1][6], "Em estoque");
});

test("estornar devolve a barra e cancela a sobra que ainda está em estoque", () => {
  const env = criarAmbiente([linha(1, 8, 5)]);
  const tv = env.login("vendedor", "venda123");
  const to = env.login("operador", "opera123");
  env.post({ action: "baixar", token: tv, instrucoes: [{ id: 1, cortes: [3] }] });
  const r = env.post({ action: "estornar", token: to, id: 1 });
  assert.equal(r.sucesso, true, r.mensagem);
  assert.deepEqual(r.cancelados, [2]);
  assert.equal(env.grade[1][6], "Em estoque");
  assert.equal(env.grade[2][6], "Cancelado");
  const lista = env.post({ action: "listar", token: to }).itens;
  assert.deepEqual(lista.map((i) => [i.id, i.status]), [[1, "estoque"]]);
});

test("estornar é recusado se a sobra gerada já foi vendida", () => {
  const env = criarAmbiente([linha(1, 8, 5)]);
  const tv = env.login("vendedor", "venda123");
  const to = env.login("operador", "opera123");
  env.post({ action: "baixar", token: tv, instrucoes: [{ id: 1, cortes: [3] }] });
  env.post({ action: "baixar", token: tv, instrucoes: [{ id: 2, cortes: [] }] });
  const r = env.post({ action: "estornar", token: to, id: 1 });
  assert.equal(r.sucesso, false);
  assert.match(r.mensagem, /#2/);
});

test("sobras antigas (origem só no texto) mantêm a origem ao serem vendidas", () => {
  const env = criarAmbiente([linha(1, 8, 5, "Vendido", "Vendido: A"), linha(7, 8, 2, "Em estoque", "Sobra do ID #1 (A)")]);
  const tv = env.login("vendedor", "venda123");
  env.post({ action: "baixar", token: tv, cliente: "B", instrucoes: [{ id: 7, cortes: [] }] });
  assert.equal(env.grade[2][9], 1);
});

// ---------- Etapa 2: colunas de reserva e aba Movimentos ----------
const T0 = Date.UTC(2026, 10, 25, 13, 0, 0); // 25/11/2026 10:00 em São Paulo

test("planilha antiga ganha colunas K, L, M", () => {
  const env = criarAmbiente([linha(1, 8, 3)], { agora: T0 });
  env.post({ action: "listar", token: env.login("vendedor", "venda123") });
  assert.deepEqual(env.grade[0].slice(10, 13), ["Reserva até", "Reserva para", "Reserva código"]);
});

test("listar esconde o código da reserva do vendedor", () => {
  const r = linha(1, 8, 3);
  r[10] = new Date(T0 + 3600000); r[11] = "Pedido 9"; r[12] = "ABCD1234";
  const env = criarAmbiente([r], { agora: T0 });
  const v = env.post({ action: "listar", token: env.login("vendedor", "venda123") }).itens[0];
  assert.equal(v.reserva.para, "Pedido 9");
  assert.equal(v.reserva.ate, T0 + 3600000);
  assert.equal(v.reserva.codigo, undefined);
  const o = env.post({ action: "listar", token: env.login("operador", "opera123") }).itens[0];
  assert.equal(o.reserva.codigo, "ABCD1234");
});

test("reserva vencida aparece como livre", () => {
  const r = linha(1, 8, 3);
  r[10] = new Date(T0 - 1); r[11] = "Pedido 9"; r[12] = "ABCD1234";
  const env = criarAmbiente([r], { agora: T0 });
  const v = env.post({ action: "listar", token: env.login("operador", "opera123") }).itens[0];
  assert.equal(v.reserva, null);
});

test("aba Movimentos é criada com o cabeçalho", () => {
  const env = criarAmbiente([], { agora: T0 });
  env.ctx.getMovSheet();
  assert.deepEqual(env.gradeDe("Movimentos")[0].slice(0, 20), ["Data/hora", "Lote", "Mov", "Ação", "Perfil", "Cliente", "ID barra", "Origem", "Bitola",
    "Medida original", "Cortes", "Kg peças", "Sobra (m)", "ID sobra", "Kg sobra", "Sucata (m)", "Kg sucata", "Kg perda corte", "Preço R$/kg", "Estornado"]);
  assert.match(env.ctx.gerarCodigo(), /^[0-9A-F]{8}$/);
});

// ---------- Etapa 3: reservas ----------
const HORAS2 = 2 * 3600000;
function ambienteReserva() {
  const env = criarAmbiente([linha(1, 8, 3), linha(2, 8, 4), linha(3, 8, 5)], { agora: T0 });
  env.tv = env.login("vendedor", "venda123");
  env.to = env.login("operador", "opera123");
  env.reservar = (ids, cliente, codigo) => env.post({ action: "reservar", token: env.tv, ids, cliente, codigo });
  env.cod = (n) => env.grade[n][12];
  return env;
}

test("reservar grava K/L/M e devolve código", () => {
  const env = ambienteReserva();
  const r = env.reservar([1, 2], "Pedido 9");
  assert.equal(r.sucesso, true, r.mensagem);
  assert.match(r.codigo, /^[0-9A-F]{8}$/);
  assert.equal(r.expira, T0 + HORAS2);
  assert.equal(env.cod(1), r.codigo);
  assert.equal(env.grade[2][11], "Pedido 9");
  assert.equal(env.ctx.lerMs(env.grade[1][10]), T0 + HORAS2);
  assert.equal(env.cod(3), "");
});

test("reserva sem cliente é recusada", () => {
  const env = ambienteReserva();
  assert.equal(env.reservar([1], "  ").sucesso, false);
  assert.equal(env.cod(1), "");
});

test("segunda reserva sobre a mesma barra falha inteira", () => {
  const env = ambienteReserva();
  env.reservar([1], "Cliente A");
  const r = env.reservar([1, 2], "Cliente B");
  assert.equal(r.sucesso, false);
  assert.equal(r.codigo, "CONFLITO");
  assert.match(r.mensagem, /#1/);
  assert.equal(env.cod(2), "");
});

test("atualizar reserva troca o conjunto e renova o prazo", () => {
  const env = ambienteReserva();
  const c = env.reservar([1, 2], "Pedido 9").codigo;
  env.setAgora(T0 + 3600000);
  const r = env.reservar([2, 3], "Pedido 9", c);
  assert.equal(r.sucesso, true, r.mensagem);
  assert.equal(r.codigo, c);
  assert.equal(env.cod(1), "");
  assert.equal(env.cod(3), c);
  assert.equal(env.ctx.lerMs(env.grade[2][10]), T0 + 3600000 + HORAS2);
});

test("baixa de barra reservada sem código é recusada; com o código passa e limpa a reserva", () => {
  const env = ambienteReserva();
  const c = env.reservar([1], "Pedido 9").codigo;
  const sem = env.post({ action: "baixar", token: env.tv, instrucoes: [{ id: 1, cortes: [] }] });
  assert.equal(sem.sucesso, false);
  assert.equal(sem.codigo, "CONFLITO");
  assert.equal(env.grade[1][6], "Em estoque");
  const com = env.post({ action: "baixar", token: env.tv, reserva: c, instrucoes: [{ id: 1, cortes: [] }] });
  assert.equal(com.sucesso, true, com.mensagem);
  assert.equal(env.grade[1][6], "Vendido");
  assert.equal(env.cod(1), "");
});

test("baixa com código libera as barras não usadas da reserva", () => {
  const env = ambienteReserva();
  const c = env.reservar([1, 2], "Pedido 9").codigo;
  const r = env.post({ action: "baixar", token: env.tv, reserva: c, instrucoes: [{ id: 1, cortes: [] }] });
  assert.equal(r.sucesso, true, r.mensagem);
  assert.equal(env.cod(2), "");
});

test("reserva vencida não bloqueia a baixa", () => {
  const env = ambienteReserva();
  env.reservar([1], "Pedido 9");
  env.setAgora(T0 + HORAS2 + 1);
  const r = env.post({ action: "baixar", token: env.tv, instrucoes: [{ id: 1, cortes: [] }] });
  assert.equal(r.sucesso, true, r.mensagem);
});

test("vendedor cancela pelo código; só operador cancela pelo id", () => {
  const env = ambienteReserva();
  const c = env.reservar([1], "Pedido 9").codigo;
  const r = env.post({ action: "cancelarReserva", token: env.tv, codigo: c });
  assert.equal(r.sucesso, true, r.mensagem);
  assert.deepEqual(r.liberados, [1]);
  assert.equal(env.cod(1), "");

  env.reservar([2], "Pedido 10");
  assert.equal(env.post({ action: "cancelarReserva", token: env.tv, id: 2 }).codigo, "PERMISSAO");
  const o = env.post({ action: "cancelarReserva", token: env.to, id: 2 });
  assert.equal(o.sucesso, true, o.mensagem);
  assert.equal(env.cod(2), "");
});

// ---------- Etapa 4: Movimentos, barra nova, estornos ----------
const MOV = ["Data/hora", "Lote", "Mov", "Ação", "Perfil", "Cliente", "ID barra", "Origem", "Bitola", "Medida original", "Cortes",
  "Kg peças", "Sobra (m)", "ID sobra", "Kg sobra", "Sucata (m)", "Kg sucata", "Kg perda corte", "Preço R$/kg", "Estornado"];
const movs = (env) => (env.gradeDe("Movimentos") || [[]]).slice(1).map((r) => Object.fromEntries(MOV.map((n, i) => [n, r[i]])));

test("baixa grava um movimento por barra com sucata e perda", () => {
  const env = criarAmbiente([linha(1, 8, 5)], { agora: T0 });
  const tv = env.login("vendedor", "venda123");
  const r = env.post({ action: "baixar", token: tv, cliente: "Pedido 9", kerf: 0.003, precoKg: 7.8, instrucoes: [{ id: 1, cortes: [2.48, 2.48] }] });
  assert.equal(r.sucesso, true, r.mensagem);
  assert.match(r.lote, /^[0-9A-F]{8}$/);
  const m = movs(env);
  assert.equal(m.length, 1);
  assert.equal(m[0]["Ação"], "baixa");
  assert.equal(m[0]["Origem"], "ponta");
  assert.equal(m[0]["Perfil"], "vendedor");
  assert.equal(m[0]["ID barra"], 1);
  assert.equal(m[0]["Lote"], r.lote);
  assert.equal(m[0]["Mov"], r.lote + "-1");
  assert.equal(m[0]["Sucata (m)"], 0.034);
  assert.ok(m[0]["Kg sucata"] > 0);
  assert.ok(m[0]["Kg perda corte"] > 0);
  assert.equal(m[0]["Sobra (m)"], 0);
  assert.equal(m[0]["Preço R$/kg"], 7.8);
  assert.equal(m[0]["Estornado"], "");
});

test("baixa com barra nova cria sobra e movimento de origem barra nova", () => {
  const env = criarAmbiente([linha(1, 8, 2)], { agora: T0 });
  const tv = env.login("vendedor", "venda123");
  const r = env.post({ action: "baixar", token: tv, instrucoes: [{ nova: true, bitola: 8, cortes: [5] }] });
  assert.equal(r.sucesso, true, r.mensagem);
  assert.equal(r.sobras.length, 1);
  assert.equal(r.sobras[0].medida, 7);
  const nova = env.grade.find((row) => row[0] === r.sobras[0].id);
  assert.equal(nova[7], "Sobra de barra nova 12 m");
  assert.equal(nova[9], "");
  const m = movs(env);
  assert.equal(m[0]["Origem"], "barra nova");
  assert.equal(m[0]["ID barra"], "");
  assert.equal(m[0]["ID sobra"], r.sobras[0].id);
  assert.equal(m[0]["Medida original"], 12);
});

test("barra nova com cortes acima de 12 m é recusada", () => {
  const env = criarAmbiente([], { agora: T0 });
  const r = env.post({ action: "baixar", token: env.login("vendedor", "venda123"), instrucoes: [{ nova: true, bitola: 8, cortes: [7, 6] }] });
  assert.equal(r.sucesso, false);
  assert.equal(env.grade.length, 1);
});

test("estorno marca o movimento como estornado", () => {
  const env = criarAmbiente([linha(1, 8, 5)], { agora: T0 });
  env.post({ action: "baixar", token: env.login("vendedor", "venda123"), instrucoes: [{ id: 1, cortes: [] }] });
  const r = env.post({ action: "estornar", token: env.login("operador", "opera123"), id: 1 });
  assert.equal(r.sucesso, true, r.mensagem);
  const m = movs(env);
  assert.equal(m[0]["Estornado"], "sim");
  assert.equal(m[1]["Ação"], "estorno");
  assert.equal(m[1]["ID barra"], 1);
  assert.equal(m[1]["Perfil"], "operador");
});

test("estorno de baixa antiga sem movimento funciona", () => {
  const env = criarAmbiente([linha(1, 8, 5, "Vendido", "Vendido: A")], { agora: T0 });
  const r = env.post({ action: "estornar", token: env.login("operador", "opera123"), id: 1 });
  assert.equal(r.sucesso, true, r.mensagem);
  const m = movs(env);
  assert.equal(m.length, 1);
  assert.equal(m[0]["Ação"], "estorno");
});

test("estornarBarraNova cancela a sobra", () => {
  const env = criarAmbiente([], { agora: T0 });
  const b = env.post({ action: "baixar", token: env.login("vendedor", "venda123"), instrucoes: [{ nova: true, bitola: 8, cortes: [5] }] });
  const r = env.post({ action: "estornarBarraNova", token: env.login("operador", "opera123"), mov: b.lote + "-1" });
  assert.equal(r.sucesso, true, r.mensagem);
  const sobra = env.grade.find((row) => row[0] === b.sobras[0].id);
  assert.equal(sobra[6], "Cancelado");
  assert.equal(movs(env)[0]["Estornado"], "sim");
  assert.equal(movs(env)[1]["Ação"], "estorno");
  const de_novo = env.post({ action: "estornarBarraNova", token: env.login("operador", "opera123"), mov: b.lote + "-1" });
  assert.equal(de_novo.sucesso, false);
});

test("estornarBarraNova recusa se a sobra já foi vendida", () => {
  const env = criarAmbiente([], { agora: T0 });
  const tv = env.login("vendedor", "venda123");
  const b = env.post({ action: "baixar", token: tv, instrucoes: [{ nova: true, bitola: 8, cortes: [5] }] });
  env.post({ action: "baixar", token: tv, instrucoes: [{ id: b.sobras[0].id, cortes: [] }] });
  const r = env.post({ action: "estornarBarraNova", token: env.login("operador", "opera123"), mov: b.lote + "-1" });
  assert.equal(r.sucesso, false);
  assert.match(r.mensagem, new RegExp("#" + b.sobras[0].id));
});

test("vendedor não pode estornarBarraNova", () => {
  const env = criarAmbiente([], { agora: T0 });
  const r = env.post({ action: "estornarBarraNova", token: env.login("vendedor", "venda123"), mov: "X-1" });
  assert.equal(r.codigo, "PERMISSAO");
});

test("cadastro registra movimento de entrada", () => {
  const env = criarAmbiente([], { agora: T0 });
  env.post({ action: "cadastrar", token: env.login("operador", "opera123"), bitola: 10, medida: 2.5, qtde: 2 });
  const m = movs(env);
  assert.equal(m.length, 2);
  assert.equal(m[0]["Ação"], "cadastro");
  assert.equal(m[0]["Origem"], "ponta");
});

test("movimentos filtra por período", () => {
  const env = criarAmbiente([linha(1, 8, 3), linha(2, 8, 4)], { agora: T0 });
  let tv = env.login("vendedor", "venda123");
  env.post({ action: "baixar", token: tv, instrucoes: [{ id: 1, cortes: [] }] });
  env.setAgora(T0 + 86400000);
  tv = env.login("vendedor", "venda123"); // o token de 12 h venceu no dia seguinte
  env.post({ action: "baixar", token: tv, instrucoes: [{ id: 2, cortes: [1.5] }] });
  const r = env.post({ action: "movimentos", token: tv, de: "2026-11-25", ate: "2026-11-25" });
  assert.equal(r.sucesso, true, r.mensagem);
  assert.equal(r.movimentos.length, 1);
  const m = r.movimentos[0];
  assert.equal(m.idBarra, 1);
  assert.equal(m.acao, "baixa");
  assert.equal(m.origem, "ponta");
  assert.equal(m.estornado, false);
  assert.deepEqual(m.cortes, []);
  assert.ok(m.kgPecas > 0);
  const todos = env.post({ action: "movimentos", token: tv });
  assert.equal(todos.movimentos.length, 2);
  assert.deepEqual(todos.movimentos[1].cortes, [1.5]);
});

test("bloqueia após muitas senhas erradas", () => {
  const env = criarAmbiente([]);
  for (let i = 0; i < 20; i++) env.post({ action: "login", role: "operador", senha: "errada" });
  assert.equal(env.post({ action: "login", role: "operador", senha: "opera123" }).codigo, "BLOQUEADO");
});
