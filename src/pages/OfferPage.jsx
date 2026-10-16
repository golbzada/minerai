import React, { useEffect, useMemo, useState } from 'react';
import Chart from '../components/Chart';
import { resumoDaEvolucao } from '../utils/evolucao';
import StarRating from '../components/StarRating';
import StageBadge from '../components/StageBadge';
import TagEditor from '../components/TagEditor';
import OfferModal from '../components/OfferModal';
import { api } from '../services/api';
import { useAppData } from '../context/AppData';
import { navigate } from '../router';
import { STATUS_CONFIG } from '../utils/metaParser';
import { normalizeHistory, resolveRunningDays, resolvePageActiveAds, resolveStatus, todayIso, decodeNotes } from '../utils/offerMeta';
import { safeHttpUrl, safeImageSrc, safeCreativeThumb } from '../utils/url';
import { STAGES, CHECKLIST_ITEMS, getExtras, allTags, offerMeta, withMetaPatch } from '../utils/offerExtras';
import { getAccess, lockedMessage } from '../utils/plan';
import { brasilDaOferta, textoBrasil, resumoCurtoBrasil } from '../utils/gringa';

/**
 * Página própria da oferta: criativo grande, resumo editável (favorito, nota,
 * coluna da esteira, etiquetas), links, anotações, checklist de análise,
 * histórico de medições, linha do tempo e comparação lado a lado.
 */
