import React from 'react';
import Icon from './Icons';
import { resolveStatus } from '../utils/offerMeta';

/**
 * Quatro números da tab ativa, sem emoji: ícone de linha, rótulo, valor e uma
 * linha de contexto. Mesma família de ícones do menu lateral.
 */
export default function MetricsBar({ offers = [], tabName = '' }) {
  const totalOffers = offers.length;
  const stages = offers.map(resolveStatus);
  const winnersCount = stages.filter((s) => s === 'winner').length;
  const scalingCount = stages.filter((s) => s === 'scaling').length;

  const totalAds = offers.reduce((acc, o) => acc + (Number(o.ads_count) || 0), 0);
  const avgAds = totalOffers > 0 ? Math.round(totalAds / totalOffers) : 0;

  const topOffer = offers.length
    ? [...offers].sort((a, b) => (Number(b.ads_count) || 0) - (Number(a.ads_count) || 0))[0]
    : null;
  const topAds = topOffer ? Number(topOffer.ads_count) || 0 : 0;

  const stats = [
    {
      icon: 'acervo',
      label: 'Ofertas no acervo',
      value: totalOffers,
      sub: tabName ? `na tab ${tabName}` : 'no total'
    },
    {
      icon: 'alta',
      label: 'Em alta agora',
      value: winnersCount + scalingCount,
      sub: `${winnersCount} ${winnersCount === 1 ? 'vencedora' : 'vencedoras'} · ${scalingCount} escalando`
    },
    {
      icon: 'camadas',
      label: 'Anúncios por oferta',
      value: avgAds,
      sub: 'média de anúncios ativos'
    },
    {
      icon: 'pico',
      label: 'Maior escala',
      value: topOffer ? `${topAds} ${topAds === 1 ? 'anúncio' : 'anúncios'}` : '—',
      sub: topOffer ? topOffer.name : 'nenhuma oferta ainda',
      title: topOffer?.name
    }
  ];

  return (
    <section className="gstats" aria-label="Resumo da tab">
      {stats.map((s) => (
        <div key={s.label} className="gstat">
          <span className="gstat-icon" aria-hidden="true">
            <Icon name={s.icon} size={18} />
          </span>
          <div className="gstat-info">
            <span className="gstat-label">{s.label}</span>
            <strong className="gstat-value">{s.value}</strong>
            <span className="gstat-sub" title={s.title}>{s.sub}</span>
          </div>
        </div>
      ))}
    </section>
  );
}
