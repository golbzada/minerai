import { storage } from './storage';
import {
  supabase,
  isSupabaseConfigured,
  RESET_PASSWORD_URL,
  EMAIL_CONFIRM_URL
} from './supabaseClient';
import {
  decodeNotes,
  encodeNotes,
  resolveRunningDays,
  daysToStartDate,
  normalizeHistory,
  upsertHistory,
  historyEntry,
  classifyStatus,
  todayIso
} from '../utils/offerMeta';
import { AppError, toUserError, assertOk } from '../utils/errors';
import { safeHttpUrl, safeImageSrc, safeCreativeThumb } from '../utils/url';

// ==============================================================================
// LIMITES (espelham as constraints do banco: migração 002)
// ==============================================================================
const LIMITS = {
  name: 200,
  niche: 80,
  pageId: 64,
  notes: 9000, // deixa folga para o bloco de metadados dentro dos 10000 do banco
  tabName: 80,
  profileName: 120,
  cpfCnpj: 20,
  historyEntries: 3650,
  importBatch: 100,
  shareOffers: 300
};

export const PAGE_SIZE = 120;

const STATUS_VALUES = ['testing', 'pre_scaling', 'scaling', 'winner', 'paused'];

// Colunas realmente usadas pela interface (evita puxar colunas futuras sem querer).
const OFFER_COLUMNS =
  'id,user_id,tab_id,name,page_id,ads_count,library_url,landing_page,affiliate_link,' +
  'funnel_notes,status,niche,avatar_url,creative_thumb,history,created_at,updated_at';

const PROFILE_COLUMNS = 'id,name,email,cpf_cnpj,plan,active,trial_ends_at,created_at';

// Campos que entram no retrato público de uma tab (a RPC do banco também
// remove affiliate_link/funnel_notes/notes de retratos antigos).
const SHARE_FIELDS = [
  'id', 'name', 'page_id', 'ads_count', 'library_url', 'landing_page', 'destination_url',
  'status', 'niche', 'avatar_url', 'creative_thumb', 'history', 'created_at',
  'start_date', 'running_days', 'topic', 'library_id'
];
const SHARE_META_FIELDS = ['start_date', 'status_manual', 'topic', 'page_slug', 'library_id', 'page_id'];

const ONLINE = () => isSupabaseConfigured && supabase;

// ==============================================================================
// HELPERS
// ==============================================================================

function clip(value, max) {
  const str = value == null ? '' : String(value);
  return str.length > max ? str.slice(0, max) : str;
}

function safeStatus(value, fallback = 'testing') {
  return STATUS_VALUES.includes(value) ? value : fallback;
}

function safeCount(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(10000000, Math.max(0, Math.round(n)));
}

function safeHistory(history) {
  return normalizeHistory(history)
    .slice(-LIMITS.historyEntries)
    .map((h) => historyEntry(h.date, h.count));
}

function safeAvatar(value) {
  const src = safeImageSrc(value);
  return src && src.length <= 200000 ? src : null;
}

/**
 * ID do usuário logado. Usa a sessão local (sem ida ao servidor): o filtro por
 * user_id é só conforto para a query, quem garante o isolamento é o RLS.
 */
async function currentUserId() {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data?.session?.user) {
    throw new AppError('Não autenticado', { code: 'AUTH_EXPIRED', isAuth: true });
  }
  return data.session.user.id;
}

async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();

  if (error) throw toUserError(error, 'Não foi possível carregar seu perfil.');
  return data || null;
}

/** Perfil ausente (trigger falhou) vira conta sem plano: nunca acesso pago. */
function fallbackProfile(authUser) {
  return {
    id: authUser.id,
    name: authUser.user_metadata?.name || (authUser.email || '').split('@')[0] || 'Minerador',
    email: authUser.email,
    plan: null,
    active: false,
    trial_ends_at: null
  };
}

