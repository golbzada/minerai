import React, { useEffect, useMemo, useState } from 'react';
import PageGuide from '../components/PageGuide';
import MetricsBar from '../components/MetricsBar';
import Tabs from '../components/Tabs';
import Toolbar, { GarimpoActions } from '../components/Toolbar';
import OfferCard from '../components/OfferCard';
import OfferModal from '../components/OfferModal';
import ResultModal from '../components/ResultModal';
import HistoryModal from '../components/HistoryModal';
import TabModal from '../components/TabModal';
import OfferListTable from '../components/OfferListTable';
import BulkBar from '../components/BulkBar';
import Icon from '../components/Icons';
import { api } from '../services/api';
import { useAppData } from '../context/AppData';
import { navigate } from '../router';
import { resolveStatus } from '../utils/offerMeta';
import { NICHE_OPTIONS } from '../utils/metaParser';
import { getAccess, lockedMessage } from '../utils/plan';
import { allTags, getExtras, offersToCsv, downloadText, withMetaPatch } from '../utils/offerExtras';

const VIEW_KEY = 'minerai_garimpo_view';

/**
 * Página principal: o acervo da tab ativa em cards ou lista, com favoritas,
 * notas, etiquetas, seleção em lote e duplicadas. O funil das favoritas mora
 * em Favoritos; extensão e Modelar ficam no menu lateral.
 */
