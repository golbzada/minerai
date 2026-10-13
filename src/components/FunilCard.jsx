import React, { useState } from 'react';
import Icon from './Icons';
import StarRating from './StarRating';
import { STATUS_CONFIG, statusText } from '../utils/metaParser';
import { resolveRunningDays, resolveStatus } from '../utils/offerMeta';
import { safeImageSrc, safeCreativeThumb } from '../utils/url';
import { getExtras } from '../utils/offerExtras';

/**
 * Card enxuto do funil (Favoritos). O card inteiro é arrastável; as setas
 * levam para a etapa anterior ou seguinte sem precisar arrastar (celular).
 * `dense` mostra só o nome; o modo detalhado mostra foto, status e números.
 */
export default function FunilCard({
  offer,
  dense = false,
  locked = false,
  dragging = false,
  canPrev = false,
  canNext = false,
  prevName,
  nextName,
  onOpen,
  onPrev,
  onNext,
  onUnfav,
  onRate,
  dragProps = {}
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const extras = getExtras(offer);
  const days = resolveRunningDays(offer);
  const status = STATUS_CONFIG[resolveStatus(offer)] || STATUS_CONFIG.testing;
  const ads = offer.ads_count != null ? Number(offer.ads_count) : 1;
  const image = imgFailed
    ? null
    : safeCreativeThumb(offer.creative_thumb) || safeImageSrc(offer.avatar_url) || safeImageSrc(offer.image_url);
  const initial = (offer.name || '?').trim().charAt(0).toUpperCase();

  return (
    <article
      className={`fcard ${dense ? 'dense' : ''} ${dragging ? 'dragging' : ''}`}
      draggable={!locked}
      {...dragProps}
    >
      <button type="button" className="fcard-main" onClick={() => onOpen(offer)} title={`Abrir ${offer.name}`}>
        {!dense && (
          <span className="fcard-thumb" aria-hidden="true">
            {image ? <img src={image} alt="" loading="lazy" draggable={false} onError={() => setImgFailed(true)} /> : initial}
          </span>
        )}
        <span className="fcard-body">
          <span className="fcard-name">{offer.name}</span>
          <span className="fcard-meta">
            <span className="fcard-status" style={{ color: status.color === '#ffffff' ? status.bg : status.color }}>
              {statusText(status)}
            </span>
            <span>· {days} {days === 1 ? 'dia' : 'dias'}</span>
            {!dense && <span>· {ads} {ads === 1 ? 'anúncio' : 'anúncios'}</span>}
          </span>
        </span>
      </button>

      {!dense && (
        <div className="fcard-foot">
          <StarRating value={extras.rating} readOnly={locked} onChange={(n) => onRate(offer, n)} />
        </div>
      )}

      {!locked && (
        <div className="fcard-actions">
          <button
            type="button"
            className="fcard-btn"
            disabled={!canPrev}
            title={canPrev ? `Voltar para "${prevName}"` : 'Já está na primeira etapa'}
            aria-label="Voltar uma etapa"
            onClick={() => onPrev(offer)}
          >
            <Icon name="recolher" size={14} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            className="fcard-btn"
            disabled={!canNext}
            title={canNext ? `Avançar para "${nextName}"` : 'Já está na última etapa'}
            aria-label="Avançar uma etapa"
            onClick={() => onNext(offer)}
          >
            <Icon name="expandir" size={14} strokeWidth={2.4} />
          </button>
          <button
            type="button"
            className="fcard-btn star"
            title="Tirar das favoritas"
            aria-label="Tirar das favoritas"
            onClick={() => onUnfav(offer)}
          >
            ★
          </button>
        </div>
      )}
    </article>
  );
}
