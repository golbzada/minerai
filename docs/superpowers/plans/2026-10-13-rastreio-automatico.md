# Rastreio automático diário — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A extensão mede sozinha, uma vez por dia, o total de anúncios ativos do anunciante de cada oferta salva, grava no histórico e avisa quando escalou, decaiu ou morreu.

**Architecture:** Regras puras num script clássico compartilhado (`extension/rastreio-regras.js`, carregado pelo content script, pelo service worker e por `node --test`). O motor (`extension/rastreio.js`, via `importScripts` no `background.js`) usa `chrome.alarms` + fila em `chrome.storage.local`, lê a Biblioteca por `fetch` (sem abas) e grava no Supabase via REST. O painel lê os campos novos do bloco de metadados em `funnel_notes`. A sessão passa a sincronizar nos dois sentidos pelo `bridge.js`.

**Tech Stack:** Chrome MV3 (service worker clássico), React 18 + Vite, Supabase REST, `node --test` (Node 24).

**Spec:** `docs/superpowers/specs/2026-10-13-rastreio-automatico-design.md`

## Global Constraints

- Custo zero; nenhuma aba aberta pelo rastreio; sem migração no banco.
- Campos novos só no bloco `[[minerai:{...}]]` (máx. 10000 caracteres em `funnel_notes`).
- Teto: 200 ofertas/dia; favoritas sempre entram; pula esteira `descartada`.
- Morreu = total 0 **e** anúncio salvo inativo **e** `page_id_real` confirmado, em 2 leituras de dias diferentes.
- Escalou = hoje ≥ 1,5× **e** ≥ +5 vs. menor leitura `kind:'anunciante'` dos últimos 7 dias. Decaindo = hoje ≤ 0,5× a maior dos últimos 7 dias, com maior ≥ 4. Primeira leitura não gera evento.
- `track_events`: no máximo 5, cada um visível 7 dias.
- No máximo 1 notificação por rodada, só com evento forte (escalou, morreu).
- Bloqueio da Meta (captcha `"xfb_ad_library_is_captcha_required":true`, 3 leituras seguidas sem marcador, ou 3 HTTP ≥400 seguidos) → para a rodada até o dia seguinte.
- Textos para o usuário em português simples, sem jargão, sem emoji novo.
- Regras de estágio espelhadas em `extension/content.js`, `extension/rastreio-regras.js` e `src/utils/offerMeta.js`.
- Versão da extensão: 1.27.0; reempacotar `public/minerai-extensao.zip` (`npm run build:extension`).

## Review Focus

1. Painel aberto numa aba esquecida enquanto a extensão renova a sessão → o painel deve continuar logado (pega a sessão nova do `localStorage`).
2. Oferta antiga minerada fora do Brasil (sem `country`) → não pode virar "Morreu" na primeira rodada; tenta `ALL` quando `BR` dá 0 com anúncio ativo.
3. Pessoa edita anotações no painel durante a rodada → a gravação do rastreio relê a linha antes do PATCH e não apaga a edição.
4. Chrome fechado no meio da rodada → continua do ponto onde parou no mesmo dia, sem medir duas vezes.
5. Plano inativo / sem login → rodada não roda e não mostra erro.

---

### Task 1: Regras puras compartilhadas

**Files:**
- Create: `extension/rastreio-regras.js`
- Create: `tests/rastreio-regras.test.cjs`
- Modify: `package.json` (script `"test": "node --test tests/"`)

