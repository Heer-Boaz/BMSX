export type Layer2D = 0 | 1 | 2;

export const LAYER_2D_WORLD: Layer2D = 0;
export const LAYER_2D_UI: Layer2D = 1;
export const LAYER_2D_IDE: Layer2D = 2;

export type SkyboxImageIds = {
	posx: string;
	negx: string;
	posy: string;
	negy: string;
	posz: string;
	negz: string;
};

export const SKYBOX_FACE_KEYS = ['posx', 'negx', 'posy', 'negy', 'posz', 'negz'] as const satisfies readonly (keyof SkyboxImageIds)[];
