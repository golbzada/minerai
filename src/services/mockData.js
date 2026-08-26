export const INITIAL_USER = {
  id: 'usr_demo_123',
  name: 'Empreendedor Digital',
  email: 'usuario@minerarads.com.br',
  active: true,
  plan: 'annual'
};

export const INITIAL_TABS = [
  { id: 'tab_geral', name: 'Geral', offers_count: 3 },
  { id: 'tab_saude', name: 'Saúde & Beleza', offers_count: 2 },
  { id: 'tab_drop', name: 'Dropshipping Brasil', offers_count: 2 },
  { id: 'tab_info', name: 'Infoprodutos & PLR', offers_count: 1 }
];

export const INITIAL_OFFERS = [
  {
    id: 'off_1',
    tab_id: 'tab_geral',
    name: 'Goma Termogênica Vsl Black',
    niche: 'Emagrecimento & Suplementos',
    status: 'winner',
    notes: 'VSL de 24min com oferta de 5 potes. Anúncios em formato UGC e depoimentos no TikTok/Reels.',
    page_id: '105829184518291',
    library_url: 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&view_all_page_id=105829184518291',
    destination_url: 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&view_all_page_id=105829184518291',
    ads_count: 38,
    running_days: 14,
    created_at: new Date(Date.now() - 14 * 86400000).toISOString(),
    history: [
      { result_date: '2026-08-12', results_count: 6 },
      { result_date: '2026-08-15', results_count: 14 },
      { result_date: '2026-08-18', results_count: 22 },
      { result_date: '2026-08-22', results_count: 31 },
      { result_date: '2026-08-25', results_count: 38 }
    ]
  },
  {
    id: 'off_2',
    tab_id: 'tab_geral',
    name: 'Sérum Anti-Manchas Clareador',
    niche: 'Saúde & Beleza',
    status: 'scaling',
    notes: 'Criativo com dermatologista explicando a fórmula. Checkout da Yampi com upsell de protetor solar.',
    page_id: '112938472918234',
    library_url: 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&view_all_page_id=112938472918234',
    destination_url: 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&view_all_page_id=112938472918234',
    ads_count: 52,
    running_days: 28,
    created_at: new Date(Date.now() - 28 * 86400000).toISOString(),
    history: [
      { result_date: '2026-07-28', results_count: 8 },
      { result_date: '2026-08-04', results_count: 18 },
      { result_date: '2026-08-11', results_count: 29 },
      { result_date: '2026-08-18', results_count: 44 },
      { result_date: '2026-08-25', results_count: 52 }
    ]
  },
  {
    id: 'off_3',
    tab_id: 'tab_geral',
    name: 'Mini Projetor Smart 4K Portátil',
    niche: 'Tecnologia & Gadgets',
    status: 'testing',
    notes: 'Produto trending do AliExpress sendo testado no Brasil via Shopify + CartPanda.',
    page_id: '109384756281928',
    library_url: 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&view_all_page_id=109384756281928',
    destination_url: 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&view_all_page_id=109384756281928',
    ads_count: 19,
    running_days: 7,
    created_at: new Date(Date.now() - 7 * 86400000).toISOString(),
    history: [
      { result_date: '2026-08-18', results_count: 3 },
      { result_date: '2026-08-21', results_count: 9 },
      { result_date: '2026-08-23', results_count: 15 },
      { result_date: '2026-08-25', results_count: 19 }
    ]
  },
  {
    id: 'off_4',
    tab_id: 'tab_saude',
    name: 'Gotas Sublinguais Sono Reparador',
    niche: 'Saúde & Beleza',
    status: 'winner',
    notes: 'Fórmula de melatonina líquida com alta conversão em público 40+.',
    page_id: '108273645192837',
    library_url: 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&view_all_page_id=108273645192837',
    destination_url: 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&view_all_page_id=108273645192837',
    ads_count: 45,
    running_days: 21,
    created_at: new Date(Date.now() - 21 * 86400000).toISOString(),
    history: [
      { result_date: '2026-08-04', results_count: 10 },
      { result_date: '2026-08-11', results_count: 22 },
      { result_date: '2026-08-18', results_count: 35 },
      { result_date: '2026-08-25', results_count: 45 }
    ]
  },
  {
    id: 'off_5',
    tab_id: 'tab_saude',
    name: 'Kit Clareador Dental Carvão Ativado',
    niche: 'Saúde & Beleza',
    status: 'scaling',
    notes: 'Anúncios no feed e stories com demonstrações de antes e depois.',
    page_id: '104729184620193',
    library_url: 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&view_all_page_id=104729184620193',
    destination_url: 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&view_all_page_id=104729184620193',
    ads_count: 27,
    running_days: 12,
    created_at: new Date(Date.now() - 12 * 86400000).toISOString(),
    history: [
      { result_date: '2026-08-13', results_count: 5 },
      { result_date: '2026-08-19', results_count: 16 },
      { result_date: '2026-08-25', results_count: 27 }
    ]
  },
  {
    id: 'off_6',
    tab_id: 'tab_drop',
    name: 'Depilador Laser Crystal Indolor',
    niche: 'Dropshipping',
    status: 'winner',
    notes: 'Vídeos virais mostrando praticidade sem lâminas. Ticket médio R$ 97,00.',
    page_id: '103847592817263',
    library_url: 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&view_all_page_id=103847592817263',
    destination_url: 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&view_all_page_id=103847592817263',
    ads_count: 64,
    running_days: 35,
    created_at: new Date(Date.now() - 35 * 86400000).toISOString(),
    history: [
      { result_date: '2026-07-21', results_count: 12 },
      { result_date: '2026-08-01', results_count: 28 },
      { result_date: '2026-08-10', results_count: 42 },
      { result_date: '2026-08-18', results_count: 55 },
      { result_date: '2026-08-25', results_count: 64 }
    ]
  },
  {
    id: 'off_7',
    tab_id: 'tab_drop',
    name: 'Organizador Giratório Multifuncional 360',
    niche: 'Dropshipping',
    status: 'testing',
    notes: 'Público feminino / casa & organização. Criativos com narração gerada por IA.',
    page_id: '109283746192837',
    library_url: 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&view_all_page_id=109283746192837',
    destination_url: 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&view_all_page_id=109283746192837',
    ads_count: 15,
    running_days: 5,
    created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    history: [
      { result_date: '2026-08-20', results_count: 4 },
      { result_date: '2026-08-22', results_count: 8 },
      { result_date: '2026-08-25', results_count: 15 }
    ]
  },
  {
    id: 'off_8',
    tab_id: 'tab_info',
    name: 'Protocolo Ansiedade Zero (VSL High Ticket)',
    niche: 'Infoprodutos & PLR',
    status: 'scaling',
    notes: 'Funil com advertorial médico + VSL de alta conversão na Hotmart.',
    page_id: '107394857291823',
    library_url: 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&view_all_page_id=107394857291823',
    destination_url: 'https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=BR&view_all_page_id=107394857291823',
    ads_count: 41,
    running_days: 19,
    created_at: new Date(Date.now() - 19 * 86400000).toISOString(),
    history: [
      { result_date: '2026-08-06', results_count: 7 },
      { result_date: '2026-08-13', results_count: 19 },
      { result_date: '2026-08-20', results_count: 32 },
      { result_date: '2026-08-25', results_count: 41 }
    ]
  }
];
