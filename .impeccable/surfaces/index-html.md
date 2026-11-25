---
version: 1
slug: "index-html"
primary_target: "index.html"
related_targets: ["styles.css","app.js"]
---

# Controle de Pontas: app inteiro (index.html)

Mode: Operate. Rebranding visual do app interno para a identidade Grande Aço (o logo existente é a referência fixa).
Escopo: casca (cabeçalho, abas), as 4 abas, login, modais, toast, etiquetas térmicas, PDF exportado, favicon. Função, textos de domínio e fluxos ficam intactos.
Usuários: vendedor no PC (balcão) e operador no celular (pátio), com o mesmo peso. As etiquetas são a única peça que chega ao cliente.
Restrições: site estático sem build; etiquetas térmicas em P&B; contraste para uso ao sol; alvos de toque ≥44px.
Momento memorável: o plano de corte desenhado como barra de aço sobre trena graduada.
Em aberto: nada.

## Direction contract

THESIS: o app vira ferramenta da própria Grande Aço: a marca firme na casca e o aço medido no centro. Recusa o painel SaaS cinza com um acento azul e a imitação de loja Apple que existia.

OWN-WORLD: casca grafite #171E26 com filete azul GA #3BADE8; fundo aço frio #EEF1F4; painéis brancos. Ação primária = preenchimento azul GA com texto grafite; links e texto ativo em azul profundo #0B6FA4; vermelho só para baixa e erro. Archivo expandida peso 800 em títulos e números grandes; Archivo normal na interface; JetBrains Mono em IDs, medidas e rótulos de dado (caixa alta, espaçada, eco de "INDÚSTRIA DE AÇO"). Cantos de 6px nos controles e 10px nos painéis; ícones SVG próprios com traço de 2px.

STORY: a pessoa entra por um login com a marca, monta o pedido, vê cada barra cortada sobre a trena, confirma a baixa e imprime etiquetas com o monograma GA.

FIRST VIEWPORT: faixa grafite de 60px (logo negativo com 46px de altura à esquerda; 56px/40px no celular. Ajustado no build porque o logo empilhado em três linhas fica ilegível com 30px), "Controle de Pontas" depois de um divisor, ações em ícone + rótulo à direita), filete azul de 3px, barra de abas branca com a aba ativa sublinhada em azul GA. Abaixo, o título "Plano de corte" (Archivo expandida 800, cerca de 40px) e o painel "Configurar pedido" com campos em grade. Ação primária "Calcular aproveitamento" em azul GA, alinhada à direita no fim do painel. Sem sessão, a tela inteira é grafite com o logo negativo grande e um cartão branco de senha.

FORM: direção fixada pelo usuário. seed: none (pinned): "pode seguir com a B", sendo B = "Identidade industrial completa: faixa grafite, filete azul GA, título largo, rótulos mono, tela de login com a marca, monograma GA nas etiquetas e no PDF, modo escuro em grafite". Assinatura: barra de corte sobre trena graduada (marcas a cada 0,5 m, números mono, peças em azul GA, sobra em aço claro, sucata marcada).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