**Interfaces:**
- Produces (global `self.MineraiRastreio` no navegador; `module.exports` no node):
  - `STAGE_DAYS`, `STAGE_BY_ADS` (iguais a `content.js`)
  - `LIMITES = { teto: 200, escalouFator: 1.5, escalouMin: 5, decaiFator: 0.5, decaiBaseMin: 4, janelaDias: 7, eventosMax: 5, eventosDias: 7 }`
  - `lerAnuncio(html: string, libraryId: string) -> { pageId: string, ativo: boolean|null }`
  - `lerTotal(html: string) -> number|null` (null sem marcador)
  - `pareceBloqueio(html: string) -> boolean`
  - `historyEntry(date, count, kind?) -> object` (mantém `kind` quando passado)
  - `upsertHistory(history, date, count, kind?) -> array` (preserva `kind` das entradas existentes)
  - `classifyStage(days, pageAds) -> 'testing'|'pre_scaling'|'scaling'|'winner'`
  - `diasNoAr(startDate: 'YYYY-MM-DD', deadSince?: 'YYYY-MM-DD', hoje: 'YYYY-MM-DD') -> number`
  - `avaliarLeitura({ meta, history }, { date, total, ativo, pageIdConfirmado }) -> { meta: object, eventos: Array<{ tipo, data, de, para }> }` — tipos: `morreu`, `voltou`, `criativo_saiu`, `escalou`, `decaindo`; a `meta` devolvida já tem `page_active_ads`, `page_active_ads_at`, `ad_active`, `dead_since`, `dead_check`, `tracked_at`, `track_events` (eventos com mais de 7 dias removidos, máx. 5).
  - `montarFila(offers, hoje) -> string[]` (ids; favoritas primeiro; depois `tracked_at` mais antigo/ausente primeiro; pula `stage==='descartada'` e já medidas hoje; corta em 200 mantendo todas as favoritas)

- [ ] **Step 1: Write the failing tests** — `node:test` + `assert`, carregando o arquivo com `require('../extension/rastreio-regras.js')`:
  - `lerAnuncio` acha `page_id` e `is_active:false` num HTML com `"ad_archive_id":"123"…"page_id":"999"…"is_active":false`; HTML sem o anúncio → `{ pageId:'', ativo:null }`.
  - `lerTotal('..."search_results_connection":{"count":27,...')` → 27; sem marcador → null.
  - `pareceBloqueio` true com `"xfb_ad_library_is_captcha_required":true`.
  - `upsertHistory([{date:'2026-10-01',count:3}], '2026-10-02', 12, 'anunciante')` → 2 entradas, a segunda com `kind:'anunciante'`, a primeira sem `kind`.
  - `diasNoAr('2026-09-01', '2026-09-11', '2026-10-13')` → 11; sem `deadSince` → 43.
  - `avaliarLeitura`: primeira leitura (sem `page_active_ads`) → `eventos: []`.
  - Escalou: history anunciante de 7 dias com mínimo 10, leitura 16 → evento `escalou` (de 10, para 16); leitura 14 → nada.
  - Decaindo: máximo 20 nos 7 dias, leitura 10 → `decaindo`; máximo 3, leitura 0 com anúncio ativo → nada.
  - Morreu: total 0 + inativo + confirmado → 1ª leitura só grava `dead_check`, sem evento; 2ª leitura em outro dia → evento `morreu`, `dead_since` = data da 1ª.
  - Total 0 com `pageIdConfirmado:false` → nunca `morreu`.
  - Voltou: meta com `dead_since`, total 5 → evento `voltou`, `dead_since` ausente.
  - Criativo saiu: `ativo:false`, total 8, meta anterior `ad_active:true` → `criativo_saiu`.
  - `track_events`: com 5 eventos antigos + 1 novo → 5; evento de 8 dias atrás some.
  - `montarFila`: 250 ofertas com 3 favoritas no fim → resultado começa pelas 3 favoritas e tem 200 itens; oferta `descartada` fora; oferta com `tracked_at` = hoje fora.

- [ ] **Step 2: Run** `node --test tests/` → FAIL (arquivo não existe).
- [ ] **Step 3: Implement** `extension/rastreio-regras.js` como IIFE que monta o objeto e faz `if (typeof module !== 'undefined') module.exports = api; else self.MineraiRastreio = api;`. `lerAnuncio` procura `page_id` nos 4000 caracteres após `"ad_archive_id":"<id>"` (senão o último antes, como `fetchRealPageId` hoje) e `is_active` na mesma janela. Datas sempre `YYYY-MM-DD` comparadas como texto/dias de calendário.
- [ ] **Step 4: Run** `node --test tests/` → PASS.
- [ ] **Step 5: Commit** `feat(extensao): regras puras do rastreio diário`.

### Task 2: Painel — histórico com `kind`, dias congelados, oferta morta