export default function OfferPage({ id }) {
  const data = useAppData();
  const { offers, user, setNotice, applyOffer, removeOffers, tabs } = data;
  const offer = offers.find((o) => o.id === id);

  const access = getAccess(user);
  const locked = Boolean(user) && !access.active;

  const [notes, setNotes] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [compareId, setCompareId] = useState('');
  const [newDate, setNewDate] = useState(todayIso());
  const [newCount, setNewCount] = useState('');

  useEffect(() => {
    if (offer) {
      if (!notesDirty) setNotes(offer.notes ?? decodeNotes(offer.funnel_notes).notes ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer?.id, offer?.funnel_notes]);

  const tagSuggestions = useMemo(() => allTags(offers), [offers]);

  if (!offer) {
    return (
      <div className="empty">
        {data.loading ? 'Carregando a oferta...' : 'Esta oferta não está no seu acervo (pode ter sido excluída).'}
        <br />
        <button className="secondary" style={{ marginTop: 12 }} onClick={() => navigate('/garimpo')}>Voltar ao Garimpo</button>
      </div>
    );
  }

  const extras = getExtras(offer);
  const meta = offerMeta(offer);
  const days = resolveRunningDays(offer);
  const history = normalizeHistory(offer.history);
  const creative = safeCreativeThumb(offer.creative_thumb);
  const avatar = safeImageSrc(offer.avatar_url);
  const libraryUrl = safeHttpUrl(offer.library_url);
  const salesUrl = safeHttpUrl(offer.landing_page || offer.destination_url);
  // Página do Facebook (quem anuncia) é uma coisa; página de vendas é outra.
  const fbPageName = typeof meta.page_name === 'string' ? meta.page_name.trim() : '';
  const fbPageId = offer.page_id && offer.page_id !== 'N/A' && offer.page_id !== '4' ? offer.page_id : '';
  const fbPageUrl = safeHttpUrl(meta.page_url) || (fbPageId ? `https://www.facebook.com/${fbPageId}` : null);
  const affiliateUrl = safeHttpUrl(offer.affiliate_link);
  const tab = tabs.find((t) => t.id === offer.tab_id);
  const compareOffer = offers.find((o) => o.id === compareId);

  function guardWrite() {
    if (!locked) return true;
    setNotice(lockedMessage(user));
    return false;
  }

  async function patch(patchMeta, options) {
    if (!guardWrite()) return;
    const before = offer;
    // A tela muda na hora; se o banco recusar, volta como estava.
    if (patchMeta && Object.keys(patchMeta).length) applyOffer(withMetaPatch(offer, patchMeta));
    setSaving(true);
    try {
      const res = await api.patchOfferMeta(offer.id, patchMeta, options);
      applyOffer(res.offer);
      return res.offer;
    } catch (err) {
      applyOffer(before);
      setNotice(err.message);
    } finally {
      setSaving(false);
    }
    return null;
  }

  async function saveNotes() {
    const saved = await patch({}, { notes });
    if (saved) {
      setNotesDirty(false);
      setNotice('Anotações salvas.');
    }
  }

  async function addMeasurement(e) {
    e.preventDefault();
    if (!guardWrite()) return;
    if (newCount === '') return;
    try {
      const res = await api.addDailyResult(offer.id, Number(newCount), newDate);
      applyOffer(res.offer);
      setNotice(res.message);
      setNewCount('');
    } catch (err) {
      setNotice(err.message);
    }
  }

  async function deleteMeasurement(date) {
    if (!guardWrite()) return;
    if (!window.confirm(`Remover medição do dia ${date}?`)) return;
    try {
      const res = await api.deleteHistoryEntry(offer.id, date);
      applyOffer(res.offer);
      setNotice(res.message);
    } catch (err) {
      setNotice(err.message);
    }
  }

  async function handleDelete() {
    if (!guardWrite()) return;
    if (!window.confirm(`Excluir a oferta "${offer.name}"?`)) return;
    try {
      await api.deleteOffer(offer.id);
      removeOffers([offer.id]);
      setNotice('Oferta excluída.');
      navigate('/garimpo');
    } catch (err) {
      setNotice(err.message);
    }
  }

  async function handleDuplicate() {
    if (!guardWrite()) return;
    try {
      const res = await api.duplicateOffer(offer.id, offer.tab_id);
      applyOffer(res.offer);
      setNotice('Oferta duplicada. Abrindo a cópia.');
      navigate(`/oferta/${res.offer.id}`);
    } catch (err) {
      setNotice(err.message);
    }
  }

  async function handleSaveEdit(offerData) {
    const res = await api.updateOffer(offer.id, offerData);
    applyOffer(res.offer);
    setNotice(res.message);
  }

  function copyLink(url, label) {
    navigator.clipboard.writeText(url).then(
      () => setNotice(`${label} copiado.`),
      () => window.prompt('Copie o link:', url)
    );
  }

  function toggleCheck(key) {
    const next = { ...extras.checklist, [key]: !extras.checklist[key] };
    patch({ checklist: next });
  }

  const checklistDone = CHECKLIST_ITEMS.filter((i) => extras.checklist[i.key]).length;

  // Linha do tempo: criação, captura, medições e modelagens, mais recente primeiro.
  const timeline = [
    { date: offer.created_at, label: 'Garimpada no painel' },
    meta.captured_at ? { date: meta.captured_at, label: 'Capturada pela extensão' } : null,
    ...history.map((h) => ({ date: `${h.date}T12:00:00`, label: `Medição: ${h.count} anúncios` })),
    ...extras.modelagens.map((m) => ({ date: m.date, label: `Página modelada: ${m.url}` }))
  ]
    .filter((t) => t && t.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 30);

  const fmtDate = (d) => {
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString('pt-BR');
  };

  return (
    <div className="offer-page">
      <div className="page-head">
        <button type="button" className="back-link" onClick={() => navigate('/garimpo')}>← Voltar ao Garimpo</button>
        <div className="page-head-actions">
          {salesUrl && (
            <button type="button" className="secondary" onClick={() => navigate(`/modelar?url=${encodeURIComponent(salesUrl)}&offer=${offer.id}`)} title="Capturar a página de vendas para modelar">
              📐 Modelar página
            </button>
          )}
          {libraryUrl && <a className="secondary btn-link" href={libraryUrl} target="_blank" rel="noopener noreferrer">↗ Biblioteca</a>}
          {!locked && <button type="button" className="primary" onClick={() => setEditing(true)}>✎ Editar</button>}
        </div>
      </div>

      <div className="offer-grid">
        {/* Coluna da esquerda: criativo e links */}
        <div className="offer-side">
          <div className="panel offer-creative">
            {creative ? (
              <img src={creative} alt={`Criativo de ${offer.name}`} />
            ) : avatar ? (
              <img src={avatar} alt={`Anunciante ${offer.name}`} className="avatar-only" />
            ) : (
              <div className="creative-empty">Sem criativo salvo. Minere de novo pela extensão para guardar a imagem.</div>
            )}
          </div>

          <div className="panel">
            <p className="eyebrow">Links</p>
            <ul className="link-list">
              <li>
                <span>Biblioteca de Anúncios</span>
                {libraryUrl ? <a href={libraryUrl} target="_blank" rel="noopener noreferrer">abrir</a> : <em>não informado</em>}
                {libraryUrl && <button type="button" className="mini-btn" onClick={() => copyLink(libraryUrl, 'Link da biblioteca')}>copiar</button>}
              </li>
              <li>
                <span>Página do Facebook</span>
                {fbPageUrl ? <a href={fbPageUrl} target="_blank" rel="noopener noreferrer" title={fbPageName || fbPageUrl}>abrir</a> : <em>não informada</em>}
                {fbPageUrl && <button type="button" className="mini-btn" onClick={() => copyLink(fbPageUrl, 'Link da página do Facebook')}>copiar</button>}
              </li>
              <li>
                <span>Página de vendas</span>
                {salesUrl ? <a href={salesUrl} target="_blank" rel="noopener noreferrer">abrir</a> : <em>não informada</em>}
                {salesUrl && <button type="button" className="mini-btn" onClick={() => copyLink(salesUrl, 'Link da página')}>copiar</button>}
              </li>
              <li>
                <span>Link de afiliado</span>
                {affiliateUrl ? <a href={affiliateUrl} target="_blank" rel="noopener noreferrer">abrir</a> : <em>não informado</em>}
              </li>
              <li>
                <span>ID da página do Facebook</span>
                <code>{offer.page_id && offer.page_id !== '4' ? offer.page_id : '—'}</code>
              </li>
              {meta.library_id && (
                <li>
                  <span>ID do anúncio</span>
                  <code>{meta.library_id}</code>
                </li>
              )}
            </ul>
          </div>

          <div className="panel">
            <p className="eyebrow">Ações</p>
            <div className="action-stack">
              <button type="button" className="secondary" onClick={() => copyLink(`${window.location.origin}/oferta/${offer.id}`, 'Link da oferta no painel')}>🔗 Copiar link desta página</button>
              {!locked && <button type="button" className="secondary" onClick={handleDuplicate}>⧉ Duplicar oferta</button>}
              {!locked && <button type="button" className="secondary danger-text" onClick={handleDelete}>🗑 Excluir oferta</button>}
            </div>
          </div>
        </div>

        {/* Coluna principal */}
        <div className="offer-main">
          <div className="panel">
            <div className="offer-title-row">
              <div>
                <p className="eyebrow">{tab ? `Tab ${tab.name}` : 'Oferta'} · {offer.niche}</p>
                <h1 className="offer-title">{offer.name}</h1>
                {fbPageName && fbPageName.toLowerCase() !== (offer.name || '').trim().toLowerCase() && (
                  <p className="offer-page-name">Anunciado pela página <strong>{fbPageName}</strong></p>
                )}
              </div>
              {!locked && (
                <button type="button" className={`fav-btn big ${extras.fav ? 'active' : ''}`} onClick={() => patch({ fav: extras.fav ? null : true })} title={extras.fav ? 'Tirar das favoritas' : 'Favoritar'}>
                  {extras.fav ? '★' : '☆'}
                </button>
              )}
            </div>

            <div className="offer-stats">
              <div><small>Status</small><StageBadge offer={offer} /></div>
              <div><small>Dias rodando</small><strong>{days}</strong></div>
              <div><small>Anúncios ativos</small><strong>{offer.ads_count ?? 0}</strong></div>
              {textoBrasil(brasilDaOferta(offer)) && (
                <div title={`${textoBrasil(brasilDaOferta(offer)).texto}. Conferido pelo rastreio uma vez por semana.`}>
                  <small>No Brasil</small>
                  <strong className={textoBrasil(brasilDaOferta(offer)).janela ? 'brasil-janela' : ''}>
                    {resumoCurtoBrasil(brasilDaOferta(offer))}
                  </strong>
                </div>
              )}
              {resolvePageActiveAds(offer) && (
                <div title="Total de anúncios ativos do anunciante, lido quando a oferta foi minerada">
                  <small>Do anunciante</small><strong>{resolvePageActiveAds(offer)}</strong>
                </div>
              )}
              <div><small>Medições</small><strong>{history.length}</strong></div>
              {meta.start_date && <div><small>Início</small><strong>{fmtDate(`${meta.start_date}T12:00:00`)}</strong></div>}
            </div>

            <div className="offer-controls">
              <label>
                <span>Nota</span>
                <StarRating value={extras.rating} onChange={(n) => patch({ rating: n || null })} size="md" readOnly={locked} />
              </label>
              <label>
                <span>Coluna da esteira</span>
                <select value={extras.stage} disabled={locked} onChange={(e) => patch({ stage: e.target.value })}>
                  {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
            </div>

            <div className="offer-controls-full">
              <span className="label">Etiquetas</span>
              {locked ? (
                <div className="tag-list">{extras.tags.map((t) => <span key={t} className="tag-chip">{t}</span>)}</div>
              ) : (
                <TagEditor tags={extras.tags} suggestions={tagSuggestions} onChange={(tags) => patch({ tags: tags.length ? tags : null })} />
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <p className="eyebrow">Anotações de espionagem</p>
              {!locked && (
                <button type="button" className="mini-btn" disabled={!notesDirty || saving} onClick={saveNotes}>
                  {saving ? 'Salvando...' : notesDirty ? 'Salvar anotações' : 'Salvo'}
                </button>
              )}
            </div>
            <textarea
              className="notes-area"
              value={notes}
              maxLength={9000}
              disabled={locked}
              placeholder="Hook, promessa, preço, upsell, o que você aprendeu com esta oferta..."
              onChange={(e) => {
                setNotes(e.target.value);
                setNotesDirty(true);
              }}
            />
          </div>

          <div className="panel">
            <div className="panel-head">
              <p className="eyebrow">Checklist de análise</p>
              <span className="muted">{checklistDone} de {CHECKLIST_ITEMS.length}</span>
            </div>
            <div className="progress"><span style={{ width: `${(checklistDone / CHECKLIST_ITEMS.length) * 100}%` }} /></div>
            <ul className="checklist">
              {CHECKLIST_ITEMS.map((item) => (
                <li key={item.key}>
                  <label>
                    <input type="checkbox" checked={Boolean(extras.checklist[item.key])} disabled={locked} onChange={() => toggleCheck(item.key)} />
                    <span>{item.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel">
            <p className="eyebrow">Histórico de medições</p>
            <Chart resumo={resumoDaEvolucao(history.length ? history : [{ date: todayIso(), count: offer.ads_count ?? 0 }])} />
            {!locked && (
              <form className="history-add-box" onSubmit={addMeasurement}>
                <div className="history-inputs">
                  <label className="field-sm"><span>Data</span><input type="date" required value={newDate} onChange={(e) => setNewDate(e.target.value)} /></label>
                  <label className="field-sm"><span>Anúncios ativos</span><input type="number" min="0" required placeholder="Ex: 50" value={newCount} onChange={(e) => setNewCount(e.target.value)} /></label>
                </div>
                <button className="primary" type="submit">+ Salvar medição</button>
              </form>
            )}
            <div className="history-table-wrap">
              <table className="history-table">
                <thead><tr><th>Data</th><th>Anúncios</th><th>Variação</th><th /></tr></thead>
                <tbody>
                  {[...history].reverse().map((item, idx, arr) => {
                    const prev = arr[idx + 1];
                    const diff = prev ? item.count - prev.count : 0;
                    return (
                      <tr key={item.date}>
                        <td><strong>{fmtDate(`${item.date}T12:00:00`)}</strong></td>
                        <td><span className="ads-pill">{item.count} ads</span></td>
                        <td>{!prev ? <span className="growth-neutral">Inicial</span> : diff > 0 ? <span className="growth-up">+{diff} 📈</span> : diff < 0 ? <span className="growth-down">{diff} 📉</span> : <span className="growth-neutral">Estável</span>}</td>
                        <td style={{ textAlign: 'right' }}>{!locked && <button type="button" className="delete-entry-btn" onClick={() => deleteMeasurement(item.date)} title="Excluir medição">🗑️</button>}</td>
                      </tr>
                    );
                  })}
                  {!history.length && <tr><td colSpan="4" style={{ textAlign: 'center', padding: 16 }}>Nenhuma medição ainda.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <p className="eyebrow">Comparar com outra oferta</p>
              <select value={compareId} onChange={(e) => setCompareId(e.target.value)}>
                <option value="">Escolher oferta...</option>
                {offers.filter((o) => o.id !== offer.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            {compareOffer && <CompareTable a={offer} b={compareOffer} />}
            {!compareOffer && <p className="muted">Escolha uma oferta para ver as duas lado a lado.</p>}
          </div>

          <div className="panel">
            <p className="eyebrow">Linha do tempo</p>
            <ul className="timeline">
              {timeline.map((t, i) => (
                <li key={`${t.date}-${i}`}>
                  <span className="tl-date">{fmtDate(t.date)}</span>
                  <span className="tl-label">{t.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {editing && <OfferModal offer={offer} nicheSuggestions={offers.map((o) => o.niche)} onClose={() => setEditing(false)} onSave={handleSaveEdit} />}
    </div>
  );
}

function CompareTable({ a, b }) {
  const rows = [
    ['Nicho', (o) => o.niche],
    ['Status', (o) => STATUS_CONFIG[resolveStatus(o)]?.label || resolveStatus(o)],
    ['Dias no ar', (o) => resolveRunningDays(o)],
    ['Anúncios ativos', (o) => o.ads_count ?? 0],
    ['Medições', (o) => normalizeHistory(o.history).length],
    ['Nota', (o) => '★'.repeat(getExtras(o).rating) || '—'],
    ['Coluna', (o) => STAGES.find((s) => s.key === getExtras(o).stage)?.label],
    ['Etiquetas', (o) => getExtras(o).tags.join(', ') || '—'],
    ['Página de vendas', (o) => safeHttpUrl(o.landing_page || o.destination_url) || '—']
  ];
  const thumb = (o) => safeCreativeThumb(o.creative_thumb) || safeImageSrc(o.avatar_url);
  return (
    <div className="compare-wrap">
      <table className="compare-table">
        <thead>
          <tr>
            <th />
            <th>{thumb(a) && <img src={thumb(a)} alt="" />}<span>{a.name}</span></th>
            <th>{thumb(b) && <img src={thumb(b)} alt="" />}<span>{b.name}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, fn]) => (
            <tr key={label}><td>{label}</td><td>{String(fn(a))}</td><td>{String(fn(b))}</td></tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="mini-btn" onClick={() => navigate(`/oferta/${b.id}`)}>Abrir {b.name}</button>
    </div>
  );
}
