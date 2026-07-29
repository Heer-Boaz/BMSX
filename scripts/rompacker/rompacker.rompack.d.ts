/**
 * Rombuilder producer types.
 */
import { Buffer } from 'buffer';
import type { Canvas, Image as NodeCanvasImage } from 'canvas';
import type { NativeGxTexture } from '../../toolchain/ts/rompack/gx_texture_codec';
import type { GxTexturePageTile } from '../../toolchain/ts/rompack/assets';
import type { AssetType } from '../../machine/ts/rompack/toc';

export type RomPackerMode = 'rompack' | 'bios';

export interface RomPackerOptions {
	rom_name: string;
	title: string;
	respath: string;
	outputDirectory: string;
	force: boolean;
	debug: boolean;
	/** Accepted for CLI parity; rompack mode no longer type-checks TypeScript games. */
	skipTypecheck?: boolean;
	/** VM optimizer level. */
	optLevel: 0 | 1 | 2 | 3;
	mode: RomPackerMode;
	/** Always false on this branch; carts are Lua/data only. */
	shouldBundleCartCode: boolean;
	extraLuaRoots: string[];
	libraryLuaRoots: string[];
}

export type resourcetype = Exclude<AssetType, 'texture'> | 'atlas';
export type collisiontype = 'concave' | 'convex' | 'aabb';
export type datatype = 'json' | 'yaml' | 'bin';

interface BaseResource<TType extends resourcetype> {
	type: TType; // resource type
	name: string; // logical name within the rompack.
	filepath?: string; // Original file path on disk (relative)
	sourcePath?: string; // Original relative source path before any normalization (e.g. for Lua assets)
	ext?: string; // file extension
	id?: number; // assigned resource ID
	buffer?: Buffer; // raw data buffer
}

export interface ImageResource extends BaseResource<'image'> {
	id: number;
	collisionType: collisiontype;
	targetAtlasId: number;
	img?: NodeCanvasImage;
	textureU?: number;
	textureV?: number;
	gxPageTiles?: GxTexturePageTile[];
}

// Rombuilder-only packing group. Its canonical texture becomes one generated ROM resource.
export interface TextureAtlasResource extends BaseResource<'atlas'> {
	id: number;
	atlasId: number;
	gxTexture?: NativeGxTexture;
	img?: Canvas;
}

export interface AudioResource extends BaseResource<'audio'> {
	id: number;
}

export interface DataResource extends BaseResource<'data'> {
	id: number;
	datatype: datatype;
}

export interface AemResource extends BaseResource<'aem'> {
	id: number;
	datatype: datatype;
}

export interface ModelResource extends BaseResource<'model'> {
	id: number;
	datatype: datatype;
}

export interface LuaResource extends BaseResource<'lua'> {
	id: number;
	update_timestamp: number; // Timestamp of the last update to this Lua asset, used for caching and reloading during development.
}

export interface RomLabelResource extends BaseResource<'romlabel'> {
	id?: number;
}

// Raw binary asset: owner-authored packed bytes (struct arrays) emitted as-is.
export interface BinResource extends BaseResource<'bin'> {
	id: number;
}

export type Resource =
	| ImageResource
	| TextureAtlasResource
	| AudioResource
	| DataResource
	| AemResource
	| ModelResource
	| LuaResource
	| RomLabelResource
	| BinResource;
