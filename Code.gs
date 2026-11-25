/**
 * ============================================================================
 * GOOGLE APPS SCRIPT - BACKEND v2 (CONTROLE DE PONTAS - GRANDE AÇO)
 * ============================================================================
 * Estrutura da Planilha "Pontas":
 *  A ID | B Data entrada | C Qtde | D Bitola (mm) | E Medida (m) | F Peso (kg)
 *  G Situação | H Cliente/Obs | I Data Saída (novo) | J ID Origem (novo)
 *
 * COMO INSTALAR (uma vez):
 *  1. Cole este arquivo no editor do Apps Script (substituindo o anterior).
 *  2. Na função configurarSenhas() abaixo, preencha as duas senhas,
 *     selecione "configurarSenhas" no menu e clique em Executar.
 *  3. APAGUE as senhas do código e salve (elas ficam guardadas com hash
 *     nas Propriedades do Script).
 *  4. Implantar > Gerenciar implantações > (lápis) > Versão: "Nova versão"
 *     > Implantar. Assim a URL /exec continua a mesma.
 *     Configuração da implantação: Executar como "Eu" | Acesso "Qualquer pessoa".
 *  5. A planilha pode (e deve) deixar de ser pública: o script lê os dados
 *     com a sua conta, e o site não acessa mais a planilha diretamente.
 *
 * Para trocar as senhas, repita os passos 2 e 3 (todas as sessões abertas
 * são encerradas automaticamente).
 * ============================================================================
 */

const SPREADSHEET_ID = '1dtIpGk97RggIA7E-4diWtiEPa0GbI6d1i_F7UsA9CtI';
const SHEET_NAME = 'Pontas';
const TIMEZONE = 'America/Sao_Paulo';
const FATOR_PESO_ACO = 162;
const SOBRA_MINIMA = 0.05;        // m — sobras menores viram sucata e não entram no estoque
const KERF_MAXIMO = 0.02;         // m — limite de segurança para a perda por corte
const TOKEN_VALIDADE_HORAS = 12;
const MAX_FALHAS_LOGIN = 20;      // por perfil, a cada 10 minutos

const RESERVA_HORAS = 2;          // validade de uma reserva de pontas
const BARRA_NOVA_M = 12;          // comprimento da barra inteira nova (estoque principal, fora deste sistema)

const COL = { ID: 0, DATA: 1, QTDE: 2, BITOLA: 3, MEDIDA: 4, PESO: 5, SITUACAO: 6, OBS: 7, DATA_SAIDA: 8, ID_ORIGEM: 9,
  RESERVA_ATE: 10, RESERVA_PARA: 11, RESERVA_COD: 12 };
const NUM_COLS = 13;
const CABECALHO = ['Nº', 'Data', 'Nº de Pontas', 'Bitola (mm)', 'Medida (m)', 'Peso Estimado', 'Situação', 'Cliente', 'Data Saída', 'ID Origem',
  'Reserva até', 'Reserva para', 'Reserva código'];

// Aba de registro: uma linha por barra afetada em cada operação (base do Painel).
const SHEET_MOV = 'Movimentos';
const MOV_CAB = ['Data/hora', 'Lote', 'Mov', 'Ação', 'Perfil', 'Cliente', 'ID barra', 'Origem', 'Bitola', 'Medida original', 'Cortes',
  'Kg peças', 'Sobra (m)', 'ID sobra', 'Kg sobra', 'Sucata (m)', 'Kg sucata', 'Kg perda corte', 'Preço R$/kg', 'Estornado'];
const MC = {}; MOV_CAB.forEach(function (n, i) { MC[n] = i; });

// Quem pode fazer o quê. O servidor é quem decide — o site apenas esconde botões.
const PERMISSOES = {
  listar: ['vendedor', 'operador'],
  baixar: ['vendedor', 'operador'],
  reservar: ['vendedor', 'operador'],
  cancelarReserva: ['vendedor', 'operador'], // por código: qualquer perfil; pelo ID da barra: só operador
  movimentos: ['vendedor', 'operador'],
  cadastrar: ['operador'],
  estornar: ['operador'],
  estornarBarraNova: ['operador']
};

// ============================================================================
// CONFIGURAÇÃO DE SENHAS (executar manualmente no editor)
// ============================================================================
function configurarSenhas() {
  const SENHA_VENDEDOR = ''; // ← preencha, execute e depois APAGUE
  const SENHA_OPERADOR = ''; // ← preencha, execute e depois APAGUE

  if (!SENHA_VENDEDOR || !SENHA_OPERADOR) throw new Error('Preencha as duas senhas antes de executar.');
  if (SENHA_VENDEDOR === SENHA_OPERADOR) throw new Error('As senhas de Vendedor e Operador devem ser diferentes.');
  if (SENHA_VENDEDOR.length < 6 || SENHA_OPERADOR.length < 6) throw new Error('Use senhas com pelo menos 6 caracteres.');

  const salt = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperties({
    SALT: salt,
    HASH_VENDEDOR: hashSenha(SENHA_VENDEDOR, salt),
    HASH_OPERADOR: hashSenha(SENHA_OPERADOR, salt),
    TOKEN_SECRET: Utilities.getUuid() + Utilities.getUuid() // trocar o segredo invalida as sessões antigas
  });
  Logger.log('Senhas configuradas. Agora APAGUE as senhas do código e salve o projeto.');
}

