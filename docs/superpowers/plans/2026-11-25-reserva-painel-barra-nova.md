# Reserva, Painel e Barra Nova — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 2-hour ponta reservations, a Movimentos log with an aproveitamento dashboard, and automatic completion with new 12 m bars to the Controle de Pontas app.

**Architecture:** The backend stays in `Code.gs` (Apps Script over the "Pontas" sheet, plus a new "Movimentos" sheet); the frontend stays static (`index.html`, `styles.css`, `app.js`). Pure logic lives in small UMD modules that are unit-tested in Node: `corte.js` (optimizer, extended) and a new `painel.js` (dashboard math). The backend is tested in Node through the existing Apps Script mock in `testes/backend.test.js`.

**Tech Stack:** Google Apps Script (V8), vanilla JS (ES2020, no build), Node 24 `node:test` for tests.

**Spec:** `docs/superpowers/specs/2026-11-25-reserva-painel-barra-nova-design.md`

## Global Constraints

- Reservation validity: **2 hours** (`RESERVA_HORAS = 2` in Code.gs). Expiry is computed on read; no cleanup job.
- New bar length: **12 m** (`BARRA_NOVA_M = 12` in Code.gs, `CONFIG.BARRA_NOVA_M = 12` in app.js).
- Minimum leftover that becomes a ponta: `SOBRA_MINIMA = 0.05` m (unchanged); below it is sucata.
- Fit/leftover rule, identical in `corte.js` and `Code.gs`: fits if `soma + kerf*(n-1) <= medida`; leftover = `max(0, medida - soma - kerf*n)`; zero cuts = whole bar sold, leftover 0.
- Every write runs under `LockService` and is all-or-nothing (validate everything, then write).
- The reservation code is secret: `listar` returns `reserva.codigo` only to role `operador`.
- Aproveitamento and valor recuperado count **only origem `ponta`**; barra nova is reported separately.
- Old sheets must keep working: new columns K, L, M and the "Movimentos" sheet are created automatically.
- UI follows `DESIGN.md`: GA blue only as fill with graphite text, data in JetBrains Mono, red only for baixa/erro/sucata, icons from the `#i-*` SVG sprite (no emoji).
- User-facing copy is Brazilian Portuguese.

## Review Focus

1. A reservation expires while the vendedor is confirming: the baixa must still succeed (an expired reservation is simply a free bar), not fail with a code error. → test in Task 3.
2. Two vendedores reserve overlapping bars almost at once: the second request must fail entirely (nothing reserved) and name the conflicting bar. → test in Task 3.
3. Painel for a period with no movements: every figure is 0 and the taxa shows "—", never `NaN` or `Infinity`. → test in Task 5.
4. A piece longer than 12 m with barra nova enabled: it stays in `faltantes` and the search terminates. → test in Task 1.
5. Estorno of a ponta sold before the Movimentos sheet existed (no movement row): the estorno still works and writes its own `estorno` row. → test in Task 4.

---

### Task 1: Barra nova in the optimizer

**Files:**
- Modify: `corte.js` (`planejar`, `guloso`, `buscar`, `agruparEstoque`)
- Test: `testes/corte.test.js`

**Interfaces:**
- Produces: `Corte.planejar(barras, pecas, { kerf, limiteNos, barraNova })` where `barraNova` is `{ medida: number } | null | undefined`. Result `barras[]` entries are `{ barra, cortes, sobra }`; for a new bar `barra = { id: null, nova: true, medida: barraNova.medida }`. Result entries are sorted with pontas first (by id), then new bars.

