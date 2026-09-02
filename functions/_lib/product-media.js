import { canonicalContentAssetUrl } from '../../js/image-url.js';

export function canonicalizeProductMediaUrl(value) {
  return typeof value === 'string' ? canonicalContentAssetUrl(value) : '';
}

export function canonicalizeProductMedia(product = {}) {
  const value = product && typeof product === 'object' ? product : {};
  const imageUrl = canonicalizeProductMediaUrl(value.image_url);
  const gallery = Array.isArray(value.gallery)
    ? [...new Set(value.gallery
      .map(canonicalizeProductMediaUrl)
      .filter(Boolean))]
    : [];
  return {
    ...value,
    image_url: imageUrl || null,
    gallery,
  };
}
