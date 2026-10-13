import React, { useState } from 'react';
import { STATUS_CONFIG, statusText } from '../utils/metaParser';

/** Barra que aparece quando há ofertas selecionadas: ações em lote. */
export default function BulkBar({ count, tabs, tagSuggestions = [], busy, onMoveTab, onStatus, onAddTag, onDelete, onCsv, onClear }) {
  const [tag, setTag] = useState('');

  return (
    <div className="bulk-bar" role="region" aria-label="Ações em lote">
      <strong>{count} {count === 1 ? 'oferta selecionada' : 'ofertas selecionadas'}</strong>

      <label>
        <span>Mover para tab</span>
        <select defaultValue="" disabled={busy} onChange={(e) => e.target.value && onMoveTab(e.target.value)}>
          <option value="">Escolher...</option>
          {tabs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>

      <label>
        <span>Status</span>
        <select defaultValue="" disabled={busy} onChange={(e) => e.target.value && onStatus(e.target.value)}>
          <option value="">Escolher...</option>
          {Object.values(STATUS_CONFIG).map((s) => <option key={s.key} value={s.key}>{statusText(s)}</option>)}
        </select>
      </label>

      <form
        className="bulk-tag"
        onSubmit={(e) => {
          e.preventDefault();
          if (tag.trim()) {
            onAddTag(tag.trim());
            setTag('');
          }
        }}
      >
        <input type="text" value={tag} maxLength={24} placeholder="Etiqueta" list="minerai-tag-suggestions" onChange={(e) => setTag(e.target.value)} disabled={busy} />
        <button type="submit" className="mini-btn" disabled={busy || !tag.trim()}>Etiquetar</button>
      </form>

      <datalist id="minerai-tag-suggestions">
        {tagSuggestions.map((t) => <option key={t} value={t} />)}
      </datalist>

      <button type="button" className="mini-btn" onClick={onCsv} disabled={busy}>Exportar CSV</button>
      <button type="button" className="mini-btn danger" onClick={onDelete} disabled={busy}>Excluir</button>
      <button type="button" className="mini-btn" onClick={onClear}>Limpar seleção</button>
    </div>
  );
}
