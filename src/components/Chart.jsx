import React from 'react';

function diaMes(iso) {
  const m = String(iso || '').match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[1]}` : '';
}

const SETA = { subiu: '▲', caiu: '▼', estavel: '■', unica: '●' };

/**
 * Evolução da oferta em um olhar: só o começo e a medição mais recente, mais
 * uma frase ("Caiu de 42 para 29 anúncios ativos desde 13/10"). O dia a dia
 * fica no histórico. `resumo` vem de resumoDaEvolucao (utils/evolucao.js).
 */
export default function Chart({ resumo }) {
  if (!resumo || resumo.direcao === 'vazia') {
    return <div className="chart-empty">{resumo?.frase || 'Sem medições ainda.'}</div>;
  }

  const { direcao, inicio, fim } = resumo;
  const unica = direcao === 'unica';
  // Dois pontos na mesma escala: o maior fica em cima.
  const menor = Math.min(inicio.count, fim.count);
  const maior = Math.max(inicio.count, fim.count);
  const altura = (v) => (maior === menor ? 18 : 30 - ((v - menor) / (maior - menor)) * 22);
  const y1 = unica ? 18 : altura(inicio.count);
  const y2 = unica ? 18 : altura(fim.count);

  return (
    <div className={`chart-wrap chart-${direcao}`}>
      <div className="chart-plot">
        <svg className="chart" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
          {unica ? (
            <line className="chart-guia" x1="6" y1="18" x2="94" y2="18" />
          ) : (
            <>
              <polygon className="chart-area" points={`6,36 6,${y1} 94,${y2} 94,36`} />
              <line className="chart-line" x1="6" y1={y1} x2="94" y2={y2} />
            </>
          )}
        </svg>
        {/* Pontos fora do SVG esticado: ficam redondos em qualquer largura. */}
        {!unica && <span className="chart-dot" style={{ left: '6%', top: `${(y1 / 36) * 100}%` }} />}
        <span className="chart-dot is-fim" style={{ left: unica ? '50%' : '94%', top: `${(y2 / 36) * 100}%` }} />
      </div>

      <div className={`chart-labels ${unica ? 'is-unica' : ''}`}>
        {!unica && (
          <span>
            <b>{inicio.count}</b>
            {diaMes(inicio.date)} · início
          </span>
        )}
        <span>
          <b>{fim.count}</b>
          {diaMes(fim.date)} · {unica ? 'primeira medição' : 'última'}
        </span>
      </div>

      <p className="chart-frase">
        <span className="chart-seta" aria-hidden="true">{SETA[direcao]}</span> {resumo.frase}
      </p>
    </div>
  );
}
