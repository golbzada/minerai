// ==============================================================================
// MINERAÍ EXTENSÃO - BACKGROUND SERVICE WORKER (MANIFEST V3)
// ==============================================================================

const SUPABASE_URL = 'https://vqqzpkdxyaowqxdfshex.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_6uR1O7oSEjl_6Zyh_pHoUQ_uY5LnN7_';

// Endereços do NOSSO painel. O primeiro é o oficial — é para onde os botões
// "Conectar conta" mandam, e é dele que lemos a sessão salva em cookie.
//
// ATENÇÃO: minerarads.com.br NÃO é nosso. É de outro produto ("Mineirar Ads"),
// o site que serviu de referência de estrutura. Deixar esse domínio aqui fazia
// a extensão jogar o cliente na tela de login de terceiro e ainda vasculhar
// cookie de site alheio. Não recolocar.
const DASHBOARD_OFICIAL = 'https://mineraiofertas.vercel.app';

const DASHBOARD_URLS = [
  DASHBOARD_OFICIAL,
  'http://localhost:5173'
];

// Regras da sessão compartilhada com o painel (quem tem a mais nova) e regras
// do rastreio diário (histórico, estágio, leitura da Biblioteca).
importScripts('sessao-regras.js', 'rastreio-regras.js');

// ==============================================================================
// SANEAMENTO DO QUE SAI DO CONTENT SCRIPT
// ==============================================================================
// O content script lê o DOM da Biblioteca, que é controlado pelo anunciante.
// Nada do que ele extrai é confiável: antes de virar linha no banco, cada
// campo passa por aqui. Os limites espelham as constraints da migração 002 —
// sem isso, um campo estourado derrubava a oferta inteira com "23514".

const OFFER_LIMITS = {
  name: 200,
  niche: 80,
  topic: 80,
  pageId: 64,
  notes: 9000,
  url: 2048,
  adsCount: 10000000
};

const STATUS_VALUES = ['testing', 'pre_scaling', 'scaling', 'winner', 'paused'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS_RE = /^\d{1,64}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SLUG_RE = /^[A-Za-z][A-Za-z0-9._-]{2,79}$/;

function clip(value, max) {
  const str = value == null ? '' : String(value);
  return str.length > max ? str.slice(0, max) : str;
}

/** URL http(s) normalizada ou string vazia. Nunca `javascript:` nem `data:`. */
function safeHttpUrl(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw || raw.length > OFFER_LIMITS.url) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (!parsed.hostname || !parsed.hostname.includes('.')) return '';
    return parsed.href.length > OFFER_LIMITS.url ? '' : parsed.href;
  } catch (e) {
    return '';
  }
}

/** Só https vale para baixar foto/criativo (nada de data:, blob:, file:...). */
function isFetchableImageUrl(value) {
  return /^https:\/\//i.test(String(value || '')) && String(value).length <= OFFER_LIMITS.url;
}

function safeStatus(value, fallback = 'testing') {
  return STATUS_VALUES.includes(value) ? value : fallback;
}

function safeCount(value, fallback = 1) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(OFFER_LIMITS.adsCount, Math.max(0, n));
}

function safeDigits(value) {
  const str = String(value || '').trim();
  return DIGITS_RE.test(str) ? str : '';
}

function safeIsoDate(value) {
  const str = String(value || '').trim();
  return ISO_DATE_RE.test(str) ? str : '';
}

function safePageSlug(value) {
  const str = String(value || '').trim();
  return PAGE_SLUG_RE.test(str) ? str : '';
}

function safeCountry(value) {
  const str = String(value || '').trim().toUpperCase();
  return /^(ALL|[A-Z]{2})$/.test(str) ? str : '';
}

function safeUuid(value) {
  const str = String(value || '').trim();
  return UUID_RE.test(str) ? str : '';
}

