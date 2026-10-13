// ==============================================================================
// MINERAÍ EXTENSÃO - REGRAS DA SESSÃO COMPARTILHADA COM O PAINEL (funções puras)
// ==============================================================================
// O refresh_token do Supabase é de uso único: quem renova recebe um novo e o
// antigo é revogado. Painel e extensão guardam a mesma sessão, então quem
// renovar precisa entregar a sessão nova ao outro — senão o outro tenta usar
// a antiga e o Supabase desloga os dois.
//
// Regra: entre duas sessões do MESMO usuário, vale a que vence mais tarde.
// Usado pelo bridge.js (no painel) e pelo background.js. Fica em
// `self.MineraiSessao`.
// ==============================================================================

(function () {
  'use strict';

  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  /**
   * painel   = objeto guardado pelo supabase-js (`sb-*-auth-token`)
   * extensao = { user: {id}, session: {access_token, refresh_token, expires_at} }
   * -> 'extensao' (gravar a da extensão no painel), 'painel' ou 'igual'
   */
  function compararSessoes(painel, extensao) {
    if (!painel || !painel.access_token) return 'igual';
    const sessao = extensao && extensao.session;
    const idExt = extensao && extensao.user && extensao.user.id;
    const idPainel = painel.user && painel.user.id;
    if (!sessao || !sessao.access_token || !sessao.refresh_token) return 'painel';
    if (!idExt || !idPainel || idExt !== idPainel) return 'painel';

    const ext = num(sessao.expires_at);
    const pai = num(painel.expires_at);
    if (ext > pai) return 'extensao';
    if (pai > ext) return 'painel';
    return 'igual';
  }

  /** Objeto do painel com os tokens da extensão (o resto fica como está). */
  function mesclarSessao(painel, sessao, agoraSeg) {
    const expiresAt = num(sessao.expires_at);
    return {
      ...painel,
      access_token: sessao.access_token,
      refresh_token: sessao.refresh_token,
      expires_at: expiresAt,
      expires_in: Math.max(0, expiresAt - num(agoraSeg))
    };
  }

  /**
   * A extensão aceita a sessão que veio do painel? Não, se for do mesmo
   * usuário e mais antiga que a que ela já tem (o painel ainda não recebeu
   * a renovada).
   */
  function aceitarDoPainel(guardada, user, session) {
    const atual = guardada && guardada.session;
    const idAtual = guardada && guardada.user && guardada.user.id;
    if (!atual || !idAtual || !user || user.id !== idAtual) return true;
    return num(session && session.expires_at) >= num(atual.expires_at);
  }

  self.MineraiSessao = { compararSessoes, mesclarSessao, aceitarDoPainel };
})();
