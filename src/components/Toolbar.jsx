import React, { useRef } from 'react';
import { STATUS_CONFIG, NICHE_OPTIONS } from '../utils/metaParser';

const EXTENSION_URL = 'https://chromewebstore.google.com/detail/mineirar-helper/dfapbcpmcciaddkefnfjacbojigkbgcp';

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
  const fileInputRef = useRef(null);

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
      {/* Primary search & primary actions */}
      <div className="toolbar-top">
        <input
          className="search"
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar por nome, ID da página ou palavras-chave..."
        />

        <div className="toolbar-actions">
          <button
            className="install-extension"
            type="button"
            onClick={onOpenExtension}
            title="Instalar extensão oficial Mineraí Meta Ads"
          >
            🧩 Extensão
          </button>

          <button
            className="share-button"
            type="button"
            onClick={onShare}
            disabled={isSharing}
            title="Gerar link público somente leitura da tab"
          >
            🔗 {isSharing ? 'Gerando...' : 'Compartilhar'}
          </button>

          <button
            className="secondary-btn"
            type="button"
            onClick={onExport}
            title="Fazer backup/exportar acervo em JSON"
          >
            💾 Exportar
          </button>

          <button
            className="secondary-btn"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Importar acervo de arquivo JSON"
          >
            📥 Importar
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          <button
            className="primary add"
            type="button"
            onClick={onNewOffer}
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