/** Versão saneada do que o content script mandou em SAVE_OFFER. */
function sanitizeOfferData(source) {
  const src = source && typeof source === 'object' ? source : {};
  return {
    name: clip(String(src.name || '').trim(), OFFER_LIMITS.name),
    pageName: clip(String(src.pageName || '').trim(), OFFER_LIMITS.name),
    productName: clip(String(src.productName || '').trim(), OFFER_LIMITS.name),
    niche: clip(String(src.niche || '').trim(), OFFER_LIMITS.niche),
    topic: clip(String(src.topic || '').trim(), OFFER_LIMITS.topic),
    notes: clip(String(src.notes || ''), OFFER_LIMITS.notes),
    status: safeStatus(src.status),
    adsCount: safeCount(src.adsCount, 1),
    // Total de anúncios ativos do anunciante; 0 = não foi possível ler.
    pageActiveAds: safeCount(src.pageActiveAds, 0),
    // ID real da página (lido do próprio anúncio), país da busca e se o
    // anúncio salvo estava no ar: base do rastreio diário.
    pageIdReal: safeDigits(src.pageIdReal),
    country: safeCountry(src.country),
    adActive: typeof src.adActive === 'boolean' ? src.adActive : null,
    pageId: safeDigits(src.pageId),
    pageSlug: safePageSlug(src.pageSlug),
    libraryId: safeDigits(src.libraryId),
    startDate: safeIsoDate(src.startDate),
    libraryUrl: safeHttpUrl(src.libraryUrl),
    landingPage: safeHttpUrl(src.landingPage),
    pageUrl: safeHttpUrl(src.pageUrl),
    adUrl: safeHttpUrl(src.adUrl),
    pageAdsUrl: safeHttpUrl(src.pageAdsUrl),
    avatarUrl: safeHttpUrl(src.avatarUrl),
    avatarDomUrl: isFetchableImageUrl(src.avatarDomUrl) ? String(src.avatarDomUrl) : '',
    creativeUrl: isFetchableImageUrl(src.creativeUrl) ? String(src.creativeUrl) : ''
  };
}

// Obter usuário e sessão armazenados
async function getCurrentUser() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['minerai_user', 'minerai_session'], (result) => {
      resolve({
        user: result.minerai_user || null,
        session: result.minerai_session || null
      });
    });
  });
}

// Salvar dados do usuário e sessão na extensão
async function setStoredUser(user, session) {
  return new Promise((resolve) => {
    chrome.storage.local.set({
      minerai_user: user,
      minerai_session: session
    }, () => resolve());
  });
}

// ==============================================================================
// RENOVAÇÃO DO TOKEN
// ==============================================================================
// O access_token do Supabase vale ~1 hora. Antes a extensão usava o token
// guardado até ele morrer, e a mineração falhava com {"code":"PGRST303",
// "message":"JWT expired"}. Agora renovamos pelo refresh_token da sessão.

/** Lê o `exp` de dentro do JWT, sem depender do que foi guardado junto. */
function tokenExpiraEm(token) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return 0;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = JSON.parse(json).exp;
    return typeof exp === 'number' ? exp * 1000 : 0;
  } catch (e) {
    return 0;
  }
}

/** Considera vencido um pouco antes da hora, para não estourar no meio da escrita. */
function tokenVencido(token) {
  const expiraEm = tokenExpiraEm(token);
  if (!expiraEm) return false; // não deu para ler: deixa tentar usar
  return expiraEm - Date.now() < 60 * 1000;
}

/** Troca o refresh_token por um access_token novo e guarda a sessão. */
async function renovarSessao(session) {
  const refreshToken = session?.refresh_token;
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    });

    if (!res.ok) return null;

    const nova = await res.json();
    if (!nova?.access_token) return null;

    const { user } = await getCurrentUser();
    const sessao = sanitizeSession(nova);
    await setStoredUser(sanitizeUser(nova.user) || user, sessao);
    return sessao;
  } catch (e) {
    console.warn('[Mineraí] Não foi possível renovar a sessão:', e.message);
    return null;
  }
}

/**
 * Usuário + token pronto para uso, renovando antes se estiver por vencer.
 */
async function getAuthValida() {
  const { user, session } = await getCurrentUser();
  if (!user || !session?.access_token) return { user: null, token: null };

  if (tokenVencido(session.access_token)) {
    const nova = await renovarSessao(session);
    if (nova) return { user: nova.user || user, token: nova.access_token };
  }

  return { user, token: session.access_token };
}

// Verificar status de autenticação (exige access_token válido).
// A sessão chega SÓ pelo bridge.js rodando no painel: o painel guarda a sessão
// do Supabase no localStorage, nunca em cookie, então a leitura de cookies que
// existia aqui nunca achava nada — e custava a permissão "cookies" na revisão
// da Chrome Web Store.
async function checkAuthStatus() {
  const { user, session } = await getCurrentUser();
  if (user && session?.access_token) {
    return { authenticated: true, user };
  }
  return { authenticated: false };
}

/** Só o necessário sobre a pessoa: nada de plano ou dados de assinatura. */
function sanitizeUser(source) {
  if (!source || typeof source !== 'object' || !source.id) return null;
  return {
    id: String(source.id),
    name: typeof source.name === 'string' ? source.name.slice(0, 120) : '',
    email: typeof source.email === 'string' ? source.email.slice(0, 254) : ''
  };
}

/** Só os campos da sessão que a extensão usa. */
function sanitizeSession(source) {
  if (!source || typeof source !== 'object' || typeof source.access_token !== 'string') return null;
  return {
    access_token: source.access_token,
    refresh_token: typeof source.refresh_token === 'string' ? source.refresh_token : null,
    expires_at: source.expires_at || null
  };
}

