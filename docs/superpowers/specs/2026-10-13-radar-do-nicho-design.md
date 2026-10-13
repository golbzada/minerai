# Radar do nicho — design

Data: 13/10/2026 · Pedido do dono: "a pessoa salva buscas como mapas mentais e
emagrecer, todo dia aparece uma lista com os anúncios dessas buscas que acabaram
de passar" — sem gastar nada. Ele pediu para fazer direto (sem rodada de
perguntas); as escolhas abaixo são minhas e ele ajusta usando.

## O que é

A pessoa salva até 10 buscas (palavra + país). Uma vez por dia, depois do
rastreio das ofertas, a extensão faz a busca na Biblioteca de Anúncios ordenada
pelos **mais vistos** (o que a Meta mostra por padrão) e guarda os 30 primeiros.
Anúncio entre os mais vistos do nicho com **10 a 45 dias no ar** = oferta nova
escalando. O painel ganha a página **Radar** com essa lista.

## Confirmado na Biblioteca real (13/10/2026)

- O HTML da busca traz `"search_results_connection":{"count":N,"edges":[...]}`
  com 30 anúncios completos: `ad_archive_id`, `page_id`, `start_date` (unix),
  `collation_count`, `snapshot.page_name`, `snapshot.link_url`,
  `snapshot.body.text`, imagens.
- O filtro de data da Biblioteca é por período de exibição, não por data de
  início; e "mais recentes" traz anúncios de 0 dias. Por isso: mais vistos +
  filtro de 10 a 45 dias feito por nós.
- Sem os cookies normais do navegador a Meta manda um desafio anti-robô; a
  extensão não tenta burlar: para e tenta no dia seguinte (mesma regra do
  rastreio).

## Decisões (minhas)

- **Onde ficam as buscas:** na própria extensão (`chrome.storage`), sem mudar
  o banco. O Radar só existe com a extensão instalada; as buscas não vão para
  outro computador. O painel conversa com a extensão pelo `bridge.js`.
- **Um achado por anunciante** (o de melhor posição), com: anunciante, dias no
  ar, estágio, "N anúncios com este criativo", domínio da página de vendas,
  texto curto, link para a Biblioteca.
- **Novo no radar:** anunciante que aparece pela primeira vez naquela busca.
  Na primeira rodada de uma busca nada é "novo" (tudo seria).
- **Termômetro do nicho:** total de anúncios ativos da busca e a variação em
  relação à rodada anterior.
- **Filtros na página:** "Só ofertas novas (10 a 45 dias)" e "Esconder as que
  já estão no acervo" (ligados por padrão).
- **Minerar do Radar:** cria a oferta no acervo pelo painel (nome = anunciante,
  link do anúncio, página de vendas, data de início, IDs). O rastreio diário
  passa a medi-la no dia seguinte.
- **Notificação:** no máximo uma por dia, se apareceu oferta nova escalando
  ("Radar: 4 ofertas novas escalando nos seus nichos"); clique abre `/radar`.
- **Ritmo:** uma busca por vez, com a mesma pausa do rastreio; até 10 buscas.

## Fora do escopo

Gringa x Brasil e transcrição de criativos (próximos). Busca por anunciante.
Guardar imagem do criativo (o link da Meta expira em horas).
