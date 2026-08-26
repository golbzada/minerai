import React, { useState } from 'react';

export default function HistoryModal({ offer, onClose, onAddResult, onDeleteEntry }) {
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newCount, setNewCount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const history = [...(offer.history || [])].sort((a, b) =>
    a.result_date.localeCompare(b.result_date)
  );

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
                const diff = prev ? item.results_count - prev.results_count : 0;
                const percent = prev && prev.results_count > 0
                  ? Math.round((diff / prev.results_count) * 100)
                  : 0;

                let dateFormatted = item.result_date;
                try {
                  dateFormatted = new Date(`${item.result_date}T12:00:00`).toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric'
                  });
                } catch (e) {}

                return (
                  <tr key={item.result_date}>
                    <td>
                      <strong>{dateFormatted}</strong>
                    </td>
                    <td>
                      <span className="ads-pill">{item.results_count} ads</span>
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
                        onClick={() => handleDelete(item.result_date)}
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