function hashSenha(senha, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + senha, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

function compararSeguro(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function assinar(texto, segredo) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(texto, segredo));
}

function gerarToken(role) {
  const segredo = PropertiesService.getScriptProperties().getProperty('TOKEN_SECRET');
  const expira = Date.now() + TOKEN_VALIDADE_HORAS * 3600000;
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({ r: role, e: expira }), Utilities.Charset.UTF_8);
  return { token: payload + '.' + assinar(payload, segredo), expira: expira };
}

/** Retorna o perfil ('vendedor' | 'operador') ou null se o token for inválido/expirado. */
function validarToken(token) {
  if (!token || typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 2) return null;
  const segredo = PropertiesService.getScriptProperties().getProperty('TOKEN_SECRET');
  if (!segredo) return null;
  if (!compararSeguro(assinar(partes[0], segredo), partes[1])) return null;
  try {
    const dados = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(partes[0])).getDataAsString());
    if (!dados || typeof dados.e !== 'number' || dados.e < Date.now()) return null;
    return (dados.r === 'vendedor' || dados.r === 'operador') ? dados.r : null;
  } catch (e) {
    return null;
  }
}

// ============================================================================
// UTILITÁRIOS
// ============================================================================
function getSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, NUM_COLS).setValues([CABECALHO]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return sheet;
  }
  // Migração: garante as colunas novas (I em diante) em planilhas antigas.
  if (sheet.getMaxColumns() < NUM_COLS) sheet.insertColumnsAfter(sheet.getMaxColumns(), NUM_COLS - sheet.getMaxColumns());
  const extras = NUM_COLS - COL.DATA_SAIDA;
  const cab = sheet.getRange(1, COL.DATA_SAIDA + 1, 1, extras).getValues()[0];
  if (cab.some(function (c) { return !c; })) {
    sheet.getRange(1, COL.DATA_SAIDA + 1, 1, extras).setValues([CABECALHO.slice(COL.DATA_SAIDA)]).setFontWeight('bold');
  }
  return sheet;
}

