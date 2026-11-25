# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Vendedor** (balcão, no PC): monta o plano de corte para o pedido do cliente, confere o estoque de pontas, imprime a ordem de corte e confirma a baixa.
- **Operador** (pátio, no celular): cadastra pontas novas, lê o QR Code das etiquetas, faz baixas manuais, estorna e imprime etiquetas.

Os dois contextos têm o mesmo peso: a interface precisa funcionar bem no PC e no celular.

## Product Purpose

Controlar as pontas de vergalhão (sobras de barras) da Grande Aço e reaproveitá-las ao máximo. O sistema escolhe quais pontas cortar para atender um pedido com a menor sobra possível, registra a baixa e devolve ao estoque as sobras aproveitáveis com um ID novo e etiqueta própria. Sucesso = menos aço virando sucata e estoque de pontas confiável.

## Operating Context

- Estoque vive numa planilha Google ("Pontas"); o sistema lê e grava via Apps Script autenticado.
- Etiquetas térmicas USB (100×50, 80×40, 60×40 mm ou A4) com QR Code do ID; o QR é lido pela câmera do celular no pátio.
- Ordem de corte é copiada para WhatsApp ou impressa; relatórios saem em Excel e PDF.
- Uso no pátio implica celular em ambiente externo (luz forte) e manuseio rápido.

## Capabilities and Constraints

- Perfis: Vendedor (plano de corte, estoque, baixa pelo plano) e Operador (tudo, inclusive cadastro e estorno). Senhas validadas no servidor.
- Termos do domínio: ponta, bitola (mm), medida (m), sobra, sucata, baixa, estorno, perda por corte.
- Site estático (index.html, styles.css, app.js, corte.js); sem framework nem build.
- Etiquetas são impressas em preto e branco (térmica).

## Brand Commitments

- Marca: **Grande Aço — Indústria de Aço**. Não existe manual de marca; o logo é a referência.
- Logo fixo (não redesenhar): monograma "GA" em azul-celeste, "GRANDE AÇO" em grafite com letras largas e pesadas, e "INDÚSTRIA DE AÇO" em fonte mono. Arquivos: `image_1d6ea0.png` (versão com círculo).
- Cores do logo: azul `#3BADE8`, grafite `#171E26`.

## Evidence on Hand

- Logo em PNG (com e sem círculo). Não há fotos do pátio, depoimentos nem dados públicos; não inventar.

## Product Principles

1. O dado do aço vem primeiro: ID, bitola e medida têm que ser lidos de relance.
2. Nada é baixado ou estornado sem confirmação explícita; erros nunca aparecem como sucesso.
3. Funciona igual no balcão e no pátio.
4. Ferramenta interna: a marca aparece com firmeza, mas nunca atrapalha a tarefa. As etiquetas são a peça que chega ao cliente.

## Accessibility & Inclusion

- Uso externo em celular: contraste alto e alvos de toque grandes.
- Zoom liberado; navegação por teclado no PC.
