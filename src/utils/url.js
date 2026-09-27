/**
 * ==============================================================================
 * MINERAÍ - SANEAMENTO DE URLS E IMAGENS
 * ==============================================================================
 * Tudo que vira `href` ou `src` na tela passa por aqui. Só http/https entram
 * em links (nunca `javascript:`), e imagens só aceitam https ou data:image/*.
 */

export const MAX_URL_LENGTH = 2048;

/**
 * Devolve a URL normalizada se for http(s) válida; senão, string vazia.
 * Aceita endereço sem protocolo ("site.com/pagina") e completa com https://.
 */
export function safeHttpUrl(value, { allowBare = true } = {}) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw || raw.length > MAX_URL_LENGTH) return '';

  try {
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) || !allowBare ? raw : `https://${raw}`;
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      // "localhost" e afins não servem como link de oferta.
      return '';
    }
    return parsed.href.length > MAX_URL_LENGTH ? '' : parsed.href;
  } catch (e) {
    return '';
  }
}

/** Verdadeiro quando o valor é uma URL http(s) válida. */
export function isHttpUrl(value) {
  return Boolean(safeHttpUrl(value, { allowBare: false }));
}

/** Só imagens embutidas (data:image/...) ou servidas por https. */
export function safeImageSrc(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=]+$/i.test(raw)) return raw;
  if (/^https:\/\//i.test(raw)) return safeHttpUrl(raw, { allowBare: false });
  return '';
}

/** Miniatura do criativo: só data:image/*, com teto de tamanho. */
export function safeCreativeThumb(value, maxLength = 400000) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw || raw.length > maxLength) return null;
  return /^data:image\/(png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=]+$/i.test(raw) ? raw : null;
}
