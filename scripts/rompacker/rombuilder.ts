// @ts-ignore
import type { Stats } from 'fs';
import { encodeBinary } from '../../machine/ts/common/serializer/binencoder';
import { CART_ROM_HEADER_SIZE } from '../../machine/ts/spec/bmsx/rom_package';
import type { Polygon, RectBounds } from '../../machine/ts/common/rect';
import type { vec2arr } from '../../machine/ts/common/vector';
import type {
	AudioMeta,
	BoundingBoxPrecalc,
	HitPolygonsPrecalc,
	ImgMeta,
	RomAsset,
	TextureMeta,
} from '../../toolchain/ts/rompack/assets';
import type { LuaChunk } from '../../toolchain/ts/lua/syntax/ast';
import type { GLTFMesh } from '../../toolchain/ts/rompack/gltf';
import { parseCartManifest, type CartManifest } from '../../machine/ts/rompack/manifest';
import {
	assertCartridgePackageFitsHardware,
	type RomImageDomain,
} from '../../machine/ts/rompack/image';
import {
	alignRomAssetOffset,
	layoutRomAssetPayloads,
	type RomAssetPayloadLayout,
} from '../../toolchain/ts/rompack/asset_layout';
import { writeCartRomHeader } from '../../toolchain/ts/rompack/header_encode';
import {
	encodeDirect16GxTexture,
	encodePalette4GxTexture,
	gxTextureFitsPalette4,
	type Direct16GxTexture,
} from '../../toolchain/ts/rompack/gx_texture_codec';
import { encodeDirect16GxUpload } from '../../toolchain/ts/rompack/gp0_encode';
import { encodeImgDecStream } from '../../toolchain/ts/rompack/imgdec_codec';
import type { RomPrefixLayout } from '../../toolchain/ts/rompack/rom_prefix_layout';
import { encodeRomToc } from '../../toolchain/ts/rompack/toc_encode';
import {
	type Blua32BiosFunctionExport,
	BLUA32_BIOS_IMPORTS_IMAGE_ID,
	BLUA32_BIOS_IMPORTS_SIDECAR_SUFFIX,
	encodeBlua32BiosImports,
	type Blua32BiosImports,
} from '../../toolchain/ts/rompack/blua32_bios_imports';
import {
	assertSystemBlua32ImageFits,
	SYSTEM_BLUA32_IMAGE_OFFSET,
} from '../../toolchain/ts/rompack/system';
import { encodeAudioAssetToAdpcm } from './adpcm';
import { buildBlua32Image, type GeneratedLuaModule } from '../../toolchain/ts/rompack/blua32_image_builder';
import { createTextureAtlas, resolveTextureAtlasName } from './atlasbuilder';
import {
	GX_SYSTEM_TEXTURE_ATLAS_NAME,
	GX_TEXTURE_PAGE_PIXELS,
} from './texture_atlas_contract';
import {
	GX_GPU_TRANSFER_MAX_HEIGHT,
	GX_GPU_TRANSFER_MAX_WIDTH,
} from '../../machine/ts/spec/gx/gp0';
import { BIOS_TERMINAL_GLYPHS_ASSET_ID, buildBiosTerminalGlyphTable } from './bios_terminal_font';
import {
	GX_SYSTEM_TEXTURE_ASSET_ID,
	GX_SYSTEM_TEXTURE_HEIGHT,
	GX_SYSTEM_TEXTURE_WIDTH,
	GX_SYSTEM_TEXTURE_X,
	GX_SYSTEM_TEXTURE_Y,
} from './system_texture';
import { BoundingBoxExtractor } from './boundingbox_extractor';
import { collectGLTFExternalBufferFileSet, loadGLTFModel } from './gltfloader';
import type { TextureAtlasResource, ImageResource, Resource, resourcetype } from './rompacker.rompack';
import { collectCartSourceFiles } from './cart_source_files';
import { CART_ROM_BASE, SYSTEM_ROM_BASE, SYSTEM_ROM_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import {
	BLUA32_IMAGE_ID,
	type Blua32BootHeader,
} from '../../toolchain/ts/rompack/blua32_image';
import {
	BLUA32_SYMBOLS_IMAGE_ID,
	encodeBlua32SymbolsImage,
} from '../../toolchain/ts/rompack/blua32_symbols';
import {
	BLUA32_DIAGNOSTICS_IMAGE_ID,
	encodeBlua32DiagnosticDirectory,
	type Blua32DiagnosticImage,
	type PackedBlua32DiagnosticSource,
} from '../../toolchain/ts/rompack/blua32_diagnostics';
import {
	convexCollisionPiece,
	encodeCollisionShapeVariants,
} from '../../toolchain/ts/rompack/collision_shape_encode';
import { compileCollisionMap } from './collision_map_compiler';
// @ts-ignore
const { join, parse, relative, resolve, sep } = require('path');

// @ts-ignore
const { access, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, utimes, writeFile, open } = require('fs/promises');
// @ts-ignore
const { createWriteStream, readFileSync, statSync } = require('fs');
// @ts-ignore
const { once } = require('events');
// @ts-ignore
const { finished } = require('stream/promises');
// @ts-ignore
const { LuaLexer } = require('../../toolchain/ts/lua/syntax/lexer');
// @ts-ignore
const { LuaParser } = require('../../toolchain/ts/lua/syntax/parser');
// @ts-ignore
// @ts-ignore
const { collectLuaModuleDependencyClosure } = require('../../toolchain/ts/lua/compiler/module_graph');
// @ts-ignore
const { isLuaCompileError } = require('../../toolchain/ts/lua/compiler');
// @ts-ignore
const {
	toLuaModulePath,
} = require('../../toolchain/ts/lua/module_path');
// @ts-ignore
const { loadImage } = require('canvas');
// @ts-ignore
const yaml = require('js-yaml');

export const BLUA32_SYMBOLS_SIDECAR_SUFFIX = '.blua32-symbols';
// @ts-ignore
const { createHash } = require('crypto');

type ProgressNote = (message: string) => void;
const ROM_ZERO_FILL_CHUNK = Buffer.alloc(64 * 1024);
const ADPCM_NO_LOOP = 0xffffffff;
type CompleteBoundingBoxPrecalc = BoundingBoxPrecalc & {
	fliph: RectBounds;
	flipv: RectBounds;
	fliphv: RectBounds;
};

type CompleteHitPolygonsPrecalc = HitPolygonsPrecalc & {
	fliph: Polygon[];
	flipv: Polygon[];
	fliphv: Polygon[];
};

type ImageCollisionBuild = {
	boundingbox: CompleteBoundingBoxPrecalc;
	centerpoint: vec2arr;
	hitpolygons: CompleteHitPolygonsPrecalc | undefined;
	collisionbin: Buffer;
};

export function normalizeWorkspacePath(input: string): string {
	const replaced = input.replace(/\\/g, '/').trim();
	if (replaced.length === 0) {
		return '';
	}
	const parts = replaced.split('/');
	const stack: string[] = [];
	for (let index = 0; index < parts.length; index += 1) {
		const part = parts[index];
		if (!part || part === '.') {
			continue;
		}
		if (part === '..') {
			if (stack.length > 0) {
				stack.pop();
			}
			continue;
		}
		stack.push(part);
	}
	return stack.join('/');
}

function toWorkspaceRelativePath(filepath: string): string {
	if (!filepath || filepath.length === 0) {
		throw new Error('Cannot convert empty filepath to workspace-relative path.');
	}
	const absolutePath = resolve(filepath);
	const projectRoot = process.cwd();
	const relativePath = relative(projectRoot, absolutePath);
	const workspacePath = relativePath.split(sep).join('/');
	return normalizeWorkspacePath(workspacePath);
}

function normalizeVirtualRootPath(root?: string): string {
	if (!root || root.length === 0) {
		return null;
	}
	return toWorkspaceRelativePath(root);
}

export function resolveVirtualSourcePath(filepath: string, virtualRoot: string): string {
	if (!filepath || filepath.length === 0) {
		return undefined;
	}
	const workspacePath = toWorkspaceRelativePath(filepath);
	if (!virtualRoot || virtualRoot.length === 0) {
		return workspacePath;
	}
	const normalizedWorkspace = workspacePath.toLowerCase();
	const normalizedRoot = virtualRoot.toLowerCase();
	if (normalizedWorkspace === normalizedRoot) {
		return '';
	}
	if (normalizedWorkspace.startsWith(`${normalizedRoot}/`)) {
		const relative = workspacePath.slice(virtualRoot.length + 1);
		return relative;
	}
	return workspacePath;
}

const WORKSPACE_STATE_DIR_NAME = '.bmsx';

const RESOURCE_SCAN_EXCLUDE = new Set<string>([
	'.rom',
	'.js',
	'.ts',
	'.map',
	'.tsbuildinfo',
]);

/**
 * Recursively gets all files in a directory and its subdirectories, optionally filtered by file extension.
 * @param {string} dirPath - The path of the directory to search.
 * @param {string[]} [_arrayOfFiles] - An optional array of files to append to.
 * @param {string} [filterExtension] - An optional file extension to filter by.
 */
export async function getFiles(dirPath: string, arrayOfFiles?: string[], filterExtension?: string): Promise<string[]> {
	if (!(await access(dirPath).then(() => true).catch(() => false))) {
		throw new Error(`Resource path "${dirPath}" does not exist.`);
	}

	const files = await readdir(dirPath);
	let array = arrayOfFiles || [];
	for (let file of files) {
		if (file.indexOf('_ignore') > -1) continue;
		if (isWorkspaceStateDirectory(file)) continue;

		let fullpath = `${dirPath}/${file}`;

		let stats = await stat(fullpath);
		if (stats.isDirectory()) {
			array = await getFiles(fullpath, array, filterExtension);
		} else {
			const ext = parse(file).ext.toLowerCase();
			if (filterExtension) {
				if (ext === filterExtension) {
					array.push(fullpath);
				}
			} else if (!RESOURCE_SCAN_EXCLUDE.has(ext)) {
				array.push(fullpath);
			}
		}
	}
	return array;
}

export async function getRomManifest(dirPath: string): Promise<CartManifest | null> {
	const files = await getFiles(dirPath, [], '.rommanifest');

	if (files.length > 1) {
		throw new Error(`More than one rommanifest found in ${dirPath}.`);
	}
	else if (files.length === 1) {
		const res = (await readFile(files[0])).toString();
		let manifest: unknown;
		try {
			manifest = JSON.parse(res);
		} catch {
			manifest = yaml.load(res);
		}
		return parseCartManifest(manifest, `ROM manifest "${files[0]}"`);
	}
	else return null;
}

/**
 * Parses the metadata of an audio file from its filename.
 * @param {string} filename - The name of the audio file.
 * @returns {Object} An object containing the sanitized name of the audio file and its metadata.
 */
export function parseAudioMeta(filename: string) {
	const priorityregex = /@p\=\d+/;
	const priorityresult = priorityregex.exec(filename);
	const priority = priorityresult ? parseInt(priorityresult[0].slice(3)) : 0;

	const loopregex = /@l=([0-9]+(?:[.,][0-9]+)?)(?:,([0-9]+(?:[.,][0-9]+)?))?/i;
	const loopresult = loopregex.exec(filename);
	let loopStart: number;
	let loopEnd: number;
	if (loopresult) {
		loopStart = parseFloat(loopresult[1].replace(',', '.'));
		if (loopresult[2]) {
			loopEnd = parseFloat(loopresult[2].replace(',', '.'));
		}
	}

	const sanitizedName = filename.replace(priorityregex, '').replace(loopregex, '').replace('@m', '');
	const audiometa: AudioMeta =
	{
		audiotype: filename.indexOf('@m') >= 0 ? 'music' : 'sfx',
		priority: priority,
		loop: loopStart,
		loopEnd,
	};
	return { sanitizedName, audiometa };
}

// --- Image filename collision-type suffix parser ---
export function parseImageMeta(filenameWithoutExt: string): {
	sanitizedName: string,
	collisionType: 'concave' | 'convex' | 'aabb',
	targetAtlasName: string | undefined,
} {
	const collisionMatch = filenameWithoutExt.match(/@(cc|cx)/i);
	let collisionType: 'concave' | 'convex' | 'aabb' = 'aabb';
	if (collisionMatch) {
		const code = collisionMatch[1].toLowerCase();
		collisionType = code === 'cc' ? 'concave' : code === 'cx' ? 'convex' : 'aabb';
	}
	const atlasMatch = filenameWithoutExt.match(/@atlas=([a-z0-9_-]+)/i);
	const targetAtlasName = atlasMatch?.[1].toLowerCase();

	const sanitizedName = filenameWithoutExt
		.replace(/@(cc|cx)/ig, '')
		.replace(/@atlas=[a-z0-9_-]+/ig, '');

	return { sanitizedName, collisionType, targetAtlasName };
}

function flipPolygons(polys: Polygon[], flipH: boolean, flipV: boolean, imgW: number, imgH: number): Polygon[] {
	const flipped: Polygon[] = new Array(polys.length);
	for (let polyIndex = 0; polyIndex < polys.length; polyIndex += 1) {
		const poly = polys[polyIndex];
		const out = new Array<number>(poly.length);
		for (let i = 0; i < poly.length; i += 2) {
			const x = poly[i];
			const y = poly[i + 1];
			out[i] = flipH ? imgW - 1 - x : x;
			out[i + 1] = flipV ? imgH - 1 - y : y;
		}
		flipped[polyIndex] = out;
	}
	return flipped;
}

function flipBoundingBoxHorizontally(box: RectBounds, width: number): RectBounds {
	return {
		left: width - box.right,
		right: width - box.left,
		top: box.top,
		bottom: box.bottom,
		z: box.z,
	};
}

function flipBoundingBoxVertically(box: RectBounds, height: number): RectBounds {
	return {
		left: box.left,
		right: box.right,
		top: height - box.bottom,
		bottom: height - box.top,
		z: box.z,
	};
}

function generateFlippedBoundingBox(extractedBoundingBox: RectBounds, imgW: number, imgH: number): CompleteBoundingBoxPrecalc {
	const originalBoundingBox = extractedBoundingBox;
	const horizontalFlipped = flipBoundingBoxHorizontally(originalBoundingBox, imgW);
	const verticalFlipped = flipBoundingBoxVertically(originalBoundingBox, imgH);
	const bothFlipped = flipBoundingBoxHorizontally(flipBoundingBoxVertically(originalBoundingBox, imgH), imgW);
	return {
		original: originalBoundingBox,
		fliph: horizontalFlipped,
		flipv: verticalFlipped,
		fliphv: bothFlipped,
	};
}

function buildImageCollisionBuild(res: ImageResource): ImageCollisionBuild {
	const img = res.img;
	if (!img) {
		throw new Error(`Image resource "${res.name}" is missing its decoded image data.`);
	}
	const imgBoundingBox = BoundingBoxExtractor.extractBoundingBox(img);
	let originalPolygons: Polygon[] = undefined;
	switch (res.collisionType) {
		case 'concave':
			originalPolygons = BoundingBoxExtractor.extractDetailedConvexPieces(img);
			break;
		case 'convex':
			originalPolygons = [BoundingBoxExtractor.extractConvexHull(img)].filter(poly => (poly?.length ?? 0) >= 6);
			break;
		case 'aabb':
			break;
	}
	const boundingbox = generateFlippedBoundingBox(imgBoundingBox, img.width, img.height);
	const centerpoint = BoundingBoxExtractor.calculateCenterPoint(imgBoundingBox);
	const hitpolygons = originalPolygons
		? {
			original: originalPolygons,
			fliph: flipPolygons(originalPolygons, true, false, img.width, img.height),
			flipv: flipPolygons(originalPolygons, false, true, img.width, img.height),
			fliphv: flipPolygons(originalPolygons, true, true, img.width, img.height),
		}
		: undefined;
	return {
		boundingbox,
		centerpoint,
		hitpolygons,
		collisionbin: Buffer.from(encodeCollisionShapeVariants({
			original: {
				bounds: boundingbox.original,
				pieces: hitpolygons?.original.map(convexCollisionPiece),
			},
			fliph: {
				bounds: boundingbox.fliph,
				pieces: hitpolygons?.fliph.map(convexCollisionPiece),
			},
			flipv: {
				bounds: boundingbox.flipv,
				pieces: hitpolygons?.flipv.map(convexCollisionPiece),
			},
			fliphv: {
				bounds: boundingbox.fliphv,
				pieces: hitpolygons?.fliphv.map(convexCollisionPiece),
			},
		})),
	};
}

function buildImgMetaFromCollisionBuild(res: ImageResource, collision: ImageCollisionBuild): ImgMeta {
	const img = res.img;
	if (!img) {
		throw new Error(`Image resource "${res.name}" is missing its decoded image data.`);
	}
	const imgmeta: ImgMeta = {
		width: img.width,
		height: img.height,
		texture_u: res.textureU!,
		texture_v: res.textureV!,
		boundingbox: collision.boundingbox,
		centerpoint: collision.centerpoint,
		hitpolygons: collision.hitpolygons,
	};
	if (res.targetAtlasName === GX_SYSTEM_TEXTURE_ATLAS_NAME) {
		imgmeta.gx_source_x = GX_SYSTEM_TEXTURE_X + res.textureU!;
		imgmeta.gx_source_y = GX_SYSTEM_TEXTURE_Y + res.textureV!;
	} else {
		imgmeta.gx_atlas_id = res.targetAtlasName;
	}
	if (res.gxPageTiles) {
		imgmeta.gx_page_tiles = res.gxPageTiles;
	}
	return imgmeta;
}

function formatLuaCompileError(error: { path: string; message: string; line: number; column: number }, source: string): string {
	// disable-next-line newline_normalization_pattern -- compiler diagnostics map a source location to one logical source line.
	const lines = source.split(/\r\n|\r|\n/);
	const sourceLine = lines[error.line - 1];
	const gutter = `${error.line} | `;
	const caret = Math.max(0, error.column - 1);
	return `${error.path}:${error.line}:${error.column}: ${error.message}\n${gutter}${sourceLine}\n${' '.repeat(gutter.length + caret)}^`;
}

export function compileLuaChunkBuffer(source: string, path: string): Buffer {
	const lexer = new LuaLexer(source, path);
	const tokens = lexer.scanTokens();
	const parser = new LuaParser(tokens, path, source);
	const chunk = parser.parseChunk();
	const encoded = encodeBinary(chunk);
	return Buffer.from(encoded);
}

/**
 * Returns an object containing the name, extension, and type of a resource file based on its filepath.
 * @param filepath The path of the resource file.
 * @returns An object containing the name, extension, and type of the resource file.
 */
export function getResMetaByFilename(filepath: string): { name: string, ext: string, type: resourcetype, collisionType?: 'concave' | 'convex' | 'aabb', datatype?: 'json' | 'yaml' | 'bin', update_timestamp?: number } {
	const parsed = parse(filepath);
	const stats: Stats = statSync(filepath);
	const rawName = parsed.name;
	const normalizedName = rawName.replace(/\s+/g, '').toLowerCase();
	let name = normalizedName;
	const ext = parsed.ext.toLowerCase();
	let type: resourcetype;
	let collisionType: 'concave' | 'convex' | 'aabb' = undefined;
	let datatype: 'json' | 'yaml' | 'bin' = undefined;
	let update_timestamp: number = undefined;

	const getDataSubtype = (currentName: string): 'aem' | 'data' => {
		if (currentName.includes('.aem')) return 'aem';
		return 'data';
	};

	const removeExtension = (currentName: string): string => {
		// Remove any `.` and the following characters from the name, which must be done after extracting the extension and determining the subtype
		return currentName.replace(/\..*$/, '');
	};

	switch (ext) {
		case '.wav':
		case '.aac':
		case '.m4u':
		case '.ogg':
		case '.adpcm':
		case '.adp':
			type = 'audio';
			break;
		case '.atlas': // `.atlas`-files don't exist. We use this to add the texture atlas to the resource list
			type = 'atlas';
			break;
		case '.png':
			if (name === 'romlabel') {
				// Special case for romlabel, which is a PNG file with a specific name
				type = 'romlabel';
			}
			else {
				type = 'image';
			}
			break;
		case '.json':
			datatype = 'json';
			type = getDataSubtype(name);
			name = removeExtension(name);
			// Warn about JSON files, because YAML is preferred for better readability
			console.log(`JSON data file detected: "${name}${ext}" (name="${name}", ext="${ext}", type="${type}"), consider using YAML (.yaml or .yml) for better readability.`);
			break;
		case '.obj':
		case '.gltf':
		case '.glb':
			type = 'model';
			break;
		case '.yaml':
		case '.yml':
			datatype = 'yaml';
			if (name.endsWith('.collision')) {
				type = 'collision_map';
				name = name.slice(0, -'.collision'.length);
			} else {
				type = getDataSubtype(name);
				name = removeExtension(name);
			}
			break;
		case '.bin':
			type = 'bin';
			break;
		case '.lua':
			type = 'lua';
			update_timestamp = stats.mtimeMs;
			break;
	}
	return { name, ext, type, collisionType, datatype, update_timestamp };
}

/**
 * Builds a list of resource objects from the exact roots owned by one product.
 * @param respaths Paths whose resources belong to the selected build domain.
 * @returns An array of resources with basic metadata.
 */
export type ResourceScanOptions = {
	domain: RomImageDomain;
	extraLuaPaths?: string[];
	extraLuaFiles?: readonly string[];
	virtualRoot?: string;
	libraryLuaPaths?: string[];
	/** Lua roots used for library reachability without adding the roots as resources. */
	luaDependencyRootFiles?: readonly string[];
};

export type RebuildOptions = {
	domain: RomImageDomain;
	extraLuaPaths?: readonly string[];
	buildSourceDirectories?: readonly string[];
	buildSourceFiles?: readonly string[];
	/**
	 * When set, rebuild checks use the debug ROM output (`dist/<romname>.debug.rom`).
	 */
	debug?: boolean;
	/**
	 * Optional override for the expected ROM output path used by rebuild checks.
	 * Defaults to `dist/<romname>[.debug].rom` (based on `debug`).
	 */
	romFilePath?: string;
	/**
	 * BIOS import-library path used by executable cart rebuild checks. Omit it for
	 * cartridges without program source.
	 */
	biosImportsFilePath?: string;
};

function isWorkspaceStateDirectory(name: string): boolean {
	return name.toLowerCase() === WORKSPACE_STATE_DIR_NAME;
}

function collectLibraryLuaClosure(seedFiles: readonly string[], libraryRoots: readonly string[], virtualRoot: string): string[] {
	const moduleFileByPath = new Map<string, string>();
	for (const root of libraryRoots) {
		if (!root || root.length === 0) {
			continue;
		}
		for (const file of collectCartSourceFiles([root])) {
			const sourcePath = resolveVirtualSourcePath(file, virtualRoot) ?? toWorkspaceRelativePath(file);
			moduleFileByPath.set(toLuaModulePath(sourcePath), file);
		}
	}
	const rootChunks = new Array<LuaChunk>(seedFiles.length);
	for (let index = 0; index < seedFiles.length; index += 1) {
		const file = seedFiles[index];
		const source = readFileSync(file, 'utf8');
		const lexer = new LuaLexer(source, file);
		const tokens = lexer.scanTokens();
		rootChunks[index] = new LuaParser(tokens, file, source).parseChunk();
	}
	const modulePaths = new Set(moduleFileByPath.keys());
	const includedModulePaths = collectLuaModuleDependencyClosure(
		rootChunks,
		modulePaths,
		(modulePath: string): LuaChunk => {
			const file = moduleFileByPath.get(modulePath)!;
			const source = readFileSync(file, 'utf8');
			const lexer = new LuaLexer(source, file);
			const tokens = lexer.scanTokens();
			return new LuaParser(tokens, file, source).parseChunk();
		},
	);
	const includedFiles = new Array<string>(includedModulePaths.length);
	for (let index = 0; index < includedModulePaths.length; index += 1) {
		const modulePath = includedModulePaths[index];
		const file = moduleFileByPath.get(modulePath)!;
		includedFiles[index] = file;
	}
	return includedFiles.sort((a, b) => a.localeCompare(b));
}

export async function getResMetaList(
	respaths: readonly string[],
	options: ResourceScanOptions,
): Promise<Resource[]> {
	const arrayOfFiles: string[] = [];
	const virtualRoot = normalizeVirtualRootPath(options.virtualRoot);
	const extraLuaRoots = options.extraLuaPaths;
	const systemResourceRoots = options.domain === 'system' ? respaths : [];
	const seenPaths = new Set<string>();

	const pushFile = (filepath: string) => {
		const normalized = resolve(filepath);
		if (seenPaths.has(normalized)) return;
		seenPaths.add(normalized);
		arrayOfFiles.push(filepath);
	};

	for (const respath of respaths) {
		const files = await getFiles(respath);
		for (const file of files) {
			pushFile(file);
		}
	}

	if (extraLuaRoots) {
		for (const luaRoot of extraLuaRoots) {
			if (!luaRoot || luaRoot.length === 0) continue;
			for (const file of collectCartSourceFiles([luaRoot])) {
				pushFile(file);
			}
		}
	}
	const extraLuaFiles = options.extraLuaFiles;
	if (extraLuaFiles) {
		for (let index = 0; index < extraLuaFiles.length; index += 1) {
			pushFile(extraLuaFiles[index]);
		}
	}
	const seedFiles = arrayOfFiles.filter(file => file.toLowerCase().endsWith('.lua'));
	const dependencyRootFiles = options.luaDependencyRootFiles;
	if (dependencyRootFiles !== undefined) {
		for (let index = 0; index < dependencyRootFiles.length; index += 1) {
			seedFiles.push(dependencyRootFiles[index]);
		}
	}
	const libraryLuaRoots = options.libraryLuaPaths;
	if (libraryLuaRoots) {
		const libraryFiles = collectLibraryLuaClosure(seedFiles, libraryLuaRoots, virtualRoot);
		for (let index = 0; index < libraryFiles.length; index += 1) {
			pushFile(libraryFiles[index]);
		}
	}
	const gltfBufferFiles = collectGLTFExternalBufferFileSet(arrayOfFiles);
	const resourceFiles = arrayOfFiles.filter(file => parse(file).ext.toLowerCase() !== '.bin' || !gltfBufferFiles.has(resolve(file)));
	resourceFiles.sort((a, b) => a.localeCompare(b));

	const result: Array<Resource> = [];
	const targetAtlasNames = new Set<string>();
	const imageNameRegistry = new Map<string, { filepath?: string }>();

	let imgid = 1;
	let sndid = 1;
	let dataid = 1;
	let modelid = 1;
	let luaid = 1;
	let binid = 1;
	for (let i = 0; i < resourceFiles.length; i++) {
		const filepath = resourceFiles[i];
		const meta = getResMetaByFilename(filepath);

		const type = meta.type;
		let name = meta.name;
		const ext = meta.ext;
		const virtualSourcePath = resolveVirtualSourcePath(filepath, virtualRoot);
		const sourcePath = virtualSourcePath || toWorkspaceRelativePath(filepath);
		switch (type) {
			case 'image':
				const imgMeta = parseImageMeta(name);
				name = imgMeta.sanitizedName; // Remove metadata from the name
				const existingImage = imageNameRegistry.get(name);
				if (existingImage && existingImage.filepath) {
					const existingParsed = parse(existingImage.filepath);
					const currentParsed = parse(filepath);
					const sameDirectory = existingParsed.dir === currentParsed.dir;
					const sameBaseLower = existingParsed.name.toLowerCase() === currentParsed.name.toLowerCase();
					const casingDiffers = existingParsed.name !== currentParsed.name;
					if (sameDirectory && sameBaseLower && casingDiffers) {
						console.warn(`[RomPacker] Skipping case-variant image "${filepath}" (using "${existingImage.filepath}" as "${name}").`);
						break;
					}
					throw new Error(`[RomPacker] Duplicate image resource "${name}" defined by "${existingImage.filepath}" and "${filepath}".`);
				}
				const targetAtlasName = resolveTextureAtlasName(
					filepath,
					systemResourceRoots,
					imgMeta.targetAtlasName,
				);
				targetAtlasNames.add(targetAtlasName);
				result.push({
					filepath,
					name,
					ext,
					type,
					id: imgid,
					collisionType: imgMeta.collisionType,
					targetAtlasName,
					sourcePath,
				});
				imageNameRegistry.set(name, { filepath });
				++imgid;
				break;
			case 'audio':
				const parsedMeta = parseAudioMeta(name);
				name = parsedMeta.sanitizedName; // Remove metadata from the name
				result.push({ filepath, name, ext, type, id: sndid, sourcePath });
				++sndid;
				break;
			case 'romlabel':
				result.push({ filepath, name, ext, type, id: undefined, sourcePath });
				break;
			case 'data':
				result.push({ filepath, name, ext, type, id: dataid, datatype: meta.datatype, sourcePath });
				++dataid;
				break;
			case 'aem':
				result.push({
					filepath,
					name,
					ext,
					type,
					id: dataid,
					datatype: ext === '.json' ? 'json' : 'yaml',
					sourcePath,
				});
				++dataid;
				break;
			case 'collision_map':
				result.push({ filepath, name, ext, type, datatype: 'yaml', sourcePath });
				break;
			case 'lua':
				// For Lua files, we also determine the current datetime to allow the workspace to detect changes and choosing which source to regard as newer
				name = sourcePath.replace(/\.lua$/i, '');
				result.push({ filepath, name, ext, type, id: luaid, sourcePath, update_timestamp: meta.update_timestamp });
				++luaid;
				break;
			case 'model':
				result.push({ filepath, name, ext, type, id: modelid, datatype: meta.datatype, sourcePath });
				++modelid;
				break;
			case 'bin':
				result.push({ filepath, name, ext, type, id: binid, sourcePath });
				++binid;
				break;
			case 'atlas':
				// Generated texture atlas resources are added below.
				break;
		}
	}

	for (const name of Array.from(targetAtlasNames).sort((left, right) => left.localeCompare(right))) {
		result.push({
			name,
			ext: '.atlas',
			type: 'atlas',
			id: imgid++,
		});
	}

	result.sort((left, right) => {
		if (left.type !== right.type) return left.type.localeCompare(right.type);
		return left.name.localeCompare(right.name);
	});

	// Validation: ensure no duplicate IDs within the same resource type (image or audio)
	const checkDuplicateIds = (type: string) => {
		const filtered = result.filter(r => r.type === type && typeof r.id === 'number');
		const idMap = new Map<number, string[]>();
		for (const r of filtered) {
			if (!idMap.has(r.id)) idMap.set(r.id, []);
			idMap.get(r.id)!.push(r.name);
		}
		const dups = Array.from(idMap.entries()).filter(([_id, names]) => names.length > 1);
		if (dups.length > 0) {
			const msg = dups.map(([id, names]) => `ID ${id} used by: ${names.join(', ')}`).join('\n');
			throw new Error(`Duplicate ${type} resource IDs found!\n${msg}`);
		}
	};

	const checkDuplicateNames = (type: string) => {
		const filtered = result.filter(r => r.type === type && typeof r.name === 'string');
		const nameMap = new Map<string, string[]>();
		for (const r of filtered) {
			// Only consider exact matches for names
			const key = r.name;
			if (!nameMap.has(key)) nameMap.set(key, []);
			nameMap.get(key)!.push(r.filepath);
		}
		const dups = Array.from(nameMap.entries()).filter(([_name, paths]) => paths.length > 1);
		if (dups.length > 0) {
			const msg = dups.map(([name, paths]) => `Name "${name}" used by: ${paths.join(', ')}`).join('\n');
			throw new Error(`Duplicate ${type} resource names found!\n${msg}`);
		}
	};

	checkDuplicateIds('image');
	checkDuplicateIds('audio');
	checkDuplicateIds('data');
	checkDuplicateIds('model');
	checkDuplicateIds('bin');
	checkDuplicateNames('data');
	checkDuplicateNames('collision_map');
	checkDuplicateNames('image');
	checkDuplicateNames('audio');
	checkDuplicateNames('model');
	checkDuplicateNames('lua');
	checkDuplicateNames('bin');

	return result;
}

/**
 * Builds a list of resources located at `respath` for the specified `romname`.
 * @param rom_name The name of the ROM pack to build the list for.
 * @returns An array of resources.
 */
export async function getResourcesList(resMetaList: Resource[]): Promise<Resource[]> {
	let resources: Array<Resource> = [];

	// Parallelize buffer and image loading
	const resourcePromises = resMetaList.map(async (meta): Promise<Resource> => {
		const buffer = meta.filepath ? await readFile(meta.filepath) : undefined;
		switch (meta.type) {
			case 'image': {
				if (!buffer) {
					throw new Error(`Image resource "${meta.name}" is missing its binary payload.`);
				}
				const img = await loadImage(buffer);
				return {
					...meta,
					buffer,
					img,
				};
			}
			case 'audio':
			case 'data':
			case 'aem':
			case 'model':
			case 'romlabel':
			case 'atlas':
			case 'bin':
			case 'collision_map':
				return {
					...meta,
					buffer,
				};
			case 'lua': {
				if (!buffer) {
					throw new Error(`[RomPacker] Lua resource "${meta.name}" is missing its source file payload.`);
				}
				return {
					...meta,
					buffer,
				};
			}
		}
	});

	resources = await Promise.all(resourcePromises);

	return resources;
}

/**
 * Processes an array of resources to produce asset metadata and allocate buffer ranges.
 *
 * This function processes each loaded resource, extracting relevant metadata and buffer data,
 * and constructs a RomAsset for each. Producer-only atlas records are omitted;
 * each named cart atlas becomes an explicit texture resource and image records refer to it by id.
 * The resulting RomAsset array is used for ROM packing and serialization.
 *
 * @param resources - The array of resources to process.
 * @returns The generated ROM asset records.
 */

export async function generateRomAssets(
	resources: Resource[],
	reportProgress?: ProgressNote,
) {
	const romAssets: RomAsset[] = [];
	const compileErrors: string[] = [];
	const systemAtlas = resources.find((resource): resource is TextureAtlasResource =>
		resource.type === 'atlas' && resource.name === GX_SYSTEM_TEXTURE_ATLAS_NAME);
	if (systemAtlas) {
		const systemTexture = systemAtlas.gxTexture as Direct16GxTexture;
		romAssets.push({
			resid: GX_SYSTEM_TEXTURE_ASSET_ID,
			type: 'bin',
			buffer: encodeDirect16GxUpload(systemTexture, GX_SYSTEM_TEXTURE_X, GX_SYSTEM_TEXTURE_Y),
		});
		romAssets.push({
			resid: BIOS_TERMINAL_GLYPHS_ASSET_ID,
			type: 'bin',
			buffer: buildBiosTerminalGlyphTable(resources),
		});
	}
	for (const res of resources) {
		const type = res.type;
		const sourcePath = res.sourcePath || (res.filepath && toWorkspaceRelativePath(res.filepath));
		let resid = res.name;
		let buffer = res.buffer;
		reportProgress?.(`asset ${res.type}:${resid}`);

			switch (type) {
			case 'romlabel':
				romAssets.push({ resid, type, buffer, source_path: sourcePath });
				break;
			case 'image': {
				const collision = buildImageCollisionBuild(res);
				const imgmeta = buildImgMetaFromCollisionBuild(res, collision);
				const baseAsset: RomAsset = {
					resid,
					type,
					imgmeta,
					source_path: sourcePath,
				};
				baseAsset.collision_bin_buffer = collision.collisionbin;
				romAssets.push(baseAsset);
			}
				break;
			case 'audio': {
				// Note that the name has already been sanitized in the `getResMetaList` function
				const { audiometa } = parseAudioMeta(res.filepath);
				const encoded = await encodeAudioAssetToAdpcm(buffer, audiometa);
				if ((audiometa.loop === undefined || audiometa.loop === null) && encoded.loopStartFrame !== ADPCM_NO_LOOP) {
					audiometa.loop = encoded.loopStartFrame / encoded.sampleRate;
				}
				if ((audiometa.loopEnd === undefined || audiometa.loopEnd === null) && encoded.loopEndFrame !== ADPCM_NO_LOOP) {
					audiometa.loopEnd = encoded.loopEndFrame / encoded.sampleRate;
				}
				romAssets.push({ resid, type, audiometa, buffer: encoded.buffer, source_path: sourcePath });
				break;
			}
			case 'lua': {
				if (!res.filepath || res.filepath.length === 0) {
					throw new Error(`[RomPacker] Lua resource "${resid}" is missing its source file path.`);
				}
				const luaSourcePath = sourcePath || toWorkspaceRelativePath(res.filepath);
				const normalizedPath = normalizeWorkspacePath(luaSourcePath);
				const workspacePath = normalizeWorkspacePath(toWorkspaceRelativePath(res.filepath));
				const modulePath = toLuaModulePath(normalizedPath);
				const source = buffer.toString('utf8');
				let compiled_buffer: Buffer;
				try {
					compiled_buffer = compileLuaChunkBuffer(source, modulePath);
				} catch (error) {
					if (isLuaCompileError(error)) {
						compileErrors.push(formatLuaCompileError(error, source));
						continue;
					}
					throw error;
				}
				romAssets.push({
					resid,
					type,
					buffer,
					compiled_buffer,
					source_path: normalizedPath,
					normalized_source_path: workspacePath,
					update_timestamp: res.update_timestamp,
				});
				break;
			}
			case 'data':
				// Encode the JSON-data via the binencoder
				// Convert the buffer to a JSON string and then encode it
				switch (res.datatype) {
					case 'yaml':
						// If the data is a YAML file, we need to convert it to JSON first
						const yamlContent = res.buffer.toString('utf8');
						const jsonContent = yaml.load(yamlContent);
						// res.buffer = jsonContent;
						const encodedYamlData = encodeBinary(jsonContent);
						// Ensure Buffer instance (encodeBinary returns Uint8Array)
						// @ts-ignore
						buffer = Buffer.from(encodedYamlData);
						break;
					case 'json':
						// If the data is a JSON file, we need to convert it to a string first
						const json = JSON.parse(res.buffer.toString('utf8'));
						const encodedData = encodeBinary(json);

						// @ts-ignore
						buffer = Buffer.from(encodedData);
						break;
					case 'bin':
						// If the data is a binary file, we can use it as is
						break;
				}
				romAssets.push({ resid, type, buffer, source_path: sourcePath });
				break;
			case 'aem': {
				buffer = Buffer.from(encodeBinary(res.eventMap));
				romAssets.push({ resid, type, buffer, source_path: sourcePath });
				break;
			}
			case 'bin':
				// Raw binary asset: emit owner-defined packed bytes as-is for typed struct-array reads.
				romAssets.push({ resid, type, buffer, source_path: sourcePath });
				break;
			case 'collision_map': {
				const layers = compileCollisionMap(yaml.load(buffer.toString('utf8')), sourcePath);
				for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
					const layer = layers[layerIndex];
					romAssets.push({
						resid: `${resid}.${layer.name}`,
						type: 'collision_shape',
						buffer: layer.buffer,
						source_path: sourcePath,
					});
				}
				break;
			}
			case 'model': {
				const pathInfo = parse(res.filepath);
				const dir = pathInfo.dir;
				const ext = pathInfo.ext.toLowerCase();
				let gltfSource: string | ArrayBuffer;
				if (ext === '.glb') {
					const bufView = res.buffer;
					gltfSource = bufView.buffer.slice(bufView.byteOffset, bufView.byteOffset + bufView.byteLength) as ArrayBuffer;
				} else {
					gltfSource = res.buffer.toString('utf8');
				}
				const parsed = await loadGLTFModel(gltfSource, dir, resid);

				let texOffset = 0;
				const imageOffsets: { start: number; end: number }[] = [];
				// @ts-ignore
				const texBuffers: Buffer[] = [];
				for (let i = 0; i < parsed.imageBuffers.length; i++) {
					const buf = parsed.imageBuffers[i];
					const start = texOffset;
					const end = texOffset + buf.byteLength;
					texOffset = end;
					// @ts-ignore
					texBuffers.push(Buffer.from(buf));
					imageOffsets.push({ start, end });
				}
				const obj = {
					meshes: parsed.meshes.map((m: GLTFMesh) => ({
						positions: m.positions,
						texcoords: m.texcoords,
						excoords1: m.texcoords1,
						normals: m.normals,
						tangents: m.tangents,
						indices: m.indices,
						indexComponentType: m.indexComponentType,
						materialIndex: m.materialIndex,
						morphPositions: m.morphPositions,
						morphNormals: m.morphNormals,
						morphTangents: m.morphTangents,
						weights: m.weights,
						jointIndices: m.jointIndices,
						jointWeights: m.jointWeights,
						colors: m.colors,
					})),
					materials: parsed.materials,
					animations: parsed.animations,
					nodes: parsed.nodes,
					skins: parsed.skins,
					scenes: parsed.scenes,
					scene: parsed.scene,
					imageOffsets,
					textures: parsed.textures,
				};
				const encodedObj = encodeBinary(obj);
				// @ts-ignore
				buffer = Buffer.from(encodedObj);
				// @ts-ignore
				const model_texture_buffer = Buffer.concat(texBuffers);
				romAssets.push({ resid, type, buffer, model_texture_buffer, source_path: sourcePath });
			}
				break;
			case 'atlas': {
				if (res.name !== GX_SYSTEM_TEXTURE_ATLAS_NAME) {
					const texture = res.gxTexture!;
					const texturemeta: TextureMeta = {
						mode: texture.mode,
						word_width: texture.wordWidth,
						height: texture.height,
						texture_word_count: texture.textureWordCount,
						clut_word_count: texture.clutWordCount,
					};
					romAssets.push({
						resid: res.name,
						type: 'texture',
						buffer: encodeImgDecStream(texture.words, texture.textureWordCount, texture.clutWordCount),
						texturemeta,
					});
				}
			}
				break;
		}
	}
	if (compileErrors.length > 0) {
		throw new Error(`Compilation failed with ${compileErrors.length} Lua error(s):\n${compileErrors.join('\n')}`);
	}
	return romAssets;
}

