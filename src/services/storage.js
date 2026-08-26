import { INITIAL_USER, INITIAL_TABS, INITIAL_OFFERS } from './mockData';
import { extractPageIdFromUrl } from '../utils/metaParser';

const STORAGE_KEYS = {
  USER: 'minerar_user',
  TABS: 'minerar_tabs',
  OFFERS: 'minerar_offers',
  SHARES: 'minerar_shares'
};

export const storage = {
  init() {
    if (!localStorage.getItem(STORAGE_KEYS.TABS)) {
      localStorage.setItem(STORAGE_KEYS.TABS, JSON.stringify(INITIAL_TABS));
    }
    if (!localStorage.getItem(STORAGE_KEYS.OFFERS)) {
      localStorage.setItem(STORAGE_KEYS.OFFERS, JSON.stringify(INITIAL_OFFERS));
    }
    if (!localStorage.getItem(STORAGE_KEYS.USER)) {
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(INITIAL_USER));
    }
    if (!localStorage.getItem(STORAGE_KEYS.SHARES)) {
      localStorage.setItem(STORAGE_KEYS.SHARES, JSON.stringify({}));
    }
  },

  // Auth & User
  getUser() {
    this.init();
    const data = localStorage.getItem(STORAGE_KEYS.USER);
    return data ? JSON.parse(data) : null;
  },

  setUser(user) {
    if (!user) {
      localStorage.removeItem(STORAGE_KEYS.USER);
    } else {
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
    }
  },

  // Tabs
  getTabs() {
    this.init();
    const tabs = JSON.parse(localStorage.getItem(STORAGE_KEYS.TABS) || '[]');
    const offers = this.getOffers();
    return tabs.map((tab) => ({
      ...tab,
      offers_count: offers.filter((o) => o.tab_id === tab.id).length
    }));
  },

  createTab(name) {
    this.init();
    const tabs = this.getTabs();
    const newTab = {
      id: `tab_${Date.now()}`,
      name: name.trim(),
      offers_count: 0
    };
    tabs.push(newTab);
    localStorage.setItem(STORAGE_KEYS.TABS, JSON.stringify(tabs));
    return newTab;
  },

  updateTab(id, name) {
    this.init();
    const tabs = this.getTabs();
    const index = tabs.findIndex((t) => t.id === id);
    if (index === -1) throw new Error('Tab não encontrada.');

    tabs[index].name = name.trim();
    localStorage.setItem(STORAGE_KEYS.TABS, JSON.stringify(tabs));
    return tabs[index];
  },

  deleteTab(id) {
    this.init();
    const tabs = this.getTabs().filter((t) => t.id !== id);
    if (!tabs.length) {
      throw new Error('Você não pode excluir todas as tabs. Mantenha ao menos uma.');
    }
    // Delete associated offers or reassign to the first tab
    const offers = this.getOffers().filter((o) => o.tab_id !== id);
    localStorage.setItem(STORAGE_KEYS.TABS, JSON.stringify(tabs));
    localStorage.setItem(STORAGE_KEYS.OFFERS, JSON.stringify(offers));
    return tabs[0].id;
  },

  // Offers
  getOffers(tabId = null) {
    this.init();
    const offers = JSON.parse(localStorage.getItem(STORAGE_KEYS.OFFERS) || '[]');
    if (tabId) {
      return offers.filter((o) => o.tab_id === tabId);
    }
    return offers;
  },

  createOffer(data) {
    this.init();
    const offers = this.getOffers();
    const pageId = extractPageIdFromUrl(data.library_url);
    const initialResults = Number(data.initial_results) || 1;
    const runningDays = Number(data.running_days) || 1;
    const todayStr = new Date().toISOString().split('T')[0];

    const newOffer = {
      id: `off_${Date.now()}`,
      tab_id: data.tab_id,
      name: data.name.trim(),
      niche: data.niche || 'Outros',
      status: data.status || 'testing',
      notes: data.notes || '',
      library_url: data.library_url.trim(),
      destination_url: (data.destination_url || data.library_url).trim(),
      page_id: pageId,
      image_url: data.image_url || `https://graph.facebook.com/${pageId}/picture?type=large`,
      ads_count: initialResults,
      running_days: runningDays,
      created_at: new Date().toISOString(),
      history: [
        {
          result_date: todayStr,
          results_count: initialResults
        }
      ]
    };

    offers.unshift(newOffer);
    localStorage.setItem(STORAGE_KEYS.OFFERS, JSON.stringify(offers));
    return newOffer;
  },

  updateOffer(id, data) {
    this.init();
    const offers = this.getOffers();
    const index = offers.findIndex((o) => o.id === id);
    if (index === -1) throw new Error('Oferta não encontrada.');

    const pageId = data.library_url ? extractPageIdFromUrl(data.library_url) : offers[index].page_id;
    const avatar = data.image_url || (pageId ? `https://graph.facebook.com/${pageId}/picture?type=large` : offers[index].image_url);

    offers[index] = {
      ...offers[index],
      ...data,
      page_id: pageId,
      image_url: avatar
    };

    localStorage.setItem(STORAGE_KEYS.OFFERS, JSON.stringify(offers));
    return offers[index];
  },

  deleteOffer(id) {
    this.init();
    const offers = this.getOffers().filter((o) => o.id !== id);
    localStorage.setItem(STORAGE_KEYS.OFFERS, JSON.stringify(offers));
    return true;
  },

  duplicateOffer(id, targetTabId) {
    this.init();
    const offers = this.getOffers();
    const original = offers.find((o) => o.id === id);
    if (!original) throw new Error('Oferta original não encontrada.');

    const duplicate = {
      ...original,
      id: `off_${Date.now()}`,
      tab_id: targetTabId,
      name: `${original.name} (Cópia)`,
      created_at: new Date().toISOString(),
      history: [...(original.history || [])]
    };

    offers.unshift(duplicate);
    localStorage.setItem(STORAGE_KEYS.OFFERS, JSON.stringify(offers));
    return duplicate;
  },

  // Daily Results & History Management
  addDailyResult(id, resultsCount, customDate = null) {
    this.init();
    const offers = this.getOffers();
    const offer = offers.find((o) => o.id === id);
    if (!offer) throw new Error('Oferta não encontrada.');

    const targetDate = customDate || new Date().toISOString().split('T')[0];
    const num = Math.max(0, Number(resultsCount));

    offer.ads_count = num;
    if (!offer.history) offer.history = [];

    const existingIdx = offer.history.findIndex((h) => h.result_date === targetDate);
    if (existingIdx !== -1) {
      offer.history[existingIdx].results_count = num;
    } else {
      offer.history.push({ result_date: targetDate, results_count: num });
    }

    // Sort history chronologically
    offer.history.sort((a, b) => a.result_date.localeCompare(b.result_date));

    // Update status dynamically if scaling high
    if (num >= 50 && offer.status === 'testing') {
      offer.status = 'scaling';
    }

    localStorage.setItem(STORAGE_KEYS.OFFERS, JSON.stringify(offers));
    return offer;
  },

  deleteHistoryEntry(offerId, date) {
    this.init();
    const offers = this.getOffers();
    const offer = offers.find((o) => o.id === offerId);
    if (!offer) throw new Error('Oferta não encontrada.');

    offer.history = (offer.history || []).filter((h) => h.result_date !== date);
    if (offer.history.length) {
      offer.ads_count = offer.history[offer.history.length - 1].results_count;
    }

    localStorage.setItem(STORAGE_KEYS.OFFERS, JSON.stringify(offers));
    return offer;
  },

  // Share link
  createShareLink(tabId) {
    this.init();
    const shares = JSON.parse(localStorage.getItem(STORAGE_KEYS.SHARES) || '{}');
    const token = `sh_${Math.random().toString(36).slice(2, 11)}_${Date.now()}`;
    shares[token] = {
      tab_id: tabId,
      created_at: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_KEYS.SHARES, JSON.stringify(shares));
    return token;
  },

  getPublicShare(token) {
    this.init();
    const shares = JSON.parse(localStorage.getItem(STORAGE_KEYS.SHARES) || '{}');
    const share = shares[token];
    if (!share) {
      throw new Error('Link compartilhado não encontrado ou expirado.');
    }
    const user = this.getUser() || INITIAL_USER;
    const tabs = this.getTabs();
    const tab = tabs.find((t) => t.id === share.tab_id);
    const offers = this.getOffers(share.tab_id);

    return {
      owner_name: user.name || 'Mineirador',
      tab_name: tab ? tab.name : 'Ofertas Mineradas',
      offers: offers
    };
  },

  // Backup: Export / Import
  exportData() {
    this.init();
    const payload = {
      version: '1.0.0',
      exported_at: new Date().toISOString(),
      tabs: this.getTabs(),
      offers: this.getOffers()
    };
    return JSON.stringify(payload, null, 2);
  },

  importData(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (!Array.isArray(data.tabs) || !Array.isArray(data.offers)) {
        throw new Error('Arquivo JSON inválido. Formato incompatível.');
      }
      localStorage.setItem(STORAGE_KEYS.TABS, JSON.stringify(data.tabs));
      localStorage.setItem(STORAGE_KEYS.OFFERS, JSON.stringify(data.offers));
      return { tabs: data.tabs, offers: data.offers };
    } catch (e) {
      throw new Error(e.message || 'Erro ao processar arquivo de backup.');
    }
  }
};
