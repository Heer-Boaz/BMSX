export const TEXTURE_ATLAS_RGBA_BYTES_PER_PIXEL = 4;
export const GX_TEXTURE_PAGE_PIXELS = 256;
export const GX_SYSTEM_TEXTURE_GROUP_ID = 254;
export const GX_CART_TEXTURE_GROUP_ID_LIMIT = GX_SYSTEM_TEXTURE_GROUP_ID;

export function textureGroupResourceName(groupId: number): string {
	return `_atlas_${groupId.toString().padStart(2, '0')}`;
}
