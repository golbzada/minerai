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
    await setStoredUser(nova.user || user, nova);
    return nova;
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

// Verificar status de autenticação (exige access_token válido)
async function checkAuthStatus() {
  const { user, session } = await getCurrentUser();
  if (user && session?.access_token) {
    return { authenticated: true, user };
  }

  // Tenta verificar se há sessão salva em cookies (localhost ou produção)
  try {
    for (const origin of DASHBOARD_URLS) {
      const cookies = await chrome.cookies.getAll({ url: origin });
      const authCookie = cookies.find(c => c.name.includes('supabase') || c.name.includes('auth') || c.name === 'minerai_user');
      if (authCookie) {
        try {
          const parsed = JSON.parse(decodeURIComponent(authCookie.value));
          if (parsed && (parsed.access_token || parsed.currentSession?.access_token)) {
            const token = parsed.access_token || parsed.currentSession?.access_token;
            const userData = parsed.user || parsed;
            const sessionData = { access_token: token };
            await setStoredUser(userData, sessionData);
            return { authenticated: true, user: userData };
          }
        } catch (e) {}
      }
    }
  } catch (e) {}

  return { authenticated: false };
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

function historyEntry(date, count) {
  const n = Math.max(0, Number(count) || 0);
  // Grava nas duas nomenclaturas para o painel e os backups antigos lerem.
  return { date, count: n, ads_count: n, result_date: date, results_count: n };
}

function upsertHistory(history, date, count) {
  const byDate = new Map();

  (Array.isArray(history) ? history : []).forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const raw = item.date || item.result_date;
    if (!raw) return;
    const key = String(raw).slice(0, 10);
    byDate.set(key, Number(item.count ?? item.ads_count ?? item.results_count ?? 0) || 0);
  });

  byDate.set(date, Math.max(0, Number(count) || 0));

  return Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([d, c]) => historyEntry(d, c));
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

  if (offerData.libraryId) {
    // Chave principal: o ID DESTE anúncio, guardado no bloco de metadados.
    // Assim, minerar dois anúncios diferentes da mesma página cria duas
    // ofertas em vez de um sobrescrever o outro.
    queries.push(`${base}&funnel_notes=like.*library_id%22:%22${encodeURIComponent(offerData.libraryId)}%22*`);
  } else if (offerData.pageId) {
    // Sem ID do anúncio, o anunciante é o melhor critério disponível.
    queries.push(`${base}&page_id=eq.${encodeURIComponent(offerData.pageId)}`);
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
    ad_url: offerData.adUrl || undefined,
    page_ads_url: offerData.pageAdsUrl || undefined,
    topic: offerData.topic || undefined,
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
  if (!url || url.startsWith('data:')) return null;

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

  return offerData.avatarUrl || null;
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
  if (!url || url.startsWith('data:')) return null;

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
  const adsCount = Math.max(0, parseInt(offerData.adsCount, 10) || 1);
  const userNotes = decodeNotes(existing.funnel_notes).notes;

  const patch = {
    ads_count: adsCount,
    history: upsertHistory(existing.history, today, adsCount),
    funnel_notes: encodeNotes(userNotes, buildMeta(offerData, existing)),
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
  if (offerData.pageId && !existing.page_id) patch.page_id = String(offerData.pageId);

  // Nome só é corrigido quando o que está salvo é o placeholder genérico.
  if (offerData.name && /^oferta minerada$/i.test(existing.name || '')) {
    patch.name = offerData.name;
  }

  // O estágio vem do tempo de veiculação, que só cresce — então é seguro
  // reescrever. A exceção é a oferta cujo estágio o usuário fixou no painel.
  if (!decodeNotes(existing.funnel_notes).meta.status_manual) {
    patch.status = offerData.status || 'testing';
  }

  return await writeOffer(
    `${SUPABASE_URL}/rest/v1/offers?id=eq.${existing.id}`,
    'PATCH',
    patch,
    token
  );
}

async function saveCapturedOffer(offerData) {
  // Renova o token ANTES de começar: a busca por oferta existente também
  // precisa dele, e um 401 ali passaria batido e criaria oferta duplicada.
  const { user, token } = await getAuthValida();
  if (!user || !token) {
    throw new Error('Você precisa estar conectado no Mineraí para salvar ofertas.');
  }

  const userId = user.id;
  const today = todayIso();

  const adsCount = Math.max(0, parseInt(offerData.adsCount, 10) || 1);
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
    page_id: String(offerData.pageId || ''),
    ads_count: adsCount,
    library_url: offerData.libraryUrl || '',
    landing_page: offerData.landingPage || '',
    affiliate_link: '',
    funnel_notes: encodeNotes(offerData.notes || '', meta),
    status: offerData.status || 'testing',
    niche: offerData.niche || 'Outros',
    avatar_url: await resolveAvatar(offerData),
    creative_thumb: await snapshotCreative(offerData.creativeUrl),
    history: [historyEntry(today, adsCount)],
    updated_at: new Date().toISOString()
  };

  const saved = await writeOffer(`${SUPABASE_URL}/rest/v1/offers`, 'POST', payload, token);
  return { success: true, updated: false, offer: saved };
}