- [ ] **Step 1: Write the failing tests** in `testes/corte.test.js`:
  - `"barra nova só entra quando as pontas não bastam"`: `planejar(barras(3.0), [2.5], { barraNova: { medida: 12 } })` → one entry, `barra.id === 1`, no `nova`. Then `planejar(barras(3.0), [2.5, 2.5], { barraNova: { medida: 12 } })` → `completo === true`, exactly one entry with `barra.nova === true`, its `sobra === 9.5`.
  - `"prefere qualquer combinação de pontas a uma barra nova"`: `planejar(barras(3.0, 3.5), [2, 1.5, 1.5, 1.5], { barraNova: { medida: 12 } })` → no entry has `nova`.
  - `"peça maior que 12 m continua faltante"`: `planejar([], [13], { barraNova: { medida: 12 } })` → `completo === false`, `faltantes` deep-equals `[13]`.
  - `"sem barraNova o comportamento não muda"`: the existing 400-instance brute-force test must pass unchanged.
  - Extend the brute-force helper: run 200 extra random instances with `barraNova: { medida: 6 }` and assert `completo === true` whenever every piece is `<= 6`, and that the number of new bars equals the brute-force minimum (enumerate assignments to pontas plus up to `pecas.length` new bars).
- [ ] **Step 2: Run** `node --test testes/corte.test.js` — expected: the new tests FAIL (no `nova` entries are produced).
- [ ] **Step 3: Implement.** In `agruparEstoque` add an unlimited group `{ medida, barras: [], usados: 0, nova: true }` when `barraNova` is set. Opening a bar from it creates `{ id: null, nova: true, medida }` and never exhausts. Cost of opening a new bar = `medida + PENALIDADE_NOVA` with `const PENALIDADE_NOVA = 1000`. Try it after all ponta groups, both in the greedy step and in the DFS. In the infeasibility pre-check, treat the max bar as `max(maiorPonta, barraNova.medida)` and the total stock as infinite when `barraNova` is set.
- [ ] **Step 4: Run** `node --test testes/corte.test.js` — expected: all PASS, including the timing test (< 3000 ms).
- [ ] **Step 5: Commit** `git add corte.js testes/corte.test.js` · `git commit -m "feat(corte): completar com barra nova de 12 m"`

---

### Task 2: Backend schema — reservation columns, Movimentos sheet, listar

**Files:**
- Modify: `Code.gs` (constants, `getSheet`, `lerPlanilha`, `acaoListar`, new `getMovSheet`, `registrarMovimentos`, `gerarCodigo`)
- Test: `testes/backend.test.js` (mock gains multiple sheets and a controllable clock)

**Interfaces:**
- Produces (Code.gs):
  - `COL.RESERVA_ATE = 10`, `COL.RESERVA_PARA = 11`, `COL.RESERVA_COD = 12`; `NUM_COLS = 13`; header titles `'Reserva até'`, `'Reserva para'`, `'Reserva código'`.
  - `item.reserva`: `{ ate: number /*ms*/, para: string, codigo: string } | null`. Non-null only when `ate > Date.now()`.
  - `gerarCodigo(): string`, 8 uppercase hex chars from `Utilities.getUuid()`.
  - `getMovSheet(): Sheet` creates "Movimentos" with the header `MOV_CAB` = `['Data/hora','Lote','Mov','Ação','Perfil','Cliente','ID barra','Origem','Bitola','Medida original','Cortes','Kg peças','Sobra (m)','ID sobra','Kg sobra','Sucata (m)','Kg sucata','Kg perda corte','Preço R$/kg','Estornado']`.
  - `registrarMovimentos(linhas: Array<Array>)` appends rows in one `setValues`.
  - `listar` items gain `reserva: { ate, para, codigo? }` (`codigo` only when the role is `operador`).
- Produces (test mock): `criarAmbiente(linhas, { agora })` with `env.setAgora(ms)` (sets `Date.now` inside the vm context) and `env.grade(nome)` returning the rows of a named sheet.

