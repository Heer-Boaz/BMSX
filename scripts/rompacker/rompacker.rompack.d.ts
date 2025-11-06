/**
 * Type definitions shared between the rompacker CLI and the engine runtime.
 */
import { Buffer } from 'buffer';
import type { Canvas, Image as NodeCanvasImage } from 'canvas';
import type { asset_type } from '../../src/bmsx/rompack/rompack';

export type RomPackerTarget = 'browser' | 'cli' | 'headless';
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
	caseInsensitiveLua: boolean;
	mode: RomPackerMode;
	shouldBundleCartCode: boolean;
	extraLuaRoots: string[];
}

export type resourcetype = asset_type | 'rommanifest';
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
	type: TType;
	name: string;
	filepath?: string;
	ext?: string;
	id?: number;
	buffer?: Buffer;
	sourcePath?: string;
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
}

export interface RomLabelResource extends BaseResource<'romlabel'> {
	id?: number;
}

export interface RomManifestResource extends BaseResource<'rommanifest'> {
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
	| RomLabelResource
	| RomManifestResource;

export interface RomManifest {
	title?: string;
	short_name?: string;
	rom_name?: string;
}

export interface ResourceScanOptions {
	includeCode?: boolean;
	extraLuaPaths?: string[];
	atlasIndexResolver?: (filepath: string, currentIndex: number | undefined) => number | undefined;
}
