import React, { useState } from 'react';
import { normalizeHistory, todayIso } from '../utils/offerMeta';

export default function HistoryModal({ offer, onClose, onAddResult, onDeleteEntry }) {
  const [newDate, setNewDate] = useState(todayIso());
  const [newCount, setNewCount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Aceita tanto o formato do Supabase ({date, count}) quanto o legado
  // ({result_date, results_count}) sem quebrar a tela.
  const history = normalizeHistory(offer.history);

  async function handleAddEntry(e) {
    e.preventDefault();
    if (!newDate || newCount === '') {
      setError('Preencha a data e a quantidade de anúncios.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await onAddResult(offer, Number(newCount), newDate);
      setNewCount('');
    } catch (err) {
      setError(err.message || 'Erro ao adicionar medição.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(date) {
    if (window.confirm(`Remover medição do dia ${date}?`)) {
      try {
        await onDeleteEntry(offer.id, date);
      } catch (err) {
        setError(err.message || 'Erro ao remover medição.');
      }
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal history-modal">
        <div className="modal-head">
          <div>
            <p className="eyebrow">Auditoria de Escala</p>
            <h2>Histórico de Medições</h2>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        <p className="result-offer-name">
          Oferta: <strong>{offer.name}</strong>
        </p>

        {/* Add Entry Form */}
        <form className="history-add-box" onSubmit={handleAddEntry}>
          <div className="history-inputs">
            <label className="field-sm">
              <span>Data</span>
              <input
                type="date"
                required
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
              />
            </label>
            <label className="field-sm">
              <span>Anúncios Ativos</span>
              <input
                type="number"
                min="0"
                required
                placeholder="Ex: 50"
                value={newCount}
                onChange={(e) => setNewCount(e.target.value)}
              />
            </label>
          </div>
          <button className="primary" type="submit" disabled={loading}>
            {loading ? 'Salvando...' : '+ Salvar Medição'}
          </button>
        </form>

        {error && <p className="error">{error}</p>}

        {/* History Table */}
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Anúncios Ativos</th>
                <th>Variação</th>
                <th style={{ textAlign: 'right' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item, idx) => {
                const prev = idx > 0 ? history[idx - 1] : null;
                const diff = prev ? item.count - prev.count : 0;
                const percent = prev && prev.count > 0
                  ? Math.round((diff / prev.count) * 100)
                  : 0;

                let dateFormatted = item.date;
                try {
                  dateFormatted = new Date(`${item.date}T12:00:00`).toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric'
                  });
                } catch (e) {}

                return (
                  <tr key={item.date}>
                    <td>
                      <strong>{dateFormatted}</strong>
                    </td>
                    <td>
                      <span className="ads-pill">{item.count} ads</span>
                    </td>
                    <td>
                      {idx === 0 ? (
                        <span className="growth-neutral">Medição Inicial</span>
                      ) : diff > 0 ? (
                        <span className="growth-up">+{diff} (+{percent}%) 📈</span>
                      ) : diff < 0 ? (
                        <span className="growth-down">{diff} ({percent}%) 📉</span>
                      ) : (
                        <span className="growth-neutral">Estável (0%)</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="delete-entry-btn"
                        type="button"
                        onClick={() => handleDelete(item.date)}
                        title="Excluir esta medição"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!history.length && (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', padding: 20 }}>
                    Nenhuma medição registrada até o momento.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="modal-actions">
          <button className="primary" type="button" onClick={onClose}>
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
}
