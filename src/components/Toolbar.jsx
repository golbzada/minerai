import React, { useState, useRef, useEffect } from 'react';
import Icon from './Icons';
import { STATUS_CONFIG, NICHE_OPTIONS, statusText } from '../utils/metaParser';

/**
 * Busca e filtros do Garimpo numa faixa só. Cada filtro diz no próprio texto o
 * que faz ("Todos os status"), então não precisa de rótulo ao lado.
 */
export default function Toolbar({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  nicheFilter,
  onNicheFilterChange,
  minAdsFilter,
  onMinAdsFilterChange,
  sortBy,
  onSortByChange,
  availableNiches = NICHE_OPTIONS
}) {
  return (
    <section className="gfilters" aria-label="Busca e filtros">
      <label className="gsearch">
        <Icon name="busca" size={17} />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar oferta, ID ou palavra-chave"
          aria-label="Buscar ofertas"
        />
      </label>

      <select value={statusFilter} onChange={(e) => onStatusFilterChange(e.target.value)} aria-label="Filtrar por status">
        <option value="all">Todos os status</option>
        {Object.values(STATUS_CONFIG).map((s) => (
          <option key={s.key} value={s.key}>{statusText(s)}</option>
        ))}
      </select>

      <select value={nicheFilter} onChange={(e) => onNicheFilterChange(e.target.value)} aria-label="Filtrar por nicho">
        <option value="all">Todos os nichos</option>
        {availableNiches.map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>

      <select value={minAdsFilter} onChange={(e) => onMinAdsFilterChange(e.target.value)} aria-label="Escala mínima">
        <option value="0">Qualquer escala</option>
        <option value="10">10+ anúncios ativos</option>
        <option value="25">25+ anúncios ativos</option>
        <option value="50">50+ anúncios ativos</option>
      </select>

      <select value={sortBy} onChange={(e) => onSortByChange(e.target.value)} aria-label="Ordenar">
        <option value="recent">Mais recentes</option>
        <option value="oldest">Mais antigas</option>
        <option value="most_ads">Mais anúncios</option>
        <option value="least_ads">Menos anúncios</option>
        <option value="running_days">Mais dias rodando</option>
      </select>
    </section>
  );
}

/**
 * Ações da tab, ao lado das tabs: menu "Mais" (compartilhar, planilha,
 * backup) e o botão dourado de nova oferta.
 */
export function GarimpoActions({ onShare, isSharing, onCsv, onExport, onImport, onNewOffer, locked = false }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const fileInputRef = useRef(null);
  const menuRef = useRef(null);

  // Fecha o menu ao clicar fora dele
  useEffect(() => {
    if (!isMenuOpen) return undefined;
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setIsMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result;
        if (text) onImport(text);
      };
      reader.readAsText(file);
      e.target.value = '';
    }
  }

  const item = (icon, label, onClick, { disabled = false, title } = {}) => (
    <button
      type="button"
      className="gmenu-item"
      role="menuitem"
      disabled={disabled}
      title={title}
      onClick={() => {
        setIsMenuOpen(false);
        onClick();
      }}
    >
      <Icon name={icon} size={16} />
      <span>{label}</span>
    </button>
  );

  return (
    <div className="gactions">
      <div className="gmenu" ref={menuRef}>
        <button
          type="button"
          className={`gbtn ${isMenuOpen ? 'active' : ''}`}
          onClick={() => setIsMenuOpen((prev) => !prev)}
          aria-haspopup="true"
          aria-expanded={isMenuOpen}
        >
          Mais
          <Icon name="expandir" size={14} strokeWidth={2.2} className="gbtn-caret" />
        </button>

        {isMenuOpen && (
          <div className="gmenu-list" role="menu">
            {item('compartilhar', isSharing ? 'Gerando link...' : 'Compartilhar esta tab', onShare, {
              disabled: isSharing || locked,
              title: locked ? 'Ative um plano para compartilhar' : 'Gera um link público, só de leitura'
            })}
            {item('planilha', 'Baixar planilha desta tab', onCsv, { title: 'Arquivo CSV para Excel ou Google Sheets' })}
            <span className="gmenu-sep" aria-hidden="true" />
            {item('baixar', 'Baixar backup completo', onExport, { title: 'Guarda todas as tabs e ofertas num arquivo' })}
            {item('enviar', 'Restaurar backup', () => fileInputRef.current?.click(), {
              disabled: locked,
              title: locked ? 'Ative um plano para restaurar' : 'Traz de volta as ofertas de um arquivo de backup'
            })}
          </div>
        )}
      </div>

      <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileChange} />

      <button
        className="gbtn gold"
        type="button"
        onClick={onNewOffer}
        disabled={locked}
        title={locked ? 'Ative um plano para cadastrar ofertas' : 'Cadastrar uma oferta à mão'}
      >
        <Icon name="adicionar" size={15} strokeWidth={2.4} /> Nova oferta
      </button>
    </div>
  );
}
