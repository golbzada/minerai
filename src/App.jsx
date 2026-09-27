import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
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
import ExtensionModal from './components/ExtensionModal';
import ModelarModal from './components/ModelarModal';
import AuthPage from './components/AuthPage';
import PublicShare from './components/PublicShare';
import ResetPasswordPage from './components/ResetPasswordPage';
import { api, PAGE_SIZE } from './services/api';
import { supabase, isSupabaseConfigured, RESET_PASSWORD_PATH } from './services/supabaseClient';
import { resolveStatus } from './utils/offerMeta';
import { NICHE_OPTIONS } from './utils/metaParser';
import { AUTH_EXPIRED_EVENT } from './utils/errors';
import { getAccess, lockedMessage, LOCK_MODE } from './utils/plan';

function readShareToken() {
  return new URLSearchParams(window.location.hash.slice(1)).get('share');
}

/** O link de redefinição de senha abre /redefinir-senha (ou traz type=recovery no hash). */
function isRecoveryUrl() {
  if (window.location.pathname === RESET_PASSWORD_PATH) return true;
  const hash = new URLSearchParams(window.location.hash.slice(1));
  return hash.get('type') === 'recovery';
}

export default function App() {
  const [currentUser, setCurrentUser] = useState(undefined);
  const currentUserRef = useRef(undefined);
  const [shareToken, setShareToken] = useState(readShareToken);
  const [recoveryMode, setRecoveryMode] = useState(isRecoveryUrl);

  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);
  const [offers, setOffers] = useState([]);
  const [hasMoreOffers, setHasMoreOffers] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

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
  const [isExtensionModalOpen, setIsExtensionModalOpen] = useState(false);
  const [isModelarOpen, setIsModelarOpen] = useState(false);
  const [feedbackNotice, setFeedbackNotice] = useState('');
  const [isSharing, setIsSharing] = useState(false);

  const access = getAccess(currentUser);
  const locked = Boolean(currentUser) && !access.active;

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  // Hash change listener
  useEffect(() => {
    function handleHashChange() {
      setShareToken(readShareToken());
    }
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Sessão: carga inicial + eventos do Supabase + sessão expirada em chamadas.
  useEffect(() => {
    let alive = true;

    api
      .me()
      .then((res) => alive && setCurrentUser(res.user || null))
      .catch(() => alive && setCurrentUser(null));

    function handleExpired() {
      if (isSupabaseConfigured && supabase) supabase.auth.signOut().catch(() => {});
      setCurrentUser(null);
      setFeedbackNotice('');
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, handleExpired);

    let subscription = null;
    if (isSupabaseConfigured && supabase) {
      ({ data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (!alive) return;

        if (event === 'PASSWORD_RECOVERY') {
          setRecoveryMode(true);
          return;
        }
        if (event === 'SIGNED_OUT') {
          setCurrentUser(null);
          return;
        }
        // TOKEN_REFRESHED não muda o perfil: não vale uma ida ao banco.
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION') {
          if (!session?.user) return;
          if (currentUserRef.current?.id === session.user.id && event !== 'USER_UPDATED') return;
          api.me().then((res) => alive && setCurrentUser(res.user || null)).catch(() => {});
        }
      }));
    }

    return () => {
      alive = false;
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleExpired);
      subscription?.unsubscribe();
    };
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

  // Load offers (primeira página; as seguintes vêm por "Carregar mais")
  async function loadOffers(tabId = activeTabId) {
    if (!tabId) return;
    try {
      const res = await api.listOffers(tabId, { offset: 0, limit: PAGE_SIZE });
      const list = res.offers || [];
      setOffers(list);
      setHasMoreOffers(Boolean(res.hasMore));
      if (!res.hasMore) {
        setTabs((prev) =>
          prev.map((t) => (t.id === tabId ? { ...t, offers_count: list.length } : t))
        );
      }
    } catch (err) {
      setFeedbackNotice(err.message);
    }
  }

  const loadMoreOffers = useCallback(async () => {
    if (!activeTabId || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api.listOffers(activeTabId, { offset: offers.length, limit: PAGE_SIZE });
      setOffers((prev) => {
        const seen = new Set(prev.map((o) => o.id));
        return [...prev, ...(res.offers || []).filter((o) => !seen.has(o.id))];
      });
      setHasMoreOffers(Boolean(res.hasMore));
    } catch (err) {
      setFeedbackNotice(err.message);
    } finally {
      setLoadingMore(false);
    }
  }, [activeTabId, offers.length, loadingMore]);

  useEffect(() => {
    if (currentUser) {
      try {
        // A extensão lê este registro para saber quem está logado. Só o
        // necessário: nada de plano ou dados de assinatura.
        const publicUser = { id: currentUser.id, name: currentUser.name, email: currentUser.email };
        localStorage.setItem('minerai_user', JSON.stringify(publicUser));
        window.postMessage({ type: 'MINERAI_SYNC_AUTH', user: publicUser }, window.location.origin);
      } catch (e) {}
      loadTabs();
    } else if (currentUser === null) {
      try {
        localStorage.removeItem('minerai_user');
      } catch (e) {}
      setTabs([]);
      setOffers([]);
      setActiveTabId(null);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (currentUser && activeTabId) {
      loadOffers(activeTabId);
    }
  }, [activeTabId, currentUser?.id]);

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

    // Status filter — compara com o estágio exibido (que acompanha o tempo
    // de veiculação), não com o valor congelado no banco.
    if (statusFilter !== 'all') {
      result = result.filter((o) => resolveStatus(o) === statusFilter);
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

  // Nichos do seletor: os fixos mais os personalizados já usados, para que
  // uma categoria criada na mão continue filtrável.
  const availableNiches = useMemo(() => {
    const used = offers.map((o) => o.niche).filter(Boolean);
    return Array.from(new Set([...NICHE_OPTIONS, ...used]));
  }, [offers]);

  function guardWrite() {
    if (!locked) return true;
    setFeedbackNotice(lockedMessage(currentUser));
    return false;
  }

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
    if (!guardWrite()) return;
    try {
      await api.duplicateOffer(offer.id, activeTabId);
      setFeedbackNotice(`Oferta "${offer.name}" duplicada!`);
      await loadOffers();
      await loadTabs();
    } catch (err) {
      setFeedbackNotice(err.message);
    }
  }

  async function handleAddDailyResult(offer, count, customDate) {
    if (!guardWrite()) return;
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
    if (!guardWrite()) return;
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
    const res = await api.createTab({ name: tabName });
    setTabs((prev) => [...prev, res.tab]);
    setActiveTabId(res.tab.id);
    setOffers([]);
    setHasMoreOffers(false);
    setIsTabModalOpen(false);
    setFeedbackNotice(res.message);
  }

  async function handleRenameTab(tabId, newName) {
    if (!guardWrite()) return;
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
    if (!guardWrite()) return;
    if (!activeTabId) {
      setFeedbackNotice('Crie ou selecione uma tab antes de compartilhar.');
      return;
    }
    setIsSharing(true);
    try {
      const res = await api.createShareLink(activeTabId);
      const shareUrl = `${window.location.origin}/#share=${res.token}`;
      try {
        await navigator.clipboard.writeText(shareUrl);
        setFeedbackNotice('Link público copiado para a área de transferência! Quem receber poderá apenas visualizar (o link vale por 30 dias).');
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

  async function handleExportBackup() {
    try {
      const jsonStr = await api.exportData();
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `minerai_backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setFeedbackNotice('Backup do acervo exportado com sucesso!');
    } catch (err) {
      setFeedbackNotice(err.message || 'Erro ao exportar backup.');
    }
  }

  async function handleImportBackup(jsonText) {
    if (!guardWrite()) return;
    try {
      const res = await api.importData(jsonText);
      setFeedbackNotice(
        `Backup restaurado com sucesso! (${res.tabs.length} tabs e ${res.offers.length} ofertas)`
      );
      await loadTabs();
      await loadOffers();
    } catch (e) {
      setFeedbackNotice(`Erro na importação: ${e.message}`);
    }
  }

  async function handleLogout() {
    await api.logout();
    setCurrentUser(null);
  }

  // 0. Link de redefinição de senha
  if (recoveryMode) {
    return (
      <ResetPasswordPage
        onDone={() => {
          setRecoveryMode(false);
          api.me().then((res) => setCurrentUser(res.user || null)).catch(() => setCurrentUser(null));
        }}
      />
    );
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

  // 3.1 Sem plano ativo no modo bloqueio total
  if (locked && LOCK_MODE === 'block') {
    return (
      <div className="public-state">
        <Brand />
        <h2>Plano inativo.</h2>
        <p>{lockedMessage(currentUser)}</p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20 }}>
          <button className="secondary" onClick={handleExportBackup}>Exportar meu acervo</button>
          <button className="secondary" onClick={handleLogout}>Sair da conta</button>
        </div>
      </div>
    );
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
        onOpenExtension={() => setIsExtensionModalOpen(true)}
      />

      <section className="hero">
        <p className="eyebrow">GARIMPAGEM DE OFERTAS DE ALTA PERFORMANCE</p>
        <h1>
          Garimpos que <br />
          rendem <em>ouro.</em>
        </h1>
      </section>

      {locked && (
        <p className="error" role="status">
          {lockedMessage(currentUser)} Seu acervo continua disponível para consulta e exportação.
        </p>
      )}

      {/* Metrics Bar */}
      <MetricsBar offers={offers} tabName={activeTab?.name} />

      {/* Tabs */}
      <Tabs
        tabs={tabs}
        activeTabId={activeTabId}
        currentOffersCount={hasMoreOffers ? activeTab?.offers_count || offers.length : offers.length}
        onSelectTab={(id) => setActiveTabId(id)}
        onNewTab={() => setIsTabModalOpen(true)}
        onRenameTab={handleRenameTab}
        onDeleteTab={handleDeleteTab}
        locked={locked}
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
        onNewOffer={() => guardWrite() && setEditingOffer(null)}
        onOpenExtension={() => setIsExtensionModalOpen(true)}
        onOpenModelar={() => setIsModelarOpen(true)}
        availableNiches={availableNiches}
        locked={locked}
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
            locked={locked}
            onEdit={(target) => guardWrite() && setEditingOffer(target)}
            onDelete={handleDeleteOffer}
            onDuplicate={handleDuplicateOffer}
            onAddResult={(target) => guardWrite() && setResultTargetOffer(target)}
            onOpenHistory={(target) => setHistoryTargetOffer(target)}
          />
        ))}
      </section>

      {hasMoreOffers && (
        <div className="empty" style={{ paddingTop: 0 }}>
          <button className="secondary" onClick={loadMoreOffers} disabled={loadingMore}>
            {loadingMore ? 'Carregando...' : `Carregar mais ofertas (${offers.length} de ${activeTab?.offers_count || '…'})`}
          </button>
        </div>
      )}

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
      {isModelarOpen && <ModelarModal onClose={() => setIsModelarOpen(false)} />}

      {isExtensionModalOpen && (
        <ExtensionModal
          onClose={() => setIsExtensionModalOpen(false)}
        />
      )}

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
          readOnly={locked}
          onClose={() => setHistoryTargetOffer(null)}
          onAddResult={handleAddDailyResult}
          onDeleteEntry={handleDeleteHistoryEntry}
        />
      )}
    </main>
  );
}
