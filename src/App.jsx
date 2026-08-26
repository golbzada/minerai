import React, { useState, useEffect, useMemo } from 'react';
import Brand from './components/Brand';
import Topbar from './components/Topbar';
import MetricsBar from './components/MetricsBar';
import Tabs from './components/Tabs';
import Toolbar from './components/Toolbar';
import OfferCard from './components/OfferCard';
import OfferModal from './components/OfferModal';
import ResultModal from './components/ResultModal';
import HistoryModal from './components/HistoryModal';
import TabModal from './components/TabModal';
import AuthPage from './components/AuthPage';
import PublicShare from './components/PublicShare';
import { api } from './services/api';
import { supabase, isSupabaseConfigured } from './services/supabaseClient';

export default function App() {
  const [currentUser, setCurrentUser] = useState(undefined);
  const [shareToken, setShareToken] = useState(() => {
    return new URLSearchParams(window.location.hash.slice(1)).get('share');
  });

  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [offers, setOffers] = useState([]);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [nicheFilter, setNicheFilter] = useState('all');
  const [minAdsFilter, setMinAdsFilter] = useState('0');
  const [sortBy, setSortBy] = useState('recent');

  // Modals state
  const [editingOffer, setEditingOffer] = useState(undefined); // undefined: closed, null: new, obj: editing
  const [resultTargetOffer, setResultTargetOffer] = useState(null);
  const [historyTargetOffer, setHistoryTargetOffer] = useState(null);
  const [isTabModalOpen, setIsTabModalOpen] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState('');
  const [isSharing, setIsSharing] = useState(false);

  // Hash change listener
  useEffect(() => {
    function handleHashChange() {
      const token = new URLSearchParams(window.location.hash.slice(1)).get('share');
      setShareToken(token);
    }
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Check auth session
  useEffect(() => {
    api
      .me()
      .then((res) => setCurrentUser(res.user))
      .catch(() => setCurrentUser(null));

    if (isSupabaseConfigured && supabase) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (session?.user) {
          api.me().then((res) => setCurrentUser(res.user)).catch(() => {});
        } else if (event === 'SIGNED_OUT') {
          setCurrentUser(null);
        }
      });
      return () => subscription?.unsubscribe();
    }
  }, []);

  // Load tabs
  async function loadTabs() {
    try {
      const res = await api.listTabs();
      const list = res.tabs || [];
      setTabs(list);
      setActiveTabId((current) => {
        if (current && list.some((t) => t.id === current)) return current;
        return list[0]?.id || null;
      });
    } catch (err) {
      setFeedbackNotice(err.message);
    }
  }

  // Load offers
  async function loadOffers(tabId = activeTabId) {
    if (!tabId) return;
    try {
      const res = await api.listOffers(tabId);
      const list = res.offers || [];
      setOffers(list);
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, offers_count: list.length } : t))
      );
    } catch (err) {
      setFeedbackNotice(err.message);
    }
  }

  useEffect(() => {
    if (currentUser) {
      loadTabs();
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser && activeTabId) {
      loadOffers(activeTabId);
    }
  }, [activeTabId, currentUser]);

  // Filter & Sort Logic
  const visibleOffers = useMemo(() => {
    let result = [...offers];

    // Search query
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      result = result.filter((o) =>
        `${o.name} ${o.page_id || ''} ${o.niche || ''} ${o.notes || ''}`
          .toLowerCase()
          .includes(query)
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter((o) => o.status === statusFilter);
    }

    // Niche filter
    if (nicheFilter !== 'all') {
      result = result.filter((o) => o.niche === nicheFilter);
    }

    // Min ads filter
    const minAds = Number(minAdsFilter) || 0;
    if (minAds > 0) {
      result = result.filter((o) => (Number(o.ads_count) || 0) >= minAds);
    }

    // Sorting
    result.sort((a, b) => {
      if (sortBy === 'oldest') {
        return new Date(a.created_at || 0) - new Date(b.created_at || 0);
      }
      if (sortBy === 'most_ads') {
        return (Number(b.ads_count) || 0) - (Number(a.ads_count) || 0);
      }
      if (sortBy === 'least_ads') {
        return (Number(a.ads_count) || 0) - (Number(b.ads_count) || 0);
      }
      if (sortBy === 'running_days') {
        return (Number(b.running_days) || 0) - (Number(a.running_days) || 0);
      }
      // 'recent' default
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });

    return result;
  }, [offers, searchQuery, statusFilter, nicheFilter, minAdsFilter, sortBy]);

  // Actions
  async function handleSaveOffer(offerData) {
    const payload = editingOffer
      ? offerData
      : { ...offerData, tab_id: activeTabId };

    const res = editingOffer
      ? await api.updateOffer(editingOffer.id, payload)
      : await api.createOffer(payload);

    setFeedbackNotice(res.message);
    await loadOffers();
    await loadTabs();
  }

  async function handleDeleteOffer(offer) {
    if (window.confirm(`Deseja realmente excluir a oferta "${offer.name}"?`)) {
      try {
        const res = await api.deleteOffer(offer.id);
        setFeedbackNotice(res.message);
        await loadOffers();
        await loadTabs();
      } catch (err) {
        setFeedbackNotice(err.message);
      }
    }
  }

  async function handleDuplicateOffer(offer) {
    try {
      const res = await api.duplicateOffer(offer.id, activeTabId);
      setFeedbackNotice(`Oferta "${offer.name}" duplicada!`);
      await loadOffers();
      await loadTabs();
    } catch (err) {
      setFeedbackNotice(err.message);
    }
  }

  async function handleAddDailyResult(offer, count, customDate) {
    try {
      const res = await api.addDailyResult(offer.id, count, customDate);
      setFeedbackNotice(res.message);
      await loadOffers();
      if (historyTargetOffer && historyTargetOffer.id === offer.id) {
        setHistoryTargetOffer(res.offer);
      }
    } catch (err) {
      setFeedbackNotice(err.message);
    }
  }

  async function handleDeleteHistoryEntry(offerId, date) {
    try {
      const res = await api.deleteHistoryEntry(offerId, date);
      setFeedbackNotice(res.message);
      await loadOffers();
      if (historyTargetOffer && historyTargetOffer.id === offerId) {
        setHistoryTargetOffer(res.offer);
      }
    } catch (err) {
      setFeedbackNotice(err.message);
    }
  }

  async function handleCreateTab(tabName) {
    try {
      const res = await api.createTab({ name: tabName });
      setTabs((prev) => [...prev, res.tab]);
      setActiveTabId(res.tab.id);
      setOffers([]);
      setIsTabModalOpen(false);
      setFeedbackNotice(res.message);
    } catch (err) {
      setFeedbackNotice(err.message);
    }
  }

  async function handleRenameTab(tabId, newName) {
    try {
      const res = await api.updateTab(tabId, newName);
      setFeedbackNotice(res.message);
      await loadTabs();
    } catch (err) {
      setFeedbackNotice(err.message);
    }
  }

  async function handleDeleteTab(tabId) {
    try {
      const res = await api.deleteTab(tabId);
      setFeedbackNotice(res.message);
      setActiveTabId(res.nextTabId);
      await loadTabs();
    } catch (err) {
      setFeedbackNotice(err.message);
    }
  }

  async function handleShareTab() {
    if (!activeTabId) {
      setFeedbackNotice('Crie ou selecione uma tab antes de compartilhar.');
      return;
    }
    setIsSharing(true);
    try {
      const res = await api.createShareLink(activeTabId);
      const shareUrl = `${window.location.origin}${window.location.pathname}#share=${res.token}`;
      try {
        await navigator.clipboard.writeText(shareUrl);
        setFeedbackNotice('Link público copiado para a área de transferência! Quem receber poderá apenas visualizar.');
      } catch {
        window.prompt('Copie o link público abaixo:', shareUrl);
        setFeedbackNotice('Link público gerado!');
      }
    } catch (err) {
      setFeedbackNotice(err.message);
    } finally {
      setIsSharing(false);
    }
  }

  function handleExportBackup() {
    const jsonStr = api.exportData();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `minerarads_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setFeedbackNotice('Backup do acervo exportado com sucesso!');
  }

  function handleImportBackup(jsonText) {
    try {
      const res = api.importData(jsonText);
      setFeedbackNotice(`Backup restaurado com sucesso! (${res.tabs.length} tabs e ${res.offers.length} ofertas)`);
      loadTabs();
    } catch (e) {
      alert(`Erro na importação: ${e.message}`);
    }
  }

  async function handleLogout() {
    await api.logout();
    setCurrentUser(null);
  }

  // 1. If share token is present in URL
  if (shareToken) {
    return <PublicShare token={shareToken} onBackToApp={() => setShareToken(null)} />;
  }

  // 2. Initial loading
  if (currentUser === undefined) {
    return (
      <div className="splash">
        <Brand />
      </div>
    );
  }

  // 3. Unauthenticated -> Auth Page
  if (!currentUser) {
    return <AuthPage onAuthenticated={(user) => setCurrentUser(user)} />;
  }

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // 4. Authenticated -> Dashboard
  return (
    <main className="app">
      <Topbar
        user={currentUser}
        onLogout={handleLogout}
        onExport={handleExportBackup}
        onUpdateUser={(u) => setCurrentUser(u)}
      />

      <section className="hero">
        <p className="eyebrow">GARIMPAGEM DE OFERTAS DE ALTA PERFORMANCE</p>
        <h1>
          Garimpos que <br />
          rendem <em>ouro.</em>
        </h1>
      </section>

      {/* Metrics Bar */}
      <MetricsBar offers={offers} tabName={activeTab?.name} />

      {/* Tabs */}
      <Tabs
        tabs={tabs}
        activeTabId={activeTabId}
        currentOffersCount={offers.length}
        onSelectTab={(id) => setActiveTabId(id)}
        onNewTab={() => setIsTabModalOpen(true)}
        onRenameTab={handleRenameTab}
        onDeleteTab={handleDeleteTab}
      />

      {/* Toolbar with Search, Filters, Sort, Export/Import */}
      <Toolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        nicheFilter={nicheFilter}
        onNicheFilterChange={setNicheFilter}
        minAdsFilter={minAdsFilter}
        onMinAdsFilterChange={setMinAdsFilter}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        onShare={handleShareTab}
        isSharing={isSharing}
        onExport={handleExportBackup}
        onImport={handleImportBackup}
        onNewOffer={() => setEditingOffer(null)}
      />

      {feedbackNotice && (
        <p className="notice" onClick={() => setFeedbackNotice('')} title="Clique para fechar">
          {feedbackNotice}
        </p>
      )}

      {/* Board of Offers */}
      <section className="board">
        {visibleOffers.map((offer, idx) => (
          <OfferCard
            key={offer.id}
            offer={offer}
            index={idx}
            onEdit={setEditingOffer}
            onDelete={handleDeleteOffer}
            onDuplicate={handleDuplicateOffer}
            onAddResult={setResultTargetOffer}
            onOpenHistory={(target) => setHistoryTargetOffer(target)}
          />
        ))}
      </section>

      {!visibleOffers.length && (
        <div className="empty">
          Nenhuma oferta encontrada com os filtros atuais em <strong>{activeTab?.name || 'esta tab'}</strong>.
          <br />
          <button
            className="secondary"
            style={{ marginTop: 12 }}
            onClick={() => {
              setSearchQuery('');
              setStatusFilter('all');
              setNicheFilter('all');
              setMinAdsFilter('0');
            }}
          >
            Limpar Filtros
          </button>
        </div>
      )}

      {/* Modals */}
      {isTabModalOpen && (
        <TabModal
          onClose={() => setIsTabModalOpen(false)}
          onSave={handleCreateTab}
        />
      )}

      {editingOffer !== undefined && (
        <OfferModal
          offer={editingOffer}
          onClose={() => setEditingOffer(undefined)}
          onSave={handleSaveOffer}
        />
      )}

      {resultTargetOffer && (
        <ResultModal
          offer={resultTargetOffer}
          onClose={() => setResultTargetOffer(null)}
          onSave={handleAddDailyResult}
        />
      )}

      {historyTargetOffer && (
        <HistoryModal
          offer={historyTargetOffer}
          onClose={() => setHistoryTargetOffer(null)}
          onAddResult={handleAddDailyResult}
          onDeleteEntry={handleDeleteHistoryEntry}
        />
      )}
    </main>
  );
}
