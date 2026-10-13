import React, { useEffect, useState } from 'react';
import PageGuide from '../components/PageGuide';
import { api } from '../services/api';
import { useAppData } from '../context/AppData';
import { offersToCsv, downloadText } from '../utils/offerExtras';
import { getAccess, lockedMessage } from '../utils/plan';

/** Links públicos (criar, copiar, revogar), exportações e o que vem de equipe. */
export default function SharingPage() {
  const { tabs, offers, user, setNotice, activeTabId } = useAppData();
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tabId, setTabId] = useState(activeTabId || tabs[0]?.id || '');
  const [days, setDays] = useState(30);
  const [creating, setCreating] = useState(false);
  const [lastLink, setLastLink] = useState('');

  const access = getAccess(user);
  const locked = Boolean(user) && !access.active;

  useEffect(() => {
    if (!tabId && tabs[0]) setTabId(tabs[0].id);
  }, [tabs, tabId]);

  async function load() {
    try {
      const res = await api.listShares();
      setShares(res.shares);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const linkFor = (token) => `${window.location.origin}/#share=${token}`;

  function copy(url) {
    navigator.clipboard.writeText(url).then(
      () => setNotice('Link copiado para a área de transferência.'),
      () => window.prompt('Copie o link:', url)
    );
  }

  async function create(e) {
    e.preventDefault();
    if (locked) {
      setNotice(lockedMessage(user));
      return;
    }
    if (!tabId) return;
    setCreating(true);
    try {
      const res = await api.createShareLink(tabId, { days });
      const url = linkFor(res.token);
      setLastLink(url);
      copy(url);
      await load();
    } catch (err) {
      setNotice(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function revoke(share) {
    if (!window.confirm(`Revogar o link da tab "${share.tab_name}"? Quem tiver o endereço deixa de conseguir abrir.`)) return;
    try {
      const res = await api.deleteShare(share.id);
      setNotice(res.message);
      setShares((prev) => prev.filter((s) => s.id !== share.id));
    } catch (err) {
      setNotice(err.message);
    }
  }

  function exportCsv(scopeTabId) {
    const list = scopeTabId ? offers.filter((o) => o.tab_id === scopeTabId) : offers;
    const tabName = tabs.find((t) => t.id === scopeTabId)?.name || 'acervo';
    downloadText(`minerai_${tabName.replace(/\s+/g, '-').toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv`, offersToCsv(list), 'text/csv;charset=utf-8');
    setNotice(`CSV de ${tabName} exportado (${list.length} ofertas).`);
  }

  const fmt = (d) => new Date(d).toLocaleDateString('pt-BR');
  const daysLeft = (d) => Math.max(0, Math.ceil((new Date(d) - Date.now()) / 86400000));

  return (
    <div className="sharing-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Compartilhar e exportar</p>
          <h1 className="page-title">Mostre o garimpo <em>sem entregar o ouro.</em></h1>
          <p className="page-sub">Links públicos são somente leitura e nunca levam seu link de afiliado nem suas anotações.</p>
        </div>
      </div>

      <PageGuide
        id="compartilhar"
        why="Mostre o seu garimpo a alguém (sócio, aluno, cliente) sem entregar o seu link de afiliado nem as suas anotações."
        steps={[
            <>Escolha a tab e crie um <strong>link público</strong>. Quem abrir só consegue ver; não mexe em nada.</>,
            <>Em <strong>Links ativos</strong> você vê e apaga os links quando quiser.</>,
            <>Em <strong>Exportar</strong> você baixa uma planilha para abrir no Excel ou no Google Sheets.</>
        ]}
      />

      <div className="insight-grid two">
        <div className="panel">
          <p className="eyebrow">Novo link público</p>
          <form className="share-form" onSubmit={create}>
            <label>
              <span>Tab</span>
              <select value={tabId} onChange={(e) => setTabId(e.target.value)}>
                {tabs.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.offers_count})</option>)}
              </select>
            </label>
            <label>
              <span>Validade</span>
              <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                <option value={7}>7 dias</option>
                <option value={30}>30 dias</option>
                <option value={90}>90 dias</option>
              </select>
            </label>
            <button className="primary" type="submit" disabled={creating || !tabId || locked}>{creating ? 'Gerando...' : '🔗 Gerar e copiar link'}</button>
          </form>
          {lastLink && (
            <p className="share-last">
              <code>{lastLink}</code>
              <button type="button" className="mini-btn" onClick={() => copy(lastLink)}>copiar</button>
            </p>
          )}
          <p className="muted small">O link é um retrato das ofertas no momento em que foi gerado. Novas ofertas não entram nele.</p>
        </div>

        <div className="panel">
          <p className="eyebrow">Exportar</p>
          <p className="muted">Planilha (CSV) para abrir no Excel ou Google Sheets.</p>
          <div className="action-stack">
            <button type="button" className="secondary" onClick={() => exportCsv(null)}>⬇️ Acervo completo em CSV ({offers.length})</button>
            {tabs.map((t) => (
              <button key={t.id} type="button" className="secondary" onClick={() => exportCsv(t.id)}>⬇️ Tab {t.name} em CSV ({t.offers_count})</button>
            ))}
          </div>
          <p className="muted small">O backup completo em JSON (com imagens) continua no menu do seu perfil, em "Backup do Acervo".</p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <p className="eyebrow">Links ativos</p>
          <span className="muted">{shares.length} {shares.length === 1 ? 'link' : 'links'}</span>
        </div>
        {loading && <p className="muted">Carregando...</p>}
        {!loading && !shares.length && <p className="muted">Você ainda não gerou nenhum link público.</p>}
        <ul className="share-list">
          {shares.map((s) => {
            const left = daysLeft(s.expires_at);
            return (
              <li key={s.id} className={`share-row ${left === 0 ? 'expired' : ''}`}>
                <div>
                  <strong>{s.tab_name}</strong>
                  <small>Criado em {fmt(s.created_at)} · {left === 0 ? 'expirado' : `expira em ${left} ${left === 1 ? 'dia' : 'dias'} (${fmt(s.expires_at)})`}</small>
                  <code>{linkFor(s.share_token)}</code>
                </div>
                <div className="share-actions">
                  <a className="mini-btn" href={linkFor(s.share_token)} target="_blank" rel="noopener noreferrer">abrir</a>
                  <button type="button" className="mini-btn" onClick={() => copy(linkFor(s.share_token))}>copiar</button>
                  <button type="button" className="mini-btn danger" onClick={() => revoke(s)}>revogar</button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="panel soon">
        <p className="eyebrow">Equipe · em breve</p>
        <ul>
          <li>Convidar pessoas para o mesmo acervo com papéis (dono, editor, só leitura).</li>
          <li>Comentários por oferta, com quem escreveu e quando.</li>
          <li>Exportar uma tab em PDF com os criativos.</li>
        </ul>
      </div>
    </div>
  );
}
