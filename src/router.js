import { useEffect, useState } from 'react';

/**
 * Roteador mínimo por caminho (sem dependência externa).
 * A Vercel já reescreve tudo para index.html e o Vite dev também, então
 * /oferta/abc funciona ao recarregar a página.
 */
const NAV_EVENT = 'minerai:navigate';

export function currentPath() {
  return window.location.pathname + window.location.search;
}

export function navigate(path, { replace = false } = {}) {
  if (path === currentPath()) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
  window.dispatchEvent(new Event(NAV_EVENT));
}

export function useRoute() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const handler = () => setPath(currentPath());
    window.addEventListener('popstate', handler);
    window.addEventListener(NAV_EVENT, handler);
    return () => {
      window.removeEventListener('popstate', handler);
      window.removeEventListener(NAV_EVENT, handler);
    };
  }, []);
  return path;
}

export const PAGES = {
  garimpo: { path: '/garimpo', label: 'Garimpo', icon: '⛏️', hint: 'Ofertas por tab, lista e esteira' },
  favoritos: { path: '/favoritos', label: 'Favoritos', icon: '★', hint: 'Suas esteiras de ofertas favoritas' },
  modelar: { path: '/modelar', label: 'Modelar', icon: '📐', hint: 'Capturas de páginas' },
  inteligencia: { path: '/inteligencia', label: 'Inteligência', icon: '📊', hint: 'Nichos, anunciantes, tendências' },
  alertas: { path: '/alertas', label: 'Alertas', icon: '🔔', hint: 'Medições e mudanças' },
  compartilhar: { path: '/compartilhar', label: 'Compartilhar', icon: '🔗', hint: 'Links públicos e exportação' },
  extensao: { path: '/extensao', label: 'Extensão', icon: '🧩', hint: 'Status e instalação' },
  conta: { path: '/conta', label: 'Conta e plano', icon: '⭐', hint: 'Perfil, plano e uso' }
};

export const PAGE_ORDER = ['garimpo', 'favoritos', 'modelar', 'inteligencia', 'alertas', 'compartilhar', 'extensao', 'conta'];

/** Converte o caminho atual em { page, params, query }. */
export function matchRoute(path) {
  const [pathname, search = ''] = path.split('?');
  const query = new URLSearchParams(search);
  const parts = pathname.split('/').filter(Boolean);

  if (parts.length === 0 || parts[0] === 'garimpo') return { page: 'garimpo', params: {}, query };
  if (parts[0] === 'oferta' && parts[1]) return { page: 'oferta', params: { id: parts[1] }, query };

  const key = PAGE_ORDER.find((k) => PAGES[k].path === `/${parts[0]}`);
  if (key) return { page: key, params: {}, query };

  return { page: 'garimpo', params: {}, query };
}