// ==============================================================================
// METADADOS DA OFERTA
// Espelha src/utils/offerMeta.js: os campos que a tabela `offers` não tem
// (data de início, ID da biblioteca, ID da página) viajam num bloco JSON no
// final de `funnel_notes` e são escondidos na exibição do painel.
// ==============================================================================

const META_RE = /\s*\[\[minerai:(\{[\s\S]*?\})\]\]\s*/;

function decodeNotes(rawNotes) {
  const raw = typeof rawNotes === 'string' ? rawNotes : '';
  let meta = {};

  const match = raw.match(META_RE);
  if (match) {
    try {
      meta = JSON.parse(match[1]) || {};
    } catch (e) {
      meta = {};
    }
  }

  const notes = raw
    .replace(META_RE, '')
    .replace(/Dias rodando:\s*\d+\s*(?:\|\s*)?/i, '')
    .replace(/Capturado via Mineraí Extensão\.?\s*/i, '')
    .trim();

  return { notes, meta };
}

function encodeNotes(notes, meta) {
  const clean = decodeNotes(notes).notes;
  const payload = {};

  Object.keys(meta || {}).forEach((key) => {
    const value = meta[key];
    if (value !== null && value !== undefined && value !== '') {
      payload[key] = value;
    }
  });

  if (!Object.keys(payload).length) return clean;

  payload.v = 1;
  const block = `[[minerai:${JSON.stringify(payload)}]]`;
  return clean ? `${clean}\n\n${block}` : block;
}

function todayIso() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split('T')[0];
}

// historyEntry/upsertHistory vêm de rastreio-regras.js (com `kind`).
const { historyEntry, upsertHistory } = self.MineraiRastreio;

/**
 * A medição que a mineração grava: o total de anúncios ativos do anunciante.
 * Sem esse número (leitura falhou), a mineração não mexe no histórico — o
 * "N anúncios usam este criativo" não é mais medição.
 */
function medicaoDaMineracao(history, offerData, today) {
  const total = Number(offerData.pageActiveAds) || 0;
  if (total <= 0) return {};
  return {
    ads_count: total,
    history: upsertHistory(history, today, total, self.MineraiRastreio.KIND)
  };
}

// ==============================================================================
// PERSISTÊNCIA DA OFERTA CAPTURADA
// ==============================================================================

function supabaseHeaders(token, extra = {}) {
  return {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extra
  };
}

// Colunas adicionadas depois da versão original do banco. Se o usuário ainda
// não rodou a migração, o Supabase recusa a escrita citando a coluna; nesse
// caso reenviamos sem ela em vez de perder a oferta inteira.
const OPTIONAL_COLUMNS = ['creative_thumb'];

/**
 * Escreve na tabela `offers` tolerando colunas opcionais ausentes.
 */
async function writeOffer(url, method, payload, token) {
  const body = { ...payload };
  let tokenAtual = token;
  let jaRenovou = false;

  // O laço tolera uma remoção de coluna por volta, mais uma renovação de token.
  for (let attempt = 0; attempt <= OPTIONAL_COLUMNS.length + 1; attempt += 1) {
    const res = await fetch(url, {
      method,
      headers: supabaseHeaders(tokenAtual, { 'Prefer': 'return=representation' }),
      body: JSON.stringify(body)
    });

    if (res.ok) {
      const saved = await res.json();
      return saved?.[0] || body;
    }

    const errorText = await res.text();

    // O RLS recusa a escrita quando o plano está inativo (ou a aba não é do
    // usuário). É 401/403 também, mas não é token vencido — não adianta renovar.
    if (/row-level security|42501|permission denied/i.test(errorText)) {
      throw new Error('Seu plano está inativo. Ative um plano no painel Mineraí para voltar a minerar.');
    }

    if (res.status === 401 || res.status === 403) {
      // Token vencido no meio da operação: renova uma vez e repete.
      if (!jaRenovou) {
        jaRenovou = true;
        const { session } = await getCurrentUser();
        const nova = await renovarSessao(session);
        if (nova?.access_token) {
          tokenAtual = nova.access_token;
          continue;
        }
      }
      throw new Error('Sessão expirada. Abra o painel Mineraí para reconectar.');
    }

    // Constraint do banco (tamanho ou valor fora do permitido).
    if (/23514|violates check constraint/i.test(errorText)) {
      console.error('Oferta recusada pelo banco:', errorText);
      throw new Error('A oferta tem algum campo fora do limite permitido. Tente minerar de novo.');
    }

    // Coluna opcional inexistente: remove e tenta de novo.
    const missing = OPTIONAL_COLUMNS.find(
      (col) => col in body && errorText.includes(col)
    );

    if (missing) {
      console.warn(
        `[Mineraí] Coluna "${missing}" não existe no banco — salvando sem ela. ` +
        'Rode a migração do supabase_schema.sql para habilitar o recurso.'
      );
      delete body[missing];
      continue;
    }

    console.error('Erro ao gravar oferta no Supabase:', errorText);
    throw new Error('Falha ao salvar no banco de dados Mineraí.');
  }

  throw new Error('Falha ao salvar no banco de dados Mineraí.');
}

