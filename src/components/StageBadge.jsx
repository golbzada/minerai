import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { STATUS_CONFIG, statusText } from '../utils/metaParser';
import { resolveStatus, stageReason, STAGE_GUIDE, STAGE_ADS_RULE_TEXT } from '../utils/offerMeta';

/**
 * Explicação que aparece ao passar o mouse (ou focar com o teclado).
 * Vai para o <body> com posição fixa: dentro do card ela seria cortada pelo
 * `overflow: hidden` dos cards e das tabelas.
 */
function useHoverTip() {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // Abre embaixo; se não couber, abre em cima.
    const below = r.bottom + 8;
    const up = window.innerHeight - below < 140;
    setPos({
      left: Math.min(Math.max(12, r.left), window.innerWidth - 292),
      top: up ? r.top - 8 : below,
      up
    });
  };
  const hide = () => setPos(null);

  useEffect(() => {
    if (!pos) return undefined;
    window.addEventListener('scroll', hide, true);
    return () => window.removeEventListener('scroll', hide, true);
  }, [pos]);

  return { ref, pos, handlers: { onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide } };
}

function Tip({ pos, children }) {
  if (!pos) return null;
  return createPortal(
    <div
      className={`stage-tip ${pos.up ? 'up' : ''}`}
      role="tooltip"
      style={{ left: pos.left, top: pos.top }}
    >
      {children}
    </div>,
    document.body
  );
}

/** Etiqueta de estágio (Em teste, Pré-escala, Escalando, Vencedor) com o porquê. */
export default function StageBadge({ offer, variant = 'badge' }) {
  const { ref, pos, handlers } = useHoverTip();
  const cfg = STATUS_CONFIG[resolveStatus(offer)] || STATUS_CONFIG.testing;

  const label =
    variant === 'text' ? (
      <span
        ref={ref}
        className="fcard-status"
        style={{ color: cfg.color === '#ffffff' ? cfg.bg : cfg.color }}
        {...handlers}
      >
        {statusText(cfg)}
      </span>
    ) : (
      <span
        ref={ref}
        className="status-badge has-tip"
        tabIndex={0}
        style={{ color: cfg.color, backgroundColor: cfg.bg, borderColor: cfg.border }}
        {...handlers}
      >
        {cfg.label}
      </span>
    );

  return (
    <>
      {label}
      <Tip pos={pos}>
        <strong>{statusText(cfg)}</strong>
        <span>{stageReason(offer)}</span>
      </Tip>
    </>
  );
}

/**
 * Botão "?" com a legenda completa das etiquetas. Fica ao lado do filtro de
 * status: é ali que a pessoa se pergunta o que cada uma quer dizer.
 */
export function StageLegend() {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="stage-legend" ref={boxRef}>
      <button
        type="button"
        className={`stage-legend-btn ${open ? 'active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="O que significa cada etiqueta"
        title="O que significa cada etiqueta"
      >
        ?
      </button>

      {open && (
        <div className="stage-legend-pop" role="dialog" aria-label="O que significa cada etiqueta">
          <p className="stage-legend-title">O que significa cada etiqueta</p>
          <ul>
            {STAGE_GUIDE.map((g) => {
              const cfg = STATUS_CONFIG[g.key];
              return (
                <li key={g.key}>
                  <span
                    className="status-badge"
                    style={{ color: cfg.color, backgroundColor: cfg.bg, borderColor: cfg.border }}
                  >
                    {cfg.label}
                  </span>
                  <div>
                    <strong>{g.range}</strong>
                    <span>{g.text}</span>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="stage-legend-note">
            <strong>Exceção:</strong> {STAGE_ADS_RULE_TEXT} já conta como <strong>Escalando</strong>, mesmo antes
            dos 30 dias. O total de anúncios do anunciante é lido quando você clica em <strong>Minerar oferta</strong>.
          </p>
          <p className="stage-legend-foot">Passe o mouse em qualquer etiqueta para ver o porquê daquela oferta.</p>
        </div>
      )}
    </div>
  );
}
