import React, { useState, useRef, useEffect } from 'react';
import { STATUS_CONFIG, NICHE_OPTIONS } from '../utils/metaParser';

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
  onShare,
  isSharing,
  onExport,
  onImport,
  onNewOffer,
  onOpenExtension
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const fileInputRef = useRef(null);
  const menuRef = useRef(null);

  // Fecha o menu dropdown ao clicar fora dele
  useEffect(() => {
    function handleClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsMenuOpen(false);
      }
    }
    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result;
        if (text) {
          onImport(text);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    }
  }

  return (
    <section className="toolbar-container">
      {/* Primary search & reorganized actions */}
      <div className="toolbar-top">
        <input
          className="search"
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar por nome, ID da página ou palavras-chave..."
        />

        <div className="toolbar-actions">
          {/* 1. Botão Extensão (Preto #1A1A1A) */}
          <button
            className="install-extension"
            type="button"
            onClick={onOpenExtension}
            title="Instalar extensão oficial Mineraí Meta Ads"
          >
            🧩 Extensão
          </button>

          {/* 2. Menu Dropdown com Compartilhar, Exportar e Importar */}
          <div className="toolbar-menu-wrapper" ref={menuRef}>
            <button
              className={`toolbar-menu-btn ${isMenuOpen ? 'active' : ''}`}
              type="button"
              onClick={() => setIsMenuOpen((prev) => !prev)}
              title="Mais opções (Compartilhar, Exportar, Importar)"
              aria-haspopup="true"
              aria-expanded={isMenuOpen}
            >
              ⋯
            </button>

            {isMenuOpen && (
              <div className="toolbar-dropdown-menu">
                <button
                  className="toolbar-menu-item"
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onShare();
                  }}
                  disabled={isSharing}
                  title="Gerar link público somente leitura da tab"
                >
                  <span className="toolbar-menu-item-icon">🔗</span>
                  <span>{isSharing ? 'Gerando...' : 'Compartilhar'}</span>
                </button>

                <button
                  className="toolbar-menu-item"
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onExport();
                  }}
                  title="Fazer backup/exportar acervo em JSON"
                >
                  <span className="toolbar-menu-item-icon">💾</span>
                  <span>Exportar</span>
                </button>

                <button
                  className="toolbar-menu-item"
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                  title="Importar acervo de arquivo JSON"
                >
                  <span className="toolbar-menu-item-icon">⬇️</span>
                  <span>Importar</span>
                </button>
              </div>
            )}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          {/* 3. Botão + Nova Oferta em Destaque Dourado */}
          <button
            className="primary add gold-btn"
            type="button"
            onClick={onNewOffer}
            title="Cadastrar manualmente uma nova oferta"
          >
            + Nova Oferta
          </button>
        </div>
      </div>

      {/* Secondary filter & sorting bar */}
      <div className="toolbar-filters">
        <div className="filter-group">
          <label>Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
          >
            <option value="all">Todos os Status</option>
            {Object.values(STATUS_CONFIG).map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label>Nicho:</label>
          <select
            value={nicheFilter}
            onChange={(e) => onNicheFilterChange(e.target.value)}
          >
            <option value="all">Todos os Nichos</option>
            {NICHE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label>Escala mínima:</label>
          <select
            value={minAdsFilter}
            onChange={(e) => onMinAdsFilterChange(e.target.value)}
          >
            <option value="0">Qualquer quantidade</option>
            <option value="10">+10 anúncios ativos</option>
            <option value="25">+25 anúncios ativos</option>
            <option value="50">+50 anúncios (Escala Alta 🔥)</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Ordenar por:</label>
          <select
            value={sortBy}
            onChange={(e) => onSortByChange(e.target.value)}
          >
            <option value="recent">↓ Mais Recentes</option>
            <option value="oldest">↑ Mais Antigos</option>
            <option value="most_ads">🔥 Mais Anúncios (Escala)</option>
            <option value="least_ads">❄️ Menos Anúncios</option>
            <option value="running_days">⏳ Mais Dias Rodando</option>
          </select>
        </div>
      </div>
    </section>
  );
}
