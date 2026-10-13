import React, { useMemo } from 'react';
import PageGuide from '../components/PageGuide';
import Icon from '../components/Icons';
import { useAppData } from '../context/AppData';
import { navigate } from '../router';
import { computeInsights, computeAlerts, ALERT_LABELS } from '../utils/offerExtras';
import { STATUS_CONFIG, statusText } from '../utils/metaParser';

// Ícone de linha de cada status (no lugar do emoji).
const STATUS_ICONS = { winner: 'trofeu', scaling: 'alta', pre_scaling: 'broto', testing: 'teste', paused: 'pausa' };

/** Inteligência do acervo: nichos, anunciantes, domínios, ritmo semanal e alertas. */
export default function InsightsPage() {
  const { offers, loading } = useAppData();
  const insights = useMemo(() => computeInsights(offers), [offers]);
  const alerts = useMemo(() => computeAlerts(offers), [offers]);

  const maxWeek = Math.max(1, ...insights.weeks.map((w) => w.mined));
  const alertSummary = Object.keys(ALERT_LABELS).map((type) => ({ type, ...ALERT_LABELS[type], count: alerts.filter((a) => a.type === type).length }));

  if (!loading && !offers.length) {
    return (
      <div className="empty">Minere algumas ofertas e esta página começa a mostrar tendências do seu acervo.</div>
    );
  }

  return (
    <div className="insights-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Inteligência do acervo</p>
          <h1 className="page-title">O que o seu garimpo <em>revela.</em></h1>
          <p className="page-sub">Tudo calculado a partir das {insights.total} ofertas do seu acervo, sem depender de servidor.</p>
        </div>
      </div>

      <PageGuide
        id="inteligencia"
        why="Mostra os padrões do seu acervo: que nichos mais aparecem, que anunciantes se repetem e que domínios eles usam."
        steps={[
            <>Você não precisa fazer nada aqui: tudo é calculado sozinho a partir das ofertas que você salvou.</>,
            <>Quanto mais você garimpa e mede (o <strong>+ Hoje</strong> do card), mais certeiro fica.</>,
            <>Use o <strong>Ranking de nichos</strong> para decidir onde garimpar e os <strong>Anunciantes recorrentes</strong> para achar quem está escalando várias ofertas.</>
        ]}
      />

      <section className="gstats five" aria-label="Ofertas por status">
        {Object.values(STATUS_CONFIG).map((s) => {
          const count = insights.statusCount[s.key] || 0;
          const pct = insights.total ? Math.round((count / insights.total) * 100) : 0;
          return (
            <div className="gstat" key={s.key}>
              <span className="gstat-icon" aria-hidden="true" style={{ color: s.text }}>
                <Icon name={STATUS_ICONS[s.key] || 'acervo'} size={18} />
              </span>
              <div className="gstat-info">
                <span className="gstat-label">{statusText(s)}</span>
                <strong className="gstat-value">{count}</strong>
                <span className="gstat-sub">{count === 1 ? 'oferta' : 'ofertas'} · {pct}% do acervo</span>
              </div>
            </div>
          );
        })}
      </section>

      <div className="insight-grid">
        <div className="panel">
          <p className="eyebrow">Ritmo das últimas 8 semanas</p>
          <p className="muted">Quantas ofertas você garimpou por semana e quantas delas estão em alta hoje.</p>
          <div className="bar-chart" role="img" aria-label="Ofertas garimpadas por semana">
            {insights.weeks.map((w) => (
              <div key={w.label} className="bar-col" title={`${w.label}: ${w.mined} garimpadas, ${w.hot} em alta`}>
                <div className="bar-stack">
                  <div className="bar mined" style={{ height: `${(w.mined / maxWeek) * 100}%` }}>
                    <div className="bar hot" style={{ height: w.mined ? `${(w.hot / w.mined) * 100}%` : 0 }} />
                  </div>
                </div>
                <span className="bar-value">{w.mined}</span>
                <span className="bar-label">{w.label}</span>
              </div>
            ))}
          </div>
          <div className="legend"><span className="sw mined" /> garimpadas <span className="sw hot" /> em alta (escalando ou vencedora)</div>
        </div>

        <div className="panel">
          <p className="eyebrow">Alertas agora</p>
          <ul className="alert-summary">
            {alertSummary.map((a) => (
              <li key={a.type}>
                <span>{a.label}</span>
                <strong>{a.count}</strong>
              </li>
            ))}
          </ul>
          <button type="button" className="secondary" onClick={() => navigate('/alertas')}>Ver todos os alertas</button>
        </div>

        <div className="panel">
          <p className="eyebrow">Ranking de nichos</p>
          <table className="rank-table">
            <thead><tr><th>Nicho</th><th className="num">Ofertas</th><th className="num">Em alta</th><th className="num">Média dias</th><th className="num">Média anúncios</th></tr></thead>
            <tbody>
              {insights.nicheRanking.slice(0, 12).map((n) => (
                <tr key={n.name}>
                  <td><button type="button" className="link-name" onClick={() => navigate(`/garimpo?q=${encodeURIComponent(n.name)}`)}>{n.name}</button></td>
                  <td className="num">{n.total}</td>
                  <td className="num">{n.winners}</td>
                  <td className="num">{n.avgDays}</td>
                  <td className="num">{n.avgAds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <p className="eyebrow">Anunciantes recorrentes</p>
          <p className="muted">Quem aparece em mais de uma oferta do seu acervo.</p>
          {!insights.recurrentAdvertisers.length && <p className="muted">Nenhum anunciante repetido ainda.</p>}
          <ul className="plain-list">
            {insights.recurrentAdvertisers.slice(0, 12).map((a) => (
              <li key={a.pageId || a.name}>
                <div>
                  <strong>{a.name}</strong>
                  <small>{a.pageId && a.pageId !== '4' ? `ID ${a.pageId}` : 'sem ID de página'}</small>
                </div>
                <span className="count-pill">{a.total} ofertas</span>
                <button type="button" className="mini-btn" onClick={() => navigate(`/oferta/${a.offers[0].id}`)}>abrir</button>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <p className="eyebrow">Mapa de domínios</p>
          <p className="muted">Páginas de vendas e checkouts que mais aparecem.</p>
          {!insights.domainRanking.length && <p className="muted">Nenhuma página de vendas registrada ainda.</p>}
          <ul className="plain-list">
            {insights.domainRanking.slice(0, 15).map((d) => (
              <li key={d.host}>
                <strong>{d.host}</strong>
                <span className="count-pill">{d.total}</span>
                <button type="button" className="mini-btn" onClick={() => navigate(`/garimpo?q=${encodeURIComponent(d.host)}`)}>filtrar</button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