export default function GarimpoPage({ query, onExport }) {
  const data = useAppData();
  const { user, tabs, offers, activeTabId, setActiveTabId, setNotice, refresh, applyOffer, removeOffers, duplicates } = data;

  const access = getAccess(user);
  const locked = Boolean(user) && !access.active;

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState(() => query?.get('q') || '');
  const [statusFilter, setStatusFilter] = useState('all');
  const [nicheFilter, setNicheFilter] = useState('all');
  const [minAdsFilter, setMinAdsFilter] = useState('0');
  const [sortBy, setSortBy] = useState('recent');
  const [onlyFav, setOnlyFav] = useState(false);
  const [tagFilter, setTagFilter] = useState('all');
  const [view, setView] = useState(() => {
    try {
      // "esteira" saiu: o funil agora é a página Favoritos.
      return localStorage.getItem(VIEW_KEY) === 'lista' ? 'lista' : 'cards';
    } catch (e) {
      return 'cards';
    }
  });

  // Seleção em lote
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Modals state
  const [editingOffer, setEditingOffer] = useState(undefined);
  const [resultTargetOffer, setResultTargetOffer] = useState(null);
  const [historyTargetOffer, setHistoryTargetOffer] = useState(null);
  const [isTabModalOpen, setIsTabModalOpen] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  // A busca global do menu chega pela URL (?q=).
  useEffect(() => {
    const q = query?.get('q');
    if (q != null) setSearchQuery(q);
  }, [query]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch (e) {}
  }, [view]);

  // Limpa a seleção ao trocar de tab.
  useEffect(() => {
    setSelected(new Set());
  }, [activeTabId]);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const tabOffers = useMemo(() => offers.filter((o) => o.tab_id === activeTabId), [offers, activeTabId]);
  const tagSuggestions = useMemo(() => allTags(offers), [offers]);

  const visibleOffers = useMemo(() => {
    let result = [...tabOffers];

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((o) => {
        const x = getExtras(o);
        const landing = o.landing_page || o.destination_url || '';
        return `${o.name} ${o.page_id || ''} ${o.niche || ''} ${o.notes || ''} ${landing} ${x.tags.join(' ')}`
          .toLowerCase()
          .includes(q);
      });
    }

    if (statusFilter !== 'all') result = result.filter((o) => resolveStatus(o) === statusFilter);
    if (nicheFilter !== 'all') result = result.filter((o) => o.niche === nicheFilter);
    if (onlyFav) result = result.filter((o) => getExtras(o).fav);
    if (tagFilter !== 'all') result = result.filter((o) => getExtras(o).tags.includes(tagFilter));

    const minAds = Number(minAdsFilter) || 0;
    if (minAds > 0) result = result.filter((o) => (Number(o.ads_count) || 0) >= minAds);

    result.sort((a, b) => {
      if (sortBy === 'oldest') return new Date(a.created_at || 0) - new Date(b.created_at || 0);
      if (sortBy === 'most_ads') return (Number(b.ads_count) || 0) - (Number(a.ads_count) || 0);
      if (sortBy === 'least_ads') return (Number(a.ads_count) || 0) - (Number(b.ads_count) || 0);
      if (sortBy === 'running_days') return (Number(b.running_days) || 0) - (Number(a.running_days) || 0);
      if (sortBy === 'rating') return getExtras(b).rating - getExtras(a).rating;
      if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '');
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });

    return result;
  }, [tabOffers, searchQuery, statusFilter, nicheFilter, minAdsFilter, sortBy, onlyFav, tagFilter]);

  const availableNiches = useMemo(() => {
    const used = offers.map((o) => o.niche).filter(Boolean);
    return Array.from(new Set([...NICHE_OPTIONS, ...used]));
  }, [offers]);

  const filtersActive =
    Boolean(searchQuery.trim()) || statusFilter !== 'all' || nicheFilter !== 'all' || minAdsFilter !== '0' || onlyFav || tagFilter !== 'all';

  function clearFilters() {
    setSearchQuery('');
    setStatusFilter('all');
    setNicheFilter('all');
    setMinAdsFilter('0');
    setOnlyFav(false);
    setTagFilter('all');
  }

  function guardWrite() {
    if (!locked) return true;
    setNotice(lockedMessage(user));
    return false;
  }

  function openOffer(offer) {
    navigate(`/oferta/${offer.id}`);
  }

  // ---------------------------------------------------------------------------
  // Ações por oferta
  // ---------------------------------------------------------------------------
  async function handleSaveOffer(offerData) {
    const payload = editingOffer ? offerData : { ...offerData, tab_id: activeTabId };
    const res = editingOffer
      ? await api.updateOffer(editingOffer.id, payload)
      : await api.createOffer(payload);
    setNotice(res.message);
    applyOffer(res.offer);
  }

  async function handleDeleteOffer(offer) {
    if (!window.confirm(`Deseja realmente excluir a oferta "${offer.name}"?`)) return;
    try {
      const res = await api.deleteOffer(offer.id);
      setNotice(res.message);
      removeOffers([offer.id]);
    } catch (err) {
      setNotice(err.message);
    }
  }

  async function handleDuplicateOffer(offer) {
    if (!guardWrite()) return;
    try {
      const res = await api.duplicateOffer(offer.id, activeTabId);
      setNotice(`Oferta "${offer.name}" duplicada!`);
      applyOffer(res.offer);
    } catch (err) {
      setNotice(err.message);
    }
  }

  async function handleAddDailyResult(offer, count, customDate) {
    if (!guardWrite()) return;
    try {
      const res = await api.addDailyResult(offer.id, count, customDate);
      setNotice(res.message);
      applyOffer(res.offer);
      if (historyTargetOffer && historyTargetOffer.id === offer.id) setHistoryTargetOffer(res.offer);
    } catch (err) {
      setNotice(err.message);
    }
  }

  async function handleDeleteHistoryEntry(offerId, date) {
    if (!guardWrite()) return;
    try {
      const res = await api.deleteHistoryEntry(offerId, date);
      setNotice(res.message);
      applyOffer(res.offer);
      if (historyTargetOffer && historyTargetOffer.id === offerId) setHistoryTargetOffer(res.offer);
    } catch (err) {
      setNotice(err.message);
    }
  }

  async function handleToggleFav(offer) {
    if (!guardWrite()) return;
    const fav = !getExtras(offer).fav;
    try {
      const res = await api.patchOfferMeta(offer.id, { fav: fav ? true : null });
      applyOffer(res.offer);
    } catch (err) {
      setNotice(err.message);
    }
  }

  async function handleRate(offer, rating) {
    if (!guardWrite()) return;
    const patch = { rating: rating || null };
    applyOffer(withMetaPatch(offer, patch));
    try {
      const res = await api.patchOfferMeta(offer.id, patch);
      applyOffer(res.offer);
    } catch (err) {
      applyOffer(offer);
      setNotice(err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------
  async function handleCreateTab(tabName) {
    const res = await api.createTab({ name: tabName });
    data.setTabs((prev) => [...prev, res.tab]);
    setActiveTabId(res.tab.id);
    setIsTabModalOpen(false);
    setNotice(res.message);
  }

  async function handleRenameTab(tabId, newName) {
    if (!guardWrite()) return;
    try {
      const res = await api.updateTab(tabId, newName);
      setNotice(res.message);
      data.setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, name: res.tab.name } : t)));
    } catch (err) {
      setNotice(err.message);
    }
  }

  async function handleDeleteTab(tabId) {
    try {
      const res = await api.deleteTab(tabId);
      setNotice(res.message);
      setActiveTabId(res.nextTabId);
      await refresh();
    } catch (err) {
      setNotice(err.message);
    }
  }

  async function handleShareTab() {
    if (!guardWrite()) return;
    if (!activeTabId) {
      setNotice('Crie ou selecione uma tab antes de compartilhar.');
      return;
    }
    setIsSharing(true);
    try {
      const res = await api.createShareLink(activeTabId);
      const shareUrl = `${window.location.origin}/#share=${res.token}`;
      try {
        await navigator.clipboard.writeText(shareUrl);
        setNotice('Link público copiado! Quem receber poderá apenas visualizar (vale por 30 dias). Gerencie em Compartilhar.');
      } catch {
        window.prompt('Copie o link público abaixo:', shareUrl);
        setNotice('Link público gerado!');
      }
    } catch (err) {
      setNotice(err.message);
    } finally {
      setIsSharing(false);
    }
  }

  async function handleImportBackup(jsonText) {
    if (!guardWrite()) return;
    try {
      const res = await api.importData(jsonText);
      setNotice(`Backup restaurado com sucesso! (${res.tabs.length} tabs e ${res.offers.length} ofertas)`);
      await refresh();
    } catch (e) {
      setNotice(`Erro na importação: ${e.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Seleção em lote
  // ---------------------------------------------------------------------------
  function toggleSelected(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedIds = Array.from(selected);
  const selectedOffers = offers.filter((o) => selected.has(o.id));

  async function runBulk(label, fn) {
    if (!guardWrite()) return;
    setBulkBusy(true);
    try {
      await fn();
      setNotice(`${label} em ${selectedIds.length} ${selectedIds.length === 1 ? 'oferta' : 'ofertas'}.`);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBulkBusy(false);
    }
  }

  const bulkMoveTab = (tabId) => runBulk('Tab alterada', async () => {
    await api.updateOffersBulk(selectedIds, { tab_id: tabId });
    await refresh();
    setSelected(new Set());
  });

  const bulkStatus = (status) => runBulk('Status alterado', async () => {
    await api.updateOffersBulk(selectedIds, { status });
    const res = await api.patchOffersMeta(selectedIds, { status_manual: true });
    res.offers.forEach(applyOffer);
  });

  const bulkTag = (tag) => runBulk(`Etiqueta "${tag}" aplicada`, async () => {
    for (const o of selectedOffers) {
      const tags = getExtras(o).tags;
      if (tags.includes(tag)) continue;
      const res = await api.patchOfferMeta(o.id, { tags: [...tags, tag].slice(0, 12) });
      applyOffer(res.offer);
    }
  });

  const bulkDelete = () => {
    if (!window.confirm(`Excluir ${selectedIds.length} ofertas? Esta ação não pode ser desfeita.`)) return;
    runBulk('Exclusão feita', async () => {
      await api.deleteOffers(selectedIds);
      removeOffers(selectedIds);
      setSelected(new Set());
    });
  };

  function handleCsvTab() {
    const name = (activeTab?.name || 'tab').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    downloadText(`minerai_${name}_${new Date().toISOString().slice(0, 10)}.csv`, offersToCsv(tabOffers), 'text/csv;charset=utf-8');
    setNotice('Planilha da tab baixada.');
  }

  const bulkCsv = () => {
    downloadText(`minerai_selecao_${new Date().toISOString().slice(0, 10)}.csv`, offersToCsv(selectedOffers), 'text/csv;charset=utf-8');
    setNotice('CSV da seleção exportado.');
  };

  return (
    <>
      <section className="hero">
        <p className="eyebrow">GARIMPAGEM DE OFERTAS DE ALTA PERFORMANCE</p>
        <h1>
          Garimpos que <br />
          rendem <em>ouro.</em>
        </h1>
      </section>

      <PageGuide
        id="garimpo"
        why="Aqui fica todo o seu acervo: cada oferta que você salvou da Biblioteca de Anúncios da Meta."
        steps={[
            <>Instale a extensão (menu <strong>Extensão</strong>), abra a Biblioteca de Anúncios e clique em <strong>Minerar oferta</strong> no anúncio que chamou atenção. Ele aparece aqui.</>,
            <>Separe por assunto com as <strong>tabs</strong> (ex.: Emagrecimento, Gringa) e use os filtros para achar rápido.</>,
            <>Todo dia, clique em <strong>+ Hoje</strong> no card para anotar quantos anúncios a oferta tem. É assim que você vê se ela está crescendo.</>,
            <>Clique na <strong>★</strong> das melhores. Elas vão para <strong>Favoritos</strong>, onde você monta o seu funil.</>
        ]}
      />

      <MetricsBar offers={tabOffers} tabName={activeTab?.name} />

      <div className="gtabs-row">
        <Tabs
          tabs={tabs}
          activeTabId={activeTabId}
          currentOffersCount={tabOffers.length}
          onSelectTab={(id) => setActiveTabId(id)}
          onNewTab={() => setIsTabModalOpen(true)}
          onRenameTab={handleRenameTab}
          onDeleteTab={handleDeleteTab}
          locked={locked}
        />
        <GarimpoActions
          onShare={handleShareTab}
          isSharing={isSharing}
          onCsv={handleCsvTab}
          onExport={onExport}
          onImport={handleImportBackup}
          onNewOffer={() => guardWrite() && setEditingOffer(null)}
          locked={locked}
        />
      </div>

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
        availableNiches={availableNiches}
      />

      {/* Visão, favoritas, etiqueta, seleção e contagem */}
      <div className="gresults">
        <div className="gview" role="tablist" aria-label="Modo de visualização">
          {[['cards', 'grade', 'Cards'], ['lista', 'lista', 'Lista']].map(([key, icon, label]) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>
              <Icon name={icon} size={15} /> {label}
            </button>
          ))}
        </div>

        <button type="button" className={`gchip ${onlyFav ? 'active' : ''}`} onClick={() => setOnlyFav((v) => !v)} aria-pressed={onlyFav}>
          <Icon name="estrela" size={14} /> Só favoritas
        </button>

        {tagSuggestions.length > 0 && (
          <select className="gchip-select" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} aria-label="Filtrar por etiqueta">
            <option value="all">Todas as etiquetas</option>
            {tagSuggestions.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}

        {!locked && (
          <button
            type="button"
            className={`gchip ${selectMode ? 'active' : ''}`}
            aria-pressed={selectMode}
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
            }}
            title="Selecionar várias ofertas para mover, etiquetar, excluir ou exportar"
          >
            <Icon name="selecionar" size={14} /> Selecionar
          </button>
        )}

        <span className="gcount">
          {filtersActive && (
            <button type="button" className="link-inline" onClick={clearFilters}>Limpar filtros</button>
          )}
          {visibleOffers.length === tabOffers.length
            ? `${tabOffers.length} ${tabOffers.length === 1 ? 'oferta' : 'ofertas'}`
            : `${visibleOffers.length} de ${tabOffers.length} ofertas`}
        </span>
      </div>

      {selectMode && selected.size > 0 && (
        <BulkBar
          count={selected.size}
          tabs={tabs.filter((t) => t.id !== activeTabId)}
          tagSuggestions={tagSuggestions}
          busy={bulkBusy}
          onMoveTab={bulkMoveTab}
          onStatus={bulkStatus}
          onAddTag={bulkTag}
          onDelete={bulkDelete}
          onCsv={bulkCsv}
          onClear={() => setSelected(new Set())}
        />
      )}

      {data.loading && !offers.length && <div className="empty">Carregando seu acervo...</div>}

      {view === 'cards' && (
        <section className="board">
          {visibleOffers.map((offer) => (
            <OfferCard
              key={offer.id}
              offer={offer}
              locked={locked}
              selectable={selectMode}
              selected={selected.has(offer.id)}
              onSelect={toggleSelected}
              duplicates={duplicates.get(offer.id) || []}
              onOpen={openOffer}
              onToggleFav={handleToggleFav}
              onRate={handleRate}
              onEdit={(target) => guardWrite() && setEditingOffer(target)}
              onDelete={handleDeleteOffer}
              onDuplicate={handleDuplicateOffer}
              onAddResult={(target) => guardWrite() && setResultTargetOffer(target)}
              onOpenHistory={(target) => setHistoryTargetOffer(target)}
            />
          ))}
        </section>
      )}

      {view === 'lista' && (
        <OfferListTable
          offers={visibleOffers}
          duplicates={duplicates}
          selectable={selectMode}
          selected={selected}
          onSelect={toggleSelected}
          onSelectAll={(ids) => setSelected(new Set(ids))}
          onOpen={openOffer}
          onToggleFav={handleToggleFav}
          onRate={handleRate}
          onEdit={(target) => guardWrite() && setEditingOffer(target)}
          onAddResult={(target) => guardWrite() && setResultTargetOffer(target)}
        />
      )}

      {!visibleOffers.length && !data.loading && view === 'cards' && (
        <div className="empty">
          Nenhuma oferta encontrada com os filtros atuais em <strong>{activeTab?.name || 'esta tab'}</strong>.
          <br />
          <button className="secondary" style={{ marginTop: 12 }} onClick={clearFilters}>
            Limpar filtros
          </button>
        </div>
      )}

      {isTabModalOpen && <TabModal onClose={() => setIsTabModalOpen(false)} onSave={handleCreateTab} />}

      {editingOffer !== undefined && (
        <OfferModal offer={editingOffer} nicheSuggestions={availableNiches} onClose={() => setEditingOffer(undefined)} onSave={handleSaveOffer} />
      )}

      {resultTargetOffer && (
        <ResultModal offer={resultTargetOffer} onClose={() => setResultTargetOffer(null)} onSave={handleAddDailyResult} />
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
    </>
  );
}