type BuildRomBlua32TailOptions = {
	generatedLuaModules: GeneratedLuaModule[];
	includeSymbols: boolean;
	optLevel: 0 | 1 | 2 | 3;
	ramByteCount: number;
} & (
	| {
		domain: 'system';
		systemAssetEndOffset: number;
		biosExports: ReadonlyArray<Blua32BiosFunctionExport>;
	}
	| {
		domain: 'cart';
		imageOffset: number;
		biosImports: Blua32BiosImports;
	}
);

type BuildSystemRomBlua32TailOptions = Extract<
	BuildRomBlua32TailOptions,
	{ domain: 'system' }
>;

type BuildCartRomBlua32TailOptions = Extract<
	BuildRomBlua32TailOptions,
	{ domain: 'cart' }
>;

type RomBlua32TailCommon = {
	boot: Blua32BootHeader;
	layout: RomAssetPayloadLayout;
	diagnostics: Blua32DiagnosticImage | null;
};

type SystemRomBlua32Tail = RomBlua32TailCommon & {
	domain: 'system';
	symbolsPayload: Uint8Array;
	biosImportsPayload: Uint8Array;
};

export type CartRomBlua32Tail = RomBlua32TailCommon & {
	domain: 'cart';
};

export type RomBlua32Tail = SystemRomBlua32Tail | CartRomBlua32Tail;