- [ ] **Step 1: Refactor the mock** in `testes/backend.test.js` so that `SpreadsheetApp.openById(...).getSheetByName(nome)` and `insertSheet(nome)` serve a map of named grids. Keep `env.grade` (the Pontas grid) working for the existing tests; add `env.gradeDe(nome)` and `env.setAgora(ms)` via `vm.runInContext("Date.now = () => " + ms, ctx)`. Run `node --test testes/backend.test.js`: the 11 existing tests still PASS.
- [ ] **Step 2: Write the failing tests:**
  - `"planilha antiga ganha colunas K, L, M"`: after any `listar`, header cells 11–13 equal the three new titles.
  - `"listar esconde o código da reserva do vendedor"`: put a row with K = `agora + 3600000`, L = `"Pedido 9"`, M = `"ABCD1234"`. As vendedor, the item has `reserva.para === "Pedido 9"` and `reserva.codigo === undefined`. As operador, `reserva.codigo === "ABCD1234"`.
  - `"reserva vencida aparece como livre"`: same row with K = `agora - 1` → `reserva === null`.
- [ ] **Step 3: Run** — expected FAIL.
- [ ] **Step 4: Implement** the constants, the migration (extend the existing `getSheet` column/header guard to 13 columns), parsing in `lerPlanilha` (K may be a `Date` or an ISO string; store `ate` as ms), the `acaoListar` mapping, `getMovSheet`, `registrarMovimentos` and `gerarCodigo`.
- [ ] **Step 5: Run** `node --test testes/backend.test.js` — all PASS.
- [ ] **Step 6: Commit** `git commit -am "feat(backend): colunas de reserva e aba Movimentos"`

---

### Task 3: Backend — reservar, cancelarReserva, baixar with a code

**Files:**
- Modify: `Code.gs` (`PERMISSOES`, `doPost` routing, new `acaoReservar`, `acaoCancelarReserva`; `acaoBaixar`)
- Test: `testes/backend.test.js`

**Interfaces:**
- Consumes: `item.reserva`, `gerarCodigo`, COL constants (Task 2).
- Produces (POST actions, all writes under the lock):
  - `reservar { ids: number[], cliente: string, codigo?: string }` (vendedor, operador) → `{ sucesso, codigo, expira /*ms*/, ids }`. Requires a non-empty `cliente`. Every id must be in stock and either free or reserved with this same `codigo`, otherwise nothing is written (`codigo: 'CONFLITO'`, message naming each bar and "reservada para X até HH:MM"). With an existing `codigo` it replaces the set: bars with that code that are not in `ids` are released. Sets K = now + `RESERVA_HORAS`·3600000, L = cliente, M = codigo.
  - `cancelarReserva { codigo?: string, id?: number }` → `{ sucesso, liberados: number[] }`. Cancelling by `codigo` works for any role; by `id` only for `operador` (otherwise `PERMISSAO`).
  - `baixar` accepts `reserva?: string`. A bar with an active reservation whose code differs (or is missing) → the whole baixa is refused with `CONFLITO`. When the baixa succeeds, K/L/M of the sold bars are cleared, and other bars still holding `reserva` are released.

- [ ] **Step 1: Write the failing tests:**
  - `"reservar grava K/L/M e devolve código"`: reserve `[1,2]` for `"Pedido 9"` at t0 → `ate === t0 + 7200000`, `codigo` matches `/^[0-9A-F]{8}$/`.
  - `"reserva sem cliente é recusada"`.
  - `"segunda reserva sobre a mesma barra falha inteira"` (Review Focus 2): A reserves `[1]`; B reserves `[1,2]` → `sucesso false`, `codigo 'CONFLITO'`, bar 2 has an empty M.
  - `"atualizar reserva troca o conjunto e renova o prazo"`: reserve `[1,2]` at t0; at t0+3600000 reserve `[2,3]` with the same code → bar 1 is free, bars 2 and 3 have K = t0 + 3600000 + 7200000.
  - `"baixa de barra reservada sem código é recusada"`, and with the right code it succeeds and clears K/L/M.
  - `"baixa com código libera as barras não usadas da reserva"`: reserve `[1,2]`, baixar only 1 with the code → bar 2 has an empty M.
  - `"reserva vencida não bloqueia a baixa"` (Review Focus 1): reserve at t0, `setAgora(t0 + 7200001)`, baixar without a code → success.
  - `"vendedor cancela pelo código; só operador cancela pelo id"`.
- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement** the actions and the `baixar` changes listed in Interfaces. Add `reservar` and `cancelarReserva` to `PERMISSOES` (`['vendedor','operador']`) and to the lock-protected branch of `doPost`.
- [ ] **Step 4: Run** `node --test testes/backend.test.js` — all PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(backend): reserva de pontas por 2 horas"`

---

### Task 4: Backend — Movimentos logging, barra nova in baixar, estornos, movimentos query

**Files:**
- Modify: `Code.gs` (`acaoBaixar`, `acaoEstornar`, `acaoCadastrar`; new `acaoEstornarBarraNova`, `acaoMovimentos`)
- Test: `testes/backend.test.js`

**Interfaces:**
- Consumes: `registrarMovimentos`, `getMovSheet`, `gerarCodigo` (Task 2).
- Produces:
  - `baixar` instruções accept `{ nova: true, bitola: number, cortes: number[] }` alongside `{ id, cortes }`; params add `precoKg?: number`. The response adds `lote: string`. Barra nova validation: cortes fit in `BARRA_NOVA_M` under the fit rule, and `bitola` is in 1–100. Its leftover (if `>= SOBRA_MINIMA`) becomes a new ponta with obs `'Sobra de barra nova 12 m'` and an empty column J.
  - One Movimentos row per bar in each baixa: `Mov = lote + '-' + n` (n from 1); `Origem` is `'ponta'` or `'barra nova'`; `Cortes` as `'1,50; 1,50'`; `Kg peças` = weight of the cuts (whole bar weight when cortes is empty); `Kg sucata` = weight of a leftover `< SOBRA_MINIMA`; `Kg perda corte` = weight of `kerf × n`; `Estornado` = `''`.
  - `cadastrar` logs one row per created ponta with `Ação 'cadastro'` and `Origem 'ponta'`.
  - `estornar { id }` (existing): also sets `Estornado = 'sim'` on the latest `baixa` row for that ID barra that is not yet estornado (if any), and appends an `'estorno'` row.
  - `estornarBarraNova { mov: string }` (operador): finds the `baixa` row with that Mov and origem `barra nova`, refuses if it is already estornado or if its sobra ponta is already sold, cancels the sobra (Situação `'Cancelado'`) if it is in stock, marks the row `Estornado = 'sim'`, and appends an `'estorno'` row.
  - `movimentos { de?: 'yyyy-mm-dd', ate?: 'yyyy-mm-dd' }` (vendedor, operador) → `{ sucesso, movimentos: Mov[] }`, with `Mov = { mov, lote, dataHora /*ISO*/, acao, perfil, cliente, idBarra, origem, bitola, medidaOriginal, cortes: number[], kgPecas, sobraM, idSobra, kgSobra, sucataM, kgSucata, kgPerda, precoKg, estornado: boolean }`, filtered by date (inclusive, `America/Sao_Paulo`).
- The role is passed into `acaoBaixar`, `acaoEstornar` and `acaoCadastrar` to fill the Perfil column.

- [ ] **Step 1: Write the failing tests:**
  - `"baixa grava um movimento por barra com sucata e perda"`: bar 5 m, kerf 0.003, cortes `[2.48, 2.48]` → Movimentos row: Origem `'ponta'`, Sucata (m) `0.034`, Kg sucata `> 0`, Kg perda corte `> 0`, Lote non-empty.
  - `"baixa com barra nova cria sobra e movimento de origem barra nova"`: instrução `{ nova: true, bitola: 8, cortes: [5] }` → a new ponta of 7 m with obs `'Sobra de barra nova 12 m'`, one Movimentos row with Origem `'barra nova'`, and `ID sobra` = the new ponta's id.
  - `"barra nova com cortes acima de 12 m é recusada"`.
  - `"estorno marca o movimento como estornado"`.
  - `"estorno de baixa antiga sem movimento funciona"` (Review Focus 5): estornar a row already 'Vendido' with no Movimentos row → success, plus one `'estorno'` row.
  - `"estornarBarraNova cancela a sobra"`; `"estornarBarraNova recusa se a sobra já foi vendida"`; `"vendedor não pode estornarBarraNova"`.
  - `"movimentos filtra por período"`: rows on two different days, query with `de = ate =` one of them → only that day.
- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement** the logging, the barra-nova branch in `acaoBaixar` (validated together with the pontas before any write), `acaoEstornarBarraNova`, `acaoMovimentos`, and the `PERMISSOES` entries (`movimentos`: both roles; `estornarBarraNova`: operador).
- [ ] **Step 4: Run** `node --test testes/backend.test.js` — all PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(backend): aba Movimentos, barra nova na baixa e estornos"`

---

### Task 5: Dashboard math module

**Files:**
- Create: `painel.js` (UMD like `corte.js`: `module.exports` in Node, `window.Painel` in the browser)
- Test: `testes/painel.test.js`

**Interfaces:**
- Consumes: the `Mov` shape (Task 4) and estoque items `{ id, bitola, medida, peso, data /*dd/mm/yyyy*/ }`.
- Produces:
  - `Painel.resumir(movs: Mov[]): Resumo`, using only `acao === 'baixa' && !estornado`, where `Resumo = { kgReaproveitado, kgBrutoPontas, taxa /*number|null*/, valorRecuperado, baixasSemPreco, kgVoltouPonta, kgVoltouDeBarraNova, kgSucataPerda, barrasNovas, kgBarraNova, porBitola: Array<{ bitola, kgReaproveitado, kgBrutoPontas, taxa, kgSucataPerda, kgBarraNova }> }`.
  - Definitions:
    - origem `ponta` → `kgReaproveitado += kgPecas`, `kgBrutoPontas += peso(bitola, medidaOriginal)`, `kgVoltouPonta += kgSobra`;
    - when `precoKg > 0`, `valorRecuperado += kgPecas * precoKg`, otherwise `baixasSemPreco++`;
    - origem `barra nova` → `barrasNovas++`, `kgBarraNova += kgPecas`, `kgVoltouDeBarraNova += kgSobra`;
    - both origins add `kgSucata + kgPerda` to `kgSucataPerda`;
    - `taxa = kgBrutoPontas > 0 ? kgReaproveitado / kgBrutoPontas : null`;
    - weight formula = `bitola² / 162 × medida`.
  - `Painel.pontasParadas(estoque, hoje: Date, minDias = 60): Array<{ item, dias }>`, sorted by `dias` descending; an item whose date does not parse is skipped.
  - `Painel.periodo(nome: 'mes'|'mesPassado'|'30dias', hoje: Date): { de, ate }` as local `yyyy-mm-dd`.

- [ ] **Step 1: Write the failing tests:**
  - `"resumo conta só pontas no aproveitamento"`: one ponta baixa (8 mm, 5 m, kgPecas 1.9, precoKg 7.8) plus one barra nova baixa (kgPecas 3) → `kgReaproveitado === 1.9`, `kgBarraNova === 3`, `barrasNovas === 1`, `valorRecuperado ≈ 14.82`.
  - `"baixa sem preço conta em baixasSemPreco"`.
  - `"estornados e não-baixas são ignorados"`.
  - `"período sem movimentos dá zeros e taxa null"` (Review Focus 3): `resumir([])` → every number is 0, `taxa === null`.
  - `"pontasParadas ordena por idade e respeita o mínimo"`: dates 100, 70 and 10 days before `hoje` → two items, `dias` 100 then 70.
  - `"periodo mesPassado em janeiro volta para dezembro"`: hoje = 2027-01-15 → `{ de: '2026-12-01', ate: '2026-12-31' }`.
- [ ] **Step 2: Run** `node --test testes/painel.test.js` — FAIL (module missing).
- [ ] **Step 3: Implement** `painel.js` to the interfaces above.
- [ ] **Step 4: Run** `node --test testes/painel.test.js` — PASS.
- [ ] **Step 5: Commit** `git add painel.js testes/painel.test.js` · `git commit -m "feat(painel): cálculos do painel de aproveitamento"`

