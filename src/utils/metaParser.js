/**
 * Helper to parse Meta Ad Library URLs and extract Page IDs / Advertiser details
 */
export function extractPageIdFromUrl(url) {
  if (!url) return '4';
  try {
    const raw = String(url).trim();
    if (/^\d{4,}$/.test(raw)) {
      return raw;
    }

    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    const viewAllPageId = parsed.searchParams.get('view_all_page_id');
    if (viewAllPageId) return viewAllPageId;

    // Atenção: em /ads/library/?id=... o `id` é o ID do ANÚNCIO na biblioteca,
    // não o ID da página. Usá-lo aqui quebrava o avatar do anunciante.
    const isAdLibraryUrl = /\/ads\/library/i.test(parsed.pathname);
    const pageId = parsed.searchParams.get('page_id') || (isAdLibraryUrl ? null : parsed.searchParams.get('id'));
    if (pageId) return pageId;

    // Check pathname patterns
    const match = raw.match(/(?:facebook\.com\/(?:pages\/[^\/]+\/|profile\.php\?id=)?|view_all_page_id=)(\d{4,})/i);
    if (match && match[1]) {
      return match[1];
    }
  } catch (e) {
    const match = String(url).match(/(\d{5,})/);
    if (match && match[1]) {
      return match[1];
    }
  }
  return '4';
}

export function formatCpfCnpj(value) {
  const digits = value.replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return digits
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export function getFbAvatarUrl(pageId) {
  return `https://graph.facebook.com/${encodeURIComponent(String(pageId || '4'))}/picture?type=large`;
}

// As cores vêm de variáveis CSS (src/index.css): cada uma tem a versão do
// tema claro e a do escuro. `text` é a cor para usar a etiqueta como texto
// solto (sem o fundo), ex. no card do funil.
const statusColors = (key) => ({
  color: `var(--st-${key}-fg)`,
  bg: `var(--st-${key}-bg)`,
  border: `var(--st-${key}-bd)`,
  text: `var(--st-${key}-tx)`
});

export const STATUS_CONFIG = {
  winner: {
    key: 'winner',
    // Laranja sólido com texto branco: é o selo de maior destaque do painel.
    label: 'Vencedor',
    ...statusColors('winner')
  },
  scaling: {
    key: 'scaling',
    label: 'Escalando',
    ...statusColors('scaling')
  },
  pre_scaling: {
    key: 'pre_scaling',
    label: 'Pré-escala',
    ...statusColors('pre_scaling')
  },
  testing: {
    key: 'testing',
    label: 'Em teste',
    ...statusColors('testing')
  },
  paused: {
    key: 'paused',
    label: 'Pausado',
    ...statusColors('paused')
  }
};

/** Nome do status sem o emoji do fim ("Escalando 📈" vira "Escalando"). */
export function statusText(cfg) {
  return String(cfg?.label || '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim();
}

export const NICHE_OPTIONS = [
  'Saúde & Beleza',
  'Emagrecimento & Suplementos',
  'Dropshipping & Físicos',
  'Infoprodutos & PLR',
  'Finanças & Investimentos',
  'Renda Extra & Afiliados',
  'Relacionamento & Conquista',
  'Moda, Vestuário & Calçados',
  'Tecnologia & Gadgets',
  'Casa, Decoração & Cozinha',
  'Pets & Animais de Estimação',
  'Maternidade, Bebês & Kids',
  'Educação & Idiomas',
  'Espiritualidade & Astrologia',
  'Desenvolvimento Pessoal',
  'Fitness & Musculação',
  'Automotivo & Veículos',
  'iGaming & Apostas',
  'Negócios Locais & Serviços',
  'Software, Apps & SaaS',
  'Outros'
];