**Files:**
- Modify: `src/utils/offerMeta.js`
- Create: `tests/offerMeta.test.mjs`

**Interfaces:**
- Produces:
  - `historyEntry(date, count, kind?)`, `upsertHistory(history, date, count, kind?)`, `normalizeHistory(history)` — `{ date, count, kind? }` preservando `kind`.
  - `resolveRunningDays(offer, meta)` — quando `meta.dead_since` existe, conta até `dead_since`.
  - `isOfferDead(offer) -> boolean` (`meta.dead_since` presente)
  - `deadSince(offer) -> string|null`

- [ ] **Step 1: Tests** — `upsertHistory` preserva `kind`; `normalizeHistory` mantém `kind`; oferta com `start_date` 2026-09-01 e `dead_since` 2026-09-11 → `resolveRunningDays` = 11; `isOfferDead` true/false.
- [ ] **Step 2: Run** `node --test tests/` → FAIL nos novos.
- [ ] **Step 3: Implement** nas funções existentes (sem mudar assinatura para quem já chama com 3 args).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(painel): histórico com tipo de medição e dias congelados de oferta morta`.

### Task 3: Painel — alertas do rastreio

**Files:**
- Modify: `src/utils/offerExtras.js` (`computeAlerts`, `ALERT_LABELS`)
- Create: `tests/alertas.test.mjs`

**Interfaces:**
- Consumes: `normalizeHistory` (Task 2), `meta.track_events`, `meta.tracked_at`.
- Produces: alert types `morreu` (alta), `escalou` (alta), `decaindo` (media), `criativo_saiu` (baixa), `voltou` (baixa); `ALERT_LABELS` com rótulos "Morreu", "Escalou", "Decaindo", "Criativo saiu do ar", "Voltou ao ar".

- [ ] **Step 1: Tests** (`computeAlerts(offers, ALERT_DEFAULTS)`, data de hoje real):
  - evento `escalou` de hoje em `track_events` → alerta `escalou` com texto contendo "de 10 para 16".
  - evento de 8 dias atrás → nenhum alerta dele.
  - oferta com `tracked_at` de ontem → sem alerta `medicao`.
  - oferta com entradas `kind:'anunciante'` → sem alerta `queda` antigo; oferta só com entradas sem `kind` caindo 50% → `queda` continua.
  - oferta morta → sem alerta `estagio`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Textos: escalou "Escalou: de {de} para {para} anúncios ativos.", decaindo "Decaindo: de {de} para {para} anúncios ativos.", morreu "Morreu: o anunciante parou todos os anúncios em {DD/MM}.", criativo_saiu "O anúncio que você salvou saiu do ar, mas o anunciante segue com {para} anúncios.", voltou "Voltou ao ar com {para} anúncios."
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(painel): alertas de escalou, decaindo e morreu`.

### Task 4: Sessão nos dois sentidos

**Files:**
- Modify: `extension/bridge.js`, `extension/manifest.json` (bridge `run_at: document_start`), `extension/background.js` (mensagem `GET_PANEL_SESSION`)
- Create: `src/utils/extensaoSessao.js`
- Modify: `src/main.jsx`

**Interfaces:**
- `GET_PANEL_SESSION` (só aceita `vemDoPainel`) → `{ user: {id,name,email}|null, session: {access_token, refresh_token, expires_at}|null }`.
- `bridge.js`: no início marca `document.documentElement.dataset.mineraiSessao = 'aguardando'`; pede `GET_PANEL_SESSION`; se a sessão da extensão é do mesmo `user.id` do objeto `sb-*-auth-token` e tem `expires_at` maior, grava nele `access_token`, `refresh_token`, `expires_at`, `expires_in` (mantendo `user` e o resto); depois marca `'pronta'`. O laço de 6 s repete a comparação nos dois sentidos (painel mais novo → `SET_AUTH_USER` como hoje; extensão mais nova → grava no `localStorage`).
- `aguardarSessaoDaExtensao(): Promise<void>` — resolve na hora se o atributo não existe ou já é `'pronta'`; senão espera a mudança (MutationObserver) por no máximo 600 ms.
- `main.jsx`: `await aguardarSessaoDaExtensao()` e só então `import('./App')` dinâmico e render (os CSS continuam estáticos).