/** Aba "Movimentos", criada na primeira vez com o cabeçalho. */
function getMovSheet() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(SHEET_MOV);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_MOV);
    sheet.getRange(1, 1, 1, MOV_CAB.length).setValues([MOV_CAB]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Acrescenta linhas (arrays na ordem de MOV_CAB) de uma vez. */
function registrarMovimentos(linhas) {
  if (!linhas || !linhas.length) return;
  const sheet = getMovSheet();
  sheet.getRange(sheet.getLastRow() + 1, 1, linhas.length, MOV_CAB.length).setValues(linhas);
}

/** Monta uma linha de Movimentos a partir de um objeto { 'Nome da coluna': valor }. */
function linhaMov(o) {
  return MOV_CAB.map(function (n) { return o[n] === undefined || o[n] === null ? '' : o[n]; });
}

/** Lê todas as linhas de Movimentos (sem o cabeçalho). Linha na planilha = índice + 2. */
function lerMovimentos() {
  const sheet = getMovSheet();
  const ultima = sheet.getLastRow();
  const vals = ultima > 1 ? sheet.getRange(2, 1, ultima - 1, MOV_CAB.length).getValues() : [];
  return { sheet: sheet, vals: vals };
}

function marcarEstornado(sheet, indice) {
  sheet.getRange(indice + 2, MC['Estornado'] + 1, 1, 1).setValues([['sim']]);
}

/** Peso com 4 casas: sucata e perda por corte são frações pequenas e não podem virar zero. */
function pesoMov(bitola, medida) {
  if (!bitola || !medida) return 0;
  return arred((Math.pow(bitola, 2) / FATOR_PESO_ACO) * medida, 4);
}

/**
 * Balanço de material de uma barra cortada (mesma regra do corte.js):
 * medida = peças + perda por corte + resto; resto >= SOBRA_MINIMA volta como ponta, abaixo é sucata.
 * Sem cortes = barra vendida inteira.
 */
function balancoCorte(medida, cortes, kerf) {
  const n = cortes.length;
  if (!n) return { soma: 0, sobraM: 0, sucataM: 0, perdaM: 0 };
  const soma = cortes.reduce(function (s, c) { return s + c; }, 0);
  const resto = Math.max(0, arred(medida - soma - kerf * n));
  return {
    soma: soma,
    sobraM: resto >= SOBRA_MINIMA ? resto : 0,
    sucataM: resto < SOBRA_MINIMA ? resto : 0,
    perdaM: Math.max(0, arred(medida - soma - resto))
  };
}

function movParaObjeto(r) {
  const num = function (v) { return parseBRNumber(v); };
  const ms = lerMs(r[MC['Data/hora']]);
  const cortesTxt = String(r[MC['Cortes']] || '').trim();
  return {
    mov: String(r[MC['Mov']] || ''),
    lote: String(r[MC['Lote']] || ''),
    dataHora: ms ? new Date(ms).toISOString() : '',
    acao: String(r[MC['Ação']] || ''),
    perfil: String(r[MC['Perfil']] || ''),
    cliente: String(r[MC['Cliente']] || ''),
    idBarra: parseInt(r[MC['ID barra']], 10) || null,
    origem: String(r[MC['Origem']] || ''),
    bitola: num(r[MC['Bitola']]),
    medidaOriginal: num(r[MC['Medida original']]),
    cortes: cortesTxt ? cortesTxt.split(';').map(num).filter(function (c) { return c > 0; }) : [],
    kgPecas: num(r[MC['Kg peças']]),
    sobraM: num(r[MC['Sobra (m)']]),
    idSobra: parseInt(r[MC['ID sobra']], 10) || null,
    kgSobra: num(r[MC['Kg sobra']]),
    sucataM: num(r[MC['Sucata (m)']]),
    kgSucata: num(r[MC['Kg sucata']]),
    kgPerda: num(r[MC['Kg perda corte']]),
    precoKg: num(r[MC['Preço R$/kg']]) || null,
    estornado: String(r[MC['Estornado']] || '').toLowerCase() === 'sim'
  };
}

/** Código curto (8 hex maiúsculos) para reservas e lotes. */
function gerarCodigo() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** Lê uma data/hora da planilha como milissegundos (Date ou texto ISO); 0 se vazio/ilegível. */
function lerMs(valor) {
  if (valor instanceof Date) return valor.getTime();
  if (!valor) return 0;
  const t = new Date(valor).getTime();
  return isNaN(t) ? 0 : t;
}

function parseBRNumber(val) {
  if (typeof val === 'number') return isFinite(val) ? val : 0;
  if (val === null || val === undefined || val === '') return 0;
  return parseFloat(String(val).replace(',', '.')) || 0;
}

function arred(v, casas) {
  const f = Math.pow(10, casas === undefined ? 3 : casas);
  return Math.round(v * f) / f;
}

function calcularPeso(bitola, medida) {
  if (!bitola || !medida) return 0;
  return arred((Math.pow(bitola, 2) / FATOR_PESO_ACO) * medida, 2);
}

function formatDateBR(date) {
  const d = date ? new Date(date) : new Date();
  if (isNaN(d.getTime())) return String(date || '');
  return Utilities.formatDate(d, TIMEZONE, 'dd/MM/yyyy');
}

function lerData(valor) {
  if (valor instanceof Date) return formatDateBR(valor);
  return valor ? String(valor).trim() : '';
}

function formatNumVirgula(num) {
  return Number(num || 0).toFixed(2).replace('.', ',');
}

function limparTexto(val, max) {
  return String(val === null || val === undefined ? '' : val).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max || 120);
}

