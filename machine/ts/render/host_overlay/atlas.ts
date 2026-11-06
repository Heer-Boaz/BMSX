import { HOST_SYSTEM_ATLAS } from './atlas.generated';

export type HostSystemAtlasImage = Readonly<{
	id: string;
	width: number;
	height: number;
	u: number;
	v: number;
	w: number;
	h: number;
}>;

/** Immutable product asset; CPU storage lives with the asset, GPU storage with each renderer. */
export type HostAtlas = Readonly<{
	width: number;
	height: number;
	pixels: Uint8Array;
	srgb: boolean;
}>;

export type HostSystemAtlas = HostAtlas & Readonly<{
	images: readonly HostSystemAtlasImage[];
}>;

export { HOST_SYSTEM_ATLAS };

/** Upload an immutable atlas once per renderer context, on its first use. */
export class HostAtlasTextures<T> {
	private readonly textures = new Map<HostAtlas, T>();
	public constructor(private readonly create: (atlas: HostAtlas) => T, private readonly destroy: (texture: T) => void) {}
	public get(atlas: HostAtlas): T {
		let texture = this.textures.get(atlas);
		if (texture === undefined) {
			texture = this.create(atlas);
			this.textures.set(atlas, texture);
		}
		return texture;
	}
	public dispose(): void {
		for (const texture of this.textures.values()) this.destroy(texture);
		this.textures.clear();
	}
}

export function hostSystemAtlasImage(id: string): HostSystemAtlasImage {
	let first = 0;
	let last = HOST_SYSTEM_ATLAS.images.length;
	while (first < last) {
		const middle = (first + last) >>> 1;
		const image = HOST_SYSTEM_ATLAS.images[middle];
		if (image.id < id) {
			first = middle + 1;
		} else if (image.id > id) {
			last = middle;
		} else {
			return image;
		}
	}
	throw new Error(`Image '${id}' is not in the host system atlas.`);
}