export function buildRomBlua32Tail(
	assetList: ReadonlyArray<RomAsset>,
	options: BuildSystemRomBlua32TailOptions,
): SystemRomBlua32Tail;
export function buildRomBlua32Tail(
	assetList: ReadonlyArray<RomAsset>,
	options: BuildCartRomBlua32TailOptions,
): CartRomBlua32Tail;
export function buildRomBlua32Tail(
	assetList: ReadonlyArray<RomAsset>,
	options: BuildRomBlua32TailOptions,
): RomBlua32Tail {
	const luaProgramAssets = assetList.filter(
		asset => asset.type === 'lua' && asset.compiled_buffer !== undefined,
	);
	if (options.domain === 'system') {
		const imageOffset = SYSTEM_BLUA32_IMAGE_OFFSET;
		const built = buildBlua32Image({
			luaAssets: luaProgramAssets,
			generatedLuaModules: options.generatedLuaModules,
			loadAddress: SYSTEM_ROM_BASE + imageOffset,
			ramByteCount: options.ramByteCount,
			optLevel: options.optLevel,
			traceStatements: 'erase',
			domain: 'system',
			biosExports: options.biosExports,
		});
		const linked = built.linked;
		const imageEndOffset = imageOffset + linked.bytes.byteLength;
		assertSystemBlua32ImageFits(imageEndOffset);
		const symbolsPayload = encodeBlua32SymbolsImage(linked.symbols);
		const biosImportsPayload = encodeBlua32BiosImports(linked.biosImports);
		const imageLayout = layoutRomAssetPayloads([{
			resid: BLUA32_IMAGE_ID,
			type: 'code',
			buffer: Buffer.from(
				linked.bytes.buffer,
				linked.bytes.byteOffset,
				linked.bytes.byteLength,
			),
			source_path: BLUA32_IMAGE_ID,
		}], true, imageOffset);
		const tailAssets: RomAsset[] = [{
			resid: BLUA32_BIOS_IMPORTS_IMAGE_ID,
			type: 'code',
			buffer: Buffer.from(
				biosImportsPayload.buffer,
				biosImportsPayload.byteOffset,
				biosImportsPayload.byteLength,
			),
			source_path: BLUA32_BIOS_IMPORTS_IMAGE_ID,
		}];
		if (options.includeSymbols) {
			tailAssets.push({
				resid: BLUA32_SYMBOLS_IMAGE_ID,
				type: 'code',
				buffer: Buffer.from(
					symbolsPayload.buffer,
					symbolsPayload.byteOffset,
					symbolsPayload.byteLength,
				),
				source_path: BLUA32_SYMBOLS_IMAGE_ID,
			});
		}
		const tailLayout = layoutRomAssetPayloads(
			tailAssets,
			true,
			options.systemAssetEndOffset,
		);
		return {
			domain: 'system',
			boot: {
				imageOffset,
				imageByteCount: linked.bytes.byteLength,
				startupFunctionAddress: linked.startupFunctionAddress,
				irqFunctionAddress: linked.irqFunctionAddress,
				exceptionFunctionAddress: linked.exceptionFunctionAddress,
				staticLayoutTokenLo: linked.symbols.staticLayoutToken.lo,
				staticLayoutTokenHi: linked.symbols.staticLayoutToken.hi,
			},
			layout: {
				entries: imageLayout.entries.concat(tailLayout.entries),
				ranges: imageLayout.ranges.concat(tailLayout.ranges),
				payloadEnd: tailLayout.payloadEnd,
				nextOffset: tailLayout.nextOffset,
			},
			diagnostics: options.includeSymbols ? {
				textAddress: linked.layout.header.textAddress,
				textByteCount: linked.layout.header.textByteCount,
				debugRanges: linked.symbols.metadata.debugRanges,
				sources: built.diagnosticSources,
			} : null,
			symbolsPayload,
			biosImportsPayload,
		};
	}
	const built = buildBlua32Image({
		luaAssets: luaProgramAssets,
		generatedLuaModules: options.generatedLuaModules,
		loadAddress: CART_ROM_BASE + options.imageOffset,
		ramByteCount: options.ramByteCount,
		optLevel: options.optLevel,
		traceStatements: 'erase',
		domain: 'cart',
		biosImports: options.biosImports,
	});
	const linked = built.linked;
	const executableAssets: RomAsset[] = [{
		resid: BLUA32_IMAGE_ID,
		type: 'code',
		buffer: Buffer.from(
			linked.bytes.buffer,
			linked.bytes.byteOffset,
			linked.bytes.byteLength,
		),
		source_path: BLUA32_IMAGE_ID,
	}];
	if (options.includeSymbols) {
		const symbolsPayload = encodeBlua32SymbolsImage(linked.symbols);
		executableAssets.push({
			resid: BLUA32_SYMBOLS_IMAGE_ID,
			type: 'code',
			buffer: Buffer.from(
				symbolsPayload.buffer,
				symbolsPayload.byteOffset,
				symbolsPayload.byteLength,
			),
			source_path: BLUA32_SYMBOLS_IMAGE_ID,
		});
	}
	return {
		domain: 'cart',
		boot: {
			imageOffset: options.imageOffset,
			imageByteCount: linked.bytes.byteLength,
			startupFunctionAddress: linked.startupFunctionAddress,
			irqFunctionAddress: linked.irqFunctionAddress,
			exceptionFunctionAddress: linked.exceptionFunctionAddress,
			staticLayoutTokenLo: linked.symbols.staticLayoutToken.lo,
			staticLayoutTokenHi: linked.symbols.staticLayoutToken.hi,
		},
		layout: layoutRomAssetPayloads(executableAssets, true, options.imageOffset),
		diagnostics: options.includeSymbols ? {
			textAddress: linked.layout.header.textAddress,
			textByteCount: linked.layout.header.textByteCount,
			debugRanges: linked.symbols.metadata.debugRanges,
			sources: built.diagnosticSources,
		} : null,
	};
}