function resposta(obj) {
  obj.success = obj.sucesso;
  obj.message = obj.mensagem;
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function erro(mensagem, codigo) {
  return resposta({ sucesso: false, mensagem: mensagem, codigo: codigo || 'ERRO' });
}

/** Lê a planilha inteira e devolve os itens já interpretados. */
function lerPlanilha() {
  const sheet = getSheet();
  const ultimaLinha = sheet.getLastRow();
  const valores = ultimaLinha > 1 ? sheet.getRange(2, 1, ultimaLinha - 1, NUM_COLS).getValues() : [];
  const itens = [];
  const porId = {};
  let maxId = 0;

  for (let i = 0; i < valores.length; i++) {
    const r = valores[i];
    const id = parseInt(r[COL.ID], 10);
    if (!id || isNaN(id)) continue;
    if (id > maxId) maxId = id;

    const bitola = parseBRNumber(r[COL.BITOLA]);
    const medida = parseBRNumber(r[COL.MEDIDA]);
    if (bitola <= 0 || medida <= 0) continue;

    const situacao = r[COL.SITUACAO] ? String(r[COL.SITUACAO]).trim() : 'Em estoque';
    const sitLower = situacao.toLowerCase();
    const status = sitLower.indexOf('vendido') !== -1 ? 'vendido'
      : sitLower.indexOf('cancelado') !== -1 ? 'cancelado'
      : 'estoque';
    const obs = r[COL.OBS] ? String(r[COL.OBS]).trim() : '';

    // ID de origem: coluna J; em linhas antigas, extrai de "Sobra do ID #123".
    let idOrigem = parseInt(r[COL.ID_ORIGEM], 10) || null;
    let idOrigemLegado = false;
    if (!idOrigem) {
      const m = obs.match(/Sobra do ID #(\d+)/i);
      if (m) { idOrigem = parseInt(m[1], 10); idOrigemLegado = true; }
    }

    const item = {
      linha: i + 2,
      ordem: i,
      id: id,
      data: lerData(r[COL.DATA]),
      bitola: bitola,
      medida: medida,
      peso: parseBRNumber(r[COL.PESO]) || calcularPeso(bitola, medida),
      situacao: situacao,
      status: status,
      obs: obs,
      dataSaida: lerData(r[COL.DATA_SAIDA]),
      idOrigem: idOrigem,
      idOrigemLegado: idOrigemLegado,
      reserva: null
    };
    // Reserva só vale enquanto não venceu; vencida = barra livre (sem rotina de limpeza).
    const ate = lerMs(r[COL.RESERVA_ATE]);
    if (status === 'estoque' && ate > Date.now() && r[COL.RESERVA_COD]) {
      item.reserva = { ate: ate, para: String(r[COL.RESERVA_PARA] || ''), codigo: String(r[COL.RESERVA_COD]) };
    }
    itens.push(item);
    porId[id] = item;
  }
  return { sheet: sheet, itens: itens, porId: porId, maxId: maxId };
}

function linhaNova(id, dataStr, bitola, medida, obs, idOrigem) {
  return [id, dataStr, 1, formatNumVirgula(bitola), formatNumVirgula(medida), formatNumVirgula(calcularPeso(bitola, medida)),
    'Em estoque', obs, '', idOrigem || '', '', '', ''];
}

// ============================================================================
// ENTRADAS HTTP
// ============================================================================
function doGet() {
  return resposta({ sucesso: true, mensagem: 'API Controle de Pontas v3 ativa. Use POST.' });
}

function doPost(e) {
  let params;
  try {
    params = JSON.parse(e.postData.contents);
  } catch (err) {
    return erro('Requisição inválida.');
  }

  try {
    const action = params.action;
    if (action === 'login') return acaoLogin(params);
    if (!PERMISSOES[action]) return erro('Ação desconhecida: ' + action);

    const role = validarToken(params.token);
    if (!role) return erro('Sessão expirada ou inválida. Entre novamente.', 'AUTH');
    if (PERMISSOES[action].indexOf(role) === -1) return erro('Seu perfil (' + role + ') não tem permissão para esta ação.', 'PERMISSAO');

    if (action === 'listar') return acaoListar(role);

    // Escritas: uma por vez, para nunca gerar IDs duplicados.
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return erro('Sistema ocupado com outra operação. Tente novamente em instantes.', 'OCUPADO');
    try {
      const ctx = lerPlanilha();
      if (action === 'movimentos') return acaoMovimentos(params);
      if (action === 'cadastrar') return acaoCadastrar(ctx, params, role);
      if (action === 'baixar') return acaoBaixar(ctx, params, role);
      if (action === 'estornarBarraNova') return acaoEstornarBarraNova(ctx, params, role);
      if (action === 'reservar') return acaoReservar(ctx, params);
      if (action === 'cancelarReserva') return acaoCancelarReserva(ctx, params, role);
      if (action === 'estornar') return acaoEstornar(ctx, params, role);
    } finally {
      lock.releaseLock();
    }
    return erro('Ação desconhecida: ' + action);
  } catch (err) {
    return erro('Erro no servidor: ' + err.message);
  }
}

// ============================================================================
// AÇÕES
// ============================================================================
function acaoLogin(params) {
  const role = params.role === 'operador' ? 'operador' : params.role === 'vendedor' ? 'vendedor' : null;
  if (!role) return erro('Perfil inválido.');

  const props = PropertiesService.getScriptProperties();
  const salt = props.getProperty('SALT');
  const hashEsperado = props.getProperty(role === 'operador' ? 'HASH_OPERADOR' : 'HASH_VENDEDOR');
  if (!salt || !hashEsperado || !props.getProperty('TOKEN_SECRET')) {
    return erro('Senhas ainda não configuradas. Execute configurarSenhas() no editor do Apps Script.', 'CONFIG');
  }

  const cache = CacheService.getScriptCache();
  const chaveFalhas = 'falhas_login_' + role;
  const falhas = parseInt(cache.get(chaveFalhas), 10) || 0;
  if (falhas >= MAX_FALHAS_LOGIN) return erro('Muitas tentativas incorretas. Aguarde 10 minutos.', 'BLOQUEADO');

  if (!compararSeguro(hashSenha(String(params.senha || ''), salt), hashEsperado)) {
    cache.put(chaveFalhas, String(falhas + 1), 600);
    Utilities.sleep(700);
    return erro('Senha incorreta.', 'SENHA');
  }

  cache.remove(chaveFalhas);
  const t = gerarToken(role);
  return resposta({ sucesso: true, mensagem: 'Bem-vindo!', token: t.token, expira: t.expira, role: role });
}

function acaoListar(role) {
  const ctx = lerPlanilha();
  const itens = ctx.itens
    .filter(function (i) { return i.status !== 'cancelado'; })
    .map(function (i) {
      // O código da reserva é a prova de quem reservou: só o Operador o recebe.
      const reserva = i.reserva
        ? (role === 'operador' ? i.reserva : { ate: i.reserva.ate, para: i.reserva.para })
        : null;
      return {
        id: i.id, data: i.data, bitola: i.bitola, medida: i.medida, peso: i.peso,
        status: i.status, obs: i.obs, dataSaida: i.dataSaida, idOrigem: i.idOrigem, ordem: i.ordem,
        reserva: reserva
      };
    });
  return resposta({ sucesso: true, mensagem: 'OK', role: role, itens: itens });
}

function acaoCadastrar(ctx, params, role) {
  const bitola = arred(parseBRNumber(params.bitola), 2);
  const medida = arred(parseBRNumber(params.medida), 3);
  const qtde = parseInt(params.qtde, 10) || 1;
  const obs = limparTexto(params.obs) || 'Em estoque';

  if (!(bitola >= 1 && bitola <= 100)) return erro('Bitola inválida (1 a 100 mm).');
  if (!(medida >= SOBRA_MINIMA && medida <= 50)) return erro('Medida inválida (' + SOBRA_MINIMA + ' a 50 m).');
  if (!(qtde >= 1 && qtde <= 200)) return erro('Quantidade inválida (1 a 200).');

  const dataStr = formatDateBR(new Date());
  const linhas = [];
  const ids = [];
  for (let k = 0; k < qtde; k++) {
    const id = ctx.maxId + 1 + k;
    ids.push(id);
    linhas.push(linhaNova(id, dataStr, bitola, medida, obs, null));
  }
  ctx.sheet.getRange(ctx.sheet.getLastRow() + 1, 1, linhas.length, NUM_COLS).setValues(linhas);
  const agora = new Date(Date.now());
  registrarMovimentos(ids.map(function (id) {
    return linhaMov({ 'Data/hora': agora, 'Ação': 'cadastro', 'Perfil': role, 'Cliente': obs, 'ID barra': id, 'Origem': 'ponta',
      'Bitola': bitola, 'Medida original': medida, 'Kg peças': pesoMov(bitola, medida) });
  }));
  SpreadsheetApp.flush();

  return resposta({
    sucesso: true,
    mensagem: qtde + ' ponta(s) cadastrada(s): ' + (qtde > 1 ? '#' + ids[0] + ' a #' + ids[ids.length - 1] : '#' + ids[0]) + '.',
    itens: ids.map(function (id) {
      return { id: id, data: dataStr, bitola: bitola, medida: medida, peso: calcularPeso(bitola, medida) };
    })
  });
}

// ---------------------------------------------------------------------------
// RESERVAS
// ---------------------------------------------------------------------------
function formatHora(ms) {
  return Utilities.formatDate(new Date(ms), TIMEZONE, 'HH:mm');
}

function textoReservada(item) {
  return 'ID #' + item.id + ' reservada para ' + (item.reserva.para || 'outro cliente') + ' até ' + formatHora(item.reserva.ate);
}

function gravarReserva(sheet, item, ateMs, para, codigo) {
  sheet.getRange(item.linha, COL.RESERVA_ATE + 1, 1, 3).setValues([[new Date(ateMs), para, codigo]]);
}

function limparReserva(sheet, item) {
  sheet.getRange(item.linha, COL.RESERVA_ATE + 1, 1, 3).setValues([['', '', '']]);
}

/**
 * Reserva barras por RESERVA_HORAS. Tudo-ou-nada. Com um código já existente,
 * substitui o conjunto (libera o que saiu, renova o prazo do que ficou).
 */
function acaoReservar(ctx, params) {
  const cliente = limparTexto(params.cliente, 100);
  if (!cliente) return erro('Informe o cliente ou o nº do pedido para reservar.');
  const ids = (Array.isArray(params.ids) ? params.ids : [])
    .map(function (n) { return parseInt(n, 10); })
    .filter(function (n, i, a) { return n > 0 && a.indexOf(n) === i; });
  if (!ids.length) return erro('Nenhuma barra para reservar.');
  const informado = String(params.codigo || '').toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 8);
  const codigo = informado.length === 8 ? informado : gerarCodigo();

  const problemas = [];
  ids.forEach(function (id) {
    const it = ctx.porId[id];
    if (!it) { problemas.push('ID #' + id + ' não existe'); return; }
    if (it.status !== 'estoque') { problemas.push('ID #' + id + ' já está ' + (it.status === 'vendido' ? 'vendido' : 'cancelado')); return; }
    if (it.reserva && it.reserva.codigo !== codigo) problemas.push(textoReservada(it));
  });
  if (problemas.length) return erro('Nada foi reservado. ' + problemas.join('; ') + '.', 'CONFLITO');

  const ate = Date.now() + RESERVA_HORAS * 3600000;
  ctx.itens.forEach(function (it) {
    if (it.reserva && it.reserva.codigo === codigo && ids.indexOf(it.id) === -1) limparReserva(ctx.sheet, it);
  });
  ids.forEach(function (id) { gravarReserva(ctx.sheet, ctx.porId[id], ate, cliente, codigo); });
  SpreadsheetApp.flush();

  return resposta({
    sucesso: true,
    mensagem: ids.length + ' barra(s) reservada(s) para ' + cliente + ' até ' + formatHora(ate) + '.',
    codigo: codigo,
    expira: ate,
    ids: ids
  });
}

/** Cancela uma reserva pelo código (qualquer perfil) ou libera uma barra pelo ID (só operador). */
function acaoCancelarReserva(ctx, params, role) {
  const liberados = [];
  if (params.id !== undefined && params.id !== null && params.id !== '') {
    if (role !== 'operador') return erro('Só o Operador pode cancelar uma reserva pelo ID da barra.', 'PERMISSAO');
    const it = ctx.porId[parseInt(params.id, 10)];
    if (!it || !it.reserva) return erro('ID #' + params.id + ' não tem reserva ativa.');
    limparReserva(ctx.sheet, it);
    liberados.push(it.id);
  } else {
    const codigo = String(params.codigo || '');
    if (!codigo) return erro('Informe o código da reserva.');
    ctx.itens.forEach(function (it) {
      if (it.reserva && it.reserva.codigo === codigo) { limparReserva(ctx.sheet, it); liberados.push(it.id); }
    });
  }
  SpreadsheetApp.flush();
  return resposta({
    sucesso: true,
    mensagem: liberados.length ? 'Reserva cancelada: ' + liberados.length + ' barra(s) liberada(s).' : 'A reserva já não estava ativa.',
    liberados: liberados
  });
}

/**
 * Baixa barras. Cada instrução é uma ponta { id, cortes: [m, ...] } ou uma
 * barra nova { nova: true, bitola, cortes } (estoque principal, BARRA_NOVA_M).
 * - cortes vazio numa ponta = venda da barra inteira (sem sobra).
 * - A sobra é recalculada AQUI a partir da medida real — o valor do navegador não é confiável.
 * - Tudo é validado antes de gravar: se uma barra falhar, nada é baixado.
 * - Cada barra baixada vira uma linha em Movimentos (mesmo lote).
 */
function acaoBaixar(ctx, params, role) {
  const instrucoes = Array.isArray(params.instrucoes) ? params.instrucoes : [];
  if (!instrucoes.length) return erro('Nenhuma barra informada para baixa.');

  const kerf = Math.min(KERF_MAXIMO, Math.max(0, parseBRNumber(params.kerf)));
  const cliente = limparTexto(params.cliente, 100);
  const codigoReserva = params.reserva ? String(params.reserva) : '';
  const precoKg = parseBRNumber(params.precoKg);
  const dataStr = formatDateBR(new Date());
  const problemas = [];
  const vistos = {};
  const planos = [];

  const lerCortes = function (inst) {
    return Array.isArray(inst.cortes) ? inst.cortes.map(parseBRNumber) : [];
  };
  const cabe = function (cortes, medida) {
    const soma = cortes.reduce(function (s, c) { return s + c; }, 0);
    return { ok: !cortes.length || soma + kerf * (cortes.length - 1) <= medida + 0.0005, total: arred(soma + kerf * Math.max(0, cortes.length - 1)) };
  };

  instrucoes.forEach(function (inst) {
    inst = inst || {};
    if (inst.nova === true) {
      const bitola = arred(parseBRNumber(inst.bitola), 2);
      const cortes = lerCortes(inst);
      if (!(bitola >= 1 && bitola <= 100)) { problemas.push('Barra nova: bitola inválida'); return; }
      if (!cortes.length || cortes.some(function (c) { return !(c > 0); })) { problemas.push('Barra nova: medida de corte inválida'); return; }
      const c = cabe(cortes, BARRA_NOVA_M);
      if (!c.ok) { problemas.push('Barra nova: cortes somam ' + c.total + ' m, mas a barra tem ' + BARRA_NOVA_M + ' m'); return; }
      planos.push({ nova: true, bitola: bitola, medida: BARRA_NOVA_M, cortes: cortes });
      return;
    }

    const id = parseInt(inst.id, 10);
    const item = ctx.porId[id];
    if (!item) { problemas.push('ID #' + id + ' não existe'); return; }
    if (vistos[id]) { problemas.push('ID #' + id + ' repetido'); return; }
    vistos[id] = true;
    if (item.status !== 'estoque') { problemas.push('ID #' + id + ' já está ' + (item.status === 'vendido' ? 'vendido' : 'cancelado')); return; }
    if (item.reserva && item.reserva.codigo !== codigoReserva) { problemas.push(textoReservada(item)); return; }

    const cortes = lerCortes(inst);
    if (cortes.some(function (c) { return !(c > 0); })) { problemas.push('ID #' + id + ': medida de corte inválida'); return; }
    const c = cabe(cortes, item.medida);
    if (!c.ok) { problemas.push('ID #' + id + ': cortes somam ' + c.total + ' m, mas a barra tem ' + item.medida + ' m'); return; }
    planos.push({ item: item, bitola: item.bitola, medida: item.medida, cortes: cortes });
  });

  if (problemas.length) {
    return erro('Nada foi baixado. ' + problemas.join('; ') + '. Sincronize e refaça o plano.', 'CONFLITO');
  }

  const obsVenda = cliente ? 'Vendido: ' + cliente : 'Vendido';
  const novasLinhas = [];
  const sobras = [];
  const movLinhas = [];
  const lote = gerarCodigo();
  const agora = new Date(Date.now());
  let proximoId = ctx.maxId + 1;

  planos.forEach(function (p, k) {
    const b = balancoCorte(p.medida, p.cortes, kerf);
    const idOrigem = p.nova ? null : p.item.id;

    if (!p.nova) {
      // G Situação | H Obs | I Data Saída | J ID Origem (preserva a origem de sobras antigas) | K-M reserva limpa
      ctx.sheet.getRange(p.item.linha, COL.SITUACAO + 1, 1, 7).setValues([['Vendido', obsVenda, dataStr, p.item.idOrigem || '', '', '', '']]);
    }

    let idSobra = '';
    if (b.sobraM > 0) {
      idSobra = proximoId++;
      const obsSobra = p.nova
        ? 'Sobra de barra nova ' + BARRA_NOVA_M + ' m'
        : 'Sobra do ID #' + p.item.id + (cliente ? ' (' + cliente + ')' : '');
      novasLinhas.push(linhaNova(idSobra, dataStr, p.bitola, b.sobraM, obsSobra, idOrigem));
      sobras.push({ id: idSobra, idOrigem: idOrigem, bitola: p.bitola, medida: b.sobraM, peso: calcularPeso(p.bitola, b.sobraM), data: dataStr });
    }

    movLinhas.push(linhaMov({
      'Data/hora': agora, 'Lote': lote, 'Mov': lote + '-' + (k + 1), 'Ação': 'baixa', 'Perfil': role, 'Cliente': cliente,
      'ID barra': idOrigem, 'Origem': p.nova ? 'barra nova' : 'ponta', 'Bitola': p.bitola, 'Medida original': p.medida,
      'Cortes': p.cortes.map(formatNumVirgula).join('; '),
      'Kg peças': p.cortes.length ? pesoMov(p.bitola, b.soma) : pesoMov(p.bitola, p.medida),
      'Sobra (m)': b.sobraM, 'ID sobra': idSobra, 'Kg sobra': pesoMov(p.bitola, b.sobraM),
      'Sucata (m)': b.sucataM, 'Kg sucata': pesoMov(p.bitola, b.sucataM), 'Kg perda corte': pesoMov(p.bitola, b.perdaM),
      'Preço R$/kg': precoKg > 0 ? precoKg : '', 'Estornado': ''
    }));
  });

  if (novasLinhas.length) {
    ctx.sheet.getRange(ctx.sheet.getLastRow() + 1, 1, novasLinhas.length, NUM_COLS).setValues(novasLinhas);
  }
  // A reserva cumpriu o papel: barras dela que ficaram fora da baixa voltam a ser livres.
  if (codigoReserva) {
    ctx.itens.forEach(function (it) {
      if (it.reserva && it.reserva.codigo === codigoReserva && !vistos[it.id]) limparReserva(ctx.sheet, it);
    });
  }
  registrarMovimentos(movLinhas);
  SpreadsheetApp.flush();

  const nNovas = planos.filter(function (p) { return p.nova; }).length;
  return resposta({
    sucesso: true,
    mensagem: (planos.length - nNovas) + ' ponta(s) baixada(s)' + (nNovas ? ' + ' + nNovas + ' barra(s) nova(s)' : '') + '. ' +
      sobras.length + ' sobra(s) gerada(s).',
    lote: lote,
    baixados: planos.filter(function (p) { return !p.nova; }).map(function (p) { return p.item.id; }),
    sobras: sobras
  });
}

/**
 * Devolve uma barra vendida ao estoque. As sobras geradas por ela que ainda
 * estão em estoque são canceladas (senão o mesmo aço contaria duas vezes).
 * Se alguma sobra já foi vendida, o estorno é recusado: estorne a sobra antes.
 */
function acaoEstornar(ctx, params, role) {
  const id = parseInt(params.id, 10);
  const item = ctx.porId[id];
  if (!item) return erro('ID #' + id + ' não encontrado na planilha.');
  if (item.status !== 'vendido') return erro('ID #' + id + ' não está vendido — nada a estornar.');

  const filhos = ctx.itens.filter(function (i) { return i.idOrigem === id && i.status !== 'cancelado'; });
  const filhosVendidos = filhos.filter(function (i) { return i.status === 'vendido'; });
  if (filhosVendidos.length) {
    return erro('Não é possível estornar o ID #' + id + ': a sobra ' +
      filhosVendidos.map(function (f) { return '#' + f.id; }).join(', ') + ' gerada dele já foi vendida. Estorne a sobra primeiro.', 'CONFLITO');
  }

  const dataStr = formatDateBR(new Date());
  filhos.forEach(function (f) {
    ctx.sheet.getRange(f.linha, COL.SITUACAO + 1, 1, 4).setValues([['Cancelado', 'Cancelado: estorno do ID #' + id, dataStr, id]]);
  });
  ctx.sheet.getRange(item.linha, COL.SITUACAO + 1, 1, 3).setValues([['Em estoque', 'Estornado em ' + dataStr, '']]);

  // Movimentos: a baixa mais recente desta barra deixa de contar; baixas antigas (sem linha) seguem normais.
  const mv = lerMovimentos();
  for (let i = mv.vals.length - 1; i >= 0; i--) {
    const r = mv.vals[i];
    if (r[MC['Ação']] === 'baixa' && parseInt(r[MC['ID barra']], 10) === id && String(r[MC['Estornado']]).toLowerCase() !== 'sim') {
      marcarEstornado(mv.sheet, i);
      break;
    }
  }
  registrarMovimentos([linhaMov({ 'Data/hora': new Date(Date.now()), 'Ação': 'estorno', 'Perfil': role, 'ID barra': id,
    'Origem': 'ponta', 'Bitola': item.bitola, 'Medida original': item.medida })]);
  SpreadsheetApp.flush();

  return resposta({
    sucesso: true,
    mensagem: 'ID #' + id + ' devolvido ao estoque.' + (filhos.length ? ' Sobra(s) cancelada(s): ' + filhos.map(function (f) { return '#' + f.id; }).join(', ') + '.' : ''),
    cancelados: filhos.map(function (f) { return f.id; })
  });
}

/**
 * Estorna o uso de uma barra nova (que não tem linha em "Pontas"): marca o
 * movimento como estornado e cancela a sobra dela, se ainda estiver em estoque.
 * Sobra já vendida bloqueia o estorno, como acontece com as pontas.
 */
function acaoEstornarBarraNova(ctx, params, role) {
  const mov = String(params.mov || '');
  const mv = lerMovimentos();
  let indice = -1;
  for (let i = 0; i < mv.vals.length; i++) {
    if (String(mv.vals[i][MC['Mov']]) === mov && mv.vals[i][MC['Ação']] === 'baixa') { indice = i; break; }
  }
  if (!mov || indice < 0) return erro('Movimento ' + mov + ' não encontrado.');
  const r = mv.vals[indice];
  if (r[MC['Origem']] !== 'barra nova') return erro('Este movimento não é de barra nova: estorne pela própria ponta.');
  if (String(r[MC['Estornado']]).toLowerCase() === 'sim') return erro('Esta barra nova já foi estornada.');

  const idSobra = parseInt(r[MC['ID sobra']], 10);
  const sobra = idSobra ? ctx.porId[idSobra] : null;
  if (sobra && sobra.status === 'vendido') {
    return erro('Não é possível estornar: a sobra #' + idSobra + ' desta barra nova já foi vendida. Estorne a sobra primeiro.', 'CONFLITO');
  }

  const dataStr = formatDateBR(new Date());
  if (sobra && sobra.status === 'estoque') {
    ctx.sheet.getRange(sobra.linha, COL.SITUACAO + 1, 1, 7).setValues([['Cancelado', 'Cancelado: estorno de barra nova', dataStr, '', '', '', '']]);
  }
  marcarEstornado(mv.sheet, indice);
  registrarMovimentos([linhaMov({ 'Data/hora': new Date(Date.now()), 'Lote': r[MC['Lote']], 'Ação': 'estorno', 'Perfil': role,
    'Origem': 'barra nova', 'Bitola': r[MC['Bitola']], 'Medida original': r[MC['Medida original']], 'ID sobra': idSobra || '' })]);
  SpreadsheetApp.flush();

  return resposta({
    sucesso: true,
    mensagem: 'Barra nova estornada.' + (sobra && sobra.status === 'estoque' ? ' Sobra #' + idSobra + ' cancelada.' : ''),
    cancelados: sobra && sobra.status === 'estoque' ? [idSobra] : []
  });
}

/** Linhas de Movimentos no período (datas yyyy-mm-dd inclusivas, fuso de São Paulo). */
function acaoMovimentos(params) {
  const de = /^\d{4}-\d{2}-\d{2}$/.test(params.de || '') ? params.de : '';
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(params.ate || '') ? params.ate : '';
  const mv = lerMovimentos();
  const lista = mv.vals
    .filter(function (r) {
      if (!r[MC['Ação']]) return false;
      const ms = lerMs(r[MC['Data/hora']]);
      if (!ms) return !de && !ate;
      const dia = Utilities.formatDate(new Date(ms), TIMEZONE, 'yyyy-MM-dd');
      return (!de || dia >= de) && (!ate || dia <= ate);
    })
    .map(movParaObjeto);
  return resposta({ sucesso: true, mensagem: 'OK', movimentos: lista });
}
