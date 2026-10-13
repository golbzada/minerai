/**
 * Espera a extensão Mineraí entregar a sessão mais nova antes de o painel
 * ligar o Supabase.
 *
 * Quando a extensão renova o login com o painel fechado, o refresh_token que
 * o painel tem guardado fica revogado. Se o painel abrisse e renovasse com ele,
 * o Supabase deslogaria os dois. O bridge.js da extensão marca
 * `<html data-minerai-sessao="aguardando">` logo que a página nasce, grava a
 * sessão nova no localStorage e troca para "pronta". Sem a extensão, o atributo
 * nem existe e o painel segue na hora.
 */
export function aguardarSessaoDaExtensao({
  raiz = typeof document !== 'undefined' ? document.documentElement : null,
  limiteMs = 600
} = {}) {
  return new Promise((resolve) => {
    const pronto = () => !raiz || !raiz.dataset || raiz.dataset.mineraiSessao !== 'aguardando';
    if (pronto()) {
      resolve();
      return;
    }

    const inicio = Date.now();
    const timer = setInterval(() => {
      if (pronto() || Date.now() - inicio >= limiteMs) {
        clearInterval(timer);
        resolve();
      }
    }, 25);
  });
}