---

### Task 6: Frontend — reservations and barra nova in the cut plan

**Files:**
- Modify: `app.js` (CONFIG, new `Reservas` module, `Plano`, `Estoque.atualizarSelects`, `Estoque.renderizarTabela`, `BaixaManual.prever`, `Dados._carregar`, `ACOES`), `index.html` (toggle in the plan form, "Minhas reservas" area), `styles.css` (reservation band and badge)

**Interfaces:**
- Consumes: the `reservar`, `cancelarReserva` and `baixar { reserva, precoKg }` actions (Task 3/4); `Corte.planejar(..., { barraNova })` (Task 1); `item.reserva` from `listar`.
- Produces (app.js):
  - `CONFIG.BARRA_NOVA_M = 12`, `CONFIG.RESERVA_HORAS = 2`.
  - `Reservas` with storage key `'pontas_reservas'` and functions:
    - `todas(): Reserva[]` (drops expired entries and persists the result);
    - `salvar(r: Reserva)`, `remover(codigo)`, `doCodigo(codigo): Reserva | undefined`;
    - `idsMeus(): Set<number>` (ids in my active reservations).
    - `Reserva = { codigo, cliente, bitola, kerfMm, precoKg, carrinho: [{medida,qtde}], ids: number[], expira }`.
  - `state.plano.reserva: string | null`, the code attached to the plan currently shown.
  - Plan entries for new bars: `{ id: null, nova: true, bitola, medidaOriginal: 12, cortes, ... }`. The baixa sends them as `{ nova: true, bitola, cortes }`.
  - New `data-action` values: `'reservar-plano'`, `'cancelar-reserva'` (`data-codigo`), `'abrir-reserva'` (`data-codigo`), `'cancelar-reserva-id'` (`data-id`, operador only).

- [ ] **Step 1: Barra nova toggle.** Add a checkbox `#buscaBarraNova` ("Completar com barra nova de 12 m"), checked by default and persisted under `'pontas_barra_nova'`. `Plano.calcular` passes `barraNova: checked ? { medida: CONFIG.BARRA_NOVA_M } : null` and maps `x.barra.nova` entries. `Plano.htmlBarra` shows the badge "BARRA NOVA 12 m" instead of `#id`. `Estoque.atualizarSelects` fills `#buscaBitola` with the union of stock bitolas and `CONFIG.BITOLAS_COMERCIAIS`. The baixa confirmation dialog lists new bars as "Barra nova 12 m → …".
- [ ] **Step 2: Exclude reserved bars from the calculation.** `Plano.calcular` uses `state.estoque.filter(b => b.bitola === bitola && (!b.reserva || Reservas.idsMeus().has(b.id)))`.
- [ ] **Step 3: Reserve, update and cancel.**
  - After a plan is shown, the actions row gets "Reservar por 2h" (secondary button, icon `#i-tag`). It requires `#inputClienteCorte` and calls `reservar { ids: pontas do plano (sem barras novas), cliente, codigo: state.plano.reserva || undefined }`. It then saves the `Reserva` and sets `state.plano.reserva`.
  - With an active reservation, a band above the actions shows "Reservado para {cliente} até {HH:MM}" with "Cancelar reserva", and the button reads "Atualizar reserva".
  - Confirmar baixa sends `reserva` and `precoKg`. On success, `Reservas.remover`.
- [ ] **Step 4: Minhas reservas.** At the top of `#consulta`, render one row per active reservation: cliente, bitola, n barras, "expira HH:MM", with Abrir and Cancelar. Abrir restores bitola, kerf, preço and carrinho, runs `Plano.calcular()` and sets `state.plano.reserva`. Re-render every 60 s so expired entries disappear with the toast "Reserva de {cliente} expirou".
- [ ] **Step 5: Stock tab and manual baixa.**
  - Reserved rows show the badge "Reservada · {para} · até HH:MM". The operador also gets "Cancelar reserva", which calls `cancelarReserva { id }`.
  - `BaixaManual.prever` on a reserved bar shows "Reservada para X até HH:MM — peça ao operador para cancelar a reserva" and keeps `#btnBaixar` hidden.
