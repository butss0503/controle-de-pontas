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

const COL = { ID: 0, DATA: 1, QTDE: 2, BITOLA: 3, MEDIDA: 4, PESO: 5, SITUACAO: 6, OBS: 7, DATA_SAIDA: 8, ID_ORIGEM: 9 };
const NUM_COLS = 10;
const CABECALHO = ['Nº', 'Data', 'Nº de Pontas', 'Bitola (mm)', 'Medida (m)', 'Peso Estimado', 'Situação', 'Cliente', 'Data Saída', 'ID Origem'];

// Quem pode fazer o quê. O servidor é quem decide — o site apenas esconde botões.
const PERMISSOES = {
  listar: ['vendedor', 'operador'],
  baixar: ['vendedor', 'operador'],
  cadastrar: ['operador'],
  estornar: ['operador']
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
  // Migração: garante as colunas I (Data Saída) e J (ID Origem) em planilhas antigas.
  if (sheet.getMaxColumns() < NUM_COLS) sheet.insertColumnsAfter(sheet.getMaxColumns(), NUM_COLS - sheet.getMaxColumns());
  const cab = sheet.getRange(1, COL.DATA_SAIDA + 1, 1, 2).getValues()[0];
  if (!cab[0] || !cab[1]) {
    sheet.getRange(1, COL.DATA_SAIDA + 1, 1, 2).setValues([[CABECALHO[COL.DATA_SAIDA], CABECALHO[COL.ID_ORIGEM]]]).setFontWeight('bold');
  }
  return sheet;
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
      idOrigemLegado: idOrigemLegado
    };
    itens.push(item);
    porId[id] = item;
  }
  return { sheet: sheet, itens: itens, porId: porId, maxId: maxId };
}

function linhaNova(id, dataStr, bitola, medida, obs, idOrigem) {
  return [id, dataStr, 1, formatNumVirgula(bitola), formatNumVirgula(medida), formatNumVirgula(calcularPeso(bitola, medida)),
    'Em estoque', obs, '', idOrigem || ''];
}

// ============================================================================
// ENTRADAS HTTP
// ============================================================================
function doGet() {
  return resposta({ sucesso: true, mensagem: 'API Controle de Pontas v2 ativa. Use POST.' });
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
      if (action === 'cadastrar') return acaoCadastrar(ctx, params);
      if (action === 'baixar') return acaoBaixar(ctx, params);
      if (action === 'estornar') return acaoEstornar(ctx, params);
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
      return {
        id: i.id, data: i.data, bitola: i.bitola, medida: i.medida, peso: i.peso,
        status: i.status, obs: i.obs, dataSaida: i.dataSaida, idOrigem: i.idOrigem, ordem: i.ordem
      };
    });
  return resposta({ sucesso: true, mensagem: 'OK', role: role, itens: itens });
}

function acaoCadastrar(ctx, params) {
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
  SpreadsheetApp.flush();

  return resposta({
    sucesso: true,
    mensagem: qtde + ' ponta(s) cadastrada(s): ' + (qtde > 1 ? '#' + ids[0] + ' a #' + ids[ids.length - 1] : '#' + ids[0]) + '.',
    itens: ids.map(function (id) {
      return { id: id, data: dataStr, bitola: bitola, medida: medida, peso: calcularPeso(bitola, medida) };
    })
  });
}

/**
 * Baixa barras. Cada instrução: { id, cortes: [m, m, ...] }.
 * - cortes vazio = venda da barra inteira (sem sobra).
 * - A sobra é recalculada AQUI a partir da medida real da planilha — o valor
 *   do navegador não é confiável.
 * - Tudo é validado antes de gravar: se uma barra falhar, nada é baixado.
 */
