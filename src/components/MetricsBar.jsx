import React from 'react';

export default function MetricsBar({ offers = [], tabName = '' }) {
  const totalOffers = offers.length;
  const winnersCount = offers.filter((o) => o.status === 'winner').length;
  const scalingCount = offers.filter((o) => o.status === 'scaling').length;

  const totalAds = offers.reduce((acc, o) => acc + (Number(o.ads_count) || 0), 0);
  const avgAds = totalOffers > 0 ? Math.round(totalAds / totalOffers) : 0;

  // Find top scaled offer
  const topOffer = offers.length
    ? [...offers].sort((a, b) => (Number(b.ads_count) || 0) - (Number(a.ads_count) || 0))[0]
    : null;

  return (
    <section className="metrics-bar">
      <div className="metric-card">
        <div className="metric-icon">
          <span className="metric-icon-symbol">📦</span>
        </div>
        <div className="metric-info">
          <span className="metric-label">Ofertas no Acervo</span>
          <strong className="metric-value">{totalOffers}</strong>
          <small className="metric-sub">no Total</small>
        </div>
      </div>

      <div className="metric-card">
        <div className="metric-icon">
          <span className="metric-icon-symbol">🔥</span>
        </div>
        <div className="metric-info">
          <span className="metric-label">Vencedoras em Alta</span>
          <strong className="metric-value">
            {winnersCount + scalingCount} <span className="metric-badge-sm">({winnersCount} 🔥 / {scalingCount} 📈)</span>
          </strong>
          <small className="metric-sub">ofertas em alta agora</small>
        </div>
      </div>

      <div className="metric-card">
        <div className="metric-icon">
          <span className="metric-icon-symbol">📅</span>
        </div>
        <div className="metric-info">
          <span className="metric-label">Média de Criativos</span>
          <strong className="metric-value">{avgAds}</strong>
          <small className="metric-sub">anúncios ativos por oferta</small>
        </div>
      </div>

      <div className="metric-card">
        <div className="metric-icon">
          <span className="metric-icon-symbol">🚀</span>
        </div>
        <div className="metric-info">
          <span className="metric-label">Pico de Escala</span>
          <strong className="metric-value">
            {topOffer ? `${topOffer.ads_count} ads` : '-'}
          </strong>
          <small className="metric-sub truncate" title={topOffer?.name}>
            {topOffer ? topOffer.name : 'Nenhuma oferta'}
          </small>
        </div>
      </div>
    </section>
  );
}
