import React, { useMemo, useState } from 'react';
import PageGuide from '../components/PageGuide';
import { api } from '../services/api';
import { useAppData } from '../context/AppData';
import { getAccess, PLAN_LABELS } from '../utils/plan';
import { formatCpfCnpj } from '../utils/metaParser';

/** Conta, plano e uso. plan/active só mudam pelo servidor; aqui é leitura. */
export default function AccountPage({ onExport }) {
  const { user, setUser, logout, offers, tabs, setNotice } = useAppData();
  const access = getAccess(user);

  const [name, setName] = useState(user?.name || '');
  const [cpf, setCpf] = useState(user?.cpf_cnpj ? formatCpfCnpj(user.cpf_cnpj) : '');
  const [saving, setSaving] = useState(false);

  const usage = useMemo(() => {
    const imageBytes = offers.reduce((acc, o) => acc + (o.creative_thumb ? o.creative_thumb.length * 0.75 : 0) + (o.avatar_url?.startsWith('data:') ? o.avatar_url.length * 0.75 : 0), 0);
    const favs = offers.filter((o) => o.meta?.fav).length;
    return { offers: offers.length, tabs: tabs.length, imageMb: (imageBytes / 1048576).toFixed(1), favs };
  }, [offers, tabs]);

  async function save(e) {
    e.preventDefault();
    const digits = cpf.replace(/\D/g, '');
    if (!name.trim()) {
      setNotice('Informe seu nome.');
      return;
    }
    if (digits && digits.length !== 11 && digits.length !== 14) {
      setNotice('CPF precisa ter 11 dígitos e CNPJ 14 dígitos.');
      return;
    }
    setSaving(true);
    try {
      const res = await api.updateProfile({ name: name.trim(), cpf_cnpj: digits });
      setUser({ ...user, ...res.user });
      setNotice(res.message);
    } catch (err) {
      setNotice(err.message);
    } finally {
      setSaving(false);
    }
  }

  const since = user?.created_at ? new Date(user.created_at).toLocaleDateString('pt-BR') : '—';
  const trialEnds = user?.trial_ends_at ? new Date(user.trial_ends_at).toLocaleDateString('pt-BR') : null;

  return (
    <div className="account-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Minha conta</p>
          <h1 className="page-title">Conta e <em>plano.</em></h1>
        </div>
      </div>

      <PageGuide
        id="conta"
        why="Seus dados, o seu plano e as suas preferências."
        steps={[
            <>Em <strong>Plano atual</strong> você vê quantos dias faltam do teste ou do plano.</>,
            <>Em <strong>Perfil</strong> você atualiza o seu nome e CPF/CNPJ.</>
        ]}
      />

      <div className="insight-grid two">
        <div className="panel plan-panel">
          <p className="eyebrow">Plano atual</p>
          <div className="plan-hero">
            <strong>{access.label}</strong>
            <span className="status-badge" style={access.active ? { color: '#00875a', background: '#e3fcef', borderColor: '#abf5d1' } : { color: '#b42318', background: '#fdf2f0', borderColor: '#f5c6cb' }}>
              {access.active ? 'Ativo' : 'Inativo'}
            </span>
          </div>
          <ul className="plain-list compact">
            <li><span>Tipo</span><strong>{PLAN_LABELS[user?.plan] || 'Sem plano'}</strong></li>
            {access.isTrial && <li><span>Teste termina em</span><strong>{trialEnds || '—'} ({access.daysLeft} dias)</strong></li>}
            <li><span>Conta criada em</span><strong>{since}</strong></li>
            <li><span>E-mail</span><strong>{user?.email}</strong></li>
          </ul>
          <div className="action-stack">
            <button type="button" className="primary" disabled title="A assinatura por cartão entra quando o pagamento estiver ligado">💳 Assinar / trocar plano <em className="soon-tag light">em breve</em></button>
            <button type="button" className="secondary" disabled>🧾 Histórico de pagamentos <em className="soon-tag">em breve</em></button>
          </div>
        </div>

        <div className="panel">
          <p className="eyebrow">Uso</p>
          <div className="usage-grid">
            <div><strong>{usage.offers}</strong><span>ofertas</span></div>
            <div><strong>{usage.tabs}</strong><span>tabs</span></div>
            <div><strong>{usage.favs}</strong><span>favoritas</span></div>
            <div><strong>{usage.imageMb} MB</strong><span>em imagens</span></div>
          </div>
          <p className="muted small">Imagens são as miniaturas de criativos e fotos de anunciantes guardadas no acervo.</p>
          <div className="action-stack">
            <button type="button" className="secondary" onClick={onExport}>💾 Backup completo (JSON)</button>
          </div>
        </div>

        <div className="panel">
          <p className="eyebrow">Perfil</p>
          <form className="profile-form" onSubmit={save}>
            <label className="field"><span>Nome completo</span><input type="text" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="field"><span>E-mail da conta</span><input type="email" value={user?.email || ''} readOnly disabled /></label>
            <label className="field"><span>CPF ou CNPJ (opcional)</span><input type="text" inputMode="numeric" maxLength={18} value={cpf} placeholder="000.000.000-00" onChange={(e) => setCpf(formatCpfCnpj(e.target.value))} /></label>
            <div className="modal-actions" style={{ borderTop: 0, paddingTop: 0 }}>
              <button className="primary" type="submit" disabled={saving}>{saving ? 'Salvando...' : 'Salvar alterações'}</button>
            </div>
          </form>
        </div>

        <div className="panel">
          <p className="eyebrow">Preferências</p>
          <ul className="plain-list compact">
            <li><span>Tema</span><strong>Claro <em className="soon-tag">escuro em breve</em></strong></li>
            <li><span>Idioma</span><strong>Português (Brasil)</strong></li>
            <li><span>Fuso horário</span><strong>{Intl.DateTimeFormat().resolvedOptions().timeZone}</strong></li>
          </ul>
          <div className="action-stack">
            <button type="button" className="secondary danger-text" onClick={logout}>🚪 Sair da conta</button>
          </div>
        </div>
      </div>
    </div>
  );
}
