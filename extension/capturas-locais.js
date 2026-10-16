// ==============================================================================
// MINERAÍ EXTENSÃO - CAPTURAS GUARDADAS NO COMPUTADOR
// ==============================================================================
// Cada captura do Modelar Página também fica guardada no banco interno da
// extensão (IndexedDB), no computador da pessoa: nada vai para a nuvem nem
// para o Supabase. É daqui que ver.html mostra a página e compara com a
// página pronta. Só as 8 mais novas ficam (cada uma pode ter vídeo pesado).
//
// Dois depósitos: `meta` (leve: endereço, título, data) e `arquivos` (os
// bytes). Listar não carrega os arquivos de todas.
// Usado pelo documento oculto (grava) e por ver.html (lê). `self.MineraiCapturas`.
// ==============================================================================

(function () {
  'use strict';

  const BANCO = 'minerai-capturas';
  const META = 'meta';
  const ARQUIVOS = 'arquivos';
  const GUARDAR_NO_MAXIMO = 8;

  function abrir() {
    return new Promise((ok, erro) => {
      const pedido = indexedDB.open(BANCO, 1);
      pedido.onupgradeneeded = () => {
        const db = pedido.result;
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(ARQUIVOS)) db.createObjectStore(ARQUIVOS);
      };
      pedido.onsuccess = () => ok(pedido.result);
      pedido.onerror = () => erro(pedido.error);
    });
  }

  function esperar(pedido) {
    return new Promise((ok, erro) => {
      pedido.onsuccess = () => ok(pedido.result);
      pedido.onerror = () => erro(pedido.error);
    });
  }

  function terminar(tx) {
    return new Promise((ok, erro) => {
      tx.oncomplete = () => ok();
      tx.onerror = () => erro(tx.error);
      tx.onabort = () => erro(tx.error || new Error('Gravação cancelada.'));
    });
  }

  /** captura = { id, url, titulo, arquivos: [{ nome, dados }] } */
  async function guardar(captura) {
    const db = await abrir();
    try {
      const meta = {
        id: captura.id,
        url: captura.url,
        titulo: String(captura.titulo || '').slice(0, 200),
        criadoEm: new Date().toISOString()
      };
      const tx = db.transaction([META, ARQUIVOS], 'readwrite');
      tx.objectStore(META).put(meta);
      tx.objectStore(ARQUIVOS).put(captura.arquivos, captura.id);
      await terminar(tx);

      // Passou do limite: as mais antigas saem.
      const todas = await esperar(db.transaction(META).objectStore(META).getAll());
      const sair = self.MineraiVer.alemDoLimite(todas, GUARDAR_NO_MAXIMO);
      if (sair.length) {
        const limpa = db.transaction([META, ARQUIVOS], 'readwrite');
        sair.forEach((id) => {
          limpa.objectStore(META).delete(id);
          limpa.objectStore(ARQUIVOS).delete(id);
        });
        await terminar(limpa);
      }
    } finally {
      db.close();
    }
  }

  /** { meta, arquivos } ou null quando não está mais guardada. */
  async function ler(id) {
    const db = await abrir();
    try {
      const tx = db.transaction([META, ARQUIVOS]);
      const [meta, arquivos] = await Promise.all([
        esperar(tx.objectStore(META).get(id)),
        esperar(tx.objectStore(ARQUIVOS).get(id))
      ]);
      return meta && Array.isArray(arquivos) ? { meta, arquivos } : null;
    } finally {
      db.close();
    }
  }

  self.MineraiCapturas = { guardar, ler, GUARDAR_NO_MAXIMO };
})();
