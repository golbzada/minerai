import React, { useState } from 'react';
import Chart from './Chart';
import { STATUS_CONFIG } from '../utils/metaParser';

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
  const destinationUrl = offer.destination_url || offer.landing_page || offer.library_url;
  const avatarUrl =
    offer.avatar_url ||
    offer.image_url ||
    (offer.page_id && offer.page_id !== 'N/A' && offer.page_id !== '4'
      ? `https://graph.facebook.com/${offer.page_id}/picture?type=large`
      : null);

  const runningDays = Number(offer.running_days) || 1;
  const adsCount = offer.ads_count != null ? Number(offer.ads_count) : 1;
  const statusCfg = STATUS_CONFIG[offer.status] || STATUS_CONFIG.testing;

  // Garante histórico formatado com contagem correta
  let historyList =
    offer.history && Array.isArray(offer.history) && offer.history.length > 0
      ? [...offer.history]
      : [];

  if (historyList.length === 0) {
    historyList = [{ count: adsCount, date: new Date().toISOString() }];
  } else if (historyList.length === 1 && (Number(historyList[0].count) === 0 || Number(historyList[0].ads_count) === 0) && adsCount > 0) {
    historyList[0] = { ...historyList[0], count: adsCount, ads_count: adsCount };
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
          href={destinationUrl}
          target="_blank"
          rel="noreferrer"
          title="Abrir anúncio / biblioteca na Meta"
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
              Meta ID: {offer.page_id || 'N/A'} · {runningDays} {runningDays === 1 ? 'dia rodando' : 'dias rodando'}
            </p>
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
                  {(offer.notes || offer.funnel_notes) && (
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
                href={destinationUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="Abrir oferta"
                title="Abrir na Biblioteca de Anúncios"
              >
                ↗
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Anotações de Espionagem */}
      {showNotes && (offer.notes || offer.funnel_notes) && (
        <div className="notes-box">
          <strong>💡 Anotação de Espionagem:</strong>
          <p>{offer.notes || offer.funnel_notes}</p>
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