// ==============================================================================
// MODELAR PÁGINA
// ==============================================================================
// Captura uma página de vendas para servir de REFERÊNCIA de estrutura.
// Roda no navegador do próprio usuário: a página é carregada com o IP e a
// sessão dele, e a captura acontece DEPOIS do JavaScript montar tudo — por
// isso pega página de funnel builder que um servidor externo receberia vazia.

const MODELAR_ESPERA_MS = 3500;

/**
 * Injetada na página capturada. Precisa ser autossuficiente: roda isolada,
 * sem acesso a nada deste arquivo.
 */
async function capturarDaPagina() {
  const base = document.baseURI;
  const absoluta = (u, origem) => {
    try {
      return new URL(u, origem || base).href;
    } catch (e) {
      return u;
    }
  };

  const espera = (ms) => new Promise((r) => setTimeout(r, ms));

  // 1. Rolar a página inteira antes de capturar.
  //    Página de vendas carrega imagem e revela seção conforme se desce. Sem
  //    isso, só o primeiro visor era capturado e o resto vinha vazio.
  const alturaJanela = window.innerHeight || 800;
  let ultimaAltura = 0;

  for (let volta = 0; volta < 60; volta += 1) {
    const alturaTotal = document.body.scrollHeight;
    const y = Math.min(volta * alturaJanela * 0.8, alturaTotal);
    window.scrollTo(0, y);
    await espera(140);

    if (y >= alturaTotal) {
      // Confere se a rolagem não fez a página crescer (carregamento contínuo).
      if (alturaTotal === ultimaAltura) break;
      ultimaAltura = alturaTotal;
    }
  }

  window.scrollTo(0, 0);
  await espera(500);

  // 2. Destravar o que ficou invisível esperando animação.
  //    O JavaScript é removido do arquivo final, então quem depende dele para
  //    aparecer ficaria invisível para sempre.
  let destravados = 0;
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    const s = getComputedStyle(el);

    // display:none costuma ser conteúdo realmente desligado — não mexemos.
    // Fixos são banner de cookie, menu flutuante, modal: também ficam de fora.
    if (s.display === 'none' || s.position === 'fixed') continue;

    const invisivel = s.opacity === '0' || s.visibility === 'hidden';
    const deslocado = s.transform && s.transform !== 'none' && /matrix|translate/.test(s.transform);

    if (invisivel) {
      // A transição precisa morrer junto: viva, ela faria o valor novo só
      // valer meio segundo depois, e o clone sairia ainda invisível.
      el.style.setProperty('transition', 'none', 'important');
      el.style.setProperty('animation', 'none', 'important');
      el.style.setProperty('opacity', '1', 'important');
      el.style.setProperty('visibility', 'visible', 'important');
      destravados += 1;
    }
    if (invisivel && deslocado) {
      el.style.setProperty('transform', 'none', 'important');
    }
  }

  // 3. Marcar quem foi feito para animar na entrada.
  //    O site anima esses blocos por JavaScript, que é removido do arquivo.
  //    Marcando aqui, o pacote pode devolver o movimento com um script
  //    próprio, curto e sem código de terceiro.
  let animaveis = 0;
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    const s = getComputedStyle(el);
    const transicao = s.transitionProperty || '';
    const temTransicaoDeEntrada = /opacity|transform|all/.test(transicao) &&
      parseFloat(s.transitionDuration) > 0;
    const r = el.getBoundingClientRect();

    // Só blocos de seção: elemento minúsculo animando polui e trava a leitura.
    if (temTransicaoDeEntrada && r.width > 120 && r.height > 40) {
      el.setAttribute('data-minerai-anima', '');
      animaveis += 1;
    }
  }

  // 4. Clonar já com tudo revelado
  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll('script, noscript').forEach((el) => el.remove());

  clone.querySelectorAll('[src]').forEach((el) => {
    const v = el.getAttribute('src');
    if (v && !v.startsWith('data:')) el.setAttribute('src', absoluta(v));
  });
  clone.querySelectorAll('link[href], a[href]').forEach((el) => {
    const v = el.getAttribute('href');
    if (v && !v.startsWith('data:') && !v.startsWith('#')) el.setAttribute('href', absoluta(v));
  });
  clone.querySelectorAll('[srcset]').forEach((el) => {
    const v = el.getAttribute('srcset') || '';
    el.setAttribute(
      'srcset',
      v.split(',').map((parte) => {
        const [u, d] = parte.trim().split(/\s+/);
        return u ? absoluta(u) + (d ? ' ' + d : '') : parte;
      }).join(', ')
    );
  });
  clone.querySelectorAll('[style]').forEach((el) => {
    const s = el.getAttribute('style') || '';
    if (s.includes('url(')) {
      el.setAttribute('style', s.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) =>
        u.startsWith('data:') ? m : `url("${absoluta(u)}")`));
    }
  });
  // Imagem preguiçosa que não chegou a carregar guarda o endereço em data-*.
  clone.querySelectorAll('img[data-src], img[data-lazy-src], source[data-srcset]').forEach((el) => {
    const v = el.getAttribute('data-src') || el.getAttribute('data-lazy-src');
    if (v && !el.getAttribute('src')) el.setAttribute('src', absoluta(v));
    const ss = el.getAttribute('data-srcset');
    if (ss && !el.getAttribute('srcset')) el.setAttribute('srcset', ss);
  });

  // 4. CSS. Aqui estava a maior perda: um `url(...)` dentro da folha de estilo
  //    é relativo ao ENDEREÇO DA FOLHA, não ao HTML. Ao embutir o CSS sem
  //    reescrever, toda imagem de fundo quebrava — e é assim que essas páginas
  //    trazem a maioria das imagens.
  const reescreverUrls = (css, origemDaFolha) =>
    css.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, u) => {
      // chrome-extension:// vem de OUTRA extensão do navegador injetando
      // fonte na página. Não é conteúdo do site e não existe fora daqui.
      if (/^chrome-extension:/i.test(u)) return 'none';
      if (/^(data:|https?:|\/\/|#)/i.test(u)) return m;
      return `url("${absoluta(u, origemDaFolha)}")`;
    });

  const cssInterno = [];
  const cssExterno = [];

  for (const folha of Array.from(document.styleSheets)) {
    const origem = folha.href || base;
    try {
      let txt = '';
      for (const r of Array.from(folha.cssRules)) txt += r.cssText + '\n';
      if (txt.trim()) cssInterno.push(reescreverUrls(txt, origem));
    } catch (e) {
      if (folha.href) cssExterno.push(folha.href);
    }
  }

  // ---- Design system ----
  const conta = { cor: {}, fundo: {}, fonte: {}, tamanho: {}, raio: {}, espaco: {} };
  const somar = (mapa, valor) => {
    if (!valor) return;
    mapa[valor] = (mapa[valor] || 0) + 1;
  };
  const ignoraCor = (c) => !c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent';

  const visiveis = Array.from(document.body.querySelectorAll('*')).slice(0, 4000);
  for (const el of visiveis) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const s = getComputedStyle(el);
    if (!ignoraCor(s.color)) somar(conta.cor, s.color);
    if (!ignoraCor(s.backgroundColor)) somar(conta.fundo, s.backgroundColor);
    somar(conta.fonte, s.fontFamily);
    somar(conta.tamanho, s.fontSize);
    if (s.borderRadius && s.borderRadius !== '0px') somar(conta.raio, s.borderRadius);
    [s.paddingTop, s.paddingBottom, s.marginBottom].forEach((v) => {
      if (v && v !== '0px') somar(conta.espaco, v);
    });
  }

  const topo = (mapa, n) => Object.entries(mapa)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([valor, vezes]) => ({ valor, vezes }));

  return {
    titulo: document.title || 'pagina',
    url: location.href,
    html: '<!doctype html>\n' + clone.outerHTML,
    cssInterno,
    cssExterno,
    destravados,
    animaveis,
    alturaPagina: document.body.scrollHeight,
    elementos: document.body.querySelectorAll('*').length,
    tokens: {
      cores: topo(conta.cor, 10),
      fundos: topo(conta.fundo, 10),
      fontes: topo(conta.fonte, 5),
      tamanhos: topo(conta.tamanho, 10),
      raios: topo(conta.raio, 6),
      espacos: topo(conta.espaco, 10)
    }
  };
}

