/**
 * Enum representing the type of an audio asset.
 */
export const enum AudioType {
	effect = 1,
	music = 2,
}

/**
 * Metadata for an audio asset.
 */
export interface AudioMeta {
	audiotype: AudioType; // The type of audio asset.
	priority: number; // The priority of the audio asset.
	loop?: number; // The loop point of the audio asset.
}

/**
 * Metadata for an image asset.
 */
export interface ImgMeta {
	atlassed: boolean;
	width: number;
	height: number;
	texcoords?: number[];
	texcoords_fliph?: number[];
	texcoords_flipv?: number[];
	texcoords_fliphv?: number[];
}

/**
 * Represents an asset in a ROM pack.
 */
export interface RomAsset {
	resid: number;
	resname: string;
	type: string;
	start: number;
	end: number;
	buffer?: ArrayBuffer;
	imgmeta?: ImgMeta;
	audiometa?: AudioMeta;
}

export interface RomMeta {
	start: number;
	end: number;
}

export type id2res = Record<number | string, RomAsset>;
export type id2htmlimg = Record<number | string, HTMLImageElement>;
export interface RomPack {
	rom: ArrayBuffer,
	images: id2htmlimg;
	img_assets: id2res;
	snd_assets: id2res;
	code: string;
}
