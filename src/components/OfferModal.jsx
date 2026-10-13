import React, { useState } from 'react';
import { extractPageIdFromUrl, NICHE_OPTIONS, STATUS_CONFIG, getFbAvatarUrl } from '../utils/metaParser';
import { classifyStatus, STAGE_DAYS } from '../utils/offerMeta';
import useLockBodyScroll from '../utils/useLockBodyScroll';
import { safeImageSrc } from '../utils/url';

// Valor especial do seletor: deixa o estágio ser recalculado pelo tempo.
const AUTO_STATUS = 'auto';

const EMPTY_OFFER = {
  name: '',
  page_name: '',
  library_url: '',
  destination_url: '',
  niche: '',
  status: AUTO_STATUS,
  notes: '',
  initial_results: '1',
  running_days: '1'
};

export default function OfferModal({ offer, onClose, onSave, nicheSuggestions = [] }) {
  useLockBodyScroll();
  // Categorias para sugerir: as padrão + as que a pessoa já criou.
  const niches = Array.from(new Set([...NICHE_OPTIONS, ...nicheSuggestions].filter(Boolean)));

  const [formData, setFormData] = useState(
    offer
      ? {
          name: offer.name || '',
          page_name: offer.meta?.page_name || '',
          library_url: offer.library_url || '',
          destination_url: offer.destination_url || offer.landing_page || '',
          niche: offer.niche || '',
          status: offer.meta?.status_manual ? offer.status : AUTO_STATUS,
          notes: offer.notes || offer.funnel_notes || '',
          initial_results: String(offer.ads_count ?? 1),
          running_days: String(offer.running_days ?? 1)
        }
      : EMPTY_OFFER
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // ID numérico real da página. O '4' é o valor de descarte de
  // extractPageIdFromUrl (e por acaso é uma página real do Facebook), então
  // ele nunca pode virar ID exibido nem endereço de foto.
  const paginaId =
    offer?.page_id && offer.page_id !== 'N/A' && offer.page_id !== '4' ? offer.page_id : null;

  const [previewAvatar, setPreviewAvatar] = useState(
    // A foto já gravada é a real; o Graph é palpite e devolve silhueta em
    // parte das páginas — era a bolinha vazia que aparecia aqui.
    () => safeImageSrc(offer?.avatar_url) || (paginaId ? getFbAvatarUrl(paginaId) : null)
  );
  const [avatarFalhou, setAvatarFalhou] = useState(false);

  function handleLibraryUrlChange(url) {
    setFormData((prev) => ({ ...prev, library_url: url }));

    // Só arrisca o palpite pela URL quando não há foto gravada para mostrar.
    if (url.trim() && !offer?.avatar_url) {
      const pageId = extractPageIdFromUrl(url);
      if (pageId && pageId !== '4') {
        setPreviewAvatar(getFbAvatarUrl(pageId));
        setAvatarFalhou(false);
      }
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!formData.name.trim() || !formData.library_url.trim()) {
      setError('Preencha o nome do produto e a URL da biblioteca.');
      return;
    }

    // Categoria escrita à mão vale igual às da lista.
    const finalNiche = formData.niche.trim().replace(/\s+/g, ' ').slice(0, 80) || 'Outros';

    // O ID já gravado (vindo da extensão) vale mais do que o palpite genérico
    // da URL — só o substituímos quando a URL revela um ID de página real.
    const parsedPageId = extractPageIdFromUrl(formData.library_url);
    const pageId =
      parsedPageId && parsedPageId !== '4'
        ? parsedPageId
        : offer?.page_id || parsedPageId || 'N/A';
    const adsCount = Math.max(0, parseInt(formData.initial_results, 10) || 1);
    const runningDays = Math.max(1, parseInt(formData.running_days, 10) || 1);

    setLoading(true);
    setError('');

    try {
      const isAutoStatus = formData.status === AUTO_STATUS;

      await onSave({
        name: formData.name.trim(),
        library_url: formData.library_url.trim(),
        destination_url: formData.destination_url.trim() || formData.library_url.trim(),
        landing_page: formData.destination_url.trim() || formData.library_url.trim(),
        niche: finalNiche,
        status: isAutoStatus ? classifyStatus(runningDays) : formData.status,
        status_manual: !isAutoStatus,
        notes: formData.notes,
        funnel_notes: formData.notes,
        page_id: pageId,
        ads_count: adsCount,
        running_days: runningDays,
        // Vazio apaga do bloco de metadados.
        meta: { page_name: formData.page_name.trim().slice(0, 200) || null }
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

        {previewAvatar && !avatarFalhou && (
          <div className="avatar-preview-box">
            {/* Se a imagem não carregar, o bloco inteiro some — antes ficava
                a borda da foto sozinha, parecendo um card quebrado. */}
            <img
              src={previewAvatar}
              alt="Foto do anunciante"
              onError={() => setAvatarFalhou(true)}
            />
            <div>
              <strong>Anunciante</strong>
              {paginaId && <small>ID da página: {paginaId}</small>}
            </div>
          </div>
        )}

        <div className="form-grid">
          <label className="field">
            <span>Nome do produto</span>
            <input
              type="text"
              required
              value={formData.name}
              placeholder="Ex: Receitas Italianas"
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </label>

          <label className="field">
            <span>Página do Facebook (quem anuncia)</span>
            <input
              type="text"
              value={formData.page_name}
              placeholder="Ex: Fernanda Rocha"
              onChange={(e) => setFormData({ ...formData, page_name: e.target.value })}
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
            <span>Categoria</span>
            <input
              type="text"
              list="minerai-niche-options"
              value={formData.niche}
              maxLength={80}
              placeholder="Escolha da lista ou escreva a sua"
              onChange={(e) => setFormData({ ...formData, niche: e.target.value })}
            />
            <datalist id="minerai-niche-options">
              {niches.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>

          <label className="field">
            <span>Status da Oferta</span>
            <select
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
            >
              <option value={AUTO_STATUS}>Automático (pelo tempo rodando)</option>
              {Object.values(STATUS_CONFIG).map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>


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
            <span>Link da página de vendas (opcional)</span>
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
          O tempo rodando é convertido em data de início: a partir daí o contador
          avança sozinho todo dia, sem você precisar editar a oferta de novo. No
          status <strong>Automático</strong>, o estágio acompanha esse tempo — até{' '}
          {STAGE_DAYS.pre_scaling - 1} dias em teste, {STAGE_DAYS.pre_scaling} a{' '}
          {STAGE_DAYS.scaling - 1} pré-escala, {STAGE_DAYS.scaling} a{' '}
          {STAGE_DAYS.winner - 1} escalando e {STAGE_DAYS.winner}+ vencedor.
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