/** Aba padrão do usuário (a primeira criada). */
async function getDefaultTabId(userId, token) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tabs?user_id=eq.${userId}&select=id&order=created_at.asc&limit=1`,
      { headers: supabaseHeaders(token) }
    );
    if (!res.ok) return null;
    const tabs = await res.json();
    return tabs?.[0]?.id || null;
  } catch (e) {
    return null;
  }
}

/**
 * Procura uma oferta já minerada do mesmo anunciante, para atualizar em vez de
 * criar duplicata. É o que faz o gráfico de evolução crescer sozinho a cada
 * nova mineração da mesma oferta.
 */
async function findExistingOffer(userId, token, offerData) {
  // A leitura também precisa tolerar a coluna opcional ausente: sem isso o
  // SELECT falharia e a extensão passaria a criar oferta duplicada.
  const columns = [
    'id,name,ads_count,history,status,funnel_notes,landing_page,avatar_url,creative_thumb,page_id',
    'id,name,ads_count,history,status,funnel_notes,landing_page,avatar_url,page_id'
  ];

  for (const select of columns) {
    const found = await queryExistingOffer(userId, token, offerData, select);
    if (found !== undefined) return found;
  }

  return null;
}

/**
 * Executa a busca com um conjunto de colunas.
 * Devolve a oferta, `null` se não achou, ou `undefined` se o Supabase recusou
 * as colunas (aí quem chamou tenta o conjunto reduzido).
 */
async function queryExistingOffer(userId, token, offerData, select) {
  const base = `${SUPABASE_URL}/rest/v1/offers?user_id=eq.${userId}&select=${select}&limit=1`;

  const queries = [];

  // Os IDs já chegam saneados (só dígitos): nada deles vira operador do PostgREST.
  const libraryId = safeDigits(offerData.libraryId);
  const pageId = safeDigits(offerData.pageId);

  if (libraryId) {
    // Chave principal: o ID DESTE anúncio, guardado no bloco de metadados.
    // Assim, minerar dois anúncios diferentes da mesma página cria duas
    // ofertas em vez de um sobrescrever o outro.
    queries.push(`${base}&funnel_notes=like.*library_id%22:%22${encodeURIComponent(libraryId)}%22*`);
  } else if (pageId) {
    // Sem ID do anúncio, o anunciante é o melhor critério disponível.
    queries.push(`${base}&page_id=eq.${encodeURIComponent(pageId)}`);
  }

  for (const url of queries) {
    try {
      const res = await fetch(url, { headers: supabaseHeaders(token) });

      if (!res.ok) {
        const errorText = await res.text();
        // Coluna opcional recusada: avisa quem chamou para tentar sem ela.
        if (OPTIONAL_COLUMNS.some((col) => select.includes(col) && errorText.includes(col))) {
          return undefined;
        }
        continue;
      }

      const rows = await res.json();
      if (rows?.length) return rows[0];
    } catch (e) {}
  }

  return null;
}

function buildMeta(offerData, existing) {
  return {
    ...(existing ? decodeNotes(existing.funnel_notes).meta : {}),
    start_date: offerData.startDate || undefined,
    library_id: offerData.libraryId || undefined,
    page_id: offerData.pageId || undefined,
    page_slug: offerData.pageSlug || undefined,
    page_url: offerData.pageUrl || undefined,
    // Nome da página do Facebook (quem anuncia), separado do nome do produto.
    page_name: offerData.pageName || undefined,
    ad_url: offerData.adUrl || undefined,
    page_ads_url: offerData.pageAdsUrl || undefined,
    topic: offerData.topic || undefined,
    // Só sobrescreve quando a leitura deu certo: se falhar, fica o número
    // da mineração anterior.
    ...(offerData.pageActiveAds > 0
      ? { page_active_ads: offerData.pageActiveAds, page_active_ads_at: todayIso() }
      : {}),
    ...(offerData.pageIdReal ? { page_id_real: offerData.pageIdReal } : {}),
    ...(offerData.country ? { country: offerData.country } : {}),
    ...(typeof offerData.adActive === 'boolean' ? { ad_active: offerData.adActive } : {}),
    source: 'extension',
    captured_at: new Date().toISOString()
  };
}

// ==============================================================================
// AVATAR DO ANUNCIANTE
// ==============================================================================
// Ordem de preferência:
//   1. graph.facebook.com/<id ou apelido>/picture — URL permanente, que sempre
//      redireciona para a foto atual da página.
//   2. Retrato da imagem do card, reduzido e gravado como data: URI. O link do
//      CDN que aparece no anúncio é assinado e expira em horas, então guardar
//      a URL crua não adianta: guardamos os pixels.

const AVATAR_MAX_PX = 96;
const AVATAR_MAX_BYTES = 60 * 1024;

// Miniatura do criativo: 320px é o suficiente para reconhecer a oferta de
// relance no painel e mantém cada registro em poucas dezenas de KB. Vídeo nunca
// é baixado — usamos só o quadro de capa que a própria Meta já entrega.
const CREATIVE_MAX_PX = 320;

/** Converte um Blob em data: URI (sem FileReader, que não existe no worker). */
async function blobToDataUri(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
}

/**
 * Baixa a foto e devolve uma miniatura embutida. Rodar no service worker evita
 * o bloqueio de CORS que o content script sofreria.
 */
async function snapshotAvatar(url) {
  if (!isFetchableImageUrl(url)) return null;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;

    // Imagem já pequena: guarda como veio.
    if (blob.size <= AVATAR_MAX_BYTES) return await blobToDataUri(blob);

    // Grande demais: reduz para um quadrado de 96px antes de guardar.
    const bitmap = await createImageBitmap(blob);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(AVATAR_MAX_PX, AVATAR_MAX_PX);
    const ctx = canvas.getContext('2d');

    ctx.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_MAX_PX,
      AVATAR_MAX_PX
    );
    bitmap.close();

    const small = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    return await blobToDataUri(small);
  } catch (e) {
    console.warn('[Mineraí] Não foi possível guardar a foto do anunciante:', e.message);
    return null;
  }
}

/** Melhor avatar disponível para esta oferta. */
async function resolveAvatar(offerData) {
  // A foto que já está renderizada no card vem PRIMEIRO: ela sempre existe e
  // é a real. A URL do Graph parecia melhor por ser permanente, mas para uma
  // parte das páginas ela devolve a silhueta cinza padrão em vez da foto —
  // era o motivo de umas ofertas terem foto e outras não.
  const snapshot = await snapshotAvatar(offerData.avatarDomUrl);
  if (snapshot) return snapshot;

  // O banco só aceita https:// ou data:image/ aqui.
  return isFetchableImageUrl(offerData.avatarUrl) ? offerData.avatarUrl : null;
}

/** A URL do Graph é a fonte que pode cair na silhueta padrão. */
function isGraphAvatar(url) {
  return typeof url === 'string' && url.includes('graph.facebook.com');
}

/**
 * Miniatura do criativo, guardada embutida no registro.
 * Mantém proporção (não corta em quadrado como o avatar) e reduz o lado maior
 * para 320px, o que deixa cada oferta na casa das dezenas de KB.
 */
async function snapshotCreative(url) {
  if (!isFetchableImageUrl(url)) return null;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;

    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;

    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, CREATIVE_MAX_PX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const small = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
    return await blobToDataUri(small);
  } catch (e) {
    console.warn('[Mineraí] Não foi possível guardar o criativo:', e.message);
    return null;
  }
}

/**
 * Oferta já existe: registra a medição de hoje e atualiza os campos que a Meta
 * pode ter mudado, preservando o que o usuário editou à mão no painel.
 */
async function updateExistingOffer(existing, offerData, token) {
  const today = todayIso();
  const userNotes = decodeNotes(existing.funnel_notes).notes;

  const patch = {
    ...medicaoDaMineracao(existing.history, offerData, today),
    funnel_notes: clip(encodeNotes(userNotes, buildMeta(offerData, existing)), 10000),
    updated_at: new Date().toISOString()
  };

  if (offerData.landingPage) patch.landing_page = offerData.landingPage;
  if (offerData.libraryUrl) patch.library_url = offerData.libraryUrl;
  // Reminerar também conserta ofertas antigas: se a foto salva é uma URL do
  // Graph (que pode estar mostrando silhueta), trocamos pelo retrato real.
  if (!existing.avatar_url || isGraphAvatar(existing.avatar_url)) {
    const avatar = await resolveAvatar(offerData);
    if (avatar) patch.avatar_url = avatar;
  }

  if (!existing.creative_thumb && offerData.creativeUrl) {
    const creative = await snapshotCreative(offerData.creativeUrl);
    if (creative) patch.creative_thumb = creative;
  }
  if (offerData.pageId && !existing.page_id) patch.page_id = clip(offerData.pageId, OFFER_LIMITS.pageId);

  // Nome só é corrigido quando o que está salvo é o placeholder genérico ou
  // o nome da página (como era antes de separar página e produto). Se a
  // pessoa renomeou a oferta no painel, o nome dela fica.
  const savedName = (existing.name || '').trim();
  if (
    offerData.name &&
    (/^oferta minerada$/i.test(savedName) ||
      (offerData.productName && offerData.pageName && savedName === offerData.pageName))
  ) {
    patch.name = offerData.name;
  }

  // O estágio vem do tempo de veiculação, que só cresce — então é seguro
  // reescrever. A exceção é a oferta cujo estágio o usuário fixou no painel.
  if (!decodeNotes(existing.funnel_notes).meta.status_manual) {
    patch.status = safeStatus(offerData.status);
  }

  const existingId = safeUuid(existing.id);
  if (!existingId) throw new Error('Falha ao salvar no banco de dados Mineraí.');

  return await writeOffer(
    `${SUPABASE_URL}/rest/v1/offers?id=eq.${existingId}`,
    'PATCH',
    patch,
    token
  );
}

async function saveCapturedOffer(rawOfferData) {
  // Tudo que veio do content script passa pelo saneamento antes de qualquer
  // uso: o DOM da Biblioteca é controlado pelo anunciante, não por nós.
  const offerData = sanitizeOfferData(rawOfferData);

  // Renova o token ANTES de começar: a busca por oferta existente também
  // precisa dele, e um 401 ali passaria batido e criaria oferta duplicada.
  const { user, token } = await getAuthValida();
  if (!user || !token) {
    throw new Error('Você precisa estar conectado no Mineraí para salvar ofertas.');
  }

  // O ID entra em URLs do PostgREST: precisa ser um UUID de verdade.
  const userId = safeUuid(user.id);
  if (!userId) throw new Error('Sessão inválida. Abra o painel Mineraí para reconectar.');

  const today = todayIso();

  const adsCount = offerData.adsCount;
  const existing = await findExistingOffer(userId, token, offerData);

  if (existing) {
    const offer = await updateExistingOffer(existing, offerData, token);
    return { success: true, updated: true, offer };
  }

  // ---------------------------------------------------------------------------
  // Oferta nova
  // ---------------------------------------------------------------------------
  const meta = buildMeta(offerData, null);
  const tabId = await getDefaultTabId(userId, token);

  const payload = {
    user_id: userId,
    tab_id: tabId,
    name: offerData.name || 'Oferta Minerada',
    // ID da PÁGINA do anunciante (antes era gravado o ID do anúncio aqui, o que
    // quebrava o avatar e a identificação da oferta no painel).
    page_id: offerData.pageId,
    ads_count: adsCount,
    library_url: offerData.libraryUrl,
    landing_page: offerData.landingPage,
    affiliate_link: '',
    funnel_notes: clip(encodeNotes(offerData.notes, meta), 10000),
    status: offerData.status,
    niche: offerData.niche || 'Outros',
    avatar_url: await resolveAvatar(offerData),
    creative_thumb: await snapshotCreative(offerData.creativeUrl),
    history: [],
    // Com o total do anunciante, ele vira o número da oferta e a 1ª medição.
    ...medicaoDaMineracao([], offerData, today),
    updated_at: new Date().toISOString()
  };

  const saved = await writeOffer(`${SUPABASE_URL}/rest/v1/offers`, 'POST', payload, token);
  return { success: true, updated: false, offer: saved };
}

// ==============================================================================
// MODELAR PÁGINA
// ==============================================================================
// Captura uma página de vendas e entrega uma pasta PRONTA para modelar: a
// página com imagens, vídeos e fontes dentro dela, os movimentos (carrossel,
// FAQ, abas) refeitos, o mapa das seções e o prompt para a IA.
//
// Roda no navegador do próprio usuário: a página é carregada com o IP e a
// sessão dele, e a captura acontece DEPOIS do JavaScript montar tudo — por
// isso pega página de funnel builder que um servidor externo receberia vazia.
//
// Três partes:
//   captura.js         lê a página (injetado na aba da página)
//   empacotador.js     baixa os arquivos e monta o zip (documento oculto)
//   movimentos-pagina.js  vai dentro do zip e devolve os movimentos

importScripts('captura.js');

const MODELAR_ESPERA_MS = 3500;

// O Chrome ignora o `filename` quando o download vem de um data: URI e salva
// como "download.zip". Este evento é a forma oficial de a extensão mandar no
// nome — por isso o arquivo vinha sem o domínio.
let nomePendente = null;

if (chrome.downloads?.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener((item, sugerir) => {
    if (nomePendente) {
      sugerir({ filename: nomePendente, conflictAction: 'uniquify' });
      nomePendente = null;
      return;
    }
    sugerir();
  });
}

// O documento oculto (offscreen) é quem baixa os arquivos e monta o zip: o
// service worker não cria URL de Blob e pode ser encerrado no meio de um
// download grande. Um só por vez; criado na primeira captura.
let criandoEmpacotador = null;

async function garantirEmpacotador() {
  const existentes = chrome.runtime.getContexts
    ? await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
    : [];
  if (existentes.length) return;
  if (!criandoEmpacotador) {
    criandoEmpacotador = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Montar o pacote do Modelar página: baixar imagens, vídeos e fontes e gerar o arquivo .zip.'
    }).catch((e) => {
      // Chrome sem getContexts: o documento pode já existir. Não é erro.
      if (!/single offscreen|already/i.test(String(e && e.message))) throw e;
    }).finally(() => {
      criandoEmpacotador = null;
    });
  }
  await criandoEmpacotador;
}

/** Manda o que a captura leu para o documento oculto e espera o zip. */
async function empacotar(dados, url) {
  await garantirEmpacotador();
  const resposta = await chrome.runtime.sendMessage({ alvo: 'offscreen', type: 'MINERAI_EMPACOTAR', dados, url });
  if (!resposta || !resposta.success) {
    throw new Error((resposta && resposta.error) || 'Não foi possível montar o pacote.');
  }
  return resposta.data;
}

/** Baixa o zip pela URL de Blob do documento oculto e libera a memória depois. */
function baixarPacote(blobUrl, nomeArquivo) {
  nomePendente = nomeArquivo;
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url: blobUrl, filename: nomeArquivo, saveAs: false }, (id) => {
      if (chrome.runtime.lastError || id === undefined) {
        nomePendente = null;
        reject(new Error(chrome.runtime.lastError?.message || 'O Chrome recusou o download.'));
        return;
      }
      const liberar = () => {
        chrome.runtime.sendMessage({ alvo: 'offscreen', type: 'MINERAI_LIBERAR', blobUrl }).catch(() => {});
      };
      // A URL só pode ser liberada quando o arquivo terminou de gravar.
      const ouvinte = (delta) => {
        if (delta.id !== id || !delta.state) return;
        if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
          chrome.downloads.onChanged.removeListener(ouvinte);
          liberar();
        }
      };
      chrome.downloads.onChanged.addListener(ouvinte);
      setTimeout(() => {
        chrome.downloads.onChanged.removeListener(ouvinte);
        liberar();
      }, 10 * 60 * 1000);
      resolve(id);
    });
  });
}

/**
 * Abre a URL numa aba, espera renderizar, captura e baixa os arquivos.
 */
// O Chrome só aceita pedido de permissão vindo de uma página da extensão com
// clique do usuário — o painel do site não pode pedir. Em vez de devolver um
// texto mandando a pessoa caçar o ícone da extensão na barra (que vem escondido
// atrás do quebra-cabeça), abrimos nossa própria tela, que pede a autorização e
// já termina a captura ali mesmo.
async function abrirTelaDeAutorizacao(url) {
  const pagina = chrome.runtime.getURL(
    `autorizar.html?url=${encodeURIComponent(url)}`
  );
  try {
    await chrome.tabs.create({ url: pagina, active: true });
    return true;
  } catch (e) {
    return false;
  }
}

async function modelarPagina(url, opcoes) {
  const config = opcoes || {};
  let alvo;
  try {
    alvo = new URL(url);
    if (!/^https?:$/.test(alvo.protocol)) throw new Error('protocolo');
  } catch (e) {
    throw new Error('Endereço inválido. Use um link completo, começando com https://');
  }

  const origem = `${alvo.origin}/*`;
  const temPermissao = await chrome.permissions.contains({ origins: [origem] });
  if (!temPermissao) {
    // A própria tela de autorização chama esta função depois de conseguir a
    // permissão. Se ela caísse aqui de novo, abriria outra aba sem parar.
    let telaAberta = false;
    if (config.abrirAutorizacao !== false) {
      telaAberta = await abrirTelaDeAutorizacao(alvo.href);
    }
    const erro = new Error('PERMISSAO_NECESSARIA');
    erro.origem = origem;
    erro.telaAberta = telaAberta;
    throw erro;
  }

  // A aba precisa ficar VISÍVEL durante a captura. O Chrome estrangula os
  // temporizadores de aba escondida (trava em 1 por segundo), e aí a rolagem
  // que revela o conteúdo nunca termina. Guardamos a aba atual para devolver
  // o foco assim que acabar.
  const [abaOriginal] = await chrome.tabs.query({ active: true, currentWindow: true });
  const aba = await chrome.tabs.create({ url: alvo.href, active: true });

  let dados;
  try {
    await esperarCarregar(aba.id);
    // Um respiro extra para animação e conteúdo que entra depois do load.
    await new Promise((r) => setTimeout(r, MODELAR_ESPERA_MS));

    const [resultado] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      func: capturarDaPagina
    });

    dados = resultado?.result;
    if (!dados) throw new Error('Não foi possível ler o conteúdo da página.');
  } finally {
    // A aba já pode fechar: daqui para frente o trabalho é baixar e empacotar.
    try {
      await chrome.tabs.remove(aba.id);
      // Devolve o foco para onde a pessoa estava.
      if (abaOriginal?.id) await chrome.tabs.update(abaOriginal.id, { active: true });
    } catch (e) {}
  }

  const pacote = await empacotar(dados, alvo.href);
  await baixarPacote(pacote.blobUrl, pacote.pasta);

  const { blobUrl, ...resumo } = pacote;
  return resumo;
}

/** Espera a aba terminar de carregar (com teto de tempo). */
function esperarCarregar(tabId) {
  return new Promise((resolve) => {
    const limite = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(ouvinte);
      resolve();
    }, 25000);

    function ouvinte(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(limite);
        chrome.tabs.onUpdated.removeListener(ouvinte);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(ouvinte);
  });
}

