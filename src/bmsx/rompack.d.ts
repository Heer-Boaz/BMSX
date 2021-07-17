export const enum AudioType {
	effect = 1,
	music = 2,
}

export interface AudioMeta {
	audiotype: AudioType,
	priority: number;
	loop?: number;
}

export interface ImgMeta {
	atlassed: boolean;
	width: number;
	height: number;
	texcoords?: number[];
	texcoords_fliph?: number[];
	texcoords_flipv?: number[];
	texcoords_fliphv?: number[];
}

export interface RomResource {
	resid: number;
	resname: string;
	type: string;
	start: number;
	end: number;
	imgmeta: ImgMeta;
	audiometa: AudioMeta;
}

export interface RomMeta {
	start: number;
	end: number;
}

export type id2res = { [key: number]: RomResource; };
export interface RomLoadResult {
	rom: ArrayBuffer,
	images: { [key: number]: HTMLImageElement; };
	imgresources: id2res;
	sndresources: id2res;
	source: any;
}

export interface BFont {
	char_to_img(c: string): number;
	char_width: number;
	char_height: number;
}

export interface IResourceId {
	None: number,
	[propName: string]: number;
}