/**
 * Devolve o movimento de entrada das seções.
 *
 * O site anima esses blocos por JavaScript próprio, que é removido da captura.
 * Este script é curto, escrito aqui, e não roda nada de terceiro. Ele é
 * à prova de falha: o conteúdo já nasce visível no HTML, e só se o script
 * rodar é que ele esconde e revela conforme a rolagem. Se falhar, a página
 * fica estática — nunca em branco.
 */
function scriptDeAnimacao() {
  return `
<style data-minerai="animacao">
  [data-minerai-anima].minerai-oculto {
    opacity: 0;
    transform: translateY(24px);
  }
  [data-minerai-anima] {
    transition: opacity .6s ease, transform .6s ease;
  }
  @media (prefers-reduced-motion: reduce) {
    [data-minerai-anima] { transition: none; }
    [data-minerai-anima].minerai-oculto { opacity: 1; transform: none; }
  }
</style>
<script data-minerai="animacao">
(function () {
  var alvos = document.querySelectorAll('[data-minerai-anima]');
  if (!alvos.length || !('IntersectionObserver' in window)) return;

  alvos.forEach(function (el) { el.classList.add('minerai-oculto'); });

  var observador = new IntersectionObserver(function (entradas) {
    entradas.forEach(function (entrada) {
      if (!entrada.isIntersecting) return;
      entrada.target.classList.remove('minerai-oculto');
      observador.unobserve(entrada.target);
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });

  alvos.forEach(function (el) { observador.observe(el); });

  // Rede de segurança: passados 6 segundos, mostra tudo de qualquer jeito.
  setTimeout(function () {
    alvos.forEach(function (el) { el.classList.remove('minerai-oculto'); });
  }, 6000);
})();
<\/script>`;
}

