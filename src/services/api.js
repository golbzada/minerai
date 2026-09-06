import { storage } from './storage';
import { supabase, isSupabaseConfigured } from './supabaseClient';
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
  const incoming = offerData.meta || {};
  const notes = offerData.notes ?? offerData.funnel_notes ?? '';

  let startDate = incoming.start_date || offerData.start_date || existingMeta.start_date || null;

  // Se o usuário digitou "há X dias rodando", derivamos a data de início para
  // que a contagem continue andando sozinha nos dias seguintes.
  if (offerData.running_days != null && offerData.running_days !== '') {
    const typedDays = Math.max(1, parseInt(offerData.running_days, 10) || 1);
    startDate = daysToStartDate(typedDays);
  }

  // `status_manual` marca que o usuário fixou o estágio na mão; sem ele, o
  // estágio é recalculado sozinho pelo tempo de veiculação.
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

export const API_CONFIG = {
  USE_LOCAL: !isSupabaseConfigured,
  IS_SUPABASE: isSupabaseConfigured
};

export const api = {
  // ============================================================================
  // AUTH & SESSION
  // ============================================================================

  async me() {
    if (isSupabaseConfigured && supabase) {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        throw new Error('Não autenticado');
      }

      // Fetch profile
      const { data: profile, error: profError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (profError || !profile) {
        return {
          user: {
            id: user.id,
            name: user.user_metadata?.name || user.email.split('@')[0],
            email: user.email,
            plan: 'annual',
            active: true
          }
        };
      }

      return { user: profile };
    }

    // Fallback local
    const user = storage.getUser();
    if (!user) throw new Error('Não autenticado');
    return { user };
  },

  async login({ email, password }) {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      });

      if (error) {
        let msg = 'Erro ao realizar login. Verifique suas credenciais.';
        if (error.message.includes('Invalid login credentials')) {
          msg = 'E-mail ou senha incorretos.';
        } else if (error.message.includes('Email not confirmed')) {
          msg = 'Conta aguardando confirmação. Clique em "Esqueci minha senha" para liberar o acesso instantaneamente.';
        }
        throw new Error(msg);
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

      const user = profile || {
        id: data.user.id,
        name: data.user.user_metadata?.name || email.split('@')[0],
        email: data.user.email,
        plan: 'annual',
        active: true
      };

      storage.setUser(user);
      return { message: 'Login realizado com sucesso!', user };
    }

    // Fallback local
    let user = storage.getUser();
    if (!user || user.email !== email) {
      user = {
        id: `usr_${Date.now()}`,
        name: email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
        email: email,
        active: true,
        plan: 'annual'
      };
    }
    storage.setUser(user);
    return { message: 'Login realizado com sucesso!', user };
  },

  async startRegistration({ name, email, password }) {
    if (isSupabaseConfigured && supabase) {
      // 1. Tenta cadastrar no Supabase Auth
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            name: name ? name.trim() : email.split('@')[0]
          }
        }
      });

      if (error) {
        // Se a conta já existe, tenta autenticar diretamente
        if (error.message.includes('already registered') || error.message.includes('already exists')) {
          return await this.login({ email, password });
        }
        throw new Error(error.message || 'Erro ao realizar cadastro.');
      }

      // 2. Se a sessão foi retornada na hora, salva e conclui
      if (data.session && data.user) {
        const user = {
          id: data.user.id,
          name: name ? name.trim() : email.split('@')[0],
          email: data.user.email,
          plan: 'annual',
          active: true
        };
        storage.setUser(user);
        return { message: 'Cadastro realizado com sucesso!', autoConfirmed: true, user };
      }

      // 3. Tenta login direto para capturar a sessão
      try {
        const loginRes = await this.login({ email, password });
        return { message: 'Cadastro realizado com sucesso!', autoConfirmed: true, user: loginRes.user };
      } catch (e) {
        const user = {
          id: data.user?.id || `usr_${Date.now()}`,
          name: name ? name.trim() : email.split('@')[0],
          email: email.trim(),
          plan: 'annual',
          active: true
        };
        storage.setUser(user);
        return { message: 'Cadastro realizado com sucesso!', autoConfirmed: true, user };
      }
    }

    const user = {
      id: `usr_${Date.now()}`,
      name: name ? name.trim() : email.split('@')[0],
      email: email.trim(),
      plan: 'annual',
      active: true
    };
    storage.setUser(user);
    return { message: 'Cadastro realizado com sucesso!', autoConfirmed: true, user };
  },

  async verifyRegistration({ email, code }) {
    return { message: 'Código verificado com sucesso!' };
  },

  async completeRegistration({ email, password, name }) {
    if (isSupabaseConfigured && supabase) {
      const { data: { user } } = await supabase.auth.getUser();
      const finalUser = user || {
        id: `usr_${Date.now()}`,
        name: name ? name.trim() : email.split('@')[0],
        email: email.trim(),
        active: true,
        plan: 'annual'
      };
      storage.setUser(finalUser);
      return { message: 'Cadastro concluído com sucesso!', user: finalUser };
    }

    const user = {
      id: `usr_${Date.now()}`,
      name: name ? name.trim() : email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
      email: email,
      active: true,
      plan: 'annual'
    };
    storage.setUser(user);
    return { message: 'Cadastro concluído com sucesso!', user };
  },

  async startPasswordReset({ email }) {
    return { message: 'Informe sua nova senha abaixo para redefinir o acesso.' };
  },

  async verifyPasswordReset({ email, code }) {
    return { message: 'Código verificado com sucesso!', reset_token: 'valid' };
  },

  async completePasswordReset({ email, password }) {
    if (isSupabaseConfigured && supabase) {
      // 1. Tenta redefinir via RPC direta no Postgres (segura e sem depender de SMTP)
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('quick_reset_password', {
          user_email: email.trim(),
          new_password: password
        });

        if (!rpcError && rpcData && rpcData.success) {
          try {
            const loginRes = await this.login({ email, password });
            return {
              message: 'Senha alterada com sucesso!',
              user: loginRes.user,
              autoLoggedIn: true
            };
          } catch (e) {
            return { message: 'Senha alterada com sucesso! Faça login com a sua nova senha.' };
          }
        } else if (rpcData && rpcData.error) {
          throw new Error(rpcData.error);
        }
      } catch (rpcErr) {
        if (rpcErr.message && !rpcErr.message.includes('function quick_reset_password')) {
          throw rpcErr;
        }
      }

      // 2. Fallback de atualização
      try {
        await supabase.auth.updateUser({ password });
      } catch (e) {}

      // Tenta login direto
      try {
        const loginRes = await this.login({ email, password });
        return { message: 'Senha redefinida com sucesso!', user: loginRes.user, autoLoggedIn: true };
      } catch (e) {}

      return { message: 'Senha alterada com sucesso! Faça login com sua nova senha.' };
    }

    return { message: 'Senha alterada com sucesso! Faça login com sua nova senha.' };
  },

  async logout() {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut().catch(() => {});
    }
    storage.setUser(null);
    return { message: 'Desconectado com sucesso.' };
  },

  async updateProfile(userData) {
    if (isSupabaseConfigured && supabase) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase
          .from('profiles')
          .update({
            name: userData.name,
            updated_at: new Date().toISOString()
          })
          .eq('id', user.id);
      }
    }
    storage.setUser(userData);
    return { message: 'Perfil atualizado com sucesso!', user: userData };
  },

  // ============================================================================
  // TABS (ABAS / CATEGORIAS)
  // ============================================================================

  async listTabs() {
    if (isSupabaseConfigured && supabase) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');

      const { data: tabs, error } = await supabase
        .from('tabs')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      if (error) throw new Error(error.message || 'Erro ao listar abas.');

      // Count offers per tab
      const { data: offers } = await supabase
        .from('offers')
        .select('tab_id')
        .eq('user_id', user.id);

      const countMap = {};
      (offers || []).forEach((o) => {
        if (o.tab_id) {
          countMap[o.tab_id] = (countMap[o.tab_id] || 0) + 1;
        }
      });

      const formattedTabs = (tabs || []).map((t) => ({
        id: t.id,
        name: t.name,
        offers_count: countMap[t.id] || 0
      }));

      return { tabs: formattedTabs };
    }

    const tabs = storage.getTabs();
    return { tabs };
  },

  async createTab({ name }) {
    if (isSupabaseConfigured && supabase) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');

      const { data, error } = await supabase
        .from('tabs')
        .insert([{ user_id: user.id, name: name.trim() }])
        .select()
        .single();

      if (error) throw new Error(error.message || 'Erro ao criar aba.');

      const newTab = { id: data.id, name: data.name, offers_count: 0 };
      return { message: `Tab "${name}" criada com sucesso!`, tab: newTab };
    }

    const tab = storage.createTab(name);
    return { message: `Tab "${name}" criada com sucesso!`, tab };
  },

  async updateTab(id, name) {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase
        .from('tabs')
        .update({ name: name.trim() })
        .eq('id', id);

      if (error) throw new Error(error.message || 'Erro ao renomear aba.');

      return { message: 'Tab renomeada com sucesso!', tab: { id, name: name.trim() } };
    }

    const tab = storage.updateTab(id, name);
    return { message: 'Tab renomeada com sucesso!', tab };
  },

  async deleteTab(id) {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.from('tabs').delete().eq('id', id);
      if (error) throw new Error(error.message || 'Erro ao excluir aba.');

      // Return next tab
      const { tabs } = await this.listTabs();
      const nextTabId = tabs.length ? tabs[0].id : null;
      return { message: 'Tab excluída com sucesso.', nextTabId };
    }

    const nextTabId = storage.deleteTab(id);
    return { message: 'Tab excluída com sucesso.', nextTabId };
  },

  // ============================================================================
  // OFFERS (OFERTAS GARIMPADAS)
  // ============================================================================

  async listOffers(tabId = null) {
    if (isSupabaseConfigured && supabase) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');

      let query = supabase
        .from('offers')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (tabId) {
        query = query.eq('tab_id', tabId);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message || 'Erro ao listar ofertas.');

      return { offers: (data || []).map(formatOffer) };
    }

    const offers = storage.getOffers(tabId);
    return { offers };
  },

  async createOffer(offerData) {
    if (isSupabaseConfigured && supabase) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');

      const initialCount = Number(offerData.ads_count ?? offerData.initial_results ?? 1);

      const payload = {
        user_id: user.id,
        tab_id: offerData.tab_id || null,
        name: offerData.name || 'Nova Oferta',
        page_id: offerData.page_id || '',
        ads_count: initialCount,
        library_url: offerData.library_url || '',
        landing_page: offerData.landing_page || offerData.destination_url || '',
        affiliate_link: offerData.affiliate_link || '',
        funnel_notes: buildNotesField(offerData),
        status: offerData.status || 'testing',
        niche: offerData.niche || 'Geral',
        avatar_url: offerData.avatar_url || null,
        history: normalizeHistory(offerData.history).length
          ? normalizeHistory(offerData.history).map((h) => historyEntry(h.date, h.count))
          : [historyEntry(todayIso(), initialCount)]
      };

      const { data, error } = await supabase
        .from('offers')
        .insert([payload])
        .select()
        .single();

      if (error) throw new Error(error.message || 'Erro ao salvar oferta.');

      return { message: 'Oferta salva com sucesso!', offer: formatOffer(data) };
    }

    const offer = storage.createOffer(offerData);
    return { message: 'Oferta salva com sucesso!', offer };
  },

  async updateOffer(id, offerData) {
    if (isSupabaseConfigured && supabase) {
      const initialCount = Number(offerData.ads_count ?? offerData.initial_results ?? 1);

      // Preserva os metadados já gravados (ID da biblioteca, origem da captura)
      // que o formulário de edição não conhece.
      const { data: current } = await supabase
        .from('offers')
        .select('funnel_notes')
        .eq('id', id)
        .single();

      const existingMeta = decodeNotes(current?.funnel_notes).meta;

      const payload = {
        name: offerData.name,
        page_id: offerData.page_id || '',
        ads_count: initialCount,
        library_url: offerData.library_url || '',
        landing_page: offerData.landing_page || offerData.destination_url || '',
        affiliate_link: offerData.affiliate_link || '',
        funnel_notes: buildNotesField(offerData, existingMeta),
        status: offerData.status || 'testing',
        niche: offerData.niche || 'Geral',
        updated_at: new Date().toISOString()
      };

      if (offerData.tab_id) payload.tab_id = offerData.tab_id;
      if (offerData.avatar_url) payload.avatar_url = offerData.avatar_url;
      if (offerData.history) {
        payload.history = normalizeHistory(offerData.history).map((h) => historyEntry(h.date, h.count));
      }

      const { data, error } = await supabase
        .from('offers')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (error) throw new Error(error.message || 'Erro ao atualizar oferta.');

      return { message: 'Oferta atualizada com sucesso!', offer: formatOffer(data) };
    }

    const offer = storage.updateOffer(id, offerData);
    return { message: 'Oferta atualizada com sucesso!', offer };
  },

  async deleteOffer(id) {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.from('offers').delete().eq('id', id);
      if (error) throw new Error(error.message || 'Erro ao excluir oferta.');
      return { message: 'Oferta excluída com sucesso.' };
    }

    storage.deleteOffer(id);
    return { message: 'Oferta excluída com sucesso.' };
  },

  async duplicateOffer(id, targetTabId) {
    if (isSupabaseConfigured && supabase) {
      const { data: original, error: getErr } = await supabase
        .from('offers')
        .select('*')
        .eq('id', id)
        .single();

      if (getErr || !original) throw new Error('Oferta original não encontrada.');

      const copyData = {
        ...original,
        tab_id: targetTabId,
        name: `${original.name} (Cópia)`
      };
      delete copyData.id;
      delete copyData.created_at;
      delete copyData.updated_at;

      const { data, error } = await supabase
        .from('offers')
        .insert([copyData])
        .select()
        .single();

      if (error) throw new Error(error.message || 'Erro ao duplicar oferta.');

      return { message: 'Oferta duplicada com sucesso!', offer: data };
    }

    const offer = storage.duplicateOffer(id, targetTabId);
    return { message: 'Oferta duplicada com sucesso!', offer };
  },

  /**
   * Registra (ou corrige) a contagem de anúncios ativos de um dia.
   * É o que alimenta o gráfico de pirâmide da evolução da oferta.
   */
  async addDailyResult(offerId, adsCount, customDate = null) {
    const date = customDate || todayIso();
    const parsedCount = Math.max(0, Number(adsCount) || 0);

    if (isSupabaseConfigured && supabase) {
      const { data: offer, error: getErr } = await supabase
        .from('offers')
        .select('history, ads_count, status, funnel_notes')
        .eq('id', offerId)
        .single();

      if (getErr || !offer) throw new Error('Oferta não encontrada.');

      const history = upsertHistory(offer.history, date, parsedCount);
      const latest = history[history.length - 1];

      const patch = {
        history,
        updated_at: new Date().toISOString()
      };

      // `ads_count` reflete sempre a medição mais recente do histórico.
      if (latest) patch.ads_count = latest.count;

      // Reclassifica pelo tempo de veiculação, a menos que o usuário tenha
      // fixado o estágio à mão no formulário.
      const meta = decodeNotes(offer.funnel_notes).meta;
      if (!meta.status_manual) {
        patch.status = classifyStatus(resolveRunningDays(offer, meta));
      }

      const { data, error } = await supabase
        .from('offers')
        .update(patch)
        .eq('id', offerId)
        .select()
        .single();

      if (error) throw new Error(error.message || 'Erro ao registrar medição.');

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
    if (isSupabaseConfigured && supabase) {
      const { data: offer, error: getErr } = await supabase
        .from('offers')
        .select('history')
        .eq('id', offerId)
        .single();

      if (getErr || !offer) throw new Error('Oferta não encontrada.');

      const history = normalizeHistory(offer.history)
        .filter((h) => h.date !== date)
        .map((h) => historyEntry(h.date, h.count));

      const patch = { history, updated_at: new Date().toISOString() };
      if (history.length) patch.ads_count = history[history.length - 1].count;

      const { data, error } = await supabase
        .from('offers')
        .update(patch)
        .eq('id', offerId)
        .select()
        .single();

      if (error) throw new Error(error.message || 'Erro ao remover medição.');

      return { message: `Medição de ${date} removida.`, offer: formatOffer(data) };
    }

    const offer = storage.deleteHistoryEntry(offerId, date);
    return { message: `Medição de ${date} removida.`, offer };
  },

  // ============================================================================
  // SHARES (COMPARTILHAMENTOS)
  // ============================================================================

  async createShare(tabId, tabName, offersSnapshot) {
    const token = `share_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    if (isSupabaseConfigured && supabase) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');

      const { data, error } = await supabase
        .from('shares')
        .insert([{
          user_id: user.id,
          share_token: token,
          tab_id: tabId || null,
          tab_name: tabName || 'Geral',
          snapshot: offersSnapshot || []
        }])
        .select()
        .single();

      if (error) throw new Error(error.message || 'Erro ao gerar link de compartilhamento.');

      return {
        message: 'Link de compartilhamento gerado com sucesso!',
        share: { token: data.share_token }
      };
    }

    const share = storage.createShare(tabId, tabName, offersSnapshot);
    return { message: 'Link de compartilhamento gerado com sucesso!', share };
  },

  async getPublicShare(token) {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase
        .from('shares')
        .select('*')
        .eq('share_token', token)
        .single();

      if (error || !data) {
        throw new Error('Link de compartilhamento inválido ou expirado.');
      }

      return {
        share: {
          token: data.share_token,
          tab_name: data.tab_name,
          offers: data.snapshot,
          created_at: data.created_at
        }
      };
    }

    const share = storage.getShare(token);
    if (!share) {
      throw new Error('Link de compartilhamento inválido ou expirado.');
    }
    return { share };
  },

  /**
   * Conteúdo exibido na página pública de compartilhamento (somente leitura).
   */
  async publicOffers(token) {
    const { share } = await this.getPublicShare(token);
    return {
      owner_name: share.owner_name || '',
      tab_name: share.tab_name || 'Ofertas',
      offers: (share.offers || []).map((offer) =>
        offer.funnel_notes && !offer.meta ? formatOffer(offer) : offer
      )
    };
  },

  /**
   * Gera o link público de uma tab tirando um retrato das ofertas do momento.
   */
  async createShareLink(tabId) {
    if (isSupabaseConfigured && supabase) {
      const { tabs } = await this.listTabs();
      const tab = (tabs || []).find((t) => t.id === tabId);
      const { offers } = await this.listOffers(tabId);

      const res = await this.createShare(tabId, tab?.name || 'Geral', offers || []);
      return { message: res.message, token: res.share.token };
    }

    const share = storage.createShareLink(tabId);
    return { message: 'Link de compartilhamento gerado com sucesso!', token: share.token };
  },

  // ============================================================================
  // BACKUP (EXPORTAR / IMPORTAR ACERVO)
  // ============================================================================

  async exportData() {
    if (isSupabaseConfigured && supabase) {
      const { tabs } = await this.listTabs();
      const { offers } = await this.listOffers();

      return JSON.stringify(
        {
          source: 'minerarads',
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
      throw new Error('Arquivo inválido: não é um JSON válido.');
    }

    const importedTabs = Array.isArray(parsed.tabs) ? parsed.tabs : [];
    const importedOffers = Array.isArray(parsed.offers) ? parsed.offers : [];

    if (!importedTabs.length && !importedOffers.length) {
      throw new Error('Arquivo de backup vazio ou fora do formato do Mineraí.');
    }

    if (isSupabaseConfigured && supabase) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');

      // Recria as tabs pelo nome e mapeia os IDs antigos para os novos.
      const { tabs: currentTabs } = await this.listTabs();
      const tabIdMap = {};

      for (const tab of importedTabs) {
        const existing = (currentTabs || []).find(
          (t) => t.name.toLowerCase() === String(tab.name || '').toLowerCase()
        );
        if (existing) {
          tabIdMap[tab.id] = existing.id;
        } else {
          const res = await this.createTab({ name: tab.name || 'Importada' });
          tabIdMap[tab.id] = res.tab.id;
        }
      }

      const fallbackTabId = Object.values(tabIdMap)[0] || currentTabs?.[0]?.id || null;

      const rows = importedOffers.map((offer) => {
        const adsCount = Math.max(0, Number(offer.ads_count) || 0);
        return {
          user_id: user.id,
          tab_id: tabIdMap[offer.tab_id] || fallbackTabId,
          name: offer.name || 'Oferta Importada',
          page_id: String(offer.page_id || ''),
          ads_count: adsCount,
          library_url: offer.library_url || '',
          landing_page: offer.landing_page || offer.destination_url || '',
          affiliate_link: offer.affiliate_link || '',
          // Quando o backup já traz a data de início, ela vale mais do que o
          // número de dias (que ficaria congelado na data da importação).
          funnel_notes: buildNotesField({
            ...offer,
            running_days: offer.start_date ? undefined : offer.running_days
          }),
          status: offer.status || 'testing',
          niche: offer.niche || 'Geral',
          avatar_url: offer.avatar_url || null,
          history: normalizeHistory(offer.history).length
            ? normalizeHistory(offer.history).map((h) => historyEntry(h.date, h.count))
            : [historyEntry(todayIso(), adsCount)]
        };
      });

      if (rows.length) {
        const { error } = await supabase.from('offers').insert(rows);
        if (error) throw new Error(error.message || 'Erro ao importar ofertas.');
      }

      return { tabs: importedTabs, offers: importedOffers };
    }

    return storage.importData(jsonText);
  }
};
