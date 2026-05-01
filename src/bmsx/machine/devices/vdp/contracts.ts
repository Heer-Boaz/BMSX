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

export type SkyboxFaceSources = {
	posx: VdpSlotSource;
	negx: VdpSlotSource;
	posy: VdpSlotSource;
	negy: VdpSlotSource;
	posz: VdpSlotSource;
	negz: VdpSlotSource;
};

export const SKYBOX_FACE_KEYS = ['posx', 'negx', 'posy', 'negy', 'posz', 'negz'] as const satisfies readonly (keyof SkyboxFaceSources)[];

export type VdpParallaxRig = {
	vy: number;
	scale: number;
	impact: number;
	impact_t: number;
	bias_px: number;
	parallax_strength: number;
	scale_strength: number;
	flip_strength: number;
	flip_window: number;
};

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
