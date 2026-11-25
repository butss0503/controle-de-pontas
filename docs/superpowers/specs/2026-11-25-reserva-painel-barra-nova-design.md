# Reserva de pontas, painel de aproveitamento e barra nova — design

Data: 2026-11-25 · Projeto: Controle de Pontas (Grande Aço)

## Intenção e porquê

O sistema já escolhe bem quais pontas cortar, mas ainda falta o seguinte:

1. **Reserva.** Dois vendedores podem montar planos com a mesma ponta e o segundo só descobre na hora de confirmar. Com a reserva, o vendedor separa as barras para um cliente enquanto ele decide.
2. **Painel.** O ganho (kg reaproveitado, valor recuperado, sucata evitada) não aparece em lugar nenhum, e pontas paradas há meses ocupam o pátio sem ninguém notar.
3. **Barra nova.** Quando as pontas não bastam, o plano para em "estoque insuficiente" e o vendedor precisa resolver de cabeça.

Sucesso = nenhum conflito de "barra já usada" no balcão, um número claro de kg e R$ reaproveitados por mês, e todo pedido saindo com plano completo.

## Objetivos

- O vendedor reserva as barras de um plano por **2 horas**, com cliente/pedido. A reserva expira sozinha.
- Uma barra reservada some dos cálculos de outros vendedores e não pode ser baixada sem o código da reserva.
- Cada baixa e cada estorno ficam registrados numa aba **Movimentos**, com peças, sobra, sucata e perda.
- Uma aba **Painel**, visível para **Vendedor e Operador**, com os indicadores do período e as pontas paradas.
- O otimizador completa o pedido com **barra nova de 12 m** só quando as pontas não bastam. A sobra dela vira ponta com ID.

## Não-objetivos

- Controlar estoque de barras inteiras: a barra nova é sempre tratada como disponível.
- Gráficos elaborados no painel: números e tabelas nesta etapa; um gráfico mensal pode vir depois.
- Login individual por pessoa: o registro guarda o **perfil** (vendedor/operador), não o nome.
- Tabela de preço por bitola: o valor recuperado usa o preço por kg digitado no plano, quando houver.
- Reservar barra nova (ela é tratada como ilimitada).

## Anti-objetivos (falharia mesmo "funcionando")

- Reserva automática a cada cálculo, que travaria o estoque com simulações (opção A2, descartada).
- Plano que prefere barra nova quando existe combinação de pontas que atende o pedido.
- Painel com número inventado: sem preço informado, o valor fica de fora e o painel diz isso; nada é estimado em silêncio.
- Qualquer caminho que baixe uma barra reservada por outro cliente sem o operador liberar antes.

## Restrições

- Backend continua no Apps Script (Code.gs) + planilha Google; o site continua estático (sem build).
- Planilhas antigas precisam continuar funcionando: as colunas novas são criadas sozinhas, como foi feito com I e J.
- A mesma regra de encaixe e sobra vale no `corte.js` e no `Code.gs` (perda por corte inclusa).
- Escritas sob `LockService`, tudo-ou-nada, como hoje.
- Identidade visual segue o `DESIGN.md` (casca grafite, azul GA só como preenchimento, dados em mono).

## Abordagens consideradas

| | Escolha | Por quê |
|---|---|---|
| **A1** ✅ | Botão "Reservar por 2h" no plano | O vendedor simula livremente e reserva só quando o cliente pede para separar. |
| A2 | Reserva automática a cada cálculo | Trava barras com orçamentos que não fecharam. Descartada pelo usuário. |
| **B1** ✅ | Aba nova "Movimentos" na planilha | Única forma de medir sucata e peças vendidas. Serve também de auditoria. |
| B2 | Só colunas atuais | O painel ficaria sem sucata e sem kg de peças. Descartada. |
| Barra nova | Barra de 12 m ilimitada no otimizador, com custo alto | Só entra quando nenhuma combinação de pontas atende. Caminho único sensato. |

## Decisões do usuário

- Validade da reserva: **2 horas**.
- Painel visível para **Vendedor e Operador**.
- Barra inteira: **12 m, assumida disponível** (estoque principal fora deste sistema).
- Reserva por **botão** (A1) e registro em **aba Movimentos** (B1).
- **Várias reservas ao mesmo tempo** por computador, numa lista "Minhas reservas".
- O aproveitamento e o valor recuperado contam **só o que veio de pontas**. O que foi cortado de barra nova aparece à parte. Venda de ponta inteira (baixa manual) conta como reaproveitada.

