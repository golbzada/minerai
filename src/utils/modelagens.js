/**
 * Fila e histórico do Modelar Página, guardados neste navegador.
 * (O arquivo capturado vai direto para a pasta Downloads; aqui ficam os
 * dados da captura para reabrir, repetir e ligar a uma oferta.)
 */
const KEY = 'minerai_modelagens';
const EVENT = 'minerai:modelagens';

export const MODELAGEM_TIPOS = ['VSL', 'Quiz', 'Advertorial', 'Checkout', 'Página de captura', 'Outro'];

export function loadModelagens() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function persist(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 200)));
  } catch (e) {}
  window.dispatchEvent(new Event(EVENT));
}

export function addModelagem({ url, offerId = null, offerName = '' }) {
  const item = {
    id: `mod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    url,
    status: 'capturando', // capturando | pronto | falhou
    createdAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: '',
    offerId,
    offerName,
    fav: false,
    tipo: ''
  };
  persist([item, ...loadModelagens()]);
  return item;
}

export function updateModelagem(id, patch) {
  const list = loadModelagens().map((m) => (m.id === id ? { ...m, ...patch } : m));
  persist(list);
  return list.find((m) => m.id === id) || null;
}

export function removeModelagem(id) {
  persist(loadModelagens().filter((m) => m.id !== id));
}

export function subscribeModelagens(handler) {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
