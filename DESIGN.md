---
name: Controle de Pontas — Grande Aço
description: Ferramenta interna da Grande Aço para reaproveitar pontas de vergalhão; casca grafite com filete azul GA e o aço medido no centro.
colors:
  ga-azul: "#3BADE8"
  ga-grafite: "#171E26"
  shell-bg: "#171E26"
  shell-ink: "#FFFFFF"
  shell-ink-muted: "#A9B4C0"
  shell-hover: "#232C37"
  chao: "#EEF1F4"
  painel: "#FFFFFF"
  painel-2: "#F5F7F9"
  aco-claro: "#D6DDE4"
  linha: "#D3DAE1"
  linha-forte: "#AEB8C3"
  ink: "#171E26"
  ink-2: "#3D4955"
  ink-3: "#5B6874"
  acao: "#3BADE8"
  acao-hover: "#5BBDEF"
  acao-press: "#2A9BD6"
  acao-ink: "#171E26"
  link: "#0B6FA4"
  acao-tint: "#E6F5FD"
  perigo: "#C62828"
  perigo-ink: "#FFFFFF"
  perigo-tint: "#FDECEC"
  perigo-texto: "#A61F1F"
  aviso-tint: "#FFF3D1"
  aviso-texto: "#6E4600"
  sucata: "#F6D3D1"
typography:
  display:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "clamp(28px, 4.2vw, 40px)"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 125"
  headline:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "22px"
    fontWeight: 800
    lineHeight: 1.15
    fontVariation: "'wdth' 118"
  numeral:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "26px"
    fontWeight: 800
    lineHeight: 1.1
    fontFeature: "'tnum'"
    fontVariation: "'wdth' 118"
  title:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.2
    fontVariation: "'wdth' 112"
  body:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "11.5px"
    fontWeight: 600
    letterSpacing: "0.08em"
  data:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "12.5px"
    fontWeight: 700
    fontFeature: "'tnum', 'zero'"
  data-lg:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "22px"
    fontWeight: 700
    fontFeature: "'tnum', 'zero'"
rounded:
  segmento: "3px"
  badge: "4px"
  barra: "5px"
  r-ctrl: "6px"
  r-painel: "10px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "9": "36px"
components:
  button-primary:
    backgroundColor: "{colors.acao}"
    textColor: "{colors.acao-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.r-ctrl}"
    padding: "0 20px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.acao-hover}"
    textColor: "{colors.acao-ink}"
  button-primary-press:
    backgroundColor: "{colors.acao-press}"
    textColor: "{colors.acao-ink}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.r-ctrl}"
    padding: "0 20px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.painel-2}"
  button-pearl:
    backgroundColor: "{colors.painel-2}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.r-ctrl}"
    padding: "0 14px"
    height: "40px"
  button-danger:
    backgroundColor: "{colors.perigo}"
    textColor: "{colors.perigo-ink}"
    rounded: "{rounded.r-ctrl}"
    padding: "0 20px"
    height: "44px"
  button-danger-contorno:
    backgroundColor: "transparent"
    textColor: "{colors.perigo-texto}"
    rounded: "{rounded.r-ctrl}"
    padding: "0 20px"
    height: "44px"
  button-danger-contorno-hover:
    backgroundColor: "{colors.perigo-tint}"
  input:
    backgroundColor: "{colors.painel}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.r-ctrl}"
    padding: "0 14px"
    height: "44px"
  shell-bar:
    backgroundColor: "{colors.shell-bg}"
    textColor: "{colors.shell-ink}"
    height: "60px"
  shell-btn:
    backgroundColor: "transparent"
    textColor: "{colors.shell-ink-muted}"
    rounded: "{rounded.r-ctrl}"
    padding: "0 12px"
    height: "40px"
  shell-btn-hover:
    backgroundColor: "{colors.shell-hover}"
    textColor: "{colors.shell-ink}"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink-3}"
    padding: "0 14px"
    height: "50px"
  tab-active:
    textColor: "{colors.ink}"
  painel:
    backgroundColor: "{colors.painel}"
    rounded: "{rounded.r-painel}"
    padding: "24px"
  kpi-card:
    backgroundColor: "{colors.painel-2}"
    textColor: "{colors.ink}"
    typography: "{typography.numeral}"
    padding: "14px 18px 16px"
  cart-chip:
    backgroundColor: "{colors.acao-tint}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r-ctrl}"
    padding: "0 6px 0 12px"
    height: "36px"
  badge:
    backgroundColor: "{colors.ga-grafite}"
    textColor: "{colors.shell-ink}"
    typography: "{typography.data}"
    rounded: "{rounded.badge}"
    padding: "0 8px"
    height: "24px"
  cut-bar:
    backgroundColor: "{colors.ga-grafite}"
    rounded: "{rounded.barra}"
    padding: "2px"
    height: "34px"
  cut-segment:
    backgroundColor: "{colors.ga-azul}"
    textColor: "{colors.ga-grafite}"
    typography: "{typography.data}"
    rounded: "{rounded.segmento}"
  cut-leftover:
    backgroundColor: "{colors.aco-claro}"
    textColor: "{colors.ink}"
    typography: "{typography.data}"
    rounded: "{rounded.segmento}"
  cut-leftover-sucata:
    backgroundColor: "{colors.sucata}"
    textColor: "{colors.perigo-texto}"
    typography: "{typography.data}"
    rounded: "{rounded.segmento}"
