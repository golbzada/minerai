import React, { useState } from 'react';

export default function TabModal({ onClose, onSave }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Informe o nome da tab.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await onSave(name.trim());
    } catch (err) {
      setError(err.message || 'Erro ao criar tab.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form className="modal tab-modal" onSubmit={handleSubmit}>
        <div className="modal-head">
          <h2>Nova Tab</h2>
          <button className="modal-close-btn" type="button" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        <label className="field">
          <span>Nome da tab</span>
          <input
            type="text"
            required
            autoFocus
            value={name}
            placeholder="Ex: Nicho Black, VSLs Gringas, Ofertas Dropship"
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button className="secondary" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" type="submit" disabled={loading}>
            {loading ? 'Criando...' : 'Criar tab'}
          </button>
        </div>
      </form>
    </div>
  );
}
