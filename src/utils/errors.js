/**
 * ==============================================================================
 * MINERAÍ - TRATAMENTO PADRONIZADO DE ERROS
 * ==============================================================================
 * Toda chamada ao Supabase passa por `toUserError`: o erro técnico vai para o
 * console e o usuário recebe uma frase em português que faz sentido para ele.
 * Erros de sessão expirada disparam o evento `minerai:auth-expired`, que o App
 * escuta para desconectar e voltar para a tela de login.
 */

export const AUTH_EXPIRED_EVENT = 'minerai:auth-expired';

export class AppError extends Error {
  constructor(message, { code = null, cause = null, isAuth = false } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.cause = cause;
    this.isAuth = isAuth;
  }
}

function text(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return String(error.message || error.error_description || error.msg || '');
}

/** Sessão inválida/expirada (JWT vencido, 401) ou usuário deslogado. */
export function isAuthError(error) {
  if (!error) return false;
  const msg = text(error).toLowerCase();
  const code = String(error.code || '');
  const status = Number(error.status || 0);
  return (
    code === 'PGRST301' ||
    status === 401 ||
    msg.includes('jwt expired') ||
    (msg.includes('jwt') && msg.includes('invalid')) ||
    msg.includes('refresh_token_not_found') ||
    msg.includes('invalid refresh token') ||
    msg.includes('não autenticado')
  );
}

/**
 * Converte qualquer erro (Supabase, rede, JS) em AppError com mensagem amigável.
 * `fallback` é a frase usada quando o erro não é reconhecido.
 */
export function toUserError(error, fallback = 'Não foi possível concluir a operação. Tente novamente.') {
  if (error instanceof AppError) return error;

  const msg = text(error);
  const lower = msg.toLowerCase();
  const code = String(error?.code || '');

  // Diagnóstico completo só no console (nunca na tela).
  if (typeof console !== 'undefined') {
    console.warn('[Mineraí] Erro técnico:', error);
  }

  if (isAuthError(error)) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    }
    return new AppError('Sua sessão expirou. Entre novamente para continuar.', {
      code: 'AUTH_EXPIRED',
      cause: error,
      isAuth: true
    });
  }

  if (error instanceof TypeError && (lower.includes('fetch') || lower.includes('network'))) {
    return new AppError('Sem conexão com o servidor. Verifique sua internet e tente de novo.', {
      code: 'NETWORK',
      cause: error
    });
  }

  if (code === '42501' || lower.includes('row-level security') || lower.includes('permission denied')) {
    return new AppError(
      'Sem permissão para esta ação. Verifique se o seu plano está ativo.',
      { code: 'FORBIDDEN', cause: error }
    );
  }

  if (code === '23514') {
    return new AppError(
      'Algum campo ultrapassa o tamanho permitido ou tem um valor inválido.',
      { code: 'INVALID', cause: error }
    );
  }

  if (code === '23505') {
    return new AppError('Já existe um registro igual a este.', { code: 'DUPLICATE', cause: error });
  }

  if (code === '23503') {
    return new AppError('A aba informada não existe mais. Recarregue a página.', {
      code: 'REFERENCE',
      cause: error
    });
  }

  if (code === 'PGRST202' || lower.includes('could not find the function')) {
    return new AppError(
      'Recurso indisponível no servidor. A migração do banco ainda não foi aplicada.',
      { code: 'MISSING_RPC', cause: error }
    );
  }

  if (code === 'PGRST204' || (lower.includes('column') && lower.includes('does not exist'))) {
    return new AppError(
      'O banco de dados está desatualizado. Aplique a migração mais recente.',
      { code: 'SCHEMA', cause: error }
    );
  }

  if (code === '429' || lower.includes('rate limit') || lower.includes('too many requests')) {
    return new AppError('Muitas tentativas em pouco tempo. Aguarde um minuto e tente de novo.', {
      code: 'RATE_LIMIT',
      cause: error
    });
  }

  return new AppError(fallback, { code: code || 'UNKNOWN', cause: error });
}

/** Lança AppError quando a resposta do Supabase veio com `error`. */
export function assertOk(error, fallback) {
  if (error) throw toUserError(error, fallback);
}
