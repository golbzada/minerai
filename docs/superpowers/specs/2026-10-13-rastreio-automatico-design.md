# Rastreio automático diário das ofertas — design

Data: 13/10/2026 · Produto: Mineraí (painel `mineraiofertas.vercel.app` + extensão Chrome)

Marcações: **[dono]** = decidido pelo dono do produto na conversa;
**[escolha do Claude]** = decisão técnica/produto tomada por mim, que o dono
pode vetar ao ler.

## Intenção e porquê

O Mineraí guarda as ofertas que a pessoa garimpou na Biblioteca de Anúncios da
Meta. O valor de uma oferta salva está em **acompanhar como ela evolui**: se o
anunciante está colocando mais anúncios (escalando), se está tirando (decaindo)
ou se parou tudo (morreu — não vale mais modelar).

Hoje isso depende de a pessoa clicar em "+ Hoje" em cada card, todo dia, e
digitar um número. Quase ninguém faz. Resultado: gráfico de evolução vazio,
alertas sem dado, estágio "Escalando por anúncios" sem número atualizado.

O rastreio automático faz essa medição sozinho, uma vez por dia, no Chrome da
própria pessoa, e avisa quando algo importante acontece. Palavras do dono:
"é bom que a gente fica de olho, fica sondando as ofertas, e mostra as que
morreram".

Público: iniciantes que garimpam e modelam ofertas. Não são técnicos.

## Objetivos

1. Toda oferta salva (não descartada) recebe uma medição por dia, sem clique
   **[dono: todas, favoritas primeiro]**.
2. A medição registra o **total de anúncios ativos do anunciante** e se **o
   anúncio salvo ainda está no ar**.
3. Avisar quando uma oferta **escalou**, **está decaindo** ou **morreu**: na
   página Alertas do painel e, nos casos fortes, com notificação do Chrome
   **[dono: "avisar durante o dia se ele estiver usando"]**.
4. O gráfico de evolução de cada oferta passa a se encher sozinho.
5. Custo zero **[dono]**.

## Fora do escopo (agora)

- Radar do nicho (buscas salvas) e transcrição de criativos: projetos
  separados, depois deste **[dono: ordem 1, depois 2/3]**. O motor de leitura
  daqui deve poder ser reusado pelo Radar.
- Uma tab própria de "ofertas mortas" no Garimpo: o dono quer "depois,
  eventualmente". Agora: filtro "Morreu" na página Alertas + marca no card.
- Rodar em servidor (cron na nuvem). Seria pago ou frágil.
- Rastrear com o computador desligado.

## Antiobjetivos (seria um fracasso mesmo funcionando)

- Pesar no PC (o dono se preocupou com RAM). **Nenhuma aba pode ser aberta**:
  a leitura é por requisição de texto, em segundo plano.
- Fazer a Meta bloquear a Biblioteca da pessoa. Ritmo lento, teto diário,
  parar no primeiro sinal de bloqueio.
- **Deslogar a pessoa do painel** por causa da sessão compartilhada com a
  extensão (ver "Sessão" abaixo).
- Marcar como morta uma oferta viva (leitura errada = pessoa descarta oferta boa).
- Encher a pessoa de notificações: no máximo **uma por rodada**, só com evento forte.
- Quebrar ou atrasar o "Minerar oferta" e o restante da extensão.
- Gastar dinheiro.

## Restrições

- Extensão Manifest V3: o service worker pode ser encerrado após ~30 s ocioso.
  Trabalho em fila + progresso em `chrome.storage`, processado em lotes.
- CSP do painel: `script-src 'self'` (sem script inline).
- Banco: Supabase gratuito. **Sem migração nova**: campos extras no bloco de
  metadados escondido em `funnel_notes` (`[[minerai:{...}]]`, máx. 10000
  caracteres) — `src/utils/offerMeta.js` + cópias espelhadas em
  `extension/background.js`. `history` é `jsonb` (até 256 KB).
- RLS deixa a extensão atualizar `ads_count`, `history`, `funnel_notes`,
  `status`, `updated_at` (migração 003) — basta.
- Regras de estágio espelhadas: `STAGE_DAYS`/`STAGE_BY_ADS` em
  `extension/content.js` e `src/utils/offerMeta.js`.
- Clientes instalam "sem compactação": versão nova = reinstalar. Permissões
  novas (`alarms`, `notifications`, host `https://www.facebook.com/*`)
  aparecem no aviso de instalação — aceitável.
- Plano inativo bloqueia escrita (RLS por plano): o rastreio não roda e não
  mostra erro.

## Como funciona

