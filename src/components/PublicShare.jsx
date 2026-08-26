import React, { useState, useEffect } from 'react';
import Brand from './Brand';
import OfferCard from './OfferCard';
import { api } from '../services/api';

export default function PublicShare({ token, onBackToApp }) {
  const [data, setData] = useState({ owner_name: '', tab_name: '', offers: [] });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError('');
    api
      .publicOffers(token)
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'Link inválido ou expirado.');
        setLoading(false);
      });
  }, [token]);

  if (loading) {
    return (
      <div className="splash">
        <Brand />
      </div>
    );
  }

  if (error) {
    return (
      <div className="public-state">
        <Brand />
        <h2>Link indisponível.</h2>
        <p>{error}</p>
        <button
          className="secondary"
          style={{ marginTop: 20 }}
          onClick={() => {
            window.location.hash = '';
            if (onBackToApp) onBackToApp();
          }}
        >
          Voltar para o Painel
        </button>
      </div>
    );
  }

  return (
    <main className="app public-view">
      <header className="topbar">
        <Brand />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="readonly-badge">Somente leitura</span>
          <button
            className="secondary"
            style={{ minHeight: 34, padding: '0 12px', fontSize: '0.75rem' }}
            onClick={() => {
              window.location.hash = '';
              if (onBackToApp) onBackToApp();
            }}
          >
            Voltar ao App
          </button>
        </div>
      </header>

      <section className="hero">
        <p className="eyebrow">
          {data.tab_name || 'Mineirados'} compartilhada por {data.owner_name}
        </p>
        <h1>
          Ofertas que valem <em>ouro.</em>
        </h1>
      </section>

      <nav className="tabs">
        <button className="tab active">
          {data.tab_name || 'Mineirados'}{' '}
          <span className="count">{data.offers?.length || 0}</span>
        </button>
      </nav>

      <section className="board">
        {data.offers?.map((offer, idx) => (
          <OfferCard
            key={offer.id}
            offer={offer}
            index={idx}
            readOnly={true}
          />
        ))}
      </section>

      {!data.offers?.length && (
        <div className="empty">Nenhuma oferta compartilhada nesta pasta.</div>
      )}
    </main>
  );
}