/** Explica o que veio no pacote, para quem abrir o zip depois. */
function montarLeiaMe(url, dados) {
  return `MODELAR PÁGINA — Mineraí
=========================

Origem: ${url}
Capturado em: ${new Date().toLocaleString('pt-BR')}

O QUE TEM AQUI
--------------
index.html         A página como ela aparece na tela, já com todo o CSS
                   embutido. Abra direto no navegador.
design-system.css  Cores, fontes, tamanhos, arredondamentos e espaçamentos
                   que a página realmente usa, ordenados por frequência.

COMO FOI FEITO
--------------
A captura rola a página inteira antes de copiar, e acontece DEPOIS que o
JavaScript termina de montar tudo — a partir do seu próprio navegador.
Por isso funciona em página feita com construtor visual, que um download
pelo servidor pegaria vazia.

Os scripts foram removidos de propósito: ao abrir o arquivo localmente,
nada de terceiro é executado e a página não tenta redirecionar. Como
consequência, quem dependia de script para aparecer foi destravado na
captura (${dados.destravados || 0} elemento(s)).

As imagens continuam apontando para o site de origem — elas carregam
enquanto o site estiver no ar.

VEIO ALGUMA PARTE QUEBRADA?
---------------------------
É normal em página muito dependente de script. Jogue esta pasta na IA que
você usa e peça algo como:

  "Esta pasta é a captura de uma página de vendas, para servir de
   referência de estrutura. Conserte o que estiver quebrado e reorganize o
   layout mantendo os mesmos blocos, proporções e o design system do
   design-system.css. Depois troque os textos e imagens pelos meus."

PARA QUE SERVE
--------------
Referência de estrutura: blocos, proporções, espaçamentos e paleta, para
você construir a sua página em cima. O conteúdo (textos, imagens, marca)
é de quem publicou a página original.
`;
}

/** Nome de arquivo seguro a partir do domínio. */
function nomeDoSite(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '_');
  } catch (e) {
    return 'pagina';
  }
}

