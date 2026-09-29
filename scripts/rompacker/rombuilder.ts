import { encodeLuaChunk } from '../../toolchain/ts/lua/syntax/serialization';
import { encodeBinary } from '../../machine/ts/common/serializer/binencoder';
import { assetIdFromSourceName } from '../../toolchain/ts/rompack/assets';
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
import {
	buildBlua32Image,
	decodeBlua32SourceModules,
	type GeneratedLuaModule,
} from '../../toolchain/ts/rompack/blua32_image_builder';
import type { TraceStatementSelection } from '../../toolchain/ts/lua/compiler/trace_statement';
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
import { loadGLTFModel } from './gltfloader';
import type { RomBuildInputs } from './build_inputs';
import type { RomBuildOutput } from './build_state';
import type { TextureAtlasResource, ImageResource, Resource, resourcetype } from './rompacker.rompack';
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
const { mkdir, mkdtemp, rename, rm, writeFile } = require('fs/promises');
// @ts-ignore
const { createWriteStream } = require('fs');
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
	const encoded = encodeLuaChunk(chunk);
	return Buffer.from(encoded);
}

/**
 * Returns an object containing the name, extension, and type of a resource file based on its filepath.
 * @param filepath The path of the resource file.
 * @returns An object containing the name, extension, and type of the resource file.
 */
export function getResMetaByFilename(filepath: string): { name: string, ext: string, type: resourcetype, collisionType?: 'concave' | 'convex' | 'aabb', datatype?: 'json' | 'yaml' | 'bin' } {
	const parsed = parse(filepath);
	const rawName = parsed.name;
	const normalizedName = assetIdFromSourceName(rawName);
	let name = normalizedName;
	const ext = parsed.ext.toLowerCase();
	let type: resourcetype;
	let collisionType: 'concave' | 'convex' | 'aabb' = undefined;
	let datatype: 'json' | 'yaml' | 'bin' = undefined;

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
			throw new Error(`Unsupported model format: "${filepath}". Export the model as glTF or GLB.`);
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
			break;
	}
	return { name, ext, type, collisionType, datatype };
}

/**
 * Builds a list of resource objects from the exact roots owned by one product.
 * @param respaths Paths whose resources belong to the selected build domain.
 * @returns An array of resources with basic metadata.
 */
export type ResourceScanOptions = {
	domain: RomImageDomain;
	extraLuaFiles?: readonly string[];
	virtualRoot?: string;
	libraryLuaFiles?: readonly string[];
	/** Derived-build roots whose reachable library modules remain source-only in the base image. */
	sourceOnlyLuaRootFiles: readonly string[];
	sourceOnlyLuaModuleRoots: readonly string[];
};

type LibraryLuaClosure = {
	files: string[];
	sourceOnlyFiles: ReadonlySet<string>;
};

function collectLibraryLuaClosure(
	inputs: RomBuildInputs,
	programRootFiles: readonly string[],
	sourceOnlyRootFiles: readonly string[],
	sourceOnlyModuleRoots: readonly string[],
	libraryFiles: readonly string[],
	virtualRoot: string,
): LibraryLuaClosure {
	const moduleFileByPath = new Map<string, string>();
	for (const file of libraryFiles) {
		const sourcePath = resolveVirtualSourcePath(file, virtualRoot) ?? toWorkspaceRelativePath(file);
		moduleFileByPath.set(toLuaModulePath(sourcePath), file);
	}
	const chunksByFile = new Map<string, LuaChunk>();
	const loadFileChunk = (file: string): LuaChunk => {
		const key = resolve(file);
		const cached = chunksByFile.get(key);
		if (cached !== undefined) {
			return cached;
		}
		const source = inputs.files.get(key)!.text;
		const lexer = new LuaLexer(source, file);
		const tokens = lexer.scanTokens();
		const chunk = new LuaParser(tokens, file, source).parseChunk();
		chunksByFile.set(key, chunk);
		return chunk;
	};
	const modulePaths = new Set(moduleFileByPath.keys());
	const collectClosure = (rootFiles: readonly string[]): string[] => {
		const rootChunks = new Array<LuaChunk>(rootFiles.length);
		for (let index = 0; index < rootFiles.length; index += 1) {
			rootChunks[index] = loadFileChunk(rootFiles[index]);
		}
		return collectLuaModuleDependencyClosure(
			rootChunks, modulePaths, modulePath => loadFileChunk(moduleFileByPath.get(modulePath)!),
		);
	};
	const programModulePaths = collectClosure(programRootFiles);
	const programModules = new Set(programModulePaths);
	const sourceOnlyModulePaths = [...new Set([...sourceOnlyModuleRoots,
		...collectClosure([...sourceOnlyRootFiles, ...sourceOnlyModuleRoots.map(path => moduleFileByPath.get(path)!)])])].filter(
		modulePath => !programModules.has(modulePath),
	);
	const includedModulePaths = new Set(programModulePaths);
	for (let index = 0; index < sourceOnlyModulePaths.length; index += 1) {
		includedModulePaths.add(sourceOnlyModulePaths[index]);
	}
	const files = Array.from(includedModulePaths, modulePath => moduleFileByPath.get(modulePath)!)
		.sort((left, right) => left.localeCompare(right));
	const sourceOnlyFiles = new Set<string>();
	for (let index = 0; index < sourceOnlyModulePaths.length; index += 1) {
		sourceOnlyFiles.add(resolve(moduleFileByPath.get(sourceOnlyModulePaths[index])!));
	}
	return { files, sourceOnlyFiles };
}

