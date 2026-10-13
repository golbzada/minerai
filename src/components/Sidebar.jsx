import React, { useState } from 'react';
import Icon from './Icons';
import { PAGES, PAGE_ORDER, navigate } from '../router';

const APP_VERSION = 'v1.20';

/**
 * Menu lateral: painel escuro flutuante com cantos arredondados, item ativo em
 * pílula clara, ícones de linha, contadores e marca no topo. Recolhido vira um
 * trilho só de ícones. No celular vira a barra inferior (BottomBar).
 */
export default function Sidebar({ page, collapsed, onToggleCollapse, counts = {}, onSearch }) {
  const [query, setQuery] = useState('');

  function submitSearch(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    onSearch(q);
    setQuery('');
  }

  const counterFor = (key) => {
    if (key === 'favoritos') return counts.favs || 0;
    if (key === 'alertas') return counts.alerts || 0;
    if (key === 'modelar') return counts.modelagens || 0;
    return 0;
  };

  const counterTitle = {
    favoritos: 'ofertas favoritas',
    alertas: 'alertas pendentes',
    modelar: 'capturas prontas'
  };

  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  const env = host === 'localhost' || host === '127.0.0.1' ? 'servidor local' : host;

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Menu principal">
      <div className="sb-top">
        <button type="button" className="sb-brand" onClick={() => navigate('/garimpo')} title="Ir para o Garimpo">
          <span className="sb-mark" aria-hidden="true">M</span>
          <span className="sb-wordmark">
            Minera<span className="sb-wordmark-i">í</span>
          </span>
        </button>
        <button
          type="button"
          className="sb-collapse"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          <Icon name={collapsed ? 'expandir' : 'recolher'} size={16} strokeWidth={2.2} />
        </button>
      </div>

      {!collapsed && (
        <form className="sb-search" onSubmit={submitSearch} role="search">
          <Icon name="busca" size={16} />
          <input
            type="search"
            value={query}
            placeholder="Buscar oferta, anunciante..."
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Busca global"
          />
        </form>
      )}

      <nav className="sb-nav">
        {PAGE_ORDER.map((key, idx) => {
          const item = PAGES[key];
          const active = page === key || (key === 'garimpo' && page === 'oferta');
          const count = counterFor(key);
          return (
            <button
              key={key}
              type="button"
              className={`sb-item ${active ? 'active' : ''}`}
              onClick={() => navigate(item.path)}
              title={collapsed ? `${item.label} (Alt+${idx + 1})` : `${item.hint} · Alt+${idx + 1}`}
              aria-current={active ? 'page' : undefined}
            >
              <span className="sb-icon"><Icon name={key} /></span>
              <span className="sb-label">{item.label}</span>
              {count > 0 && (
                <span className="sb-count" title={`${count} ${counterTitle[key] || ''}`}>{count > 99 ? '99+' : count}</span>
              )}
            </button>
          );
        })}
      </nav>

      <p className="sb-foot" title="Atalhos: Alt+1 a Alt+8 trocam de página">
        {collapsed ? APP_VERSION : `${APP_VERSION} · ${env}`}
      </p>
    </aside>
  );
}

/** Barra inferior do celular: 4 páginas principais + "Mais" com o restante. */
export function BottomBar({ page, counts = {} }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const main = ['garimpo', 'favoritos', 'modelar', 'alertas'];
  const rest = PAGE_ORDER.filter((k) => !main.includes(k));

  return (
    <>
      <nav className="bottom-bar" aria-label="Menu do celular">
        {main.map((key) => {
          const item = PAGES[key];
          const active = page === key || (key === 'garimpo' && page === 'oferta');
          const count = key === 'alertas' ? counts.alerts : key === 'favoritos' ? counts.favs : key === 'modelar' ? counts.modelagens : 0;
          return (
            <button
              key={key}
              type="button"
              className={`bb-item ${active ? 'active' : ''}`}
              onClick={() => {
                setMoreOpen(false);
                navigate(item.path);
              }}
            >
              <span className="bb-icon"><Icon name={key} size={20} /></span>
              <span className="bb-label">{item.label}</span>
              {count > 0 && <span className="bb-count">{count > 99 ? '99+' : count}</span>}
            </button>
          );
        })}
        <button
          type="button"
          className={`bb-item ${rest.includes(page) || moreOpen ? 'active' : ''}`}
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
        >
          <span className="bb-icon"><Icon name="mais" size={20} strokeWidth={2.6} /></span>
          <span className="bb-label">Mais</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="bb-more-backdrop" onClick={() => setMoreOpen(false)}>
          <div className="bb-more" onClick={(e) => e.stopPropagation()}>
            <p className="sb-section-title">Mais páginas</p>
            {rest.map((key) => (
              <button
                key={key}
                type="button"
                className={`sb-item ${page === key ? 'active' : ''}`}
                onClick={() => {
                  setMoreOpen(false);
                  navigate(PAGES[key].path);
                }}
              >
                <span className="sb-icon"><Icon name={key} /></span>
                <span className="sb-label">{PAGES[key].label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