/**
 * Converte uma linha crua da tabela `offers` no formato usado pela interface:
 * separa anotações dos metadados e recalcula os dias rodando na hora.
 */
function formatOffer(row) {
  if (!row) return row;

  const { notes, meta } = decodeNotes(row.funnel_notes);
  const history = normalizeHistory(row.history).map((h) => historyEntry(h.date, h.count));

  return {
    ...row,
    notes,
    funnel_notes: notes,
    meta,
    history,
    start_date: meta.start_date || null,
    library_id: meta.library_id || null,
    topic: meta.topic || null,
    destination_url: row.landing_page || row.library_url || '',
    running_days: resolveRunningDays(row, meta)
  };
}

/**
 * Monta o `funnel_notes` (anotações + metadados) a partir dos dados do
 * formulário ou da extensão, preservando metadados já existentes.
 */
function buildNotesField(offerData, existingMeta = {}) {
  const incoming = offerData.meta && typeof offerData.meta === 'object' ? offerData.meta : {};
  const notes = clip(offerData.notes ?? offerData.funnel_notes ?? '', LIMITS.notes);

  let startDate = incoming.start_date || offerData.start_date || existingMeta.start_date || null;

  // "há X dias rodando" vira data de início para a contagem andar sozinha.
  if (offerData.running_days != null && offerData.running_days !== '') {
    const typedDays = Math.max(1, parseInt(offerData.running_days, 10) || 1);
    startDate = daysToStartDate(typedDays);
  }

  const statusManual =
    typeof offerData.status_manual === 'boolean'
      ? offerData.status_manual
      : existingMeta.status_manual;

  return encodeNotes(notes, {
    ...existingMeta,
    ...incoming,
    start_date: startDate,
    status_manual: statusManual ? true : undefined
  });
}

/** Linha de `offers` saneada, pronta para inserir/atualizar. */
function buildOfferRow(offerData, { userId, existingMeta = {}, includeHistoryFallback = true } = {}) {
  const adsCount = safeCount(offerData.ads_count ?? offerData.initial_results ?? 1, 1);
  const history = safeHistory(offerData.history);

  const row = {
    name: clip((offerData.name || '').trim() || 'Nova Oferta', LIMITS.name),
    page_id: clip(String(offerData.page_id || ''), LIMITS.pageId),
    ads_count: adsCount,
    library_url: safeHttpUrl(offerData.library_url),
    landing_page: safeHttpUrl(offerData.landing_page || offerData.destination_url),
    affiliate_link: safeHttpUrl(offerData.affiliate_link),
    funnel_notes: buildNotesField(offerData, existingMeta),
    status: safeStatus(offerData.status),
    niche: clip((offerData.niche || '').trim() || 'Geral', LIMITS.niche)
  };

  if (userId) row.user_id = userId;
  if (history.length) {
    row.history = history;
  } else if (includeHistoryFallback) {
    row.history = [historyEntry(todayIso(), adsCount)];
  }

  return row;
}

/** Só os campos públicos de uma oferta entram no retrato compartilhado. */
function shareSnapshotEntry(offer) {
  const entry = {};
  SHARE_FIELDS.forEach((key) => {
    if (offer[key] !== undefined) entry[key] = offer[key];
  });
  const meta = {};
  SHARE_META_FIELDS.forEach((key) => {
    if (offer.meta?.[key] !== undefined) meta[key] = offer.meta[key];
  });
  entry.meta = meta;
  return entry;
}

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const API_CONFIG = {
  USE_LOCAL: !isSupabaseConfigured,
  IS_SUPABASE: isSupabaseConfigured
};

