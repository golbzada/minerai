import React, { useMemo, useState } from 'react';
import PageGuide from '../components/PageGuide';
import ResultModal from '../components/ResultModal';
import { api } from '../services/api';
import { useAppData } from '../context/AppData';
import { navigate } from '../router';
import { computeAlerts, ALERT_LABELS, loadAlertPrefs, saveAlertPrefs, ALERT_DEFAULTS, ultimoRastreioHoje } from '../utils/offerExtras';
import { getAccess, lockedMessage } from '../utils/plan';
import { resolveStatus } from '../utils/offerMeta';

const PREFS_REMINDERS_KEY = 'minerai_reminder_prefs';

function loadReminderPrefs() {
  try {
    return { email: false, whatsapp: false, ...(JSON.parse(localStorage.getItem(PREFS_REMINDERS_KEY) || '{}')) };
  } catch (e) {
    return { email: false, whatsapp: false };
  }
}

/** Alertas e rotina: o que precisa de medição, quedas, longa duração e mudanças de estágio. */
export default function AlertsPage() {
  const { offers, user, setNotice, applyOffer } = useAppData();
  const [prefs, setPrefs] = useState(loadAlertPrefs);
  const [reminders, setReminders] = useState(loadReminderPrefs);
  const [typeFilter, setTypeFilter] = useState('all');
  const [target, setTarget] = useState(null);

  const access = getAccess(user);
  const locked = Boolean(user) && !access.active;

  const alerts = useMemo(() => computeAlerts(offers, prefs), [offers, prefs]);
  const visible = typeFilter === 'all' ? alerts : alerts.filter((a) => a.type === typeFilter);
  const needMeasure = alerts.filter((a) => a.type === 'medicao');
  const rastreioHora = useMemo(() => ultimoRastreioHoje(offers), [offers]);

  function updatePref(key, value) {
    const next = { ...prefs, [key]: Math.max(1, Number(value) || ALERT_DEFAULTS[key]) };
    setPrefs(next);
    saveAlertPrefs(next);
  }

  function updateReminder(key) {
    const next = { ...reminders, [key]: !reminders[key] };
    setReminders(next);
    try {
      localStorage.setItem(PREFS_REMINDERS_KEY, JSON.stringify(next));
    } catch (e) {}
  }

  async function saveMeasurement(offer, count, date) {
    if (locked) {
      setNotice(lockedMessage(user));
      return;
    }
    try {
      const res = await api.addDailyResult(offer.id, count, date);
      applyOffer(res.offer);
      setNotice(res.message);
    } catch (err) {
      setNotice(err.message);
    }
  }

  async function acknowledgeStage(offer) {
    // Grava no banco o estágio que o painel já mostra (sem fixar à mão).
    try {
      const res = await api.updateOffersBulk([offer.id], { status: alertStatus(offer) });
      if (res.count) {
        const fresh = await api.patchOfferMeta(offer.id, {});
        applyOffer(fresh.offer);
        setNotice('Estágio atualizado no banco.');
      }
    } catch (err) {
      setNotice(err.message);
    }
  }

  return (
    <div className="alerts-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Alertas e rotina</p>
          <h1 className="page-title">O que pede <em>atenção.</em></h1>
          <p className="page-sub">
            {rastreioHora
              ? `Ofertas atualizadas automaticamente hoje às ${rastreioHora}. `
              : 'A extensão Mineraí mede suas ofertas sozinha uma vez por dia, com o Chrome aberto. '}
            Ajuste os limites abaixo do jeito que você trabalha.
          </p>
        </div>
      </div>

      <PageGuide
        id="alertas"
        why="Avisa o que pede a sua atenção hoje, para você não perder a hora de agir numa oferta."
        steps={[
            <>A extensão mede suas ofertas sozinha uma vez por dia e avisa aqui quando uma <strong>escalou</strong>, está <strong>decaindo</strong> ou <strong>morreu</strong>.</>,
            <><strong>Rotina de hoje</strong> lista só as ofertas que o rastreio não conseguiu medir. Abra cada uma e anote os anúncios do dia.</>,
            <>Ajuste os <strong>limites</strong> (ex.: quantos dias sem medir) do jeito que você trabalha.</>
        ]}
      />

      <div className="insight-grid two">
        <div className="panel">
          <p className="eyebrow">Rotina de hoje</p>
          <p className="muted">{needMeasure.length ? `${needMeasure.length} ${needMeasure.length === 1 ? 'oferta precisa' : 'ofertas precisam'} de medição.` : 'Todas as ofertas estão com medição em dia.'}</p>
          <ul className="routine-list">
            {needMeasure.slice(0, 8).map((a) => (
              <li key={a.offer.id}>
                <button type="button" className="link-name" onClick={() => navigate(`/oferta/${a.offer.id}`)}>{a.offer.name}</button>
                <small>{a.text}</small>
                {!locked && <button type="button" className="mini-btn" onClick={() => setTarget(a.offer)}>+ Medir</button>}
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <p className="eyebrow">Limites dos alertas</p>
          <div className="pref-grid">
            <label><span>Sem medição há (dias)</span><input type="number" min="1" value={prefs.diasSemMedicao} onChange={(e) => updatePref('diasSemMedicao', e.target.value)} /></label>
            <label><span>Longa duração a partir de (dias)</span><input type="number" min="1" value={prefs.diasLonga} onChange={(e) => updatePref('diasLonga', e.target.value)} /></label>
            <label><span>Queda de anúncios (%)</span><input type="number" min="1" max="100" value={prefs.quedaPercentual} onChange={(e) => updatePref('quedaPercentual', e.target.value)} /></label>
          </div>

          <p className="eyebrow" style={{ marginTop: 16 }}>Lembretes</p>
          <label className="switch-row">
            <input type="checkbox" checked={reminders.email} onChange={() => updateReminder('email')} />
            <span>Resumo diário por e-mail <em className="soon-tag">em breve</em></span>
          </label>
          <label className="switch-row">
            <input type="checkbox" checked={reminders.whatsapp} onChange={() => updateReminder('whatsapp')} />
            <span>Resumo diário no WhatsApp <em className="soon-tag">em breve</em></span>
          </label>
          <p className="muted small">A preferência fica guardada; o envio entra quando o disparador estiver ligado.</p>
        </div>
      </div>

      <div className="garimpo-bar">
        <div className="view-switch">
          <button type="button" className={typeFilter === 'all' ? 'active' : ''} onClick={() => setTypeFilter('all')}>Todos ({alerts.length})</button>
          {Object.entries(ALERT_LABELS).map(([type, info]) => {
            const n = alerts.filter((a) => a.type === type).length;
            return (
              <button key={type} type="button" className={typeFilter === type ? 'active' : ''} onClick={() => setTypeFilter(type)}>
                {info.icon} {info.label} ({n})
              </button>
            );
          })}
        </div>
      </div>

      {!visible.length && <div className="empty">Nenhum alerta neste filtro. Bom sinal.</div>}

      <ul className="alert-list">
        {visible.map((a, i) => (
          <li key={`${a.type}-${a.offer.id}-${i}`} className={`alert-item sev-${a.severity}`}>
            <span className="alert-icon" aria-hidden="true">{ALERT_LABELS[a.type].icon}</span>
            <div className="alert-body">
              <strong>
                <button type="button" className="link-name" onClick={() => navigate(`/oferta/${a.offer.id}`)}>{a.offer.name}</button>
              </strong>
              <span>{ALERT_LABELS[a.type].label}: {a.text}</span>
            </div>
            <div className="alert-actions">
              {a.type === 'medicao' && !locked && <button type="button" className="mini-btn" onClick={() => setTarget(a.offer)}>+ Medir agora</button>}
              {a.type === 'estagio' && !locked && <button type="button" className="mini-btn" onClick={() => acknowledgeStage(a.offer)}>Confirmar estágio</button>}
              <button type="button" className="mini-btn" onClick={() => navigate(`/oferta/${a.offer.id}`)}>Abrir</button>
            </div>
          </li>
        ))}
      </ul>

      {target && <ResultModal offer={target} onClose={() => setTarget(null)} onSave={saveMeasurement} />}
    </div>
  );
}

/** Mesma regra do painel: estágio pelo tempo rodando. */
function alertStatus(offer) {
  return resolveStatus(offer);
}