---

# Design System: Controle de Pontas — Grande Aço

## Overview

**Creative North Star: "A Bancada da Usina"**

O app é a ferramenta da própria Grande Aço: a marca aparece firme na casca (faixa grafite, logo negativo, filete azul GA de 3px) e o centro da tela é o aço medido. Tudo que importa ao trabalho (ID, bitola, medida, sobra) é dado de oficina: lido de relance, em mono tabular, sobre painéis brancos num chão de aço frio. Os títulos usam Archivo expandida e pesada, parente direta das letras largas de "GRANDE AÇO" no logo; os rótulos de dado em mono, caixa alta e espaçados, ecoam o "INDÚSTRIA DE AÇO".

A densidade é de ferramenta, não de vitrine: painéis com borda de 1px, sem sombra em repouso, grade de campos que vira pares no celular, alvos de toque de 44px. O mesmo sistema serve o vendedor no balcão (PC) e o operador no pátio (celular, sol forte), por isso o contraste é alto e o azul GA, que é claro demais para texto, só aparece como preenchimento ou traço; o texto azul é o azul profundo.

Este mundo substitui deliberadamente a imitação de loja Apple anterior e recusa o painel SaaS cinza com um acento azul. A peça assinatura é a barra de corte desenhada sobre uma trena graduada. O modo escuro é a mesma usina em grafite mais profundo, não um tema invertido genérico.

**Key Characteristics:**
- Casca grafite (`shell-bg`) com filete azul GA de 3px, presa no topo; abas brancas com sublinhado azul GA na ativa.
- Chão de aço frio (`chao`), painéis brancos (`painel`) com borda `linha` e cantos de 10px.
- Azul GA como preenchimento de ação, sempre com texto grafite; azul profundo (`link`) para texto, foco e números em destaque.
- Archivo expandida (largura 112–125%, pesos 700–800) para títulos e números grandes; JetBrains Mono tabular com zero cortado para todo dado do aço.
- Vermelho reservado para baixa, erro e sucata.
- Ícones SVG próprios, traço de 2px, pontas arredondadas, 18px.

## Colors

Paleta de duas cores de marca (azul GA e grafite, tiradas do logo) sobre uma escala de aços frios; o resto são estados funcionais.

### Primary
- **Azul GA** (`ga-azul` / `acao`): o azul-celeste do monograma. Preenche a ação primária, os segmentos de peça na barra de corte, o filete da casca, o sublinhado da aba ativa e as bordas de seleção (bitola ativa, opção de exportação marcada, chip do carrinho). Nunca é cor de texto sobre fundo claro. `acao-hover` (mais claro) e `acao-press` (mais fundo) são seus únicos estados.
- **Azul Profundo** (`link`): o azul legível. Texto ativo, medidas em tabela (`td-medida`), KPI em destaque, sobra reaproveitável, contorno de foco, caret e marcação de checkbox (5.5:1 sobre branco).
- **Bruma Azul** (`acao-tint`): fundo de itens selecionados e do painel de resultado, sempre com borda azul GA.

### Neutral
- **Grafite GA** (`ga-grafite` / `shell-bg` / `ink`): a casca, a tela de login, o fundo de aço por trás dos cortes, badges, toast e o texto principal.
- **Grafite Realce** (`shell-hover`): hover dos botões da casca.
- **Névoa de Casca** (`shell-ink-muted`): rótulos das ações da casca em repouso.
- **Aço Frio** (`chao`): fundo da página.
- **Branco Painel** (`painel`) e **Painel Interno** (`painel-2`): painéis e, dentro deles, cabeçalho de tabela, KPIs, hover de linha e botão perolado.
- **Aço Claro** (`aco-claro`): a sobra aproveitável na barra de corte.
- **Linha** (`linha`) e **Linha Forte** (`linha-forte`): bordas de painel/tabela e bordas de campo, trena e barra de rolagem.
- **Tinta 2** (`ink-2`) e **Tinta 3** (`ink-3`): rótulos de campo e texto secundário (5.6:1 sobre branco).

