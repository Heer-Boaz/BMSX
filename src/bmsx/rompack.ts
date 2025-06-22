/*
 * Enum representing the type of an audio asset.
 */
export type AudioType = 'sfx' | 'music';

/**
 * Alternative representation of a 2D vector as an array.
 * Example: [x, y]
 */
export type vec2arr = [number, number] | [number, number, number];

/**
 * Alternative representation of a 2D vector as an array.
 * Example: [x, y, z]
 */
export type vec3arr = [number, number, number];

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

export type Vector = vec2 & { z?: number };

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

export type Polygon = vec2arr[][];

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

export interface HitPolygonsPrecalc {
	original: Polygon; // The concave hull polygon of the image, used for collision detection.
	fliph: Polygon; // The concave hull polygon of the image, when flipped horizontally.
	flipv: Polygon; // The concave hull polygon of the image, when flipped vertically.
	fliphv: Polygon; // The concave hull polygon of the image, when flipped both horizontally and vertically.
}

/**
 * Metadata for an image asset.
 */
export interface ImgMeta {
	atlassed: boolean; // Whether the image is part of an atlas.
	atlasid?: number; // The ID of the atlas the image is part of, if applicable.
	width: number; // The width of the image.
	height: number; // The height of the image.
	texcoords?: number[]; // The texture coordinates for the image, used for rendering.
	texcoords_fliph?: number[]; // The texture coordinates for the image, when flipped horizontally.
	texcoords_flipv?: number[]; // The texture coordinates for the image, when flipped vertically.
	texcoords_fliphv?: number[]; // The texture coordinates for the image, when flipped both horizontally and vertically.
	boundingbox?: BoundingBoxPrecalc; // The bounding box of the image. Used for collision detection.
	centerpoint?: vec2arr; // The center point of the image, based on the bounding box.
	hitpolygons?: HitPolygonsPrecalc; // The concave hull polygons for collision detection, with flipped variants.
}

export interface AtlasMeta {
	/**
	 * The ID of the atlas.
	 */
	id: number;

	/**
	 * The width of the atlas.
	 */
	width: number;

	/**
	 * The height of the atlas.
	 */
	height: number;

	/**
	 * The list of image assets in the atlas.
	 */
	// img_assets: RomAsset[];
}

export type asset_type = 'image' | 'audio' | 'code' | 'atlas';

/**
 * Represents an asset in a ROM pack.
 */
export interface RomAsset {
	resid: number; // The resource ID of the asset.
	resname: string; // The name of the asset.
	type: asset_type; // The type of the asset.
	start: number; // The start offset of the asset in the ROM.
	end: number; // The end offset of the asset in the ROM.
	metabuffer_start?: number; // Optional start offset of binary-encoded per-asset metadata in the buffer
	metabuffer_end?: number; // Optional end offset of binary-encoded per-asset metadata in the buffer
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