/** Monta o arquivo do design system a partir dos valores medidos na página. */
function montarDesignSystem(tokens, url) {
  const bloco = (titulo, itens, prefixo) => {
    if (!itens.length) return '';
    const linhas = itens.map((t, i) => `  --${prefixo}-${i + 1}: ${t.valor};` +
      ` /* usado ${t.vezes}x */`).join('\n');
    return `\n  /* ${titulo} */\n${linhas}\n`;
  };

  return `/* ==========================================================================
   DESIGN SYSTEM EXTRAÍDO
   Origem: ${url}
   Gerado pelo Mineraí em ${new Date().toLocaleString('pt-BR')}

   São os valores que a página realmente aplica na tela, ordenados por
   frequência de uso. Servem de referência para você modelar a sua.
   ========================================================================== */

:root {
${bloco('Cores de texto', tokens.cores, 'cor')}${bloco('Cores de fundo', tokens.fundos, 'fundo')}${bloco('Tipografia', tokens.fontes, 'fonte')}${bloco('Tamanhos de fonte', tokens.tamanhos, 'texto')}${bloco('Arredondamento', tokens.raios, 'raio')}${bloco('Espaçamentos', tokens.espacos, 'espaco')}}
`;
}

// ==============================================================================
// EMPACOTADOR ZIP
// ==============================================================================
// Antes os arquivos eram baixados soltos como data:text/plain, e o Chrome
// renomeava tudo para .txt (por isso vinham "download.txt" e "download (1).txt").
// Agora sai um .zip só, montado aqui mesmo — sem biblioteca externa, usando a
// compressão nativa do navegador.

const CRC_TABELA = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABELA[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Compressão deflate nativa do Chrome — não precisa de biblioteca. */
async function comprimir(bytes) {
  const fluxo = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(fluxo).arrayBuffer());
}

/**
 * Monta um .zip a partir de [{ nome, texto }].
 */
async function montarZip(arquivos) {
  const codificador = new TextEncoder();
  const partes = [];
  const central = [];
  let posicao = 0;

  for (const arquivo of arquivos) {
    const nome = codificador.encode(arquivo.nome);
    const dados = codificador.encode(arquivo.texto);
    const soma = crc32(dados);
    const comprimido = await comprimir(dados);

    const cabecalho = new DataView(new ArrayBuffer(30));
    cabecalho.setUint32(0, 0x04034b50, true); // assinatura
    cabecalho.setUint16(4, 20, true);         // versão mínima
    cabecalho.setUint16(6, 0x0800, true);     // nomes em UTF-8
    cabecalho.setUint16(8, 8, true);          // método deflate
    cabecalho.setUint32(14, soma, true);
    cabecalho.setUint32(18, comprimido.length, true);
    cabecalho.setUint32(22, dados.length, true);
    cabecalho.setUint16(26, nome.length, true);
    partes.push(new Uint8Array(cabecalho.buffer), nome, comprimido);

    const registro = new DataView(new ArrayBuffer(46));
    registro.setUint32(0, 0x02014b50, true);
    registro.setUint16(4, 20, true);
    registro.setUint16(6, 20, true);
    registro.setUint16(8, 0x0800, true);
    registro.setUint16(10, 8, true);
    registro.setUint32(16, soma, true);
    registro.setUint32(20, comprimido.length, true);
    registro.setUint32(24, dados.length, true);
    registro.setUint16(28, nome.length, true);
    registro.setUint32(42, posicao, true);
    central.push({ registro: new Uint8Array(registro.buffer), nome });

    posicao += 30 + nome.length + comprimido.length;
  }

  const inicioCentral = posicao;
  let tamanhoCentral = 0;
  for (const item of central) {
    partes.push(item.registro, item.nome);
    tamanhoCentral += 46 + item.nome.length;
  }

  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true);
  fim.setUint16(8, central.length, true);
  fim.setUint16(10, central.length, true);
  fim.setUint32(12, tamanhoCentral, true);
  fim.setUint32(16, inicioCentral, true);
  partes.push(new Uint8Array(fim.buffer));

  return new Blob(partes, { type: 'application/zip' });
}

/**
 * Baixa um Blob. O service worker não tem URL.createObjectURL, então o
 * conteúdo vai como data: URI — e o tipo application/zip faz o Chrome
 * salvar com a extensão .zip correta.
 */
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

async function baixarBlob(blob, nomeArquivo) {
  nomePendente = nomeArquivo;
  const bytes = new Uint8Array(await blob.arrayBuffer());

  let binario = '';
  const pedaco = 0x8000;
  for (let i = 0; i < bytes.length; i += pedaco) {
    binario += String.fromCharCode.apply(null, bytes.subarray(i, i + pedaco));
  }

  const uri = `data:application/zip;base64,${btoa(binario)}`;

  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url: uri, filename: nomeArquivo, saveAs: false },
      (id) => (chrome.runtime.lastError
        ? reject(new Error(chrome.runtime.lastError.message))
        : resolve(id))
    );
  });
}

