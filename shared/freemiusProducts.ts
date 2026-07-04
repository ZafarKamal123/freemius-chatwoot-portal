export const freemiusProducts = [
  {
    name: 'Frame Maker',
    id: '289295',
    bearerTokenEnvName: 'FREEMIUS_FRAME_MAKER_BEARER_TOKEN',
  },
  {
    name: 'Image Blend',
    id: '452236',
    bearerTokenEnvName: 'FREEMIUS_IMAGE_BLEND_BEARER_TOKEN',
  },
  {
    name: 'Collage Maker',
    id: '22331',
    bearerTokenEnvName: 'FREEMIUS_COLLAGE_MAKER_BEARER_TOKEN',
  },
  {
    name: 'Type Warp',
    id: '27131',
    bearerTokenEnvName: 'FREEMIUS_TYPE_WARP_BEARER_TOKEN',
  },
] as const

export type FreemiusProductId = (typeof freemiusProducts)[number]['id']
export type FreemiusProduct = (typeof freemiusProducts)[number]

export const defaultFreemiusProductId = freemiusProducts[0].id

export function getFreemiusProduct(productId: string) {
  return freemiusProducts.find((product) => product.id === productId) ?? null
}

export function isFreemiusProductId(
  productId: string,
): productId is FreemiusProductId {
  return getFreemiusProduct(productId) !== null
}