## Decisões de quem constrói (para conferir)

- **O código da reserva é secreto.** O `listar` só devolve o código para o Operador; o Vendedor recebe só "reservada para X até HH:MM". Quem reservou guarda o código no navegador. Cancelar ou baixar barra reservada exige esse código, ou o perfil Operador (que cancela pelo ID da barra). Com login por perfil, o código é a única prova de quem reservou.
- **A baixa com barra nova pode ser estornada.** Cada baixa ganha um **número de lote** em Movimentos. O Histórico mostra também as baixas de barra nova, e o estorno delas marca o movimento como estornado e cancela a sobra criada, se ela ainda estiver em estoque. Sobra já vendida bloqueia o estorno, como já acontece com as pontas.
- **Bitolas sem ponta livre aparecem no plano.** O seletor de bitola junta as bitolas com pontas às bitolas comerciais (`CONFIG.BITOLAS_COMERCIAIS`), porque a barra nova pode atender sozinha.
- **"Atualizar reserva" renova as 2 h.** Depois de uma baixa com código, as barras da reserva que não foram usadas são liberadas.

## Design

### 1. Reserva (A1)

**Planilha "Pontas":** três colunas novas, K **Reserva até** (data/hora), L **Reserva para** (cliente/pedido) e M **Reserva código**. A Situação continua "Em estoque". Uma barra está reservada quando K está no futuro. A expiração é calculada na leitura, sem rotina de limpeza: passou da hora, a barra volta a ser livre.

**Servidor (novas ações):**
- `reservar` {ids, cliente, codigo?} (vendedor e operador). Valida que todas as barras estão em estoque e livres (ou já reservadas com este mesmo código). Grava K/L/M com validade de agora + 2h. Com um `codigo` existente, **substitui** o conjunto: libera as barras que saíram do plano e reserva as novas, tudo de uma vez. Devolve `{codigo, expira, ids}`. O cliente/pedido é obrigatório.
- `cancelarReserva` {codigo} (vendedor e operador). Limpa K/L/M das barras com esse código.
- `baixar` passa a aceitar `reserva` (código). Baixar uma barra com reserva ativa de **outro** código é recusado (conflito, nada é baixado). Na baixa, as colunas K/L/M da barra são limpas.
- `listar` passa a devolver, para cada barra, `reserva: {ate, para, codigo}` quando ativa.

**Interface:**
- Plano de corte: depois de calcular, o botão **"Reservar por 2h"** fica ao lado de "Confirmar baixa" e exige cliente/pedido. Com reserva ativa, aparece uma faixa "Reservado para *Pedido X* até 15:42" com **Cancelar reserva**. "Confirmar baixa" envia o código.
- Se o pedido muda e é recalculado com reserva ativa, as barras da própria reserva continuam disponíveis para o cálculo. Quando o novo plano usa outras barras, o botão vira **"Atualizar reserva"**.
- **Minhas reservas:** o navegador guarda uma lista de reservas (código, cliente, bitola, barras, peças do pedido, validade), que sobrevive a um recarregar da página. Um painel "Minhas reservas" no Plano de corte lista as ativas, com tempo restante. **Abrir** recarrega o pedido e o plano daquela reserva para confirmar a baixa; **Cancelar** libera as barras. Começar um pedido novo não mexe nas reservas anteriores. As expiradas saem da lista com o aviso "expirou".
- Cálculo: barras com reserva ativa de outro código ficam fora do `Corte.planejar`.
- Estoque: a barra reservada continua listada, com selo "Reservada · Pedido X · até 15:42". O Operador vê **Cancelar reserva** na linha.
- Baixa manual de barra reservada: bloqueada, com a mensagem "Reservada para X até HH:MM — peça ao operador para cancelar a reserva".

### 2. Movimentos (B1)

**Aba nova "Movimentos"**, criada automaticamente, uma linha por barra afetada:

`Data/hora | Lote | Ação | Perfil | Cliente | ID barra | Origem | Bitola | Medida original | Cortes | Kg peças | Sobra (m) | ID sobra | Kg sobra | Sucata (m) | Kg sucata | Kg perda corte | Preço R$/kg | Estornado`

