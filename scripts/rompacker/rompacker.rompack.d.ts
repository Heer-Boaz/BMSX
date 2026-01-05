/**
 * Type definitions shared between the rompacker CLI and the engine runtime.
 */
import { Buffer } from 'buffer';
import type { Canvas, Image as NodeCanvasImage } from 'canvas';
import type { asset_type } from '../../src/bmsx/rompack/rompack';
import type { CanonicalizationType } from '../../src/bmsx/rompack/rompack';

export type RomPackerTarget = 'browser' | 'cli' | 'headless' | 'libretro-wsl' | 'libretro-win' | 'libretro-snesmini';
export type RomPackerMode = 'bundle' | 'engine';

export interface RomPackerOptions {
	rom_name: string;
	title: string;
	bootloader_path: string;
	respath: string;
	force: boolean;
	debug: boolean;
	buildreslist: boolean;
	deploy: boolean;
	useTextureAtlas: boolean;
	platform: RomPackerTarget;
	/** Optional path to a directory of bmsx declarations to use for type-checking games. */
	enginedts?: string;
	/** When true, instruct rompacker to use per-game tsconfig.pkg.json for bundling/type-checking. */
	usePkgTsconfig?: boolean;
	/** When true, skip type-checking for the game. */
	skipTypecheck?: boolean;
	/** When true (default), rompacker folds Lua identifiers to lowercase for case-insensitive mode. */
	canonicalization: CanonicalizationType;
	mode: RomPackerMode;
	shouldBundleCartCode: boolean;
	extraLuaRoots: string[];
}

export type resourcetype = asset_type;
export type collisiontype = 'concave' | 'convex' | 'aabb';
export type datatype = 'json' | 'yaml' | 'bin';

export type AtlasTexcoords = [
	number, number,
	number, number,
	number, number,
	number, number,
	number, number,
	number, number
];

interface BaseResource<TType extends resourcetype> {
	type: TType; // resource type
	name: string; // logical name within the rompack, but I think unused in the game engine
	filepath?: string; // Original file path on disk (relative)
	sourcePath?: string; // Original relative source path before any normalization (e.g. for Lua assets)
	ext?: string; // file extension
	id?: number; // assigned resource ID
	buffer?: Buffer; // raw data buffer
}

export interface ImageResource extends BaseResource<'image'> {
	id: number;
	collisionType: collisiontype;
	targetAtlasIndex?: number;
	atlasid?: number;
	img?: NodeCanvasImage;
	atlasTexcoords?: AtlasTexcoords;
	skipAtlas?: boolean;
}

export interface AtlasResource extends BaseResource<'atlas'> {
	id: number;
	atlasid: number;
	img?: Canvas & { toBuffer?: (format: string) => Buffer; };
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

export interface CodeResource extends BaseResource<'code'> {
	id: number;
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

export type Resource =
	| ImageResource
	| AtlasResource
	| AudioResource
	| DataResource
	| AemResource
	| CodeResource
	| ModelResource
	| LuaResource
	| RomLabelResource;
