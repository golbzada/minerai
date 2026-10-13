/**
 * Conversa com a extensão Mineraí pelo bridge.js (postMessage na mesma janela).
 * Sem extensão (ou com uma versão sem o Radar), a resposta é
 * { success: false, error: 'EXTENSAO_AUSENTE' } depois do limite.
 */
let sequencia = 0;

export function pedirAoRadar(pedido, { limiteMs = 5000 } = {}) {
  return new Promise((resolve) => {
    sequencia += 1;
    const id = `radar-${Date.now()}-${sequencia}`;

    function ouvir(event) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const d = event.data;
      if (!d || d.type !== 'MINERAI_RADAR_RESPOSTA' || d.id !== id) return;
      clearTimeout(limite);
      window.removeEventListener('message', ouvir);
      resolve(d.resposta || { success: false });
    }

    const limite = setTimeout(() => {
      window.removeEventListener('message', ouvir);
      resolve({ success: false, error: 'EXTENSAO_AUSENTE' });
    }, limiteMs);

    window.addEventListener('message', ouvir);
    window.postMessage({ type: 'MINERAI_RADAR', id, pedido }, window.location.origin);
  });
}
