import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import { computeAlerts, findDuplicates, getExtras } from '../utils/offerExtras';

/**
 * Dados compartilhados por todas as páginas do painel: abas, acervo completo,
 * aba ativa, avisos e contadores do menu. Carrega tudo uma vez por login e
 * atualiza em memória a cada alteração (sem recarregar a página inteira).
 */
const AppDataContext = createContext(null);

const ACTIVE_TAB_KEY = 'minerai_active_tab';

export function AppDataProvider({ user, onUserChange, onLogout, children }) {
  const [tabs, setTabs] = useState([]);
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [activeTabId, setActiveTabIdState] = useState(() => {
    try {
      return localStorage.getItem(ACTIVE_TAB_KEY) || null;
    } catch (e) {
      return null;
    }
  });

  const setActiveTabId = useCallback((id) => {
    setActiveTabIdState(id);
    try {
      if (id) localStorage.setItem(ACTIVE_TAB_KEY, id);
    } catch (e) {}
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [{ tabs: tabList }, all] = await Promise.all([api.listTabs(), api.fetchAllOffers(null)]);
      setTabs(tabList || []);
      setOffers(all || []);
      setActiveTabIdState((current) => {
        if (current && (tabList || []).some((t) => t.id === current)) return current;
        return tabList?.[0]?.id || null;
      });
    } catch (err) {
      setNotice(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh, user?.id]);

  /** Substitui (ou acrescenta) uma oferta já formatada no acervo em memória. */
  const applyOffer = useCallback((offer) => {
    if (!offer?.id) return;
    setOffers((prev) => {
      const idx = prev.findIndex((o) => o.id === offer.id);
      if (idx === -1) return [offer, ...prev];
      const next = prev.slice();
      next[idx] = { ...prev[idx], ...offer };
      return next;
    });
  }, []);

  const removeOffers = useCallback((ids) => {
    const set = new Set(ids);
    setOffers((prev) => prev.filter((o) => !set.has(o.id)));
  }, []);

  const duplicates = useMemo(() => findDuplicates(offers), [offers]);

  const counts = useMemo(() => ({
    favs: offers.filter((o) => getExtras(o).fav).length,
    alerts: computeAlerts(offers).length,
    total: offers.length
  }), [offers]);

  // Contagem por aba sempre a partir do acervo em memória.
  const tabsWithCounts = useMemo(
    () => tabs.map((t) => ({ ...t, offers_count: offers.filter((o) => o.tab_id === t.id).length })),
    [tabs, offers]
  );

  const value = {
    user,
    setUser: onUserChange,
    logout: onLogout,
    tabs: tabsWithCounts,
    setTabs,
    offers,
    setOffers,
    loading,
    refresh,
    applyOffer,
    removeOffers,
    notice,
    setNotice,
    activeTabId,
    setActiveTabId,
    duplicates,
    counts
  };

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData precisa estar dentro de AppDataProvider');
  return ctx;
}
