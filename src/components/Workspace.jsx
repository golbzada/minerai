import React, { useEffect, useMemo, useRef, useState } from 'react';
import useRevelar from '../utils/useRevelar';
import Topbar from './Topbar';
import Sidebar, { BottomBar } from './Sidebar';
import { AppDataProvider, useAppData } from '../context/AppData';
import { useRoute, matchRoute, navigate, PAGE_ORDER, PAGES } from '../router';
import { api } from '../services/api';
import { loadModelagens } from '../utils/modelagens';
import GarimpoPage from '../pages/GarimpoPage';
import FavoritosPage from '../pages/FavoritosPage';
import RadarPage from '../pages/RadarPage';
import OfferPage from '../pages/OfferPage';
import ModelarPage from '../pages/ModelarPage';
import InsightsPage from '../pages/InsightsPage';
import AlertsPage from '../pages/AlertsPage';
import SharingPage from '../pages/SharingPage';
import ExtensionPage from '../pages/ExtensionPage';
import AccountPage from '../pages/AccountPage';

const COLLAPSE_KEY = 'minerai_sidebar_collapsed';

/**
 * Casca do painel autenticado: menu lateral + conteúdo da página atual.
 * O App continua cuidando de login, link de share e redefinição de senha.
 */
// O que surge ao rolar: um bloco repetido por lista, nunca o que se arrasta.
const REVELAR = '.board > .offer-item, .radar-grid > *, .insight-grid > *, .alert-list > *, .share-list > *, .modelagem-list > *';

export default function Workspace({ user, onLogout, onUpdateUser }) {
  return (
    <AppDataProvider user={user} onUserChange={onUpdateUser} onLogout={onLogout}>
      <Shell />
    </AppDataProvider>
  );
}

function Shell() {
  const data = useAppData();
  const path = useRoute();
  const route = useMemo(() => matchRoute(path), [path]);
  // Blocos que surgem ao rolar (cards do acervo, radar, inteligência...).
  const conteudoRef = useRef(null);
  useRevelar(conteudoRef, REVELAR, route.page);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch (e) {
      return false;
    }
  });
  const [modelagensProntas, setModelagensProntas] = useState(() => loadModelagens().filter((m) => m.status === 'pronto').length);

  useEffect(() => {
    const onModelagens = () => setModelagensProntas(loadModelagens().filter((m) => m.status === 'pronto').length);
    window.addEventListener('minerai:modelagens', onModelagens);
    return () => {
      window.removeEventListener('minerai:modelagens', onModelagens);
    };
  }, []);

  // Atalhos Alt+1..7 para trocar de página.
  useEffect(() => {
    function onKey(e) {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= PAGE_ORDER.length) {
        e.preventDefault();
        navigate(PAGES[PAGE_ORDER[n - 1]].path);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Sobe a página ao trocar de rota.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route.page, route.params.id]);

  function toggleCollapse() {
    setCollapsed((v) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1');
      } catch (e) {}
      return !v;
    });
  }


  async function handleExportBackup() {
    try {
      const jsonStr = await api.exportData();
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `minerai_backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      data.setNotice('Backup do acervo exportado com sucesso!');
    } catch (err) {
      data.setNotice(err.message || 'Erro ao exportar backup.');
    }
  }

  const counts = { ...data.counts, modelagens: modelagensProntas };

  let pageEl;
  switch (route.page) {
    case 'oferta':
      pageEl = <OfferPage id={route.params.id} />;
      break;
    case 'radar':
      pageEl = <RadarPage />;
      break;
    case 'favoritos':
      pageEl = <FavoritosPage />;
      break;
    case 'modelar':
      pageEl = <ModelarPage query={route.query} />;
      break;
    case 'inteligencia':
      pageEl = <InsightsPage />;
      break;
    case 'alertas':
      pageEl = <AlertsPage />;
      break;
    case 'compartilhar':
      pageEl = <SharingPage />;
      break;
    case 'extensao':
      pageEl = <ExtensionPage />;
      break;
    case 'conta':
      pageEl = <AccountPage onExport={handleExportBackup} />;
      break;
    default:
      pageEl = <GarimpoPage query={route.query} onExport={handleExportBackup} />;
  }

  return (
    <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
      <Sidebar
        page={route.page}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
        counts={counts}
        onSearch={(q) => navigate(`/garimpo?q=${encodeURIComponent(q)}`)}
      />

      <div className="shell-main">
        <main className="app">
          <Topbar
            user={data.user}
            onLogout={data.logout}
            onExport={handleExportBackup}
            onUpdateUser={data.setUser}
            onOpenExtension={() => navigate('/extensao')}
          />

          {data.notice && (
            <p className="notice" onClick={() => data.setNotice('')} title="Clique para fechar">
              {data.notice}
            </p>
          )}

          {/* A chave por página remonta só o conteúdo da direita: ele entra
              suave a cada troca no menu, e o menu fica parado. */}
          <div className="page-enter" key={route.page} ref={conteudoRef}>
            {pageEl}
          </div>
        </main>
      </div>

      <BottomBar page={route.page} counts={counts} />
    </div>
  );
}
