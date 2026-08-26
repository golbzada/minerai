import React, { useState } from 'react';

export default function ResultModal({ offer, onClose, onSave }) {
  const [resultsCount, setResultsCount] = useState(offer.ads_count ?? 1);
  const [customDate, setCustomDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function handleIncrement(delta) {
    setResultsCount((prev) => Math.max(0, (Number(prev) || 0) + delta));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (resultsCount === '') {
      setError('Informe a quantidade de anúncios ativos.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await onSave(offer, Number(resultsCount), customDate);
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao registrar resultado.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form className="modal result-modal" onSubmit={handleSubmit}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">Acompanhamento Diário</p>
            <h2>Registrar Medição</h2>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        <p className="result-offer-name">
          Oferta: <strong>{offer.name}</strong>
        </p>

        <label className="field">
          <span>Data da Medição</span>
          <input
            type="date"
            required
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Quantidade de Anúncios Ativos</span>
          <input
            type="number"
            min="0"
            required
            autoFocus
            value={resultsCount}
            onChange={(e) => setResultsCount(e.target.value)}
            placeholder="Ex: 48"
          />
        </label>

        {/* Quick Increment buttons */}
        <div className="quick-increments">
          <span>Ajuste rápido:</span>
          <button type="button" onClick={() => handleIncrement(1)}>+1</button>
          <button type="button" onClick={() => handleIncrement(5)}>+5</button>
          <button type="button" onClick={() => handleIncrement(10)}>+10</button>
          <button type="button" onClick={() => handleIncrement(25)}>+25</button>
          <button type="button" onClick={() => handleIncrement(-5)}>-5</button>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button className="secondary" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" type="submit" disabled={loading}>
            {loading ? 'Salvando...' : 'Salvar Medição'}
          </button>
        </div>
      </form>
    </div>
  );
}