### Estados
- **Vermelho de Baixa** (`perigo`, `perigo-texto`, `perigo-tint`): botão de baixa/exclusão, erro de formulário, toast de erro, cartão de barra inválida.
- **Âmbar de Aviso** (`aviso-tint`, `aviso-texto`): avisos não destrutivos.
- **Rosa Sucata** (`sucata`): a sobra curta demais para voltar ao estoque, na barra de corte.

### Modo escuro
`:root[data-theme="dark"]` redefine os mesmos nomes: `shell-bg` #0B0F14, `shell-hover` #18202A, `chao` #0F141A, `painel` #171E26, `painel-2` #1D2630, `aco-claro` #3A4654, `linha` #2A3440, `linha-forte` #3E4B59, `ink` #E9EEF3, `ink-2` #C3CDD7, `ink-3` #93A1AF, `link` #6CC6F2, `acao-tint` #12303F, `perigo` #E5484D, `perigo-tint` #3A1517, `perigo-texto` #FF9592, `aviso-tint` #3A2C08, `aviso-texto` #F5C76A, `sucata` #5A2326. Azul GA, grafite e os estados de ação não mudam.

### Named Rules
**A Regra do Texto Grafite.** Preenchimento azul GA sempre leva texto grafite (`acao-ink`), nunca branco. Texto azul sobre fundo claro é sempre `link`, nunca `ga-azul`.

**A Regra do Vermelho de Baixa.** Vermelho só aparece para baixa, erro e sucata. Ação destrutiva repetida numa lista usa o contorno vermelho; o vermelho cheio fica para a confirmação.

**A Regra da Casca Grafite.** O grafite com filete azul GA pertence à casca e à tela de login. O conteúdo vive no chão de aço frio com painéis brancos.

## Typography

**Display Font:** Archivo variável, auto-hospedada (com system-ui, Segoe UI, sans-serif)
**Body Font:** Archivo, largura normal
**Label/Mono Font:** JetBrains Mono, auto-hospedada (com ui-monospace, Consolas, monospace)

**Character:** Uma grotesca industrial que se alarga e engrossa nos títulos, como as letras do logo, contra uma mono técnica que trata cada número como medida de oficina.

### Hierarchy
- **Display** (800, clamp 28–40px, 1.05, largura 125%, caixa alta, `text-wrap: balance`): título de cada aba ("Plano de corte", "Estoque").
- **Headline** (800, 22px, 1.15, largura 118%): título de modal.
- **Numeral** (800, 26px, 1.1, largura 118%, tabular): valor de KPI.
- **Title** (700, 19px, 1.2, largura 112%): título de painel. O nome do produto na casca usa 700, 15px, largura 112%.
- **Body** (400, 16px, 1.5): texto e campos; descrição de página limitada a 62ch. **Body-sm** (14px) em tabelas, subtítulos e textos de resultado.
- **Label** (mono 600, 11.5px, 0.08em, caixa alta): rótulos de campo, cabeçalhos de tabela, rótulos de KPI e de sobra.
- **Data** (mono 700, 12.5px, tabular, zero cortado): badges de ID, números dentro da barra de corte. **Data-lg** (mono 700, 22px): o valor da sobra. Bitola no cartão: mono 700, 16px.

### Named Rules
**A Regra Expandida.** A largura expandida (112–125%) e os pesos 700–800 são para títulos e números grandes; o texto corrido fica em largura normal.

**A Regra do Dado em Mono.** ID, bitola, medida, peso e sobra sempre em JetBrains Mono com `tabular-nums slashed-zero`, para alinhar em coluna e não confundir 0 com O.

## Layout

Coluna única centrada com largura máxima de 1180px e margem lateral de 24px (12px abaixo de 735px); a mesma `shell-inner` alinha casca, abas e conteúdo. A página começa 36px abaixo das abas (22px no celular) e reserva 72px no rodapé para o toast. Painéis empilham com 20px entre si e 24px de padding interno (18px 16px no celular).

Ritmo em passos de 4px: 4, 8, 12, 16, 20, 24 e 36px. Campos em grade `auto-fit` de colunas com mínimo de 190px e vão de 16px; abaixo de 735px a grade vira pares, e selects, textos e campo com botão ocupam a linha inteira. Ações do painel ficam alinhadas à direita no fim e, no celular, viram botões de largura total.