/** Builds producer-only atlases and destination-free GX texture payloads. */
export async function createTextureAtlases(
	resources: Resource[],
	reportProgress?: ProgressNote,
): Promise<void> {
	const atlases: TextureAtlasResource[] = [];
	const imagesByAtlas = new Map<string, ImageResource[]>();
	let imageCount = 0;
	for (let resourceIndex = 0; resourceIndex < resources.length; resourceIndex += 1) {
		const resource = resources[resourceIndex];
		if (resource.type === 'atlas') {
			atlases.push(resource);
		} else if (resource.type === 'image') {
			let atlasImages = imagesByAtlas.get(resource.targetAtlasName);
			if (atlasImages == null) {
				atlasImages = [];
				imagesByAtlas.set(resource.targetAtlasName, atlasImages);
			}
			atlasImages.push(resource);
			imageCount += 1;
		}
	}
	if (imageCount === 0) {
		return;
	}
	for (let atlasIndex = 0; atlasIndex < atlases.length; atlasIndex += 1) {
		const atlas = atlases[atlasIndex];
		const atlasImages = imagesByAtlas.get(atlas.name)!;
		const systemTexture = atlas.name === GX_SYSTEM_TEXTURE_ATLAS_NAME;
		let pageLocal = true;
		for (let imageIndex = 0; imageIndex < atlasImages.length; imageIndex += 1) {
			const image = atlasImages[imageIndex];
			if (image.img!.width > GX_TEXTURE_PAGE_PIXELS || image.img!.height > GX_TEXTURE_PAGE_PIXELS) {
				pageLocal = false;
				break;
			}
		}
		reportProgress?.(`texture atlas ${atlas.name} (${atlasImages.length} images)`);
		let canvas = createTextureAtlas(atlasImages, {
			maxPixelWidth: systemTexture ? GX_SYSTEM_TEXTURE_WIDTH : GX_GPU_TRANSFER_MAX_WIDTH << 2,
			maxHeight: systemTexture ? GX_SYSTEM_TEXTURE_HEIGHT : GX_GPU_TRANSFER_MAX_HEIGHT,
			pageLocal,
		});
		while (true) {
			const context = canvas.getContext('2d');
			const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
			if (!systemTexture && gxTextureFitsPalette4(rgba)) {
				atlas.gxTexture = encodePalette4GxTexture(canvas.width, canvas.height, rgba);
				break;
			}
			if (systemTexture || canvas.width <= GX_GPU_TRANSFER_MAX_WIDTH) {
				atlas.gxTexture = encodeDirect16GxTexture(canvas.width, canvas.height, rgba);
				break;
			}
			canvas = createTextureAtlas(atlasImages, {
				maxPixelWidth: GX_GPU_TRANSFER_MAX_WIDTH,
				maxHeight: GX_GPU_TRANSFER_MAX_HEIGHT,
				pageLocal,
			});
		}
		atlas.img = canvas;
	}
}