### Leitura de uma oferta (confirmado na Biblioteca real em 13/10/2026)

1. `GET https://www.facebook.com/ads/library/?id=<library_id>` → perto de
   `"ad_archive_id":"<library_id>"` vêm `"page_id":"N"` (ID real da página do
   anunciante) e `"is_active":true|false` (anúncio salvo no ar).
2. `GET .../ads/library/?active_status=active&ad_type=all&country=<país>&view_all_page_id=<page_id>&media_type=all`
   → `"search_results_connection":{"count":N` = anúncios ativos do anunciante
   (bate com o "~N resultados" da tela). 8/8 certos, 1–3 s cada, sem login.
- Código atual: `fetchRealPageId`/`fetchPageActiveAds` em `extension/content.js`.
  Vira uma peça só, usada pelo content script (minerar) e pelo service worker
  (rastreio). No service worker precisa do host `https://www.facebook.com/*`.
- `page_id_real` é guardado no metadado depois da primeira leitura (a do card
  costuma ser ID de perfil e dá 0).
- Oferta sem `library_id` e sem `page_id_real`: tenta o `page_id` salvo; se der
  0 ou falhar, a oferta fica "sem rastreio" e **nunca** é marcada como morta.
- **País [escolha do Claude]**: o da mineração (`country` no metadado, gravado a
  partir de agora). Oferta antiga sem país: tenta `BR`; se `BR` der 0 mas o
  anúncio salvo estiver ativo, tenta `ALL` e grava o país que funcionou.

### Sessão (login) da extensão **[escolha do Claude]**

Hoje o painel passa a sessão para a extensão (`bridge.js`, a cada 6 s, só com o
painel aberto). Quando o token vence e o painel está fechado, a extensão renova
sozinha (`getAuthValida`) — o token antigo fica revogado, mas o painel ainda o
tem guardado. Isso já é um risco hoje (mineração com painel fechado > 1 h) e o
rastreio diário tornaria frequente.

Correção: **sincronização nos dois sentidos**.
- Toda vez que a extensão renovar a sessão, ela devolve a sessão nova para o
  painel: o `bridge.js` grava no `localStorage` do painel (chave `sb-*-auth-token`)
  em qualquer aba do painel aberta, e também no carregamento de uma aba nova
  (`run_at: document_start`, antes do app iniciar), sempre que a sessão da
  extensão for do mesmo usuário e mais nova (`expires_at` maior).
- O supabase-js do painel lê a sessão do `localStorage` a cada uso/ao voltar o
  foco, então passa a usar a sessão nova sem deslogar.
- Validar no Chrome do dono: fechar o painel, esperar > 1 h (ou forçar o token
  vencido), rodar o rastreio, abrir o painel → continua logado.

### Quando roda

- Uma vez por dia (dia local). Dispara quando o Chrome abre
  (`runtime.onStartup`) e por um `chrome.alarms` periódico que confere "já rodou
  hoje?". Precisa da extensão conectada; sem login, não roda.
- Botão "Rodar agora" no popup.

### Quais ofertas, ordem e ritmo

- Todas as da pessoa, **favoritas primeiro**, depois as demais (as medidas há
  mais tempo antes). Pula as da coluna "descartada" da esteira.
- **Teto [escolha do Claude]**: 200 ofertas por dia. Acima disso, revezam (as
  que ficaram de fora entram primeiro no dia seguinte); favoritas sempre entram.
- Uma oferta por vez, alguns segundos entre elas. ~100 ofertas ≈ 5–7 min.
- Progresso salvo: Chrome fechou no meio → continua na próxima vez, no mesmo dia.
- Sinal de bloqueio (captcha `xfb_ad_library_is_captcha_required:true`, HTML sem
  o marcador várias vezes seguidas, HTTP 4xx/5xx em sequência): **para a
  rodada** e só tenta no dia seguinte.

### Unidade do número de anúncios **[escolha do Claude]**

- A partir de agora, **o número que importa é o total de anúncios ativos do
  anunciante**: vai para `history` e `ads_count` (o painel já chama de
  "anúncios ativos"). O "N anúncios usam este criativo" do card continua só
  como informação na barra da Biblioteca.
- **Minerar oferta** também passa a gravar o total do anunciante no histórico
  quando a leitura dá certo; se falhar, não grava medição (só salva a oferta).
- Cada entrada nova do histórico ganha `kind: 'anunciante'`; `historyEntry`,
  `normalizeHistory` e `upsertHistory` (painel e extensão) preservam esse campo.
  Entradas antigas sem `kind` ficam no gráfico como estão, mas **nenhum alerta
  compara número novo com número antigo** (inclusive o "queda" que já existe).