export async function getResMetaList(
	inputs: RomBuildInputs,
	options: ResourceScanOptions,
): Promise<Resource[]> {
	const arrayOfFiles: string[] = [];
	const virtualRoot = normalizeVirtualRootPath(options.virtualRoot);
	const systemResourceRoots = options.domain === 'system' ? inputs.resourceRoots : [];
	const seenPaths = new Set<string>();

	const pushFile = (filepath: string) => {
		const normalized = resolve(filepath);
		if (seenPaths.has(normalized)) return;
		seenPaths.add(normalized);
		arrayOfFiles.push(filepath);
	};

	for (const file of inputs.resourceFiles) pushFile(file);
	const extraLuaFiles = options.extraLuaFiles;
	if (extraLuaFiles) {
		for (let index = 0; index < extraLuaFiles.length; index += 1) {
			pushFile(extraLuaFiles[index]);
		}
	}
	const programRootFiles = arrayOfFiles.filter(file => file.toLowerCase().endsWith('.lua'));
	let sourceOnlyLibraryFiles: ReadonlySet<string> = new Set();
	const libraryLuaFiles = options.libraryLuaFiles;
	if (libraryLuaFiles) {
		const libraryClosure = collectLibraryLuaClosure(
			inputs,
			programRootFiles,
			options.sourceOnlyLuaRootFiles,
			options.sourceOnlyLuaModuleRoots,
			libraryLuaFiles,
			virtualRoot,
		);
		sourceOnlyLibraryFiles = libraryClosure.sourceOnlyFiles;
		for (let index = 0; index < libraryClosure.files.length; index += 1) {
			pushFile(libraryClosure.files[index]);
		}
	}
	const resourceFiles = arrayOfFiles.filter(file => parse(file).ext.toLowerCase() !== '.bin' || !inputs.modelBufferFiles.has(resolve(file)));
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
				result.push({
					filepath,
					name,
					ext,
					type,
					id: luaid,
					programModule: !sourceOnlyLibraryFiles.has(resolve(filepath)),
					sourcePath,
					update_timestamp: inputs.files.get(resolve(filepath))!.modifiedMs,
				});
				++luaid;
				break;
			case 'model':
				result.push({ filepath, name, ext, type, id: modelid, sourcePath, document: inputs.models.get(resolve(filepath))! });
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

	for (const resource of result) {
		if (resource.filepath !== undefined) resource.buffer = inputs.files.get(resolve(resource.filepath))!.bytes;
	}

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

	// Decoding consumes the captured bytes; no file is reopened here.
	const resourcePromises = resMetaList.map(async (meta): Promise<Resource> => {
		const buffer = meta.buffer;
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
				const asset: RomAsset = {
					resid,
					type,
					buffer,
					source_path: normalizedPath,
					normalized_source_path: workspacePath,
					update_timestamp: res.update_timestamp,
				};
				if (res.programModule) {
					try {
						asset.compiled_buffer = compileLuaChunkBuffer(source, modulePath);
					} catch (error) {
						if (isLuaCompileError(error)) {
							compileErrors.push(formatLuaCompileError(error, source));
							continue;
						}
						throw error;
					}
				}
				romAssets.push(asset);
				break;
			}
			case 'data': {
				const source = res.datatype === 'bin' ? undefined : res.buffer.toString('utf8');
				switch (res.datatype) {
					case 'yaml':
						buffer = Buffer.from(encodeBinary(yaml.load(source)));
						break;
					case 'json':
						buffer = Buffer.from(encodeBinary(JSON.parse(source)));
						break;
					case 'bin':
						break;
				}
				romAssets.push({ resid, type, buffer, source_path: sourcePath,
					sourcemeta: source === undefined ? undefined : { text: source } });
				break;
			}
			case 'aem': {
				buffer = Buffer.from(encodeBinary(res.eventMap));
				romAssets.push({ resid, type, buffer, source_path: sourcePath,
					sourcemeta: { text: res.buffer.toString('utf8') } });
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
				const parsed = await loadGLTFModel(res.document, resid);

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
	traceStatements?: TraceStatementSelection;
	preloadModules?: readonly string[];
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
	const luaModules = decodeBlua32SourceModules(assetList);
	if (options.domain === 'system') {
		const imageOffset = SYSTEM_BLUA32_IMAGE_OFFSET;
		const built = buildBlua32Image({
			luaModules,
			generatedLuaModules: options.generatedLuaModules,
			loadAddress: SYSTEM_ROM_BASE + imageOffset,
			ramByteCount: options.ramByteCount,
			optLevel: options.optLevel,
			traceStatements: options.traceStatements ?? 'erase',
			preloadModules: options.preloadModules,
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
				image: linked.layout,
				symbols: linked.symbols,
				sources: built.diagnosticSources,
			} : null,
			symbolsPayload,
			biosImportsPayload,
		};
	}
	const built = buildBlua32Image({
		luaModules,
		generatedLuaModules: options.generatedLuaModules,
		loadAddress: CART_ROM_BASE + options.imageOffset,
		ramByteCount: options.ramByteCount,
		optLevel: options.optLevel,
		traceStatements: options.traceStatements ?? 'erase',
		preloadModules: options.preloadModules,
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
			image: linked.layout,
			symbols: linked.symbols,
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
	const outputs: RomBuildOutput[] = [];
	const romDigest = createHash('sha256');
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
			throw new Error(`ROM payload (${packageByteCount} bytes) exceeds the ${SYSTEM_ROM_SIZE}-byte system ROM window by ${packageByteCount - SYSTEM_ROM_SIZE} bytes.`);
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
			romDigest.update(payload);
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
			await writeBuffer(headerBuffer);
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
		if (blua32 !== null && blua32.domain === 'system') {
			const symbolsOutputFile = `${outputPath}${BLUA32_SYMBOLS_SIDECAR_SUFFIX}`;
			const biosImportsOutputFile = `${outputPath}${BLUA32_BIOS_IMPORTS_SIDECAR_SUFFIX}`;
			await writeFile(symbolsTempFile, blua32.symbolsPayload);
			await writeFile(biosImportsTempFile, blua32.biosImportsPayload);
			await rename(symbolsTempFile, symbolsOutputFile);
			await rename(biosImportsTempFile, biosImportsOutputFile);
			outputs.push(
				{ file: `${outfileBasename}${BLUA32_SYMBOLS_SIDECAR_SUFFIX}`, digest: createHash('sha256').update(blua32.symbolsPayload).digest('hex') },
				{ file: `${outfileBasename}${BLUA32_BIOS_IMPORTS_SIDECAR_SUFFIX}`, digest: createHash('sha256').update(blua32.biosImportsPayload).digest('hex') },
			);
		}
		await rename(tempFile, outputPath);
		outputs.push({ file: outfileBasename, digest: romDigest.digest('hex') });
	} finally {
		await rm(tempDirectory, { recursive: true, force: true });
	}
	return outputs;
}