/** Writes a completed ROM layout to its atomically published file. */
export async function finalizeRompack(
	rom_name: string,
	options: {
		projectRootPath?: string,
		status?: ProgressNote,
		debug: boolean,
		layout: RomPrefixLayout,
		outputDirectory: string,
	} & (
		| { blua32: SystemRomBlua32Tail }
		| { blua32: CartRomBlua32Tail | null }
	)
) {
	const outfileBasename = `${rom_name}${options.debug ? '.debug' : ''}.rom`;
	const outputPath = join(options.outputDirectory, outfileBasename);
	const status = options.status;
	const blua32 = options.blua32;
	const physicalSpans = blua32 === null
		? options.layout.ranges.slice()
		: options.layout.ranges.concat(blua32.layout.ranges);
	let dataEnd = options.layout.payloadEnd;
	if (blua32 !== null && blua32.layout.payloadEnd > dataEnd) {
		dataEnd = blua32.layout.payloadEnd;
	}
	const entries = blua32 === null
		? options.layout.entries.slice()
		: options.layout.entries.concat(blua32.layout.entries);
	let diagnosticDirectoryOffset = 0;
	if (blua32 !== null && blua32.diagnostics) {
		const entryBySourcePath = new Map<string, RomAsset>();
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			if (entry.type === 'lua' && entry.source_path) {
				entryBySourcePath.set(entry.source_path, entry);
			}
		}
		const spanByStart = new Map<number, Uint8Array>();
		for (let index = 0; index < physicalSpans.length; index += 1) {
			const span = physicalSpans[index];
			spanByStart.set(span.start, span.buffer);
		}
		const packedSources = new Map<string, PackedBlua32DiagnosticSource>();
		for (const [rangePath, source] of blua32.diagnostics.sources) {
			const entry = entryBySourcePath.get(source.displayPath);
			if (!entry) {
				continue;
			}
			packedSources.set(rangePath, {
				offset: entry.start!,
				bytes: spanByStart.get(entry.start!)!,
			});
		}
		diagnosticDirectoryOffset = alignRomAssetOffset(dataEnd);
		const diagnosticPayload = encodeBlua32DiagnosticDirectory({
			...blua32.diagnostics,
			directoryOffset: diagnosticDirectoryOffset,
			packedSources,
		});
		const diagnosticLayout = layoutRomAssetPayloads([{
			resid: BLUA32_DIAGNOSTICS_IMAGE_ID,
			type: 'code',
			buffer: Buffer.from(
				diagnosticPayload.buffer,
				diagnosticPayload.byteOffset,
				diagnosticPayload.byteLength,
			),
			source_path: BLUA32_DIAGNOSTICS_IMAGE_ID,
		}], true, diagnosticDirectoryOffset);
		entries.push(...diagnosticLayout.entries);
		physicalSpans.push(...diagnosticLayout.ranges);
		dataEnd = diagnosticLayout.payloadEnd;
	}
	physicalSpans.sort((left, right) => left.start - right.start);

	const dataOffset = physicalSpans[0].start;
	const tocBuffer = Buffer.from(encodeRomToc({
		entries,
		projectRootPath: options.projectRootPath,
	}));
	const tocOffset = alignRomAssetOffset(dataEnd);
	const tocLength = tocBuffer.length;
	const packageByteCount = tocOffset + tocLength;
	const header = {
		headerSize: CART_ROM_HEADER_SIZE,
		manifestOffset: options.layout.manifestOffset,
		manifestLength: options.layout.manifestLength,
		tocOffset,
		tocLength,
		dataOffset,
		dataLength: dataEnd - dataOffset,
		blua32ImageOffset: blua32 === null ? 0 : blua32.boot.imageOffset,
		blua32ImageByteCount: blua32 === null ? 0 : blua32.boot.imageByteCount,
		blua32StartupFunctionAddress: blua32 === null ? 0 : blua32.boot.startupFunctionAddress,
		blua32IrqFunctionAddress: blua32 === null ? 0 : blua32.boot.irqFunctionAddress,
		blua32ExceptionFunctionAddress: blua32 === null ? 0 : blua32.boot.exceptionFunctionAddress,
		blua32StaticLayoutTokenLo: blua32 === null ? 0 : blua32.boot.staticLayoutTokenLo,
		blua32StaticLayoutTokenHi: blua32 === null ? 0 : blua32.boot.staticLayoutTokenHi,
		blua32DiagnosticDirectoryOffset: diagnosticDirectoryOffset,
		metadataOffset: options.layout.metadataOffset,
		metadataLength: options.layout.metadataLength,
	};
	const manifest = options.layout.manifest;
	if (manifest === null) {
		if (packageByteCount > SYSTEM_ROM_SIZE) {
			throw new Error(`ROM payload exceeds the ${SYSTEM_ROM_SIZE}-byte system ROM window.`);
		}
	} else {
		assertCartridgePackageFitsHardware(
			packageByteCount,
			header,
			manifest.hardware,
		);
	}
	const headerBuffer = Buffer.alloc(CART_ROM_HEADER_SIZE);
	writeCartRomHeader(headerBuffer, header);

	await mkdir(options.outputDirectory, { recursive: true });

	const tempDirectory = await mkdtemp(join(options.outputDirectory, '.rompack-'));
	const tempFile = join(tempDirectory, outfileBasename);
	const symbolsTempFile = join(tempDirectory, `${outfileBasename}${BLUA32_SYMBOLS_SIDECAR_SUFFIX}`);
	const biosImportsTempFile = join(tempDirectory, `${outfileBasename}${BLUA32_BIOS_IMPORTS_SIDECAR_SUFFIX}`);
	try {
		const writer = createWriteStream(tempFile);
		let offset = 0;

		const writeBuffer = async (payload: Uint8Array) => {
			if (payload.byteLength === 0) return;
			const ok = writer.write(payload);
			offset += payload.byteLength;
			if (!ok) {
				await once(writer, 'drain');
			}
		};
		const writePaddingTo = async (targetOffset: number) => {
			let remaining = targetOffset - offset;
			while (remaining >= ROM_ZERO_FILL_CHUNK.byteLength) {
				await writeBuffer(ROM_ZERO_FILL_CHUNK);
				remaining -= ROM_ZERO_FILL_CHUNK.byteLength;
			}
			if (remaining !== 0) {
				await writeBuffer(ROM_ZERO_FILL_CHUNK.subarray(0, remaining));
			}
		};
		try {
			await writeBuffer(Buffer.alloc(CART_ROM_HEADER_SIZE));
			status?.('write rom payloads');
			for (let index = 0; index < physicalSpans.length; index += 1) {
				const span = physicalSpans[index];
				await writePaddingTo(span.start);
				await writeBuffer(span.buffer);
			}
			status?.('write toc');
			await writePaddingTo(tocOffset);
			await writeBuffer(tocBuffer);
		} finally {
			writer.end();
		}

		await finished(writer);
		const file = await open(tempFile, 'r+');
		try {
			await file.write(headerBuffer, 0, headerBuffer.length, 0);
		} finally {
			await file.close();
		}
		if (blua32 !== null && blua32.domain === 'system') {
			const symbolsOutputFile = `${outputPath}${BLUA32_SYMBOLS_SIDECAR_SUFFIX}`;
			const biosImportsOutputFile = `${outputPath}${BLUA32_BIOS_IMPORTS_SIDECAR_SUFFIX}`;
			await writeFile(symbolsTempFile, blua32.symbolsPayload);
			await writeFile(biosImportsTempFile, blua32.biosImportsPayload);
			await rename(symbolsTempFile, symbolsOutputFile);
			await rename(biosImportsTempFile, biosImportsOutputFile);
			const publicationTime = new Date(
				Math.max(
					(await stat(symbolsOutputFile)).mtimeMs,
					(await stat(biosImportsOutputFile)).mtimeMs,
				) + 1,
			);
			await utimes(tempFile, publicationTime, publicationTime);
		}
		await rename(tempFile, outputPath);
	} finally {
		await rm(tempDirectory, { recursive: true, force: true });
	}
}

