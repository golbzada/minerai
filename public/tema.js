// Tema claro/escuro do Mineraí. Roda antes do React para a página já nascer
// com as cores certas. Arquivo separado porque a CSP do site não aceita
// script inline. A lógica completa (botão, seguir o sistema) está em
// src/utils/theme.js — a chave e os valores precisam ficar iguais.
(function () {
  var escolha = null;
  try {
    escolha = localStorage.getItem('minerai-tema');
  } catch (e) {}
  var escuro =
    escolha === 'escuro' ||
    (escolha !== 'claro' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = escuro ? 'dark' : 'light';
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', escuro ? '#12110E' : '#FDF8ED');
})();