Pontos de quebra: 860px (somem nome do produto e divisor da casca), 735px (layout de celular: rótulos das ações da casca somem, abas esmaecem à direita para indicar rolagem, KPIs em 2 colunas, coluna de ação da tabela presa à direita) e `pointer: coarse` (todo controle pequeno sobe para 44px).

**A Regra da Faixa Dividida.** Indicadores formam uma faixa única dividida, não cartões soltos: a grade tem vão de 1px sobre fundo `linha`, de modo que as divisórias aparecem em qualquer quebra de coluna. Contagem ímpar no celular: o último ocupa a linha inteira.

## Elevation & Depth

Plano por padrão. A profundidade vem de camadas tonais (chão de aço frio, painel branco, painel interno) e de bordas de 1px; nenhum painel, cartão ou botão tem sombra em repouso. Sombra só existe no que flutua acima da página: modal e toast. A casca fica presa no topo sem sombra, separada pelo filete azul.

### Shadow Vocabulary
- **Modal** (`box-shadow: 0 18px 48px -12px rgba(11, 15, 20, 0.45)`): caixa de modal sobre o véu grafite `rgba(11, 15, 20, 0.62)`. Removida na tela de login, onde o fundo já é grafite sólido.
- **Toast** (`box-shadow: 0 10px 30px -8px rgba(11, 15, 20, 0.5)`): aviso flutuante no rodapé.
- **Coluna presa** (`box-shadow: -8px 0 12px -8px rgba(11, 15, 20, 0.25)`): só no celular, na coluna de ação da tabela que fica presa à direita.
- **Anel de foco de campo** (`box-shadow: 0 0 0 3px rgba(59, 173, 232, 0.28)`): halo azul GA junto da borda `link` no campo focado.

### Named Rules
**A Regra do Chão Plano.** Superfícies não flutuam em repouso. Sombra é sinal de "está acima da página" (modal, toast), nunca decoração.

## Shapes

Cantos firmes e pequenos, nunca pílula nos controles: 6px (`r-ctrl`) em botões, campos, chips, avisos e toast; 10px (`r-painel`) em painéis, tabelas, faixa de KPIs e modais. A barra de corte tem 5px por fora e 3px em cada segmento; badges, 4px. Pílula (999px) só no contador da aba. Bordas: 1px nos painéis; 1.5px em campos, botões de contorno e cartões selecionáveis, onde a borda é o sinal de estado. A etiqueta térmica é a exceção em P&B: bordas pretas de 2.5px e cantos de 10px (caixa do ID 6px, caixa do QR 8px).

## Components

### Buttons
Diretos e pesados, com a cor dizendo a consequência.
- **Shape:** cantos de 6px, altura mínima 44px, padding horizontal 20px, Archivo 700 15px, ícone de 18px com vão de 8px.
- **Primary:** azul GA com texto grafite e borda da mesma cor; hover clareia (`acao-hover`), pressionado escurece (`acao-press`) e desce 1px.
- **Secondary:** contorno de 1.5px em `ink`, fundo transparente; hover preenche com `painel-2`.
- **Perolado (pearl):** ação utilitária leve (Ler QR, Fechar, Mostrar mais): `painel-2`, borda `linha`, 600 14px, 40px; hover escurece borda e texto.
- **Danger:** vermelho cheio com texto branco para a confirmação da baixa. **Danger contorno:** borda e texto `perigo-texto`, para ações destrutivas repetidas em lista; hover preenche com `perigo-tint`.
- **Pequeno / ícone:** 36px (44px em tela de toque). Desabilitado: opacidade 0.5.

### Chips
- **Carrinho de medidas:** borda 1.5px azul GA sobre `acao-tint`, 36px de altura (44px no toque), botão de remover que fica vermelho no hover.
- **Badge:** grafite com texto branco, mono 700 12.5px, 24px de altura, cantos de 4px; variante vermelha para ID inválido. Contador da aba: mesmo grafite em pílula.

### Cards / Containers
- **Corner Style:** 10px.
- **Background:** `painel` sobre o chão `chao`; zonas internas em `painel-2`.
- **Shadow Strategy:** nenhuma (ver Elevation & Depth).
- **Border:** 1px `linha`.
- **Internal Padding:** 24px (18px 16px no celular); cartão de barra 18px 20px 14px.
- **Cartão de bitola:** botão selecionável com borda 1.5px `linha`; hover `ink-3`; ativo com borda azul GA sobre `acao-tint`.
- **Painel de resultado:** borda 1.5px azul GA sobre `acao-tint`, 16px 20px.