function acaoBaixar(ctx, params) {
  const instrucoes = Array.isArray(params.instrucoes) ? params.instrucoes : [];
  if (!instrucoes.length) return erro('Nenhuma barra informada para baixa.');

  const kerf = Math.min(KERF_MAXIMO, Math.max(0, parseBRNumber(params.kerf)));
  const cliente = limparTexto(params.cliente, 100);
  const dataStr = formatDateBR(new Date());
  const problemas = [];
  const vistos = {};
  const planos = [];

  instrucoes.forEach(function (inst) {
    const id = parseInt(inst && inst.id, 10);
    const item = ctx.porId[id];
    if (!item) { problemas.push('ID #' + id + ' não existe'); return; }
    if (vistos[id]) { problemas.push('ID #' + id + ' repetido'); return; }
    vistos[id] = true;
    if (item.status !== 'estoque') { problemas.push('ID #' + id + ' já está ' + (item.status === 'vendido' ? 'vendido' : 'cancelado')); return; }

    const cortes = Array.isArray(inst.cortes) ? inst.cortes.map(parseBRNumber) : [];
    if (cortes.some(function (c) { return !(c > 0); })) { problemas.push('ID #' + id + ': medida de corte inválida'); return; }
    const soma = cortes.reduce(function (s, c) { return s + c; }, 0);
    const n = cortes.length;
    if (n > 0 && soma + kerf * (n - 1) > item.medida + 0.0005) {
      problemas.push('ID #' + id + ': cortes somam ' + arred(soma + kerf * (n - 1)) + ' m, mas a barra tem ' + item.medida + ' m');
      return;
    }
    const sobra = n === 0 ? 0 : arred(Math.max(0, item.medida - soma - kerf * n));
    planos.push({ item: item, sobra: sobra });
  });

  if (problemas.length) {
    return erro('Nada foi baixado. ' + problemas.join('; ') + '. Sincronize e refaça o plano.', 'CONFLITO');
  }

  const obsVenda = cliente ? 'Vendido: ' + cliente : 'Vendido';
  const novasLinhas = [];
  const sobras = [];
  let proximoId = ctx.maxId + 1;

  planos.forEach(function (p) {
    const it = p.item;
    // G Situação | H Obs | I Data Saída | J ID Origem (preserva a origem de sobras antigas)
    ctx.sheet.getRange(it.linha, COL.SITUACAO + 1, 1, 4).setValues([['Vendido', obsVenda, dataStr, it.idOrigem || '']]);

    if (p.sobra >= SOBRA_MINIMA) {
      const id = proximoId++;
      const obsSobra = 'Sobra do ID #' + it.id + (cliente ? ' (' + cliente + ')' : '');
      novasLinhas.push(linhaNova(id, dataStr, it.bitola, p.sobra, obsSobra, it.id));
      sobras.push({ id: id, idOrigem: it.id, bitola: it.bitola, medida: p.sobra, peso: calcularPeso(it.bitola, p.sobra), data: dataStr });
    }
  });

  if (novasLinhas.length) {
    ctx.sheet.getRange(ctx.sheet.getLastRow() + 1, 1, novasLinhas.length, NUM_COLS).setValues(novasLinhas);
  }
  SpreadsheetApp.flush();

  return resposta({
    sucesso: true,
    mensagem: planos.length + ' barra(s) baixada(s). ' + sobras.length + ' sobra(s) gerada(s).',
    baixados: planos.map(function (p) { return p.item.id; }),
    sobras: sobras
  });
}

/**
 * Devolve uma barra vendida ao estoque. As sobras geradas por ela que ainda
 * estão em estoque são canceladas (senão o mesmo aço contaria duas vezes).
 * Se alguma sobra já foi vendida, o estorno é recusado: estorne a sobra antes.
 */
function acaoEstornar(ctx, params) {
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
  SpreadsheetApp.flush();

  return resposta({
    sucesso: true,
    mensagem: 'ID #' + id + ' devolvido ao estoque.' + (filhos.length ? ' Sobra(s) cancelada(s): ' + filhos.map(function (f) { return '#' + f.id; }).join(', ') + '.' : ''),
    cancelados: filhos.map(function (f) { return f.id; })
  });
}
