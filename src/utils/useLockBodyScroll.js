import { useEffect } from 'react';

/**
 * Trava a rolagem da página enquanto um modal está aberto.
 * Sem isso, a roda do mouse sobre o pop-up rolava o painel que está atrás.
 * Vários modais podem abrir ao mesmo tempo: a trava só solta quando o último fecha.
 */
let locks = 0;
let previousOverflow = '';

export default function useLockBodyScroll(active = true) {
  useEffect(() => {
    if (!active) return undefined;

    if (locks === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    locks += 1;

    return () => {
      locks -= 1;
      if (locks === 0) document.body.style.overflow = previousOverflow;
    };
  }, [active]);
}
