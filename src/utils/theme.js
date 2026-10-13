import { useEffect, useState } from 'react';

/**
 * Tema claro/escuro.
 * Sem escolha salva, segue o tema do sistema (e muda junto se o sistema
 * mudar). Depois que a pessoa clica no botão, vale a escolha dela.
 * public/tema.js faz o mesmo antes do React carregar: manter a chave igual.
 */
const KEY = 'minerai-tema';
const media = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

function savedChoice() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'claro' || v === 'escuro' ? v : null;
  } catch (e) {
    return null;
  }
}

function currentTheme() {
  return savedChoice() || (media?.matches ? 'escuro' : 'claro');
}

function applyTheme(theme) {
  const dark = theme === 'escuro';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#12110E' : '#FDF8ED');
}

export function useTheme() {
  const [theme, setTheme] = useState(currentTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Segue o sistema enquanto a pessoa não escolheu nada.
  useEffect(() => {
    if (!media) return undefined;
    const onChange = () => {
      if (!savedChoice()) setTheme(currentTheme());
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const toggle = () => {
    const next = theme === 'escuro' ? 'claro' : 'escuro';
    try {
      localStorage.setItem(KEY, next);
    } catch (e) {}
    setTheme(next);
  };

  return { theme, toggle };
}
