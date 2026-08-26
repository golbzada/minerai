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
          msg = 'E-mail não confirmado. Verifique sua caixa de entrada.';
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
        throw new Error(error.message || 'Erro ao realizar cadastro no Supabase.');
      }

      const autoConfirmed = Boolean(data.session);
      return {
        message: autoConfirmed
          ? 'Cadastro realizado com sucesso!'
          : `Enviamos um código de confirmação para ${email}.`,
        autoConfirmed,
        user: data.user
      };
    }

    return {
      message: `Código de confirmação enviado para ${email}. (Use 123456 no teste local)`,
      autoConfirmed: false
    };
  },

  async verifyRegistration({ email, code }) {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'signup'
      });

      if (error) {
        const { data: d2, error: e2 } = await supabase.auth.verifyOtp({
          email: email.trim(),
          token: code.trim(),
          type: 'email'
        });
        if (e2) throw new Error(error.message || 'Código de confirmação inválido ou expirado.');
      }

      return { message: 'Código verificado com sucesso!' };
    }

    if (code.trim() !== '123456') {
      throw new Error('Código incorreto. Use 123456 no teste local.');
    }
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
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (error) throw new Error(error.message || 'Erro ao enviar e-mail de recuperação.');
      return { message: `Enviamos o código/link de recuperação para ${email}.` };
    }
    return { message: `Código de redefinição enviado para ${email}. (Use 123456 no teste local)` };
  },

  async verifyPasswordReset({ email, code }) {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'recovery'
      });
      if (error) throw new Error(error.message || 'Código de recuperação inválido ou expirado.');
      return { message: 'Código verificado com sucesso!', reset_token: 'valid' };
    }
    return { message: 'Código verificado com sucesso!', reset_token: `reset_token_${Date.now()}` };
  },

  async completePasswordReset({ email, password }) {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.auth.updateUser({
        password
      });
      if (error) throw new Error(error.message || 'Erro ao atualizar a nova senha.');
      return { message: 'Senha redefinida com sucesso! Faça login com sua nova senha.' };
    }
    return { message: 'Senha redefinida com sucesso! Faça login com sua nova senha.' };
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

      return { offers: data || [] };
    }

    const offers = storage.getOffers(tabId);
    return { offers };
  },

  async createOffer(offerData) {
    if (isSupabaseConfigured && supabase) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');

      const payload = {
        user_id: user.id,
        tab_id: offerData.tab_id || null,
        name: offerData.name || 'Nova Oferta',
        page_id: offerData.page_id || '',
        ads_count: Number(offerData.ads_count) || 0,
        library_url: offerData.library_url || '',
        landing_page: offerData.landing_page || '',
        affiliate_link: offerData.affiliate_link || '',
        funnel_notes: offerData.funnel_notes || '',
        status: offerData.status || 'testing',
        niche: offerData.niche || 'Geral',
        avatar_url: offerData.avatar_url || '',
        history: offerData.history || [
          {
            date: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
            count: Number(offerData.ads_count) || 0
          }
        ]
      };

      const { data, error } = await supabase
        .from('offers')
        .insert([payload])
        .select()
        .single();

      if (error) throw new Error(error.message || 'Erro ao salvar oferta.');

      return { message: 'Oferta garimpada, anúncios extraídos com sucesso!', offer: data };
    }

    const offer = storage.createOffer(offerData);
    return { message: 'Oferta garimpada, anúncios extraídos com sucesso!', offer };
  },

  async updateOffer(id, offerData) {
    if (isSupabaseConfigured && supabase) {
      const payload = {
        ...offerData,
        updated_at: new Date().toISOString()
      };
      // Prevent mutating user_id
      delete payload.user_id;

      const { data, error } = await supabase
        .from('offers')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (error) throw new Error(error.message || 'Erro ao atualizar oferta.');

      return { message: 'Oferta atualizada com sucesso!', offer: data };
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
