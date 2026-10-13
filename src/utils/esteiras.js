/**
 * Esteiras da página Favoritos.
 *
 * A oferta guarda em qual esteira está (`esteira: 'Nome'`) e a posição
 * (`esteira_ordem`) no bloco de metadados, então o vínculo viaja com o acervo.
 * A lista de nomes (inclusive esteiras vazias) e a ordem das colunas ficam
 * neste navegador e são copiadas para a conta (api.saveEsteiras); qualquer
 * nome encontrado nas ofertas é incorporado sozinho.
 */
import { getExtras, offerMeta } from './offerExtras';

const KEY = 'minerai_esteiras';
export const MAX_ESTEIRAS = 12;
export const POOL = '__pool__';

export function normalizeEsteiraName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
}

function loadStored() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((n) => typeof n === 'string' && n.trim()) : [];
  } catch (e) {
    return [];
  }
}

function persist(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_ESTEIRAS)));
  } catch (e) {}
}

/** Esteira da oferta (ou null quando está no pool de favoritas). */
export function esteiraOf(offer) {
  const m = offerMeta(offer);
  return typeof m.esteira === 'string' && m.esteira.trim() ? m.esteira : null;
}

export function esteiraOrder(offer) {
  const n = Number(offerMeta(offer).esteira_ordem);
  return Number.isFinite(n) ? n : null;
}

/** Nomes das esteiras: as guardadas aqui + as que aparecem nas ofertas. */
export function listEsteiras(offers) {
  const stored = loadStored();
  const fromOffers = [];
  (offers || []).forEach((o) => {
    const name = esteiraOf(o);
    if (name && !stored.includes(name) && !fromOffers.includes(name)) fromOffers.push(name);
  });
  const merged = [...stored, ...fromOffers];
  if (fromOffers.length) persist(merged);
  return merged;
}

export function addEsteira(name, offers) {
  const clean = normalizeEsteiraName(name);
  if (!clean) throw new Error('Dê um nome para a esteira.');
  const current = listEsteiras(offers);
  if (current.some((n) => n.toLowerCase() === clean.toLowerCase())) throw new Error('Já existe uma esteira com esse nome.');
  if (current.length >= MAX_ESTEIRAS) throw new Error(`Limite de ${MAX_ESTEIRAS} esteiras.`);
  persist([...current, clean]);
  return clean;
}

export function renameEsteira(oldName, newName, offers) {
  const clean = normalizeEsteiraName(newName);
  if (!clean) throw new Error('Dê um nome para a esteira.');
  const current = listEsteiras(offers);
  if (current.some((n) => n !== oldName && n.toLowerCase() === clean.toLowerCase())) {
    throw new Error('Já existe uma esteira com esse nome.');
  }
  persist(current.map((n) => (n === oldName ? clean : n)));
  return clean;
}

export function removeEsteira(name, offers) {
  persist(listEsteiras(offers).filter((n) => n !== name));
}

export function reorderEsteiras(names) {
  persist(names);
}

/**
 * A lista da conta manda: assim uma etapa apagada em outro navegador não
 * volta. Etapas com ofertas dentro reaparecem sozinhas pelo listEsteiras.
 */
export function adoptAccountEsteiras(accountList) {
  persist(accountList);
}

/** Funil sugerido para quem ainda não criou nenhuma etapa. */
export const FUNIL_SUGERIDO = ['Para analisar', 'Modelando', 'Testando', 'Validada'];

export function applySuggestedFunnel(offers) {
  const current = listEsteiras(offers);
  const next = [...current];
  FUNIL_SUGERIDO.forEach((n) => {
    if (!next.some((x) => x.toLowerCase() === n.toLowerCase())) next.push(n);
  });
  persist(next);
  return next.slice(0, MAX_ESTEIRAS);
}

/**
 * Posição para soltar um card entre dois vizinhos sem renumerar a coluna:
 * a média das posições deles. Devolve null quando os vizinhos não têm
 * posição gravada (aí a coluna inteira precisa ser renumerada).
 */
export function orderBetween(prev, next) {
  const a = prev ? esteiraOrder(prev) : null;
  const b = next ? esteiraOrder(next) : null;
  if (prev && a == null) return null;
  if (next && b == null) return null;
  if (a == null && b == null) return 10;
  if (a == null) return b - 10;
  if (b == null) return a + 10;
  const mid = (a + b) / 2;
  return mid === a || mid === b ? null : mid;
}

/** Agrupa as favoritas por esteira, já ordenadas dentro de cada coluna. */
export function groupByEsteira(offers, names) {
  const groups = { [POOL]: [] };
  names.forEach((n) => (groups[n] = []));

  (offers || []).forEach((o) => {
    if (!getExtras(o).fav) return;
    const name = esteiraOf(o);
    const key = name && groups[name] ? name : POOL;
    groups[key].push(o);
  });

  Object.keys(groups).forEach((key) => {
    groups[key].sort((a, b) => {
      const oa = esteiraOrder(a);
      const ob = esteiraOrder(b);
      if (oa != null && ob != null && oa !== ob) return oa - ob;
      if (oa != null && ob == null) return -1;
      if (oa == null && ob != null) return 1;
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
  });

  return groups;
}

/** Explicação curta de cada etapa sugerida, mostrada embaixo do nome da coluna. */
export const DICAS_ETAPA = {
  'para analisar': 'Ofertas para olhar com calma',
  modelando: 'Você está criando a sua versão',
  testando: 'Seu anúncio já está no ar',
  validada: 'Deu resultado, vale escalar'
};