// Ouvir mensagens dos content scripts e popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECK_AUTH') {
    checkAuthStatus().then(sendResponse);
    return true;
  }

  // Sessão só pode vir do bridge.js rodando no NOSSO painel. Um content script
  // de outra origem (ou uma página qualquer) não consegue plantar sessão aqui.
  const vemDoPainel = Boolean(
    sender?.url && DASHBOARD_URLS.some((base) => sender.url.startsWith(`${base}/`))
  );

  if (message.type === 'SET_AUTH_USER') {
    const user = sanitizeUser(message.user);
    const session = sanitizeSession(message.session);
    if (!vemDoPainel || !user || !session) {
      sendResponse({ success: false, error: 'Origem não autorizada.' });
      return true;
    }
    // Se a extensão já renovou e o painel ainda tem a sessão antiga, guardar
    // a antiga perderia o refresh_token válido. O bridge entrega a nova ao
    // painel no próximo ciclo.
    getCurrentUser().then((guardada) => {
      if (!self.MineraiSessao.aceitarDoPainel(guardada, user, session)) {
        sendResponse({ success: false, error: 'Sessão mais antiga que a da extensão.' });
        return;
      }
      setStoredUser(user, session).then(() => sendResponse({ success: true }));
    });
    return true;
  }

  // O bridge pede a sessão da extensão para entregar ao painel se for mais nova.
  if (message.type === 'GET_PANEL_SESSION') {
    if (!vemDoPainel) {
      sendResponse({ success: false, error: 'Origem não autorizada.' });
      return true;
    }
    getCurrentUser().then(({ user, session }) => sendResponse({ user, session }));
    return true;
  }

  if (message.type === 'CLEAR_AUTH_USER') {
    if (!vemDoPainel) {
      sendResponse({ success: false, error: 'Origem não autorizada.' });
      return true;
    }
    setStoredUser(null, null).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === 'SAVE_OFFER') {
    saveCapturedOffer(message.offer)
      .then(res => sendResponse({ success: true, data: res }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'MINERAI_EMPACOTANDO') {
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'MODELAR_PAGINA') {
    modelarPagina(message.url, { abrirAutorizacao: message.abrirAutorizacao !== false })
      .then(res => sendResponse({ success: true, data: res }))
      .catch(err => sendResponse({
        success: false,
        error: err.message,
        precisaPermissao: err.message === 'PERMISSAO_NECESSARIA',
        telaAberta: err.telaAberta === true,
        origem: err.origem || null
      }));
    return true;
  }

  if (message.type === 'OPEN_DASHBOARD') {
    // Só abre o NOSSO painel: a URL pedida precisa estar na lista.
    const pedida = String(message.url || '');
    const url = DASHBOARD_URLS.find((base) => pedida === base || pedida.startsWith(`${base}/`)) || DASHBOARD_URLS[0];
    chrome.tabs.create({ url });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'DOWNLOAD_MEDIA') {
    // Mídia só por http(s), e o nome do arquivo é o que o content script
    // gera (letras, números, _ e .) — nada de caminho ou extensão estranha.
    const url = String(message.url || '');
    const nomePedido = String(message.filename || '');
    const nomeValido = /^[A-Za-z0-9_.-]{1,120}\.(mp4|jpe?g|png|webp|gif)$/i.test(nomePedido) && !nomePedido.includes('..');
    if (!/^https?:\/\//i.test(url) || url.length > 4096) {
      sendResponse({ success: false, error: 'Endereço de mídia inválido.' });
      return true;
    }
    if (chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({
        url,
        filename: nomeValido ? nomePedido : `anuncio_${Date.now()}.${url.includes('.mp4') ? 'mp4' : 'jpg'}`,
        saveAs: false
      }, (downloadId) => {
        if (chrome.runtime?.lastError) {
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true, downloadId });
        }
      });
    } else {
      sendResponse({ success: false, error: 'API de download não disponível' });
    }
    return true;
  }
});