- [ ] **Step 1:** Implementar `extensaoSessao.js` + `main.jsx`; `npm run build` passa.
- [ ] **Step 2:** Implementar `GET_PANEL_SESSION` e o bridge. Comparação e merge numa função pura `sessaoMaisNova(painel, extensao) -> 'painel'|'extensao'|'igual'` dentro do bridge.
- [ ] **Step 3: Verify** no painel local (`minerai-local-5175` não tem extensão): app abre sem esperar (atributo ausente) e sem erro no console.
- [ ] **Step 4: Commit** `fix(sessao): extensão devolve a sessão renovada ao painel`.

### Task 5: Mineração grava o total do anunciante

**Files:**
- Modify: `extension/manifest.json` (content script carrega `rastreio-regras.js` antes de `content.js`)
- Modify: `extension/content.js` (`fetchRealPageId`/`fetchPageActiveAds` usam `MineraiRastreio.lerAnuncio/lerTotal`; `STAGE_*`/`classifyStage` vêm de `MineraiRastreio`; captura passa `pageIdReal`, `country`, `adActive`)
- Modify: `extension/background.js` (`sanitizeOfferData` + `buildMeta` com `page_id_real`, `country`; `historyEntry`/`upsertHistory` vêm de `MineraiRastreio` com `kind:'anunciante'`; oferta existente só mexe em `ads_count`/`history` quando `pageActiveAds > 0`; oferta nova sem leitura: `ads_count` = contagem do criativo e `history: []`)

**Interfaces:**
- Consumes: Task 1 (`lerAnuncio`, `lerTotal`, `upsertHistory`, `historyEntry`, `classifyStage`).
- `fetchPageActiveAds(libraryId, cardPageId) -> Promise<{ total: number|null, pageId: string, ativo: boolean|null, country: string }>`.

- [ ] **Step 1:** Implementar; `node --check` nos dois arquivos.
- [ ] **Step 2: Verify** na Biblioteca real (navegador): colar as funções e conferir 3 cards (total bate com "~N results").
- [ ] **Step 3: Commit** `feat(extensao): minerar grava o total de anúncios do anunciante no histórico`.

### Task 6: Motor do rastreio no service worker

**Files:**
- Create: `extension/rastreio.js`
- Modify: `extension/background.js` (`importScripts('rastreio-regras.js', 'rastreio.js')`; mensagens `RASTREIO_STATUS`, `RASTREIO_RODAR`, `RASTREIO_LIGAR`)
- Modify: `extension/manifest.json` (`permissions`: + `alarms`, `notifications`; `host_permissions`: + `https://www.facebook.com/*`)

**Interfaces:**
- Consumes: Task 1; `getAuthValida`, `supabaseHeaders`, `writeOffer`, `decodeNotes`, `encodeNotes`, `SUPABASE_URL`, `DASHBOARD_OFICIAL`, `safeUuid` de `background.js`.
- Estado em `chrome.storage.local['minerai_rastreio']`: `{ ligado: boolean (padrão true), dia: 'YYYY-MM-DD', fila: string[], feitas: number, total: number, eventos: { escalou, morreu, decaindo }, iniciadoEm, terminadoEm, parado: null|'bloqueio'|'sem_login'|'plano' }`.
- Produces: `rastreioTick({ forcar?: boolean }) -> Promise<void>`; alarme `rastreio` a cada 30 min + `onStartup`/`onInstalled`; lote de até 2 min por tick, depois alarme único `rastreio-continuar` em 0,5 min.
- Por oferta: lê `?id=` (pageId + ativo) quando há `library_id`, senão usa `page_id_real`/`page_id`; lê total no `country` da meta (`BR` se ausente; se 0 com anúncio ativo e sem `country`, tenta `ALL`); intervalo 2,5–4 s entre requisições; relê a linha (`select=id,history,status,funnel_notes`) logo antes do PATCH; grava `history` (upsert `kind:'anunciante'`), `ads_count`, `status` (`classifyStage(diasNoAr(...), total)` salvo `status_manual`), `funnel_notes` (meta de `avaliarLeitura` + `page_id_real` + `country`).
- Fim da rodada: se `eventos.escalou + eventos.morreu > 0`, uma `chrome.notifications.create` ("Mineraí: 3 ofertas escalaram, 1 morreu"); clique abre `${DASHBOARD_OFICIAL}/alertas`.

