import React, { useEffect, useState } from 'react';
import PageGuide from '../components/PageGuide';
import { useAppData } from '../context/AppData';
import { NICHE_OPTIONS } from '../utils/metaParser';

const PREFS_KEY = 'minerai_ext_prefs';

function loadPrefs() {
  try {
    return { defaultTab: '', defaultNiche: '', autoCreative: true, ...(JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')) };
  } catch (e) {
    return { defaultTab: '', defaultNiche: '', autoCreative: true };
  }
}

/** Status da extensão, instalação e preferências. */
export default function ExtensionPage() {
  const { tabs } = useAppData();
  const [status, setStatus] = useState('verificando'); // verificando | instalada | ausente
  const [versao, setVersao] = useState('');
  const [prefs, setPrefs] = useState(loadPrefs);
  const [copied, setCopied] = useState('');

  function ping() {
    setStatus('verificando');
    let vivo = true;
    function aoResponder(e) {
      if (e.origin !== window.location.origin || e.source !== window) return;
      if (e.data?.type === 'MINERAI_PONG' && vivo) {
        setStatus('instalada');
        setVersao(e.data.versao || '');
      }
    }
    window.addEventListener('message', aoResponder);
    window.postMessage({ type: 'MINERAI_PING' }, window.location.origin);
    setTimeout(() => {
      vivo = false;
      window.removeEventListener('message', aoResponder);
      setStatus((s) => (s === 'verificando' ? 'ausente' : s));
    }, 1500);
  }

  useEffect(() => {
    ping();
  }, []);

  function savePrefs(patch) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch (e) {}
  }

  function copy(text, key) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 1800);
    });
  }

  return (
    <div className="extension-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Extensão do Chrome</p>
          <h1 className="page-title">Minere direto da <em>Biblioteca.</em></h1>
          <p className="page-sub">A extensão injeta um bloco em cada anúncio da Biblioteca de Anúncios da Meta e salva a oferta aqui com um clique.</p>
        </div>
      </div>

      <PageGuide
        id="extensao"
        why="A extensão é o que traz as ofertas para o Mineraí. Sem ela, você teria que copiar tudo à mão."
        steps={[
            <>Instale seguindo os <strong>3 passos</strong> abaixo. É só uma vez.</>,
            <>Abra a <strong>Biblioteca de Anúncios da Meta</strong> e pesquise um nicho.</>,
            <>Em cada anúncio aparece o botão <strong>Minerar oferta</strong>. Clique e a oferta cai no Garimpo.</>
        ]}
      />

      <div className="insight-grid two">
        <div className="panel">
          <p className="eyebrow">Status nesta aba</p>
          <div className={`ext-status ${status}`}>
            <span className="ext-dot" aria-hidden="true" />
            <div>
              <strong>
                {status === 'verificando' && 'Verificando...'}
                {status === 'instalada' && `Instalada e respondendo${versao ? ` · versão ${versao}` : ''}`}
                {status === 'ausente' && 'Não detectada nesta aba'}
              </strong>
              <small>
                {status === 'instalada' && 'Logue aqui no painel e a extensão passa a salvar as ofertas na sua conta.'}
                {status === 'ausente' && 'Se já instalou, recarregue esta página (F5). A extensão só conversa com o painel depois de carregada.'}
                {status === 'verificando' && 'Aguardando resposta da extensão.'}
              </small>
            </div>
            <button type="button" className="mini-btn" onClick={ping}>Verificar de novo</button>
          </div>

          <a href="/minerai-extensao.zip" download="minerai-extensao.zip" className="primary btn-link full">📥 Baixar extensão (.zip)</a>
          <small className="muted">Chrome, Edge, Brave e Opera. Quando sair versão nova, baixe de novo e recarregue em chrome://extensions.</small>
        </div>

        <div className="panel">
          <p className="eyebrow">Instalação em 3 passos</p>
          <ol className="install-steps">
            <li><strong>Descompacte o .zip</strong> em uma pasta do seu computador (botão direito → "Extrair tudo...").</li>
            <li>
              <strong>Abra a página de extensões</strong> e ligue o "Modo do desenvolvedor".
              <div className="inline-actions">
                <button type="button" className="mini-btn" onClick={() => copy('chrome://extensions', 'chrome')}>{copied === 'chrome' ? '✓ Copiado' : 'Copiar chrome://extensions'}</button>
                <button type="button" className="mini-btn" onClick={() => copy('edge://extensions', 'edge')}>{copied === 'edge' ? '✓ Copiado' : 'Copiar edge://extensions'}</button>
              </div>
            </li>
            <li><strong>Clique em "Carregar sem compactação"</strong> e escolha a pasta descompactada. O ícone dourado aparece na barra.</li>
          </ol>
        </div>

        <div className="panel">
          <p className="eyebrow">Preferências de mineração</p>
          <p className="muted">Guardadas neste navegador. A extensão passa a respeitá-las na próxima atualização dela.</p>
          <div className="pref-grid">
            <label>
              <span>Tab padrão para novas ofertas</span>
              <select value={prefs.defaultTab} onChange={(e) => savePrefs({ defaultTab: e.target.value })}>
                <option value="">Primeira tab (padrão)</option>
                {tabs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label>
              <span>Nicho padrão quando não identificado</span>
              <select value={prefs.defaultNiche} onChange={(e) => savePrefs({ defaultNiche: e.target.value })}>
                <option value="">Deixar a extensão decidir</option>
                {NICHE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          <label className="switch-row">
            <input type="checkbox" checked={prefs.autoCreative} onChange={() => savePrefs({ autoCreative: !prefs.autoCreative })} />
            <span>Guardar a miniatura do criativo ao minerar</span>
          </label>
        </div>

        <div className="panel soon">
          <p className="eyebrow">Em breve</p>
          <ul>
            <li>Log das últimas minerações feitas pela extensão, com o erro quando houver.</li>
            <li>Aviso automático aqui quando sair versão nova.</li>
            <li>Botão "Modelar" dentro de cada anúncio da Biblioteca.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
