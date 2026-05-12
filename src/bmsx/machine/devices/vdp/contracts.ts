export type Layer2D = 0 | 1 | 2;

export const LAYER_2D_WORLD: Layer2D = 0;
export const LAYER_2D_UI: Layer2D = 1;
export const LAYER_2D_IDE: Layer2D = 2;

export type VdpSlotSource = {
	slot: number;
	u: number;
	v: number;
	w: number;
	h: number;
};

export const SKYBOX_FACE_COUNT = 6;
export const SKYBOX_FACE_KEYS = ['posx', 'negx', 'posy', 'negy', 'posz', 'negz'] as const;
export const SKYBOX_FACE_WORD_STRIDE = 5;
export const SKYBOX_FACE_WORD_COUNT = SKYBOX_FACE_COUNT * SKYBOX_FACE_WORD_STRIDE;
export const SKYBOX_FACE_SLOT_WORD = 0;
export const SKYBOX_FACE_U_WORD = 1;
export const SKYBOX_FACE_V_WORD = 2;
export const SKYBOX_FACE_W_WORD = 3;
export const SKYBOX_FACE_H_WORD = 4;
export const VDP_SBX_CONTROL_ENABLE = 1;

export type VdpPmuBank = {
	xQ16: number;
	yQ16: number;
	scaleXQ16: number;
	scaleYQ16: number;
	control: number;
};

export const VDP_PMU_BANK_COUNT = 256;
export const VDP_PMU_BANK_WORD_STRIDE = 5;
export const VDP_PMU_BANK_WORD_COUNT = VDP_PMU_BANK_COUNT * VDP_PMU_BANK_WORD_STRIDE;
export const VDP_PMU_BANK_X_WORD = 0;
export const VDP_PMU_BANK_Y_WORD = 1;
export const VDP_PMU_BANK_SCALE_X_WORD = 2;
export const VDP_PMU_BANK_SCALE_Y_WORD = 3;
export const VDP_PMU_BANK_CONTROL_WORD = 4;
export const VDP_PMU_Q16_ONE = 0x00010000;

export const VDP_BBU_BILLBOARD_LIMIT = 1024;

export type VdpFrameBufferSize = {
	width: number;
	height: number;
};

export type VdpVramSurface = {
	surfaceId: number;
	baseAddr: number;
	capacity: number;
	width: number;
	height: number;
};

export const VDP_RD_SURFACE_SYSTEM = 0;
export const VDP_RD_SURFACE_PRIMARY = 1;
export const VDP_RD_SURFACE_SECONDARY = 2;
export const VDP_RD_SURFACE_FRAMEBUFFER = 3;
export const VDP_RD_SURFACE_COUNT = 4;
export const VDP_FRAMEBUFFER_PAGE_RENDER = 0;
export const VDP_FRAMEBUFFER_PAGE_DISPLAY = 1;
export type VdpFrameBufferPage = typeof VDP_FRAMEBUFFER_PAGE_RENDER | typeof VDP_FRAMEBUFFER_PAGE_DISPLAY;