/**
 * Abre a URL numa aba, espera renderizar, captura e baixa os arquivos.
 */
async function modelarPagina(url) {
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
    const erro = new Error('PERMISSAO_NECESSARIA');
    erro.origem = origem;
    throw erro;
  }

  // A aba precisa ficar VISÍVEL durante a captura. O Chrome estrangula os
  // temporizadores de aba escondida (trava em 1 por segundo), e aí a rolagem
  // que revela o conteúdo nunca termina. Guardamos a aba atual para devolver
  // o foco assim que acabar.
  const [abaOriginal] = await chrome.tabs.query({ active: true, currentWindow: true });
  const aba = await chrome.tabs.create({ url: alvo.href, active: true });

  try {
    await esperarCarregar(aba.id);
    // Um respiro extra para animação e conteúdo que entra depois do load.
    await new Promise((r) => setTimeout(r, MODELAR_ESPERA_MS));

    const [resultado] = await chrome.scripting.executeScript({
      target: { tabId: aba.id },
      func: capturarDaPagina
    });

    const dados = resultado?.result;
    if (!dados) throw new Error('Não foi possível ler o conteúdo da página.');

    // CSS de outro domínio: o background consegue baixar, a página não.
    const externos = [];
    for (const href of dados.cssExterno.slice(0, 25)) {
      try {
        const res = await fetch(href);
        if (res.ok) externos.push(`/* ${href} */\n` + (await res.text()));
      } catch (e) {
        externos.push(`/* não foi possível baixar: ${href} */`);
      }
    }

    const css = [...dados.cssInterno, ...externos].join('\n\n');
    const html = dados.html
      .replace(/<\/head>/i, `<style data-minerai="css-capturado">\n${css}\n</style>\n</head>`)
      .replace(/<\/body>/i, `${scriptDeAnimacao()}\n</body>`);

    const site = nomeDoSite(alvo.href);
    const designSystem = montarDesignSystem(dados.tokens, alvo.href);
    const pastaInterna = `${site}-${Date.now()}`;

    // Os arquivos vão dentro de uma pasta DO ZIP, para não espalharem soltos
    // ao descompactar. Já o download em si vai direto na pasta Downloads.
    const zip = await montarZip([
      { nome: `${pastaInterna}/index.html`, texto: html },
      { nome: `${pastaInterna}/design-system.css`, texto: designSystem },
      { nome: `${pastaInterna}/LEIA-ME.txt`, texto: montarLeiaMe(alvo.href, dados) }
    ]);

    const nomeZip = `${pastaInterna}.zip`;
    await baixarBlob(zip, nomeZip);

    return {
      pasta: nomeZip,
      titulo: dados.titulo,
      tamanhoZipKb: Math.round(zip.size / 1024),
      folhasInternas: dados.cssInterno.length,
      folhasExternas: externos.length,
      cores: dados.tokens.cores.length,
      tamanhoHtmlKb: Math.round(html.length / 1024)
    };
  } finally {
    try {
      await chrome.tabs.remove(aba.id);
      // Devolve o foco para onde a pessoa estava.
      if (abaOriginal?.id) await chrome.tabs.update(abaOriginal.id, { active: true });
    } catch (e) {}
  }
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

  if (message.type === 'SET_AUTH_USER') {
    setStoredUser(message.user, message.session).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'SAVE_OFFER') {
    saveCapturedOffer(message.offer)
      .then(res => sendResponse({ success: true, data: res }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'MODELAR_PAGINA') {
    modelarPagina(message.url)
      .then(res => sendResponse({ success: true, data: res }))
      .catch(err => sendResponse({
        success: false,
        error: err.message,
        precisaPermissao: err.message === 'PERMISSAO_NECESSARIA',
        origem: err.origem || null
      }));
    return true;
  }

  if (message.type === 'OPEN_DASHBOARD') {
    chrome.tabs.create({ url: message.url || DASHBOARD_URLS[0] });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'DOWNLOAD_MEDIA') {
    if (chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({
        url: message.url,
        filename: message.filename || `anuncio_${Date.now()}.${message.url?.includes('.mp4') ? 'mp4' : 'jpg'}`,
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