- [ ] **Step 6: Verify.**
  - `node --check app.js`.
  - Run `node --test testes/` (the three test files): all PASS.
  - In the browser, against the deployed v3 backend:
    1. reserve a plan;
    2. a second browser profile no longer gets those bars in its plan;
    3. "Minhas reservas" → Abrir → Confirmar baixa succeeds;
    4. an order larger than the stock shows a "BARRA NOVA 12 m" card.
- [ ] **Step 7: Commit** `git commit -am "feat(app): reserva de pontas e barra nova no plano"`

---

### Task 7: Frontend — Painel tab and barra nova in Histórico

**Files:**
- Modify: `index.html` (new tab `data-target="painel"` between Estoque and Cadastrar, visible to both roles; `<section id="painel">`; `<script defer src="painel.js">` before `app.js`), `app.js` (new `PainelUI` module; `Historico`), `styles.css` (painel blocks, reusing `.summary-grid` / `.kpi-card` / tables)

**Interfaces:**
- Consumes: `movimentos { de, ate }` and `estornarBarraNova { mov }` (Task 4); `Painel.resumir`, `Painel.pontasParadas` and `Painel.periodo` (Task 5).
- Produces: `PainelUI.carregar(nomePeriodo)`, called when the tab opens and when the period select changes; `Historico.carregarMovimentos()`, which fetches the last 90 days of moves when the Histórico tab opens.

- [ ] **Step 1: Painel layout.**
  - Period select (Este mês · Mês passado · Últimos 30 dias · Personalizado, the last one with two date inputs).
  - KPI strip:
    - "Reaproveitado de pontas" (kg);
    - "Aproveitamento" (% or "—");
    - "Valor recuperado" (R$, with the sub-line "N baixas sem preço" when N > 0);
    - "Voltou ao estoque" (kg);
    - "Sucata + perda" (kg);
    - "Barra nova" (n barras · kg).
  - "Por bitola" table.
  - "Pontas paradas" table: ≥ 60 days, rows ≥ 90 days with a warning style. Each row has an Etiqueta action, and Baixar for the operador.
  - Empty state: "Sem movimentos neste período".
- [ ] **Step 2: Histórico.** Below the ponta rows, list the barra nova baixas of the last 90 days (badge "BARRA NOVA", date, bitola, cortes, cliente). The operador gets "Estornar", which calls `estornarBarraNova { mov }` after `UI.confirmar`.
- [ ] **Step 3: Verify.**
  - `node --check app.js`.
  - `node --test testes/`: all PASS.
  - In the browser: the Painel tab shows non-zero numbers after one test baixa; an empty period shows the empty state; the vendedor sees the Painel but no Estornar.
- [ ] **Step 4: Commit** `git commit -am "feat(app): aba Painel e barra nova no histórico"`

---

### Task 8: Release

**Files:**
- Modify: `Code.gs` (`doGet` message `'API Controle de Pontas v3 ativa'`), `DESIGN.md` (components: reservation band, Minhas reservas, painel; only if new patterns were introduced)

- [ ] **Step 1: Run** `node --test testes/corte.test.js testes/backend.test.js testes/painel.test.js`. Expected: all PASS, 0 fail.
- [ ] **Step 2: Deploy the backend.**
  1. Paste `Code.gs` into the Apps Script editor.
  2. Implantar → Gerenciar implantações → editar → Nova versão.
  3. Check with a POST `{"action":"listar"}` without a token: it must return `codigo: "AUTH"`.
  4. Check in the app that `reservar` works.
- [ ] **Step 3: Commit and push** `git push origin main`. Confirm that `git ls-remote origin main` equals the local HEAD.
