import React, { useState } from 'react';
import Chart from './Chart';
import { STATUS_CONFIG } from '../utils/metaParser';
import { normalizeHistory, resolveRunningDays, resolveStatus, decodeNotes } from '../utils/offerMeta';

export default function OfferCard({
  offer,
  index,
  onEdit,
  onDelete,
  onAddResult,
  onOpenHistory,
  onDuplicate,
  readOnly = false
}) {
  const [showNotes, setShowNotes] = useState(false);

  // Link da biblioteca (o anúncio na Meta) e link da página de vendas são
  // coisas diferentes e ambos precisam ficar acessíveis no card.
  const libraryUrl = offer.library_url || offer.destination_url || offer.landing_page;
  const salesPageUrl = offer.destination_url || offer.landing_page || '';
  const hasSalesPage = Boolean(salesPageUrl) && salesPageUrl !== libraryUrl;

  const avatarUrl =
    offer.avatar_url ||
    offer.image_url ||
    (offer.page_id && offer.page_id !== 'N/A' && offer.page_id !== '4'
      ? `https://graph.facebook.com/${offer.page_id}/picture?type=large`
      : null);

  // Recalculado a partir da data de início: anda sozinho a cada dia.
  const runningDays = resolveRunningDays(offer);
  const adsCount = offer.ads_count != null ? Number(offer.ads_count) : 1;
  const statusCfg = STATUS_CONFIG[resolveStatus(offer)] || STATUS_CONFIG.testing;
  const notesText = offer.notes ?? decodeNotes(offer.funnel_notes).notes;

  let historyList = normalizeHistory(offer.history);

  if (historyList.length === 0) {
    historyList = [{ date: new Date().toISOString().slice(0, 10), count: adsCount }];
  } else if (historyList.length === 1 && historyList[0].count === 0 && adsCount > 0) {
    historyList = [{ ...historyList[0], count: adsCount }];
  }

  const historyCount = historyList.length;

  return (
    <article className="offer-item">
      <div className="card">
        {!readOnly && (
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

        <a
          className="photo"
          href={libraryUrl}
          target="_blank"
          rel="noreferrer"
          title="Abrir anúncio na Biblioteca de Anúncios da Meta"
        >
          <span className="index">{String(index + 1).padStart(2, '0')}</span>
          {avatarUrl && (
            <img
              src={avatarUrl}
              alt={offer.name}
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          )}
        </a>

        <div className="content">
          <div>
            <div className="badge-row">
              <span
                className="status-badge"
                style={{
                  color: statusCfg.color,
                  backgroundColor: statusCfg.bg,
                  borderColor: statusCfg.border
                }}
              >
                {statusCfg.label}
              </span>
              {offer.niche && <span className="niche-badge">{offer.niche}</span>}
            </div>

            <h2 title={offer.name}>{offer.name}</h2>
            <p className="page-id">
              <span title="Tempo de veiculação, atualizado automaticamente todo dia">
                ⏳ {runningDays} {runningDays === 1 ? 'dia rodando' : 'dias rodando'}
              </span>
              {' · '}
              <span title="Anúncios ativos na última medição">📊 {adsCount} ativos</span>
              {' · '}
              <span title="ID da página do anunciante na Meta">ID {offer.page_id || 'N/A'}</span>
            </p>
            {hasSalesPage && (
              <a
                className="sales-page-link"
                href={salesPageUrl}
                target="_blank"
                rel="noreferrer"
                title={salesPageUrl}
              >
                🔗 Página de vendas
              </a>
            )}
          </div>

          <div className="meta">
            <span className="ads">
              {offer.ads_count == null
                ? 'Sem resultados'
                : `${offer.ads_count} anúncio${Number(offer.ads_count) === 1 ? '' : 's'}`}
            </span>

            <div className="card-actions">
              {!readOnly && (
                <>
                  {notesText && (
                    <button
                      className={`action-btn-subtle ${showNotes ? 'active' : ''}`}
                      onClick={() => setShowNotes(!showNotes)}
                      title="Ver anotações de espionagem"
                    >
                      📝
                    </button>
                  )}
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
              <a
                href={libraryUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Abrir na Biblioteca de Anúncios"
                title="Abrir na Biblioteca de Anúncios da Meta"
              >
                ↗
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Anotações de Espionagem */}
      {showNotes && notesText && (
        <div className="notes-box">
          <strong>💡 Anotação de Espionagem:</strong>
          <p>{notesText}</p>
        </div>
      )}

      {/* Evolução Diária */}
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