export const api = {
  // ============================================================================
  // AUTH & SESSION
  // ============================================================================

  /** Usuário logado (perfil) ou null quando não há sessão. Nunca inventa plano. */
  async me() {
    if (ONLINE()) {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data?.session?.user) return { user: null };

      const authUser = data.session.user;
      const profile = await fetchProfile(authUser.id);
      return { user: profile || fallbackProfile(authUser) };
    }

    return { user: storage.getUser() || null };
  },

  async login({ email, password }) {
    if (ONLINE()) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: (email || '').trim(),
        password
      });

      if (error) {
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('email not confirmed')) {
          throw new AppError(
            'Confirme seu e-mail antes de entrar. Procure a mensagem do Mineraí na caixa de entrada (ou no spam).',
            { code: 'EMAIL_NOT_CONFIRMED' }
          );
        }
        if (msg.includes('invalid login credentials') || error.status === 400) {
          throw new AppError('E-mail ou senha incorretos.', { code: 'INVALID_CREDENTIALS' });
        }
        throw toUserError(error, 'Não foi possível entrar. Tente novamente.');
      }

      const profile = await fetchProfile(data.user.id);
      const user = profile || fallbackProfile(data.user);
      return { message: 'Login realizado com sucesso!', user };
    }

    // Fallback local (sem Supabase configurado)
    let user = storage.getUser();
    if (!user || user.email !== email) {
      user = {
        id: `usr_${Date.now()}`,
        name: email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
        email,
        active: true,
        plan: 'trial'
      };
    }
    storage.setUser(user);
    return { message: 'Login realizado com sucesso!', user };
  },

  /**
   * Cadastro. Com "Confirm email" ligado no Supabase, o usuário só entra
   * depois de clicar no link do e-mail: devolvemos needsConfirmation.
   */
  async register({ name, email, password }) {
    const cleanName = clip((name || '').trim(), LIMITS.profileName);
    const cleanEmail = (email || '').trim();

    if (ONLINE()) {
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: { name: cleanName || cleanEmail.split('@')[0] },
          emailRedirectTo: EMAIL_CONFIRM_URL
        }
      });

      if (error) {
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('already registered') || msg.includes('already exists')) {
          throw new AppError('Este e-mail já tem conta. Entre ou use "Esqueci minha senha".', {
            code: 'ALREADY_REGISTERED'
          });
        }
        if (msg.includes('password')) {
          throw new AppError('A senha não atende aos requisitos mínimos.', { code: 'WEAK_PASSWORD' });
        }
        throw toUserError(error, 'Não foi possível concluir o cadastro.');
      }

      // Confirmação desligada no painel: a sessão já vem pronta.
      if (data.session && data.user) {
        const profile = await fetchProfile(data.user.id);
        return {
          message: 'Cadastro realizado com sucesso!',
          user: profile || fallbackProfile(data.user)
        };
      }

      // Confirmação ligada: aguardando o clique no e-mail. (Se o e-mail já
      // existia, o Supabase devolve um usuário "fantasma" sem identities —
      // a resposta é a mesma de propósito, para não revelar quem tem conta.)
      return {
        message: `Enviamos um link de confirmação para ${cleanEmail}. Abra o e-mail para ativar sua conta.`,
        needsConfirmation: true,
        email: cleanEmail
      };
    }

    const user = {
      id: `usr_${Date.now()}`,
      name: cleanName || cleanEmail.split('@')[0],
      email: cleanEmail,
      plan: 'trial',
      active: true
    };
    storage.setUser(user);
    return { message: 'Cadastro realizado com sucesso!', user };
  },

  /** Reenvia o e-mail de confirmação de cadastro. */
  async resendConfirmation(email) {
    if (!ONLINE()) return { message: 'Modo local: não há e-mail para reenviar.' };

    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: (email || '').trim(),
      options: { emailRedirectTo: EMAIL_CONFIRM_URL }
    });
    if (error) throw toUserError(error, 'Não foi possível reenviar o e-mail agora.');
    return { message: 'E-mail de confirmação reenviado. Confira a caixa de entrada e o spam.' };
  },

  /**
   * Fluxo nativo de "esqueci minha senha": o Supabase envia um link com token
   * que abre /redefinir-senha, onde o usuário escolhe a nova senha.
   */
  async requestPasswordReset(email) {
    const cleanEmail = (email || '').trim();
    if (!cleanEmail) throw new AppError('Informe seu e-mail.', { code: 'VALIDATION' });

    if (ONLINE()) {
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: RESET_PASSWORD_URL
      });
      // O Supabase responde sucesso mesmo para e-mail sem conta: a mensagem
      // abaixo é neutra de propósito e não revela quem tem cadastro.
      if (error) {
        throw toUserError(error, 'Não foi possível enviar o e-mail agora. Tente novamente em instantes.');
      }
    }

    return {
      message: `Se existir uma conta para ${cleanEmail}, enviamos um link de redefinição. Confira a caixa de entrada e o spam.`
    };
  },

  /** Define a nova senha (o usuário chegou pelo link do e-mail e já tem sessão). */
  async updatePassword(password) {
    if (!ONLINE()) return { message: 'Modo local: senha não é armazenada.' };

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('same') || msg.includes('different')) {
        throw new AppError('A nova senha precisa ser diferente da anterior.', { code: 'SAME_PASSWORD' });
      }
      if (msg.includes('session') || error.status === 401) {
        throw new AppError('O link de redefinição expirou. Peça um novo em "Esqueci minha senha".', {
          code: 'LINK_EXPIRED'
        });
      }
      throw toUserError(error, 'Não foi possível salvar a nova senha.');
    }
    return { message: 'Senha alterada com sucesso!' };
  },

  async logout() {
    if (ONLINE()) {
      await supabase.auth.signOut().catch(() => {});
    }
    storage.setUser(null);
    return { message: 'Desconectado com sucesso.' };
  },

  /** Só name e cpf_cnpj: plan/active pertencem ao servidor. */
  async updateProfile({ name, cpf_cnpj }) {
    const patch = {};
    if (name !== undefined) patch.name = clip((name || '').trim(), LIMITS.profileName);
    if (cpf_cnpj !== undefined) patch.cpf_cnpj = clip((cpf_cnpj || '').replace(/\D/g, ''), LIMITS.cpfCnpj) || null;

    if (patch.name === '') throw new AppError('Informe seu nome.', { code: 'VALIDATION' });

    if (ONLINE()) {
      const userId = await currentUserId();
      const { data, error } = await supabase
        .from('profiles')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', userId)
        .select(PROFILE_COLUMNS)
        .single();

      if (error) throw toUserError(error, 'Não foi possível salvar o perfil.');
      return { message: 'Perfil atualizado com sucesso!', user: data };
    }

    const user = { ...(storage.getUser() || {}), ...patch };
    storage.setUser(user);
    return { message: 'Perfil atualizado com sucesso!', user };
  },

  // ============================================================================
  // TABS (ABAS / CATEGORIAS)
  // ============================================================================

  async listTabs() {
    if (ONLINE()) {
      const userId = await currentUserId();

      const { data: tabs, error } = await supabase
        .from('tabs')
        .select('id,name,created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      assertOk(error, 'Erro ao listar abas.');

      // Contagem por aba: só a coluna tab_id trafega.
      const { data: offers, error: countErr } = await supabase
        .from('offers')
        .select('tab_id')
        .eq('user_id', userId);

      assertOk(countErr, 'Erro ao contar ofertas.');

      const countMap = {};
      (offers || []).forEach((o) => {
        if (o.tab_id) countMap[o.tab_id] = (countMap[o.tab_id] || 0) + 1;
      });

      return {
        tabs: (tabs || []).map((t) => ({ id: t.id, name: t.name, offers_count: countMap[t.id] || 0 }))
      };
    }

    return { tabs: storage.getTabs() };
  },

  async createTab({ name }) {
    const cleanName = clip((name || '').trim(), LIMITS.tabName);
    if (!cleanName) throw new AppError('Informe o nome da tab.', { code: 'VALIDATION' });

    if (ONLINE()) {
      const userId = await currentUserId();

      const { data, error } = await supabase
        .from('tabs')
        .insert([{ user_id: userId, name: cleanName }])
        .select('id,name')
        .single();

      assertOk(error, 'Erro ao criar aba.');

      return { message: `Tab "${cleanName}" criada com sucesso!`, tab: { id: data.id, name: data.name, offers_count: 0 } };
    }

    const tab = storage.createTab(cleanName);
    return { message: `Tab "${cleanName}" criada com sucesso!`, tab };
  },

  async updateTab(id, name) {
    const cleanName = clip((name || '').trim(), LIMITS.tabName);
    if (!cleanName) throw new AppError('Informe o nome da tab.', { code: 'VALIDATION' });

    if (ONLINE()) {
      const { data, error } = await supabase
        .from('tabs')
        .update({ name: cleanName })
        .eq('id', id)
        .select('id,name')
        .maybeSingle();

      assertOk(error, 'Erro ao renomear aba.');
      if (!data) throw new AppError('Aba não encontrada.', { code: 'NOT_FOUND' });

      return { message: 'Tab renomeada com sucesso!', tab: { id, name: cleanName } };
    }

    const tab = storage.updateTab(id, cleanName);
    return { message: 'Tab renomeada com sucesso!', tab };
  },

  async deleteTab(id) {
    if (ONLINE()) {
      const { error } = await supabase.from('tabs').delete().eq('id', id);
      assertOk(error, 'Erro ao excluir aba.');

      const { tabs } = await this.listTabs();
      return { message: 'Tab excluída com sucesso.', nextTabId: tabs.length ? tabs[0].id : null };
    }

    const nextTabId = storage.deleteTab(id);
    return { message: 'Tab excluída com sucesso.', nextTabId };
  },

  // ============================================================================
  // OFFERS (OFERTAS GARIMPADAS)
  // ============================================================================

  /**
   * Página de ofertas de uma aba (mais recentes primeiro).
   * Devolve `hasMore` para o painel carregar a próxima página sob demanda.
   */
  async listOffers(tabId = null, { offset = 0, limit = PAGE_SIZE } = {}) {
    if (ONLINE()) {
      const userId = await currentUserId();

      let query = supabase
        .from('offers')
        .select(OFFER_COLUMNS)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit); // um a mais para saber se há próxima página

      if (tabId) query = query.eq('tab_id', tabId);

      const { data, error } = await query;
      assertOk(error, 'Erro ao listar ofertas.');

      const rows = data || [];
      const hasMore = rows.length > limit;
      return { offers: rows.slice(0, limit).map(formatOffer), hasMore };
    }

    return { offers: storage.getOffers(tabId), hasMore: false };
  },

  /** Todas as ofertas (de uma aba ou do acervo), em páginas, para backup e share. */
  async fetchAllOffers(tabId = null, { max = 5000 } = {}) {
    const all = [];
    let offset = 0;
    for (;;) {
      const { offers, hasMore } = await this.listOffers(tabId, { offset, limit: 500 });
      all.push(...offers);
      offset += 500;
      if (!hasMore || all.length >= max) break;
    }
    return all.slice(0, max);
  },

  async createOffer(offerData) {
    if (!offerData?.name?.trim()) throw new AppError('Informe o nome da oferta.', { code: 'VALIDATION' });

    if (ONLINE()) {
      const userId = await currentUserId();

      const payload = {
        ...buildOfferRow(offerData, { userId }),
        tab_id: offerData.tab_id || null,
        avatar_url: safeAvatar(offerData.avatar_url),
        creative_thumb: safeCreativeThumb(offerData.creative_thumb)
      };

      const { data, error } = await supabase
        .from('offers')
        .insert([payload])
        .select(OFFER_COLUMNS)
        .single();

      assertOk(error, 'Erro ao salvar oferta.');

      return { message: 'Oferta salva com sucesso!', offer: formatOffer(data) };
    }

    const offer = storage.createOffer(offerData);
    return { message: 'Oferta salva com sucesso!', offer };
  },

  async updateOffer(id, offerData) {
    if (!offerData?.name?.trim()) throw new AppError('Informe o nome da oferta.', { code: 'VALIDATION' });

    if (ONLINE()) {
      // Preserva os metadados já gravados (ID da biblioteca, origem da captura)
      // que o formulário de edição não conhece.
      const { data: current, error: curErr } = await supabase
        .from('offers')
        .select('funnel_notes')
        .eq('id', id)
        .maybeSingle();

      assertOk(curErr, 'Erro ao carregar a oferta.');
      if (!current) throw new AppError('Oferta não encontrada.', { code: 'NOT_FOUND' });

      const existingMeta = decodeNotes(current.funnel_notes).meta;

      const payload = {
        ...buildOfferRow(offerData, { existingMeta, includeHistoryFallback: false }),
        updated_at: new Date().toISOString()
      };

      if (offerData.tab_id) payload.tab_id = offerData.tab_id;
      if (offerData.avatar_url) payload.avatar_url = safeAvatar(offerData.avatar_url);

      const { data, error } = await supabase
        .from('offers')
        .update(payload)
        .eq('id', id)
        .select(OFFER_COLUMNS)
        .single();

      assertOk(error, 'Erro ao atualizar oferta.');

      return { message: 'Oferta atualizada com sucesso!', offer: formatOffer(data) };
    }

    const offer = storage.updateOffer(id, offerData);
    return { message: 'Oferta atualizada com sucesso!', offer };
  },

  async deleteOffer(id) {
    if (ONLINE()) {
      const { error } = await supabase.from('offers').delete().eq('id', id);
      assertOk(error, 'Erro ao excluir oferta.');
      return { message: 'Oferta excluída com sucesso.' };
    }

    storage.deleteOffer(id);
    return { message: 'Oferta excluída com sucesso.' };
  },

  async duplicateOffer(id, targetTabId) {
    if (ONLINE()) {
      const { data: original, error: getErr } = await supabase
        .from('offers')
        .select(OFFER_COLUMNS)
        .eq('id', id)
        .maybeSingle();

      assertOk(getErr, 'Erro ao carregar a oferta.');
      if (!original) throw new AppError('Oferta original não encontrada.', { code: 'NOT_FOUND' });

      const copyData = {
        ...original,
        tab_id: targetTabId || original.tab_id,
        name: clip(`${original.name} (Cópia)`, LIMITS.name)
      };
      delete copyData.id;
      delete copyData.created_at;
      delete copyData.updated_at;

      const { data, error } = await supabase
        .from('offers')
        .insert([copyData])
        .select(OFFER_COLUMNS)
        .single();

      assertOk(error, 'Erro ao duplicar oferta.');

      return { message: 'Oferta duplicada com sucesso!', offer: formatOffer(data) };
    }

    const offer = storage.duplicateOffer(id, targetTabId);
    return { message: 'Oferta duplicada com sucesso!', offer };
  },

  /**
   * Registra (ou corrige) a contagem de anúncios ativos de um dia.
   * É o que alimenta o gráfico de evolução da oferta.
   */
  async addDailyResult(offerId, adsCount, customDate = null) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(customDate || '') ? customDate : todayIso();
    const parsedCount = safeCount(adsCount, 0);

    if (ONLINE()) {
      const { data: offer, error: getErr } = await supabase
        .from('offers')
        .select('history, ads_count, status, funnel_notes')
        .eq('id', offerId)
        .maybeSingle();

      assertOk(getErr, 'Erro ao carregar a oferta.');
      if (!offer) throw new AppError('Oferta não encontrada.', { code: 'NOT_FOUND' });

      const history = upsertHistory(offer.history, date, parsedCount).slice(-LIMITS.historyEntries);
      const latest = history[history.length - 1];

      const patch = { history, updated_at: new Date().toISOString() };
      if (latest) patch.ads_count = latest.count;

      const meta = decodeNotes(offer.funnel_notes).meta;
      if (!meta.status_manual) {
        patch.status = classifyStatus(resolveRunningDays(offer, meta));
      }

      const { data, error } = await supabase
        .from('offers')
        .update(patch)
        .eq('id', offerId)
        .select(OFFER_COLUMNS)
        .single();

      assertOk(error, 'Erro ao registrar medição.');

      return {
        message: `Medição de ${date} atualizada para ${parsedCount} anúncios!`,
        offer: formatOffer(data)
      };
    }

    const offer = storage.addDailyResult(offerId, parsedCount, date);
    return { message: `Medição de ${date} atualizada para ${parsedCount} anúncios!`, offer };
  },

  /** Alias mantido para compatibilidade com chamadas antigas. */
  async addMeasurement(offerId, date, adsCount) {
    return this.addDailyResult(offerId, adsCount, date);
  },

  async deleteHistoryEntry(offerId, date) {
    if (ONLINE()) {
      const { data: offer, error: getErr } = await supabase
        .from('offers')
        .select('history')
        .eq('id', offerId)
        .maybeSingle();

      assertOk(getErr, 'Erro ao carregar a oferta.');
      if (!offer) throw new AppError('Oferta não encontrada.', { code: 'NOT_FOUND' });

      const history = normalizeHistory(offer.history)
        .filter((h) => h.date !== date)
        .map((h) => historyEntry(h.date, h.count));

      const patch = { history, updated_at: new Date().toISOString() };
      if (history.length) patch.ads_count = history[history.length - 1].count;

      const { data, error } = await supabase
        .from('offers')
        .update(patch)
        .eq('id', offerId)
        .select(OFFER_COLUMNS)
        .single();

      assertOk(error, 'Erro ao remover medição.');

      return { message: `Medição de ${date} removida.`, offer: formatOffer(data) };
    }

    const offer = storage.deleteHistoryEntry(offerId, date);
    return { message: `Medição de ${date} removida.`, offer };
  },

  // ============================================================================
  // SHARES (COMPARTILHAMENTOS)
  // ============================================================================

  /**
   * Gera o link público de uma tab tirando um retrato das ofertas do momento.
   * Só campos públicos entram no retrato (sem link de afiliado nem anotações).
   */
  async createShareLink(tabId) {
    if (!tabId) throw new AppError('Selecione uma tab para compartilhar.', { code: 'VALIDATION' });

    if (ONLINE()) {
      const userId = await currentUserId();
      const { tabs } = await this.listTabs();
      const tab = (tabs || []).find((t) => t.id === tabId);
      if (!tab) throw new AppError('Aba não encontrada.', { code: 'NOT_FOUND' });

      const offers = await this.fetchAllOffers(tabId, { max: LIMITS.shareOffers });
      const snapshot = offers.map(shareSnapshotEntry);

      const { data, error } = await supabase
        .from('shares')
        .insert([{
          user_id: userId,
          share_token: randomToken(),
          tab_id: tabId,
          tab_name: clip(tab.name || 'Geral', LIMITS.tabName),
          snapshot
        }])
        .select('share_token')
        .single();

      assertOk(error, 'Erro ao gerar link de compartilhamento.');

      return { message: 'Link de compartilhamento gerado com sucesso!', token: data.share_token };
    }

    const token = storage.createShareLink(tabId);
    return { message: 'Link de compartilhamento gerado com sucesso!', token };
  },

  /**
   * Conteúdo da página pública (somente leitura). Passa pela RPC
   * get_share_by_token: o banco devolve só o share daquele token, se válido.
   */
  async publicOffers(token) {
    const cleanToken = String(token || '').trim();
    if (cleanToken.length < 20 || cleanToken.length > 128) {
      throw new AppError('Link de compartilhamento inválido ou expirado.', { code: 'NOT_FOUND' });
    }

    if (ONLINE()) {
      const { data, error } = await supabase.rpc('get_share_by_token', { token: cleanToken });

      if (error) throw toUserError(error, 'Não foi possível abrir este link agora.');

      const share = Array.isArray(data) ? data[0] : data;
      if (!share) {
        throw new AppError('Link de compartilhamento inválido ou expirado.', { code: 'NOT_FOUND' });
      }

      const snapshot = Array.isArray(share.snapshot) ? share.snapshot : [];
      return {
        owner_name: share.owner_name || '',
        tab_name: share.tab_name || 'Ofertas',
        offers: snapshot
          .filter((o) => o && typeof o === 'object')
          .map((offer) => (offer.funnel_notes && !offer.meta ? formatOffer(offer) : offer))
      };
    }

    const share = storage.getPublicShare(cleanToken);
    return { owner_name: share.owner_name || '', tab_name: share.tab_name || 'Ofertas', offers: share.offers || [] };
  },

  // ============================================================================
  // BACKUP (EXPORTAR / IMPORTAR ACERVO)
  // ============================================================================

  async exportData() {
    if (ONLINE()) {
      const { tabs } = await this.listTabs();
      const offers = await this.fetchAllOffers(null);

      return JSON.stringify(
        {
          source: 'minerai',
          version: 2,
          exported_at: new Date().toISOString(),
          tabs: tabs || [],
          offers: offers || []
        },
        null,
        2
      );
    }

    return storage.exportData();
  },

  async importData(jsonText) {
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      throw new AppError('Arquivo inválido: não é um JSON válido.', { code: 'VALIDATION' });
    }

    const importedTabs = Array.isArray(parsed?.tabs) ? parsed.tabs : [];
    const importedOffers = Array.isArray(parsed?.offers) ? parsed.offers : [];

    if (!importedTabs.length && !importedOffers.length) {
      throw new AppError('Arquivo de backup vazio ou fora do formato do Mineraí.', { code: 'VALIDATION' });
    }

    if (ONLINE()) {
      const userId = await currentUserId();

      // Recria as tabs pelo nome e mapeia os IDs antigos para os novos.
      const { tabs: currentTabs } = await this.listTabs();
      const tabIdMap = {};

      for (const tab of importedTabs) {
        const wanted = clip(String(tab?.name || 'Importada').trim() || 'Importada', LIMITS.tabName);
        const existing = (currentTabs || []).find((t) => t.name.toLowerCase() === wanted.toLowerCase());
        if (existing) {
          tabIdMap[tab.id] = existing.id;
        } else {
          const res = await this.createTab({ name: wanted });
          currentTabs.push(res.tab);
          tabIdMap[tab.id] = res.tab.id;
        }
      }

      const fallbackTabId = Object.values(tabIdMap)[0] || currentTabs?.[0]?.id || null;

      const rows = importedOffers
        .filter((offer) => offer && typeof offer === 'object')
        .map((offer) => ({
          ...buildOfferRow(
            {
              ...offer,
              // Backup com data de início vale mais que "dias rodando" (que
              // congelaria na data da importação).
              running_days: offer.start_date ? undefined : offer.running_days,
              name: offer.name || 'Oferta Importada'
            },
            { userId }
          ),
          tab_id: tabIdMap[offer.tab_id] || fallbackTabId,
          avatar_url: safeAvatar(offer.avatar_url),
          creative_thumb: safeCreativeThumb(offer.creative_thumb)
        }));

      for (let i = 0; i < rows.length; i += LIMITS.importBatch) {
        const { error } = await supabase.from('offers').insert(rows.slice(i, i + LIMITS.importBatch));
        assertOk(error, 'Erro ao importar ofertas.');
      }

      return { tabs: importedTabs, offers: rows };
    }

    return storage.importData(jsonText);
  }
};