- [ ] **Step 1:** Implementar; `node --check extension/rastreio.js extension/background.js`.
- [ ] **Step 2: Verify** a leitura do motor no navegador (mesmas duas URLs) para 3 ofertas reais; a fila/estado com um teste node simulando `chrome.storage` em memória (`tests/rastreio-motor.test.cjs`: tick com 3 ofertas falsas e `fetch` falso → 3 PATCH, estado `feitas:3`; segunda chamada no mesmo dia não faz nada; captcha no 1º → `parado:'bloqueio'` e 0 PATCH).
- [ ] **Step 3: Commit** `feat(extensao): rastreio diário automático das ofertas`.

### Task 7: Popup — rastreio diário

**Files:**
- Modify: `extension/popup.html`, `extension/popup.css`, `extension/popup.js`

**Interfaces:**
- Consumes: mensagens `RASTREIO_STATUS` → estado da Task 6; `RASTREIO_RODAR`; `RASTREIO_LIGAR { ligado }`.

- [ ] **Step 1:** Linha compacta "Rastreio diário" abaixo da faixa de conexão: estado ("Hoje 09:12 · 109 ofertas · 3 escalaram, 1 morreu" / "Rodando: 40 de 109" / "Pausado pela Meta, tenta amanhã" / "Desligado"), botão pequeno "Rodar agora" e interruptor liga/desliga. Atualiza a cada 2,5 s junto com o login.
- [ ] **Step 2: Verify** pela prévia estática (`extensao-estatica`), simulando os estados por JS, e screenshot.
- [ ] **Step 3: Commit** `feat(popup): estado e controle do rastreio diário`.

### Task 8: Painel — marcas e textos

**Files:**
- Modify: `src/components/OfferCard.jsx`, `src/components/FunilCard.jsx` (marca "fora do ar desde DD/MM" quando `isOfferDead`), `src/index.css` (`.dead-tag` com tokens `--danger-*`)
- Modify: `src/components/ResultModal.jsx` (texto: "Anúncios ativos do anunciante (o ~N resultados da página dele na Biblioteca)")
- Modify: `src/services/api.js` (`addDailyResult` grava `kind:'anunciante'` e calcula `status` com `resolvePageActiveAds`)
- Modify: `src/services/storage.js` se tiver `addDailyResult` local (mesmo `kind`)
- Modify: `src/pages/AlertsPage.jsx` ("Atualizado automaticamente hoje às HH:MM" a partir do maior `tracked_at` de hoje; senão "O rastreio automático roda pela extensão uma vez por dia." com link para a página Extensão)
- Modify: `src/pages/GarimpoPage.jsx` (passo 3 do PageGuide: "A extensão mede sozinha, uma vez por dia, quantos anúncios cada oferta tem. O + Hoje serve para corrigir à mão.")

- [ ] **Step 1:** Implementar; `npm run build` passa; `node --test tests/` passa.
- [ ] **Step 2: Verify** no painel local (dark e light) com uma oferta mock com `dead_since` e `track_events`: marca no card, alertas na página Alertas, sem erro no console.
- [ ] **Step 3: Commit** `feat(painel): marca de oferta fora do ar e textos do rastreio`.

### Task 9: Fechamento

- [ ] **Step 1:** `manifest.json` → 1.27.0; `npm run build:extension`; `npm run build`; `node --test tests/`; `npm run security:scan` → 0 findings.
- [ ] **Step 2:** Escrever `extension/COMO_TESTAR_RASTREIO.md` (passo a passo em português simples para o dono: reinstalar, abrir popup, "Rodar agora", conferir Alertas, teste do login com painel fechado).
- [ ] **Step 3:** Review do branch inteiro por um revisor novo; corrigir achados.
- [ ] **Step 4:** Commit + `git push origin main`; conferir `tema.js`/zip no ar.