const codeFileExtensions = ['.ts', '.glsl', '.js', '.jsx', '.tsx', '.html', '.css', '.json', '.xml', '.lua'];
const CODE_FILE_EXTENSION_SET = new Set(codeFileExtensions);

function isCodeFile(filename: string): boolean {
	return CODE_FILE_EXTENSION_SET.has(parse(filename).ext.toLowerCase());
}

function shouldCheckRebuildFile(filename: string, checkCodeFiles: boolean, checkAssets: boolean): boolean {
	return (checkCodeFiles && isCodeFile(filename)) || checkAssets;
}

function shouldSkipRebuildDirectory(name: string, skipTestDirs: boolean): boolean {
	return name === '_ignore' || isWorkspaceStateDirectory(name) || (skipTestDirs && name === 'test');
}

async function anyFileNewerThan(files: readonly string[], mtimeMs: number): Promise<boolean> {
	for (const file of files) {
		const fileStats = await stat(file);
		if (fileStats.mtimeMs > mtimeMs) {
			return true;
		}
	}
	return false;
}

async function directoryHasRebuildInputNewerThan(dir: string, mtimeMs: number, checkCodeFiles: boolean, checkAssets: boolean, skipTestDirs = false): Promise<boolean> {
	try {
		await access(dir);
	} catch {
		throw new Error(`Directory "${dir}" can't be accessed!`);
	}

	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (shouldSkipRebuildDirectory(entry.name, skipTestDirs)) {
				continue;
			}
			if (await directoryHasRebuildInputNewerThan(entryPath, mtimeMs, checkCodeFiles, checkAssets, skipTestDirs)) {
				return true;
			}
			continue;
		}
		if (!shouldCheckRebuildFile(entry.name, checkCodeFiles, checkAssets)) {
			continue;
		}
		const entryStats = await stat(entryPath);
		if (entryStats.mtimeMs > mtimeMs) {
			return true;
		}
	}
	return false;
}

