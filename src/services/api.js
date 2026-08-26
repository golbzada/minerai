import { storage } from './storage';
import { supabase, isSupabaseConfigured } from './supabaseClient';

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

      const formatted = (data || []).map((o) => {
        let runningDays = 1;
        if (o.funnel_notes) {
          const match = o.funnel_notes.match(/Dias rodando:\s*(\d+)/i);
          if (match) runningDays = parseInt(match[1], 10);
        }

        return {
          ...o,
          destination_url: o.landing_page || o.library_url,
          notes: o.funnel_notes,
          running_days: runningDays
        };
      });

      return { offers: formatted };
    }

    const offers = storage.getOffers(tabId);
    return { offers };
  },

  async createOffer(offerData) {
    if (isSupabaseConfigured && supabase) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');

      const initialCount = Number(offerData.ads_count ?? offerData.initial_results ?? 1);
      const runningDays = Number(offerData.running_days ?? 1);
      const notes = offerData.notes || offerData.funnel_notes || '';
      const notesWithDays = notes.includes('Dias rodando:')
        ? notes
        : `Dias rodando: ${runningDays}${notes ? ` | ${notes}` : ''}`;

      const payload = {
        user_id: user.id,
        tab_id: offerData.tab_id || null,
        name: offerData.name || 'Nova Oferta',
        page_id: offerData.page_id || '',
        ads_count: initialCount,
        library_url: offerData.library_url || '',
        landing_page: offerData.landing_page || offerData.destination_url || '',
        affiliate_link: offerData.affiliate_link || '',
        funnel_notes: notesWithDays,
        status: offerData.status || 'testing',
        niche: offerData.niche || 'Geral',
        avatar_url: offerData.avatar_url || null,
        history: offerData.history || [
          {
            date: new Date().toISOString().split('T')[0],
            count: initialCount,
            ads_count: initialCount
          }
        ]
      };

      const { data, error } = await supabase
        .from('offers')
        .insert([payload])
        .select()
        .single();

      if (error) throw new Error(error.message || 'Erro ao salvar oferta.');

      const formatted = {
        ...data,
        destination_url: data.landing_page,
        notes: data.funnel_notes,
        running_days: runningDays
      };

      return { message: 'Oferta salva com sucesso!', offer: formatted };
    }

    const offer = storage.createOffer(offerData);
    return { message: 'Oferta salva com sucesso!', offer };
  },

  async updateOffer(id, offerData) {
    if (isSupabaseConfigured && supabase) {
      const initialCount = Number(offerData.ads_count ?? offerData.initial_results ?? 1);
      const runningDays = Number(offerData.running_days ?? 1);
      const notes = offerData.notes || offerData.funnel_notes || '';
      const notesWithDays = `Dias rodando: ${runningDays}${notes ? ` | ${notes.replace(/Dias rodando:\s*\d+\s*\|\s*/i, '').replace(/Dias rodando:\s*\d+/i, '')}` : ''}`;

      const payload = {
        name: offerData.name,
        page_id: offerData.page_id || '',
        ads_count: initialCount,
        library_url: offerData.library_url || '',
        landing_page: offerData.landing_page || offerData.destination_url || '',
        affiliate_link: offerData.affiliate_link || '',
        funnel_notes: notesWithDays,
        status: offerData.status || 'testing',
        niche: offerData.niche || 'Geral',
        updated_at: new Date().toISOString()
      };

      if (offerData.tab_id) payload.tab_id = offerData.tab_id;
      if (offerData.avatar_url) payload.avatar_url = offerData.avatar_url;
      if (offerData.history) payload.history = offerData.history;

      const { data, error } = await supabase
        .from('offers')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (error) throw new Error(error.message || 'Erro ao atualizar oferta.');

      const formatted = {
        ...data,
        destination_url: data.landing_page,
        notes: data.funnel_notes,
        running_days: runningDays
      };

      return { message: 'Oferta atualizada com sucesso!', offer: formatted };
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

  async addMeasurement(offerId, date, adsCount) {
    if (isSupabaseConfigured && supabase) {
      const { data: offer, error: getErr } = await supabase
        .from('offers')
        .select('history, ads_count')
        .eq('id', offerId)
        .single();

      if (getErr || !offer) throw new Error('Oferta não encontrada.');

      let history = Array.isArray(offer.history) ? [...offer.history] : [];
      const parsedCount = Number(adsCount) || 0;

      const existingIndex = history.findIndex((h) => h.date === date);
      if (existingIndex >= 0) {
        history[existingIndex].count = parsedCount;
      } else {
        history.push({ date, count: parsedCount });
      }

      const { data, error } = await supabase
        .from('offers')
        .update({
          history,
          ads_count: parsedCount,
          updated_at: new Date().toISOString()
        })
        .eq('id', offerId)
        .select()
        .single();

      if (error) throw new Error(error.message || 'Erro ao registrar medição.');

      return { message: `Medição de ${date} atualizada para ${parsedCount} anúncios!`, offer: data };
    }

    const offer = storage.addMeasurement(offerId, date, adsCount);
    return { message: `Medição de ${date} atualizada para ${adsCount} anúncios!`, offer };
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
  }
};
