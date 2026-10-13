import React, { useState } from 'react';
import { normalizeTag } from '../utils/offerExtras';

/** Etiquetas livres da oferta, com sugestões das já usadas no acervo. */
export default function TagEditor({ tags = [], suggestions = [], onChange, compact = false }) {
  const [draft, setDraft] = useState('');

  function add(raw) {
    const tag = normalizeTag(raw);
    if (!tag || tags.includes(tag) || tags.length >= 12) return;
    onChange([...tags, tag]);
    setDraft('');
  }

  function remove(tag) {
    onChange(tags.filter((t) => t !== tag));
  }

  const available = suggestions.filter((s) => !tags.includes(s)).slice(0, 8);

  return (
    <div className={`tag-editor ${compact ? 'compact' : ''}`}>
      <div className="tag-list">
        {tags.map((tag) => (
          <span key={tag} className="tag-chip editable">
            {tag}
            <button type="button" aria-label={`Remover ${tag}`} onClick={() => remove(tag)}>×</button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          maxLength={24}
          placeholder={tags.length ? 'Nova etiqueta' : 'Ex: VSL, quiz, gringa...'}
          list="minerai-tag-suggestions"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && tags.length) {
              remove(tags[tags.length - 1]);
            }
          }}
          onBlur={() => draft && add(draft)}
        />
      </div>
      {available.length > 0 && (
        <div className="tag-suggestions">
          {available.map((s) => (
            <button key={s} type="button" className="tag-chip ghost" onClick={() => add(s)}>+ {s}</button>
          ))}
        </div>
      )}
    </div>
  );
}