/**
 * Determines whether a rebuild of the ROM is required based on its source and resource files.
 * @param {string} romname - The name of the ROM.
 * @param {string} resPath - The path to the resource files.
 * @returns {Promise<boolean>} A Promise that resolves with a boolean indicating whether a rebuild is required.
 */
export async function isRebuildRequired(
	romname: string,
	resPath: string,
	options: RebuildOptions,
): Promise<boolean> {
	let romFilePath = options.romFilePath;
	if (romFilePath === undefined) {
		romFilePath = `./dist/${romname}${options.debug ? '.debug' : ''}.rom`;
	}
	const biosImportsFilePath = options.biosImportsFilePath;
	const extraLuaRoots = options.extraLuaPaths;
	const includeExtraRootAssets = options.domain === 'cart';

	async function checkPaths() {
		try {
			await access(romFilePath);
			return false;
		} catch {
			return true;
		}
	}
	if (await checkPaths()) {
		return true;
	}

	const romStats = await stat(romFilePath);
	const romMtimeMs = romStats.mtimeMs;
	if (options.buildSourceFiles && await anyFileNewerThan(options.buildSourceFiles, romMtimeMs)) {
		return true;
	}
	if (options.buildSourceDirectories) {
		for (const directory of options.buildSourceDirectories) {
			if (await directoryHasRebuildInputNewerThan(directory, romMtimeMs, true, false)) {
				return true;
			}
		}
	}
	if (biosImportsFilePath !== undefined) {
		let biosImportsStats: Stats;
		try {
			biosImportsStats = await stat(biosImportsFilePath);
		} catch {
			return true;
		}
		if (biosImportsStats.mtimeMs > romMtimeMs) {
			return true;
		}
	}

	const normalizedRes = resolve(resPath);
	let extraNeedsRebuild = false;
	if (extraLuaRoots) {
		for (const root of extraLuaRoots) {
			if (!root || root.length === 0) continue;
			const normalized = resolve(root);
			if (normalized === normalizedRes) continue;
			if (await directoryHasRebuildInputNewerThan(root, romMtimeMs, true, includeExtraRootAssets, true)) {
				extraNeedsRebuild = true;
				break;
			}
		}
	}

	const resNeedsRebuild = await anyFileNewerThan(await getFiles(resPath), romMtimeMs);
	return extraNeedsRebuild ||
		resNeedsRebuild;
}

export const biosResPath = './machine/bios/res';
export const biosSourcePath = './machine/bios';
export const cartlibLuaPath = './cartlib';
export const testlibLuaPath = './testlib';
