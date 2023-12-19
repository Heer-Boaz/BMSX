/*
 * Enum representing the type of an audio asset.
 */
export type AudioType = 'sfx' | 'music';

/**
 * Represents a 2D vector.
 */
export interface vec2 {
	/**
	 * The x-coordinate of the vector.
	 */
	x: number;
	/**
	 * The y-coordinate of the vector.
	 */
	y: number;
}

/**
 * Represents a 3-dimensional vector.
 * Extends the vec2 interface.
 */
export interface vec3 extends vec2 {
	z: number;
}

export type Vector = vec2 | vec3;

/**
 * Represents the size of an object.
 * It can be either a 2D vector or a 3D vector.
 */
export type Size = Vector;

/**
 * Represents an area defined by a start and end point.
 */
export interface Area {
	start: Vector;
	end: Vector;
}

/**
 * Metadata for an audio asset.
 */
export interface AudioMeta {
	audiotype: AudioType; // The type of audio asset.
	priority: number; // The priority of the audio asset.
	loop?: number; // The loop point of the audio asset.
}

export interface BoundingBoxPrecalc {
	original: Area, // The bounding box of the image. Used for collision detection.
	fliph: Area, // The bounding box of the image, when flipped horizontally. Used for collision detection.
	flipv: Area, // The bounding box of the image, when flipped vertically. Used for collision detection.
	fliphv: Area, // The bounding box of the image, when flipped both horizontally and vertically. Used for collision detection.
}

export interface BoundingBoxesPrecalc {
	original: Area[], // The bounding boxes of the image. Used for collision detection.
	fliph: Area[], // The bounding boxes of the image, when flipped horizontally. Used for collision detection.
	flipv: Area[], // The bounding boxes of the image, when flipped vertically. Used for collision detection.
	fliphv: Area[], // The bounding boxes of the image, when flipped both horizontally and vertically. Used for collision detection.
}

/**
 * Metadata for an image asset.
 */
export interface ImgMeta {
	atlassed: boolean; // Whether the image is part of an atlas.
	width: number; // The width of the image.
	height: number; // The height of the image.
	texcoords?: number[]; // The texture coordinates for the image, used for rendering.
	texcoords_fliph?: number[]; // The texture coordinates for the image, when flipped horizontally.
	texcoords_flipv?: number[]; // The texture coordinates for the image, when flipped vertically.
	texcoords_fliphv?: number[]; // The texture coordinates for the image, when flipped both horizontally and vertically.
	boundingbox?: BoundingBoxPrecalc; // The bounding box of the image. Used for collision detection.
	boundingboxes?: BoundingBoxesPrecalc; // The bounding boxes of the image. Used for collision detection.
	centerpoint?: vec2; // The center point of the image, based on the bounding box.
}

/**
 * Represents an asset in a ROM pack.
 */
export interface RomAsset {
	resid: number; // The resource ID of the asset.
	resname: string; // The name of the asset.
	type: string; // The type of the asset.
	start: number; // The start offset of the asset in the ROM.
	end: number; // The end offset of the asset in the ROM.
	buffer?: ArrayBuffer; // The binary buffer of the asset, used for all assets, including images and audio.
	imgmeta?: ImgMeta; // The metadata of the asset, if it is an image.
	audiometa?: AudioMeta; // The metadata of the asset, if it is an audio asset.
}

export interface RomMeta {
	start: number; // The start offset of the RomPack metadata in the ROM (file) buffer itself.
	end: number; // The end offset of the RomPack metadata in the ROM (file) buffer itself.
}

export type id2res = Record<number | string, RomAsset>;
export type id2htmlimg = Record<number | string, HTMLImageElement>;
export interface RomPack {
	rom: ArrayBuffer, // The binary buffer of the ROM pack, containing all assets, including images, audio and code.
	images: id2htmlimg; // The HTML images of the loaded image assets in the ROM pack, used for the Canvas renderer (not the WebGL renderer).
	img_assets: id2res; // Reference to the loaded image assets in the ROM pack, including metadata.
	snd_assets: id2res; // Reference to the loaded audio assets in the ROM pack, including metadata.
	code: string; // The loaded game code in the ROM pack.
}