- **Ação:** `baixa`, `estorno` ou `cadastro`. Reserva não gera linha.
- **Origem:** `ponta` ou `barra nova`.
- **Cortes:** texto "1,50; 1,50; 2,35".
- **Sobra:** a parte que volta como ponta, quando for maior ou igual a 0,05 m.
- **Sucata:** a sobra menor que 0,05 m.
- **Perda por corte:** perda × número de cortes.
- **Preço:** o preço por kg do plano, quando informado; vazio na baixa manual.
- **Estorno:** marca "sim" em "Estornado" na linha de baixa correspondente (a mais recente daquela barra) e grava uma linha `estorno`. O painel ignora linhas estornadas.
- Nova ação `movimentos` {de, ate} (vendedor e operador) devolve as linhas do período, já filtradas no servidor.

### 3. Painel

**Aba nova "Painel"**, entre Estoque e Cadastrar, para todos os perfis.
- **Período:** este mês (padrão), mês passado, últimos 30 dias ou personalizado.
- **Faixa de indicadores:**
  - **kg reaproveitado de pontas:** peças cortadas de pontas + pontas vendidas inteiras. É o número principal.
  - **taxa de aproveitamento das pontas:** kg reaproveitado ÷ kg bruto das pontas consumidas.
  - **valor recuperado:** kg reaproveitado × preço, só nas baixas de ponta com preço. Quando alguma baixa não tem preço, o texto diz "N baixas sem preço".
  - **kg que voltaram como nova ponta:** inclui as sobras de barra nova, mostradas em separado.
  - **kg de sucata + perda.**
  - **cortado de barra nova:** quantidade de barras e kg, à parte, sem entrar no aproveitamento.
  - Todas as contas vêm da coluna Origem de Movimentos (`ponta` ou `barra nova`).
- **Por bitola:** tabela com as mesmas medidas por bitola.
- **Pontas paradas:** do estoque atual, as pontas com 60 dias ou mais desde a entrada, ordenadas pela idade, com kg total. As de 90 dias ou mais vêm destacadas. Cada linha tem atalho para imprimir a etiqueta ou baixar (Operador).
- Visual: segue o `DESIGN.md`, com faixa dividida de indicadores, rótulos mono e números em Archivo expandida.

### 4. Barra nova de 12 m

- `corte.js`: nova opção `barraNova: { medida: 12 }`. Entra na busca como um grupo ilimitado com **custo penalizado** (medida + 1000), de modo que qualquer solução com menos barras novas vence. Entre soluções com o mesmo número de barras novas, vale o critério atual (menor sobra total). A solução gulosa e o limite inferior consideram a barra nova da mesma forma.
- Saída: barras novas vêm com `barra: { id: null, nova: true, medida: 12, bitola }`.
- Interface: opção **"Completar com barra nova de 12 m"**, ligada por padrão e guardada no navegador. O cartão da barra nova mostra o selo "BARRA NOVA 12 m" no lugar do #ID, com a mesma barra sobre trena.
- Servidor (`baixar`): instruções com `{nova: true, bitola, cortes}` não alteram nenhuma linha. Valida que os cortes cabem em 12 m (constante `BARRA_NOVA_M` no servidor), cria a sobra como ponta nova com obs "Sobra de barra nova 12 m" (sem ID de origem) e grava o movimento com origem `barra nova`.
- Peças que não cabem nem em 12 m continuam aparecendo como faltantes, com aviso.

### 5. Testes

- `corte.test.js`:
  - barra nova só entra quando as pontas não bastam;
  - o resultado ótimo bate com a força bruta, agora com barra nova;
  - peça maior que 12 m continua faltante.
- `backend.test.js`:
  - reservar, conflito entre reservas e expiração (relógio simulado);
  - substituir reserva;
  - baixa com e sem código;
  - cancelamento;
  - movimentos gravados com sucata e perda;
  - estorno marcando o movimento;
  - barra nova criando sobra;
  - permissões.

## Fica a critério de quem constrói

- Texto exato dos rótulos e mensagens, seguindo o tom atual.
- Formato da hora na faixa de reserva e se há contagem regressiva.
- Layout interno do Painel dentro do `DESIGN.md`.
- Como mostrar no Painel o período sem dados.

## Implantação

Exige **nova versão** do Apps Script (Implantar → Gerenciar implantações → Nova versão) e o envio dos arquivos do site ao GitHub. A ordem é backend primeiro: o site novo avisa se o backend estiver desatualizado.