### Inputs / Fields
- **Style:** 44px de altura, borda 1.5px `linha-forte`, fundo `painel`, cantos de 6px, texto de 16px (evita zoom no iOS), select com seta SVG própria, sem setinhas nos campos numéricos.
- **Focus:** borda `link` com halo de 3px azul GA a 28%.
- **Hover:** borda `ink-3`. **Erro:** mensagem em `perigo-texto` 14px abaixo do formulário.

### Navigation
- **Casca:** faixa grafite de 60px (56px no celular) com logo negativo de 46px (40px no celular), divisor de 1px, nome do produto e ações à direita (ícone + rótulo; só ícone abaixo de 735px). Ações em `shell-ink-muted`, hover `shell-hover` com texto branco, foco com contorno azul GA. Botão de perfil com borda de 1px.
- **Abas:** faixa branca com borda inferior `linha`; aba de 50px (48px no celular), Archivo 600 14.5px em `ink-3`; ativa em `ink` 700 com sublinhado azul GA de 3px que cresce do centro (`scaleX`, 220ms). Rolagem horizontal sem barra, com esmaecimento à direita no celular.
- **Seletor de perfil (login):** segmentado em `painel-2`; ativo em grafite com texto branco (no escuro, azul GA com texto grafite).

### Barra de corte sobre trena (assinatura)
Cada barra do plano é desenhada em escala: uma faixa grafite de 34px com 2px de padding, onde cada peça é um segmento azul GA com largura proporcional à medida (`flex: <medida> 1 0`) e a sobra fica no fim em aço claro, ou em rosa sucata quando curta demais para voltar ao estoque. O vão de 2px entre segmentos é a linha de corte. Números mono só aparecem quando o segmento ocupa pelo menos 9% da barra; o valor completo fica no `title`. Abaixo, a trena: régua com linha superior de 1.5px `linha-forte`, marcas de 6px a cada 0,5 m e de 9px a cada metro (passo de 1 m e rótulos a cada 2 m em barras acima de 6 m), números mono 700 12px, e o comprimento total com "m" na ponta direita. No escuro, a barra ganha fundo #0B0F14 e um anel de 1px `linha-forte`. A sobra aparece também no canto do cartão em mono 22px: `link` quando volta ao estoque, `perigo-texto` quando é sucata.

**A Regra do Vão de Corte.** A barra é proporcional e honesta: segmentos nunca têm largura fixa, e o vão de 2px é o único separador entre peças.

### Etiqueta térmica
A única peça que chega ao cliente, sempre em preto e branco: borda preta de 2.5px, monograma GA no cabeçalho em Archivo 800 caixa alta, ID em caixa de 28px peso 900, especificações em mono 700 13.5px com ícones de traço preto, QR à direita em caixa própria.

## Do's and Don'ts

### Do:
- **Do** usar azul GA (#3BADE8) como preenchimento com texto grafite (#171E26), e `link` (#0B6FA4) sempre que o azul for texto.
- **Do** escrever todo dado do aço (ID, bitola, medida, sobra, peso) em JetBrains Mono com `tabular-nums slashed-zero`.
- **Do** usar rótulos de dado em mono 11.5px, 600, caixa alta, 0.08em, como eco do "INDÚSTRIA DE AÇO" do logo.
- **Do** manter alvos de toque de 44px (`--ctrl-h`), e subir controles menores para 44px em `pointer: coarse`.
- **Do** desenhar medidas em escala sobre a trena quando uma barra for mostrada.
- **Do** definir toda cor nova como token em `:root` e redefini-la em `:root[data-theme="dark"]`.
- **Do** usar ícones SVG próprios de 18px, traço de 2px, pontas arredondadas, cor herdada (`currentColor`).

### Don't:
- **Don't** pôr texto branco sobre azul GA, nem usar azul GA como cor de texto sobre fundo claro.
- **Don't** usar vermelho fora de baixa, erro e sucata.
- **Don't** dar sombra a painéis, cartões ou botões; sombra é só para modal e toast.
- **Don't** espalhar indicadores em cartões soltos; use a faixa dividida.
- **Don't** usar cantos de pílula em botões ou campos.
- **Don't** redesenhar, recolorir ou recompor o logo Grande Aço; use os arquivos de `assets/`.
- **Don't** usar cor nas etiquetas térmicas: elas saem em P&B.
- **Don't** voltar à estética de loja Apple ou ao painel SaaS cinza com um acento azul que este sistema substituiu.
