import React, { useState } from 'react';
import Chart from './Chart';
import StarRating from './StarRating';
import StageBadge from './StageBadge';
import { normalizeHistory, resolveRunningDays, decodeNotes, deadSince } from '../utils/offerMeta';
import { safeHttpUrl, safeImageSrc, safeCreativeThumb } from '../utils/url';
import { getExtras, STAGES } from '../utils/offerExtras';
import { brasilDaOferta, textoBrasil } from '../utils/gringa';

export default function OfferCard({
  offer,
  onEdit,
  onDelete,
  onAddResult,
  onOpenHistory,
  onDuplicate,
  onOpen,
  onToggleFav,
  onRate,
  readOnly = false,
  // Plano inativo: o dono vê tudo, mas os botões de escrita somem.
  locked = false,
  // Seleção em lote
  selectable = false,
  selected = false,
  onSelect,
  // Possíveis duplicadas desta oferta: [{ id, name, reason }]
  duplicates = []
}) {
  const [showNotes, setShowNotes] = useState(false);

  const canWrite = !readOnly && !locked;
  const extras = getExtras(offer);
  const stageLabel = STAGES.find((s) => s.key === extras.stage)?.label;

  // Link da biblioteca (o anúncio na Meta) e link da página de vendas são
  // coisas diferentes e ambos precisam ficar acessíveis no card.
  // Tudo que vira href passa por safeHttpUrl: só http/https, nunca javascript:.
  const libraryUrl = safeHttpUrl(offer.library_url || offer.destination_url || offer.landing_page);
  const salesPageUrl = safeHttpUrl(offer.destination_url || offer.landing_page || '');
  const hasSalesPage = Boolean(salesPageUrl) && salesPageUrl !== libraryUrl;

  // Páginas com apelido (facebook.com/lojaxyz) não expõem ID numérico no card.
  const numericPageId =
    offer.page_id && offer.page_id !== 'N/A' && offer.page_id !== '4' && /^\d+$/.test(offer.page_id)
      ? offer.page_id
      : null;
  const pageSlug =
    typeof offer.meta?.page_slug === 'string' && /^[\w.-]{1,80}$/.test(offer.meta.page_slug)
      ? offer.meta.page_slug
      : null;
  const graphKey = numericPageId || pageSlug || null;

  const identificacao = numericPageId
    ? { texto: numericPageId, titulo: `Identificação da página do anunciante na Meta: ${numericPageId}` }
    : pageSlug
      ? { texto: pageSlug, titulo: `A Meta não expôs o número da página; o identificador dela é o apelido "${pageSlug}"` }
      : { texto: '—', titulo: 'A Meta não expôs a identificação da página neste anúncio' };

  const advertiserPhoto =
    safeImageSrc(offer.avatar_url) ||
    safeImageSrc(offer.image_url) ||
    (graphKey ? `https://graph.facebook.com/${encodeURIComponent(graphKey)}/picture?type=large` : null);

  // Só o criativo (data:image/*). A foto do anunciante fica de reserva.
  const mainSources = [safeCreativeThumb(offer.creative_thumb), advertiserPhoto].filter(Boolean);

  const [mainIndex, setMainIndex] = useState(0);
  const mainImage = mainSources[mainIndex] || null;

  const initial = (offer.name || '?').trim().charAt(0).toUpperCase();

  // Página do Facebook (quem anuncia), quando é diferente do nome do produto.
  const pageName = typeof offer.meta?.page_name === 'string' ? offer.meta.page_name.trim() : '';
  const showPageName = pageName && pageName.toLowerCase() !== (offer.name || '').trim().toLowerCase();

  const runningDays = resolveRunningDays(offer);
  const adsCount = offer.ads_count != null ? Number(offer.ads_count) : 1;
  const notesText = offer.notes ?? decodeNotes(offer.funnel_notes).notes;

  let historyList = normalizeHistory(offer.history);

  if (historyList.length === 0) {
    historyList = [{ date: new Date().toISOString().slice(0, 10), count: adsCount }];
  } else if (historyList.length === 1 && historyList[0].count === 0 && adsCount > 0) {
    historyList = [{ ...historyList[0], count: adsCount }];
  }

  const historyCount = historyList.length;

  // Sem link válido a área vira um bloco simples, em vez de um <a> sem href.
  const PhotoWrapper = libraryUrl ? 'a' : 'div';
  const photoProps = libraryUrl
    ? { href: libraryUrl, target: '_blank', rel: 'noopener noreferrer', title: 'Abrir anúncio na Biblioteca de Anúncios da Meta' }
    : { title: 'Esta oferta não tem link da Biblioteca de Anúncios' };

  return (
    <article className={`offer-item ${selected ? 'selected' : ''} ${extras.fav ? 'is-fav' : ''}`}>
      <div className="card">
        {selectable && (
          <label className="select-box" title="Selecionar para ação em lote">
            <input type="checkbox" checked={selected} onChange={() => onSelect && onSelect(offer.id)} aria-label={`Selecionar ${offer.name}`} />
          </label>
        )}

        {!readOnly && onToggleFav && (
          <button
            type="button"
            className={`fav-btn card-fav ${extras.fav ? 'active' : ''}`}
            onClick={() => onToggleFav(offer)}
            title={extras.fav ? 'Tirar das favoritas' : 'Favoritar oferta'}
            aria-label="Favoritar"
          >
            {extras.fav ? '★' : '☆'}
          </button>
        )}

        {canWrite && (
          <button
            className="delete-top"
            onClick={() => onDelete(offer)}
            aria-label="Excluir oferta"
            title="Excluir oferta"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" />
            </svg>
          </button>
        )}

        <PhotoWrapper className="photo" {...photoProps}>
          {mainImage ? (
            <img
              key={mainImage}
              src={mainImage}
              alt={offer.name}
              onError={() => setMainIndex((i) => i + 1)}
            />
          ) : (
            <span className="photo-initial" aria-hidden="true">
              {initial}
            </span>
          )}
        </PhotoWrapper>

        <div className="content">
          <div>
            <div className="badge-row">
              <StageBadge offer={offer} />
              {textoBrasil(brasilDaOferta(offer))?.janela && (
                <span className="janela-tag" title="Escalando lá fora e ninguém roda no Brasil ainda (conferido pelo rastreio)">
                  Janela aberta no Brasil
                </span>
              )}
              {deadSince(offer) && (
                <span className="dead-tag" title="O rastreio diário viu o anunciante sem nenhum anúncio ativo">
                  fora do ar desde {deadSince(offer).slice(8, 10)}/{deadSince(offer).slice(5, 7)}
                </span>
              )}
              {!readOnly && extras.stage !== 'radar' && (
                <span className={`stage-badge stage-${extras.stage}`} title="Coluna na esteira">{stageLabel}</span>
              )}
              {duplicates.length > 0 && (
                <span className="dup-badge" title={`Possível duplicada de:\n${duplicates.map((d) => `• ${d.name} (${d.reason})`).join('\n')}`}>
                  ⚠ duplicada?
                </span>
              )}
            </div>

            {(offer.niche || offer.topic) && (
              <div className="badge-row niche-row">
                {offer.niche && <span className="niche-badge">{offer.niche}</span>}
                {offer.topic && offer.topic !== offer.niche && (
                  <span className="topic-badge" title="Tema identificado no texto do anúncio">
                    {offer.topic}
                  </span>
                )}
              </div>
            )}

            {onOpen ? (
              <h2 title="Abrir a página da oferta">
                <button type="button" className="offer-title-btn" onClick={() => onOpen(offer)}>{offer.name}</button>
              </h2>
            ) : (
              <h2 title={offer.name}>{offer.name}</h2>
            )}
            {showPageName && (
              <p className="card-page-name" title="Página do Facebook que anuncia">por {pageName}</p>
            )}

            {!readOnly && onRate && (
              <div className="card-rating">
                <StarRating value={extras.rating} onChange={(n) => onRate(offer, n)} size="sm" />
              </div>
            )}

            <p className="page-id">
              <span title="Há quanto tempo este anúncio está no ar (conta sozinho todo dia)">
                ⏳ {runningDays} {runningDays === 1 ? 'dia no ar' : 'dias no ar'}
              </span>
              <span title="Quantos anúncios o anunciante tem ativos na Biblioteca, na última medição (a extensão mede uma vez por dia)">
                📊 {adsCount} {adsCount === 1 ? 'anúncio ativo' : 'anúncios ativos'}
              </span>
            </p>

            <p className="page-id page-id-line">
              <span title={identificacao.titulo}>🆔 {identificacao.texto}</span>
            </p>
            {hasSalesPage && (
              <a
                className="sales-page-link"
                href={salesPageUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={salesPageUrl}
              >
                🔗 Página de vendas
              </a>
            )}

            {!readOnly && extras.tags.length > 0 && (
              <div className="tag-list small card-tags">
                {extras.tags.slice(0, 4).map((t) => <span key={t} className="tag-chip">{t}</span>)}
                {extras.tags.length > 4 && <span className="tag-chip">+{extras.tags.length - 4}</span>}
              </div>
            )}
          </div>

          <div className="meta">
            <span className="ads">
              {offer.ads_count == null
                ? 'Sem resultados'
                : `${offer.ads_count} anúncio${Number(offer.ads_count) === 1 ? '' : 's'}`}
            </span>

            <div className="card-actions">
              {!readOnly && notesText && (
                <button
                  className={`action-btn-subtle ${showNotes ? 'active' : ''}`}
                  onClick={() => setShowNotes(!showNotes)}
                  title="Ver anotações de espionagem"
                >
                  📝
                </button>
              )}
              {canWrite && (
                <>
                  <button
                    onClick={() => onEdit(offer)}
                    aria-label="Editar"
                    title="Editar oferta"
                  >
                    ✎
                  </button>
                  {onDuplicate && (
                    <button
                      onClick={() => onDuplicate(offer)}
                      aria-label="Duplicar"
                      title="Duplicar oferta"
                    >
                      ⧉
                    </button>
                  )}
                  <button
                    className="today-action"
                    onClick={() => onAddResult(offer)}
                    title="Registrar contagem de anúncios hoje"
                  >
                    + Hoje
                  </button>
                </>
              )}
              {libraryUrl && (
                <a
                  href={libraryUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Abrir na Biblioteca de Anúncios"
                  title="Abrir na Biblioteca de Anúncios da Meta"
                >
                  ↗
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {showNotes && notesText && (
        <div className="notes-box">
          <strong>💡 Anotação de Espionagem:</strong>
          <p>{notesText}</p>
        </div>
      )}

      <section
        className="tracker"
        onClick={() => onOpenHistory && onOpenHistory(offer)}
        style={{ cursor: onOpenHistory ? 'pointer' : 'default' }}
        title={onOpenHistory ? 'Clique para abrir o histórico detalhado' : ''}
      >
        <div className="tracker-head">
          <div>
            <span>Evolução diária</span>
            <strong>{historyCount} medições {onOpenHistory ? '· Ver Detalhes ➔' : ''}</strong>
          </div>
        </div>
        <Chart history={historyList} />
      </section>
    </article>
  );
}