- "+ Hoje" (ResultModal) passa a explicar: "anúncios ativos do anunciante (o
  ~N resultados da página dele na Biblioteca)" e grava com `kind: 'anunciante'`.
- O `page_active_ads` gravado na mineração conta como base da primeira leitura.

### O que é gravado por oferta

- `history` (medição do dia, upsert por data) e `ads_count`.
- Metadado: `page_id_real`, `country`, `page_active_ads` (+ `_at`), `ad_active`,
  `dead_since`, `tracked_at`, `track_events` (ver abaixo).
- `status`: recalculado com a regra de estágio, exceto `status_manual`.
- Junto: corrigir `api.addDailyResult`, que hoje recalcula `status` sem os
  anúncios do anunciante.

### Eventos e alertas **[escolha do Claude nos limites]**

Sempre comparando só leituras `kind: 'anunciante'`:

- **Morreu** (forte): anunciante com 0 anúncios ativos **e** anúncio salvo
  inativo, com `page_id_real` confirmado, **em 2 leituras seguidas** (dias
  diferentes). `dead_since` = data da primeira dessas leituras. Se voltar a ter
  anúncios, `dead_since` some e gera "Voltou ao ar" (fraco).
- **Criativo saiu do ar** (fraco): anúncio salvo inativo, anunciante segue ativo.
- **Escalou** (forte): hoje ≥ 1,5× **e** ≥ +5 anúncios em relação à menor
  leitura dos últimos 7 dias (pega crescimento rápido e o de uma semana).
- **Decaindo** (médio): hoje ≤ 0,5× a maior leitura dos últimos 7 dias, com
  essa maior ≥ 4. **Substitui** o alerta "queda" atual para ofertas com leituras
  do anunciante; o "queda" antigo continua só para ofertas sem rastreio.
- Primeira leitura de uma oferta: só cria base, nenhum evento.
- Constantes num lugar só, fáceis de ajustar.

Persistência: cada evento é gravado em `track_events` no metadado (tipo, data,
números; no máximo os 5 mais recentes) e aparece na página Alertas por **7 dias**
(depois some sozinho). `computeAlerts` lê dali.

Também em Alertas: "Precisa de medição" e "Rotina de hoje" deixam de pedir
medição manual para ofertas com `tracked_at` dos últimos 2 dias.

Onde aparecem:
- **Página Alertas**: tipos novos Morreu, Escalou, Decaindo, Criativo saiu do
  ar, Voltou ao ar. O filtro por tipo existente é a "lista das mortas" por ora.
- **Card**: marca vermelha discreta "fora do ar desde DD/MM" quando morta.
- **Notificação do Chrome**: ao fim da rodada, se houve evento forte, **uma**
  notificação resumo ("3 ofertas escalaram, 1 morreu"). Clique abre
  `/alertas` no painel.

### Estágio de oferta morta **[escolha do Claude]**

- Os dias no ar **congelam em `dead_since`** (a oferta rodou X dias e parou);
  o rótulo de estágio é o desses dias. Mais a marca "fora do ar".
- O estágio pode cair quando o número de anúncios cai (a regra é recalculada
  todo dia). O texto "só sobe, nunca rebaixa" da documentação vira "a regra de
  anúncios só pode subir o estágio em relação ao tempo".
- O alerta "Mudou de estágio" não dispara por causa de oferta morta.

### Onde a pessoa vê e controla

- Popup: linha "Rastreio diário" com estado (ligado, última rodada, quantas
  ofertas, eventos) e "Rodar agora". **Ligado por padrão**, dá para desligar.
- Painel (Alertas): "Atualizado automaticamente hoje às 09:12" quando houver
  `tracked_at` de hoje; sem extensão conectada, convite para instalar.
- PageGuide do Garimpo: o "+ Hoje" deixa de ser tarefa diária obrigatória.

## Deixado para quem construir

- Organização do service worker (tamanho dos lotes, intervalo exato, fila).
- Texto exato das notificações e alertas (português simples, sem jargão).
- Como compartilhar o código de leitura entre content script e service worker.
- Visual da linha do rastreio no popup e da marca "fora do ar".

## Como validar

- Leitura: funções contra a Biblioteca real (navegador), como em 13/10.
- Regras de evento, unidade do histórico, morte em 2 leituras, congelamento de
  dias: testes `node` sobre funções puras.
- Sessão nos dois sentidos e fluxo completo do service worker: só no Chrome do
  dono com a extensão instalada — entregar roteiro de teste passo a passo.
