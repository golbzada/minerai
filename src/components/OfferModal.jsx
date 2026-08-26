import React, { useState } from 'react';
import { extractPageIdFromUrl, NICHE_OPTIONS, STATUS_CONFIG, getFbAvatarUrl } from '../utils/metaParser';

const EMPTY_OFFER = {
  name: '',
  library_url: '',
  destination_url: '',
  niche: 'Saúde & Beleza',
  custom_niche: '',
  status: 'testing',
  notes: '',
  initial_results: '1',
  running_days: '1'
};

export default function OfferModal({ offer, onClose, onSave }) {
  const isExistingCustom = offer?.niche && !NICHE_OPTIONS.includes(offer.niche);

  const [formData, setFormData] = useState(
    offer
      ? {
          name: offer.name || '',
          library_url: offer.library_url || '',
          destination_url: offer.destination_url || offer.landing_page || '',
          niche: isExistingCustom ? 'Outros (Personalizado)' : (offer.niche || 'Saúde & Beleza'),
          custom_niche: isExistingCustom ? offer.niche : '',
          status: offer.status || 'testing',
          notes: offer.notes || offer.funnel_notes || '',
          initial_results: String(offer.ads_count ?? 1),
          running_days: String(offer.running_days ?? 1)
        }
      : EMPTY_OFFER
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previewAvatar, setPreviewAvatar] = useState(() => {
    if (offer?.page_id && offer.page_id !== 'N/A' && offer.page_id !== '4') {
      return getFbAvatarUrl(offer.page_id);
    }
    return null;
  });

  function handleLibraryUrlChange(url) {
    setFormData((prev) => ({ ...prev, library_url: url }));
    if (url.trim()) {
      const pageId = extractPageIdFromUrl(url);
      if (pageId && pageId !== '4') {
        setPreviewAvatar(getFbAvatarUrl(pageId));
      }
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!formData.name.trim() || !formData.library_url.trim()) {
      setError('Preencha o nome da oferta e a URL da biblioteca.');
      return;
    }

    const finalNiche =
      formData.niche === 'Outros (Personalizado)'
        ? (formData.custom_niche.trim() || 'Outros')
        : formData.niche;

    const pageId = extractPageIdFromUrl(formData.library_url) || offer?.page_id || 'N/A';
    const adsCount = Math.max(0, parseInt(formData.initial_results, 10) || 1);
    const runningDays = Math.max(1, parseInt(formData.running_days, 10) || 1);

    setLoading(true);
    setError('');

    try {
      await onSave({
        name: formData.name.trim(),
        library_url: formData.library_url.trim(),
        destination_url: formData.destination_url.trim() || formData.library_url.trim(),
        landing_page: formData.destination_url.trim() || formData.library_url.trim(),
        niche: finalNiche,
        status: formData.status,
        notes: formData.notes,
        funnel_notes: formData.notes,
        page_id: pageId,
        ads_count: adsCount,
        running_days: runningDays
      });
      onClose();
    } catch (err) {
      setError(err.message || 'Erro ao salvar oferta.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form className="modal" onSubmit={handleSubmit}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">Oferta Minerada</p>
            <h2>{offer ? 'Editar Oferta' : 'Nova Oferta Minerada'}</h2>
          </div>
          <button className="modal-close-btn" type="button" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        {previewAvatar && (
          <div className="avatar-preview-box">
            <img
              src={previewAvatar}
              alt="Avatar Anunciante"
              onError={(e) => (e.currentTarget.style.display = 'none')}
            />
            <div>
              <strong>Logo do Anunciante Meta Detectado</strong>
              <small>ID da Página: {extractPageIdFromUrl(formData.library_url)}</small>
            </div>
          </div>
        )}

        <div className="form-grid">
          <label className="field full">
            <span>Nome da Oferta / Produto</span>
            <input
              type="text"
              required
              value={formData.name}
              placeholder="Ex: VSL Sérum Clareador Black"
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </label>

          <label className="field full">
            <span>URL da Biblioteca de Anúncios Meta</span>
            <input
              type="url"
              required
              value={formData.library_url}
              placeholder="https://www.facebook.com/ads/library/?view_all_page_id=..."
              onChange={(e) => handleLibraryUrlChange(e.target.value)}
            />
          </label>

          <label className="field">
            <span>Nicho / Categoria</span>
            <select
              value={formData.niche}
              onChange={(e) => setFormData({ ...formData, niche: e.target.value })}
            >
              {NICHE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Status da Oferta</span>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
            >
              {Object.values(STATUS_CONFIG).map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          {formData.niche === 'Outros (Personalizado)' && (
            <label className="field full">
              <span>Digite o Nome do Nicho Personalizado</span>
              <input
                type="text"
                required
                placeholder="Ex: Criptomoedas, Tarot, Artesanato, Gamer..."
                value={formData.custom_niche}
                onChange={(e) => setFormData({ ...formData, custom_niche: e.target.value })}
              />
            </label>
          )}

          <label className="field">
            <span>Anúncios Ativos (Contagem Atual)</span>
            <input
              type="number"
              min="0"
              required
              value={formData.initial_results}
              placeholder="Ex: 130"
              onChange={(e) =>
                setFormData({ ...formData, initial_results: e.target.value })
              }
            />
          </label>

          <label className="field">
            <span>Há quantos dias está rodando?</span>
            <input
              type="number"
              min="1"
              required
              value={formData.running_days}
              placeholder="Ex: 600"
              onChange={(e) =>
                setFormData({ ...formData, running_days: e.target.value })
              }
            />
          </label>

          <label className="field full">
            <span>Link da Página de Vendas / Checkout (Opcional)</span>
            <input
              type="url"
              value={formData.destination_url}
              placeholder="https://produto.com.br/vsl"
              onChange={(e) =>
                setFormData({ ...formData, destination_url: e.target.value })
              }
            />
          </label>

          <label className="field full">
            <span>Anotações de Espionagem / Funil</span>
            <textarea
              value={formData.notes}
              placeholder="Detalhes do criativo, hook usado, preço, ticket médio, upsell..."
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            />
          </label>
        </div>

        <p className="form-hint">
          Ao salvar, o sistema analisa os parâmetros da URL, sincroniza o avatar do anunciante no Facebook Graph e atualiza o histórico e os dias rodando.
        </p>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button className="secondary" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary" type="submit" disabled={loading}>
            {loading ? 'Processando...' : 'Salvar Oferta'}
          </button>
        </div>
      </form>
    </div>
  );
}
