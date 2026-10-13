import React, { useState } from 'react';

const KEY = 'minerai_guias_ok';

function readDone() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function saveDone(id, done) {
  try {
    const all = readDone();
    if (done) all[id] = true;
    else delete all[id];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Sem armazenamento: o tutorial volta a aparecer ao recarregar.
  }
}

/**
 * Tutorial curto no topo de cada aba: para que ela serve e o passo a passo.
 * Some no "Entendi" (lembrado neste navegador) e volta pelo "Como usar".
 */
export default function PageGuide({ id, why, steps }) {
  const [open, setOpen] = useState(() => !readDone()[id]);

  if (!open) {
    return (
      <div className="page-guide-reopen">
        <button
          type="button"
          className="page-guide-link"
          onClick={() => {
            setOpen(true);
            saveDone(id, false);
          }}
        >
          <span aria-hidden="true">?</span> Como usar esta página
        </button>
      </div>
    );
  }

  return (
    <section className="page-guide" aria-label="Como usar esta página">
      <div className="page-guide-head">
        <div>
          <p className="page-guide-title">Como usar esta página</p>
          {why && <p className="page-guide-why">{why}</p>}
        </div>
        <button
          type="button"
          className="mini-btn"
          onClick={() => {
            setOpen(false);
            saveDone(id, true);
          }}
        >
          Entendi
        </button>
      </div>
      <ol className="page-guide-steps">
        {steps.map((step, i) => (
          <li key={i}>
            <span className="funil-step-num">{i + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
