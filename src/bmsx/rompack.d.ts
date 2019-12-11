export const enum AudioType {
	effect = 1,
	music = 2,
}

export interface AudioMeta {
	audiotype: AudioType,
	priority: number;
	loop?: number;
}

export interface RomResource {
	resid: number;
	resname: string;
	type: string;
	start: number;
	end: number;
	audiometa: AudioMeta;
}

export interface RomMeta {
	start: number;
	end: number;
}

export type id2res = { [key: number]: RomResource; };
export interface RomLoadResult {
	rom: ArrayBuffer,
	images: Map<number, HTMLImageElement>;
	resources: id2res;
	source: any;
}