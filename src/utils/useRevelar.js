import { useEffect } from 'react';

/**
 * Faz os blocos da página surgirem suavemente quando entram na tela ao rolar
 * (cards do acervo, do radar, da inteligência...). Só mexe em elementos que
 * casam com `seletor` dentro de `raizRef`; blocos que chegam depois (próxima
 * página do acervo, filtro) também são vistos. `chave` muda quando o
 * contêiner é recriado (troca de página).
 *
 * Sem IntersectionObserver ou com "reduzir movimento" no sistema, nada é
 * escondido: o conteúdo nunca depende da animação para aparecer.
 */
export default function useRevelar(raizRef, seletor, chave) {
  useEffect(() => {
    const raiz = raizRef.current;
    if (!raiz || typeof IntersectionObserver === 'undefined') return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;

    let lote = 0;
    let zerarLote = null;
    const visto = new IntersectionObserver(
      (entradas) => {
        entradas.forEach((e) => {
          if (!e.isIntersecting) return;
          visto.unobserve(e.target);
          // Os que entram juntos aparecem em cascata curta (no máximo 6 passos).
          e.target.style.transitionDelay = `${Math.min(lote, 6) * 55}ms`;
          lote += 1;
          e.target.classList.add('revela-ok');
        });
        clearTimeout(zerarLote);
        zerarLote = setTimeout(() => (lote = 0), 120);
      },
      { rootMargin: '0px 0px -6% 0px', threshold: 0.06 }
    );

    const preparar = () => {
      raiz.querySelectorAll(seletor).forEach((el) => {
        if (el.dataset.revela) return;
        el.dataset.revela = '1';
        el.classList.add('revela');
        visto.observe(el);
      });
    };
    preparar();
    const mudou = new MutationObserver(preparar);
    mudou.observe(raiz, { childList: true, subtree: true });

    return () => {
      mudou.disconnect();
      visto.disconnect();
      clearTimeout(zerarLote);
    };
  }, [raizRef, seletor, chave]);
}
