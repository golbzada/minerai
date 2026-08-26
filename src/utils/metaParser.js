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

    const pageId = parsed.searchParams.get('page_id') || parsed.searchParams.get('id');
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
  return `https://graph.facebook.com/${pageId || '4'}/picture?type=large`;
}

export const STATUS_CONFIG = {
  winner: {
    key: 'winner',
    label: 'Vencedor 🔥',
    color: '#ff4d4d',
    bg: '#ffe5e5',
    border: '#ff9999'
  },
  scaling: {
    key: 'scaling',
    label: 'Escalando 📈',
    color: '#00875a',
    bg: '#e3fcef',
    border: '#abf5d1'
  },
  testing: {
    key: 'testing',
    label: 'Em Teste 🧪',
    color: '#0052cc',
    bg: '#deebff',
    border: '#b3d4ff'
  },
  paused: {
    key: 'paused',
    label: 'Pausado ⏸️',
    color: '#6554c0',
    bg: '#eae6ff',
    border: '#c0b6f2'
  }
};

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
  'Outros (Personalizado)'
];
