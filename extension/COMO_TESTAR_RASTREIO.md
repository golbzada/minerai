# Como testar o rastreio diário (extensão 1.27.0)

O rastreio mede sozinho, uma vez por dia, quantos anúncios ativos o anunciante
de cada oferta salva tem. Ele avisa quando uma oferta escalou, está caindo ou
morreu. Não abre nenhuma aba.

## 1. Instalar a versão nova

1. Abra `chrome://extensions` e remova a Mineraí.
2. No painel, menu **Extensão**, baixe a extensão de novo e instale como da
   primeira vez.
3. O Chrome vai avisar que a extensão quer "ler dados em facebook.com" e
   "mostrar notificações". Isso é o rastreio: ele lê a Biblioteca de Anúncios
   e avisa quando algo muda.
4. Abra o painel uma vez, logado, para a extensão pegar a sua conta.

## 2. Rodar na hora

1. Clique no ícone da Mineraí no Chrome.
2. Na linha **Rastreio diário**, clique em **Rodar agora**.
3. O texto muda para "Medindo: 3 de 109" e vai subindo. Com cerca de 100
   ofertas leva uns 5 a 7 minutos. Pode fechar o popup: ele continua por trás.
4. No fim aparece "Hoje às 09:12 · 109 ofertas". Se alguma escalou ou morreu,
   aparece também uma notificação no canto da tela.

## 3. Conferir no painel

- Página **Alertas**: no topo aparece "Ofertas atualizadas automaticamente
  hoje às ...". Na lista aparecem os alertas **Escalou**, **Decaindo**,
  **Morreu**, **Criativo saiu do ar** e **Voltou ao ar**, quando houver.
- Página da oferta: o gráfico de evolução ganha um ponto por dia.
- Oferta morta: o card mostra a marca vermelha "fora do ar desde DD/MM".

No primeiro dia quase não aparecem alertas. A primeira medição de cada oferta
só serve de base, e os alertas começam a partir da segunda.

## 4. Teste do login (o mais importante)

1. Feche todas as abas do painel.
2. Espere mais de 1 hora, ou deixe para o dia seguinte.
3. Abra o popup e clique em **Rodar agora**.
4. Depois abra o painel. **Ele precisa continuar logado.** Se pedir login de
   novo, me avise.

## 5. Desligar

No popup, use o interruptor ao lado de "Rodar agora". Desligado, nada roda
sozinho. O botão "Rodar agora" continua funcionando.

## Se aparecer "A Meta pediu uma pausa"

A Biblioteca freou as leituras. O rastreio para sozinho e tenta de novo no dia
seguinte. Não precisa fazer nada.
