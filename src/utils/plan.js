/**
 * ==============================================================================
 * MINERAÍ - PLANO E ACESSO
 * ==============================================================================
 * O front só REFLETE o que o banco decide: as policies de escrita exigem
 * public.has_active_plan(). Aqui calculamos a mesma regra para esconder ou
 * travar botões e explicar a situação ao usuário.
 *
 * LOCK_MODE define o que acontece sem plano ativo:
 *   'readonly' -> vê e exporta o acervo, mas não cria/edita nada
 *   'block'    -> tela de bloqueio no lugar do painel
 */

export const LOCK_MODE = 'block';

export const PLAN_LABELS = {
  trial: 'Teste grátis',
  monthly: 'Plano Mensal',
  annual: 'Plano Anual',
  lifetime: 'Acesso Vitalício'
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Situação de acesso do usuário. Espelha public.has_active_plan():
 * active = true e (plano pago OU trial dentro do prazo).
 */
export function getAccess(user) {
  if (!user) {
    return { active: false, plan: null, label: 'Sem plano', isTrial: false, daysLeft: 0, expired: false };
  }

  const plan = user.plan || null;
  const flagActive = user.active !== false && plan !== null;

  if (plan === 'trial') {
    const ends = user.trial_ends_at ? new Date(user.trial_ends_at) : null;
    const daysLeft = ends && !isNaN(ends.getTime()) ? Math.ceil((ends.getTime() - Date.now()) / DAY_MS) : 0;
    const active = flagActive && daysLeft > 0;
    return {
      active,
      plan,
      label: active ? `Teste grátis · ${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'}` : 'Teste encerrado',
      isTrial: true,
      daysLeft: Math.max(0, daysLeft),
      expired: !active
    };
  }

  return {
    active: flagActive,
    plan,
    label: flagActive ? (PLAN_LABELS[plan] || 'Plano ativo') : (PLAN_LABELS[plan] ? `${PLAN_LABELS[plan]} · inativo` : 'Sem plano ativo'),
    isTrial: false,
    daysLeft: null,
    expired: !flagActive
  };
}

/** Frase curta para o usuário entender por que está travado. */
export function lockedMessage(user) {
  const access = getAccess(user);
  if (access.active) return '';
  if (access.isTrial) {
    return 'Seu período de teste terminou. Ative um plano para voltar a minerar e editar ofertas.';
  }
  return 'Sua assinatura está inativa. Ative um plano para voltar a minerar e editar ofertas.';
}
