import { HOST_SYSTEM_ATLAS } from './host_system_atlas.generated';

export type HostSystemAtlasImage = Readonly<{
	id: string;
	width: number;
	height: number;
	u: number;
	v: number;
	w: number;
	h: number;
}>;

export type HostSystemAtlas = Readonly<{
	width: number;
	height: number;
	pixels: Uint8Array;
	images: readonly HostSystemAtlasImage[];
}>;

export { HOST_SYSTEM_ATLAS };

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
