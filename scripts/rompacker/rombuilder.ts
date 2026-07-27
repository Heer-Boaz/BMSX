// @ts-ignore
import type { Stats } from 'fs';
import { encodeBinary } from '../../machine/ts/common/serializer/binencoder';
import { CART_ROM_HEADER_SIZE, CART_ROM_WORD_ALIGNMENT } from '../../machine/ts/rompack/format';
import type { AudioMeta, BoundingBoxPrecalc, GLTFMesh, HitPolygonsPrecalc, ImgMeta, Polygon, RectBounds, RomAsset, RomManifest, TextureMeta, vec2arr } from '../../machine/ts/rompack/format';
import { alignRomAssetOffset, layoutRomAssetPayloads, type RomAssetPayloadLayout, type RomAssetPayloadRange } from '../../machine/ts/rompack/asset_layout';
import { writeCartRomHeader } from '../../machine/ts/rompack/tooling/header_encode';
import {
	encodeDirect16GxTexture,
	encodePalette4GxTexture,
	type Direct16GxTexture,
	type NativeGxTexture,
} from '../../machine/ts/rompack/tooling/gx_texture_codec';
import { encodeDirect16GxUpload } from '../../machine/ts/rompack/tooling/gp0_encode';
import { encodeImgDecStream } from '../../machine/ts/rompack/tooling/imgdec_codec';
import type { RomPrefixLayout } from '../../machine/ts/rompack/tooling/rom_prefix_layout';
import { encodeRomToc } from '../../machine/ts/rompack/tooling/toc_encode';
import { encodeAudioAssetToAdpcm } from './adpcm';
import { buildBlua32Image, type GeneratedLuaModule } from './blua32_image_builder';
import { createTextureAtlas, resolveTextureGroupId } from './atlasbuilder';
import {
	GX_CART_TEXTURE_GROUP_ID_LIMIT,
	GX_SYSTEM_TEXTURE_GROUP_ID,
	GX_TEXTURE_PAGE_PIXELS,
	textureGroupResourceName,
} from './texture_atlas_contract';
import { BIOS_TERMINAL_GLYPHS_ASSET_ID, buildBiosTerminalGlyphTable } from './bios_terminal_font';
import {
	GX_SYSTEM_TEXTURE_ASSET_ID,
	GX_SYSTEM_TEXTURE_HEIGHT,
	GX_SYSTEM_TEXTURE_WIDTH,
	GX_SYSTEM_TEXTURE_X,
	GX_SYSTEM_TEXTURE_Y,
} from './system_texture';
import {
	type GxTextureGroupLayout,
	type GxTextureLayout,
	type GxTextureSlot,
	validateGxTextureLayout,
} from './gx_texture_layout';
import { BoundingBoxExtractor } from './boundingbox_extractor';
import { collectGLTFExternalBufferFileSet, loadGLTFModel } from './gltfloader';
import type { TextureAtlasResource, ImageResource, Resource, resourcetype } from './rompacker.rompack';
import { collectSourceFiles } from '../tooling/file_scan';
import { collectCartSourceFiles } from './cart_source_files';
import { CART_ROM_BASE, CART_ROM_SIZE, SYSTEM_ROM_BASE, SYSTEM_ROM_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import {
	BLUA32_IMAGE_ID,
	type Blua32BootHeader,
	type Blua32ImageLayout,
} from '../../machine/ts/machine/cpu/blua32_image';
import {
	BLUA32_SYMBOLS_IMAGE_ID,
	encodeBlua32SymbolsImage,
	type Blua32SymbolsImage,
} from '../../machine/ts/rompack/tooling/blua32_symbols';
// @ts-ignore
const { join, parse, relative, resolve, sep } = require('path');

// @ts-ignore
const { access, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile, open } = require('fs/promises');
// @ts-ignore
const { createWriteStream, readFileSync, statSync } = require('fs');
// @ts-ignore
const { once } = require('events');
// @ts-ignore
const { finished } = require('stream/promises');
// @ts-ignore
const { LuaLexer } = require('../../machine/ts/lua/syntax/lexer');
// @ts-ignore
const { LuaParser } = require('../../machine/ts/lua/syntax/parser');
// @ts-ignore
const { splitText } = require('../../machine/ts/common/text_lines');
// @ts-ignore
const { isLuaCompileError } = require('../../machine/ts/lua/compiler');
// @ts-ignore
const {
	toLuaModulePath,
} = require('../../machine/ts/lua/module_path');
// @ts-ignore
const { loadImage } = require('canvas');
// @ts-ignore
const yaml = require('js-yaml');

export const BLUA32_SYMBOLS_SIDECAR_SUFFIX = '.blua32-symbols';
// @ts-ignore
const { createHash } = require('crypto');

type ProgressNote = (message: string) => void;
const ADPCM_NO_LOOP = 0xffffffff;
const GEO_COLLISION_BIN_MAGIC = 0x32443247; // "G2D2" little-endian
const GEO_COLLISION_BIN_VERSION = 2;
const GEO_COLLISION_SHAPE_KIND_AABB = 1;
const GEO_COLLISION_SHAPE_KIND_CONVEX_POLY = 3;
const GEO_COLLISION_SHAPE_KIND_COMPOUND = 4;
const GEO_COLLISION_VARIANT_HEADER_WORDS = 8;

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

const CART_ROOT_SEGMENT = 'carts/';
const FIRMWARE_RES_SEGMENT = 'machine/firmware/res';
const DEFAULT_CART_BOOTLOADER_SEGMENT = 'machine/firmware/default_cart';

function isCartPath(path?: string): boolean {
	if (!path || path.length === 0) return false;
	const normalized = normalizeWorkspacePath(path);
	return normalized.includes(CART_ROOT_SEGMENT);
}

function isFirmwareResPath(path?: string): boolean {
	if (!path || path.length === 0) return false;
	const normalized = normalizeWorkspacePath(path);
	return normalized === FIRMWARE_RES_SEGMENT || normalized.startsWith(`${FIRMWARE_RES_SEGMENT}/`);
}

function isDefaultCartBootloader(path?: string): boolean {
	if (!path || path.length === 0) return false;
	const normalized = normalizeWorkspacePath(path);
	return normalized === DEFAULT_CART_BOOTLOADER_SEGMENT || normalized.startsWith(`${DEFAULT_CART_BOOTLOADER_SEGMENT}/`);
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

export type RomBuildManifest = RomManifest & {
	gx_texture_layout?: GxTextureLayout;
};

export async function getRomManifest(dirPath: string): Promise<RomBuildManifest | null> {
	const files = await getFiles(dirPath, [], '.rommanifest');

	if (files.length > 1) {
		throw new Error(`More than one rommanifest found in ${dirPath}.`);
	}
	else if (files.length === 1) {
		const res = (await readFile(files[0])).toString();
		// Read and return the rommanifest file
		let manifest: RomBuildManifest;
		try {
			manifest = JSON.parse(res) as RomBuildManifest;
		} catch {
			manifest = yaml.load(res) as RomBuildManifest;
		}
		return manifest;
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
	targetAtlasId: number,
} {
	// Match @cc or @cx for collision type, and @atlas=n for texture atlas assignment (order-insensitive)
	const collisionMatch = filenameWithoutExt.match(/@(cc|cx)/i);
	let collisionType: 'concave' | 'convex' | 'aabb' = 'aabb';
	if (collisionMatch) {
		const code = collisionMatch[1].toLowerCase();
		collisionType = code === 'cc' ? 'concave' : code === 'cx' ? 'convex' : 'aabb';
	}
	const atlasMatch = filenameWithoutExt.match(/@atlas=(\d+)/i);
	const targetAtlasId = atlasMatch ? parseInt(atlasMatch[1], 10) : 0;

	// Remove all @cc, @cx, and @atlas=n (in any order)
	const sanitizedName = filenameWithoutExt
		.replace(/@(cc|cx)/ig, '')
		.replace(/@atlas=\d+/ig, '');

	return { sanitizedName, collisionType, targetAtlasId };
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

function computePolyBounds(poly: Polygon): RectBounds {
	let left = poly[0];
	let top = poly[1];
	let right = left;
	let bottom = top;
	for (let index = 2; index < poly.length; index += 2) {
		const x = poly[index];
		const y = poly[index + 1];
		if (x < left) left = x;
		if (x > right) right = x;
		if (y < top) top = y;
		if (y > bottom) bottom = y;
	}
	return { left, top, right, bottom };
}

function buildCollisionBin(bounds: BoundingBoxPrecalc, hitpolygons: HitPolygonsPrecalc | undefined): Buffer {
	const parts: Buffer[] = [];
	let offset = GEO_COLLISION_VARIANT_HEADER_WORDS * 4;

	const pushBuffer = (buffer: Buffer): number => {
		const start = offset;
		parts.push(buffer);
		offset += buffer.length;
		return start;
	};

	const pushBounds = (rect: RectBounds): number => {
		const buffer = Buffer.alloc(16);
		buffer.writeFloatLE(rect.left, 0);
		buffer.writeFloatLE(rect.top, 4);
		buffer.writeFloatLE(rect.right, 8);
		buffer.writeFloatLE(rect.bottom, 12);
		return pushBuffer(buffer);
	};

	const pushPolygon = (poly: Polygon): number => {
		const buffer = Buffer.alloc(poly.length * 4);
		for (let index = 0; index < poly.length; index += 1) {
			buffer.writeFloatLE(poly[index], index * 4);
		}
		return pushBuffer(buffer);
	};

	const writeDescriptor = (target: Buffer, kind: number, dataCount: number, descStart: number, dataStart: number, boundsStart: number): void => {
		target.writeUInt32LE(kind >>> 0, 0);
		target.writeUInt32LE(dataCount >>> 0, 4);
		target.writeUInt32LE((dataStart - descStart) >>> 0, 8);
		target.writeUInt32LE((boundsStart - descStart) >>> 0, 12);
	};

	const encodeVariant = (variantBounds: RectBounds, variantPolys: Polygon[] | undefined): number => {
		const descriptor = Buffer.alloc(16);
		const descriptorStart = pushBuffer(descriptor);
		if (!variantPolys || variantPolys.length === 0) {
			const boundsStart = pushBounds(variantBounds);
			writeDescriptor(descriptor, GEO_COLLISION_SHAPE_KIND_AABB, 4, descriptorStart, boundsStart, boundsStart);
			return descriptorStart;
		}
		if (variantPolys.length === 1) {
			const poly = variantPolys[0];
			const dataStart = pushPolygon(poly);
			const boundsStart = pushBounds(computePolyBounds(poly));
			writeDescriptor(descriptor, GEO_COLLISION_SHAPE_KIND_CONVEX_POLY, poly.length >> 1, descriptorStart, dataStart, boundsStart);
			return descriptorStart;
		}
		const pieceTable = Buffer.alloc(variantPolys.length * 16);
		const pieceTableStart = pushBuffer(pieceTable);
		for (let polyIndex = 0; polyIndex < variantPolys.length; polyIndex += 1) {
			const poly = variantPolys[polyIndex];
			const pieceDescriptorStart = pieceTableStart + polyIndex * 16;
			const dataStart = pushPolygon(poly);
			const boundsStart = pushBounds(computePolyBounds(poly));
			writeDescriptor(pieceTable.subarray(polyIndex * 16, (polyIndex + 1) * 16), GEO_COLLISION_SHAPE_KIND_CONVEX_POLY, poly.length >> 1, pieceDescriptorStart, dataStart, boundsStart);
		}
		const boundsStart = pushBounds(variantBounds);
		writeDescriptor(descriptor, GEO_COLLISION_SHAPE_KIND_COMPOUND, variantPolys.length, descriptorStart, pieceTableStart, boundsStart);
		return descriptorStart;
	};

	const originalOffset = encodeVariant(bounds.original, hitpolygons?.original);
	const fliphOffset = encodeVariant(bounds.fliph, hitpolygons?.fliph);
	const flipvOffset = encodeVariant(bounds.flipv, hitpolygons?.flipv);
	const fliphvOffset = encodeVariant(bounds.fliphv, hitpolygons?.fliphv);
	const header = Buffer.alloc(GEO_COLLISION_VARIANT_HEADER_WORDS * 4);
	header.writeUInt32LE(GEO_COLLISION_BIN_MAGIC, 0);
	header.writeUInt32LE(GEO_COLLISION_BIN_VERSION, 4);
	header.writeUInt32LE(originalOffset >>> 0, 8);
	header.writeUInt32LE(fliphOffset >>> 0, 12);
	header.writeUInt32LE(flipvOffset >>> 0, 16);
	header.writeUInt32LE(fliphvOffset >>> 0, 20);
	header.writeUInt32LE(0, 24);
	header.writeUInt32LE(0, 28);
	return Buffer.concat([header, ...parts]);
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
		collisionbin: buildCollisionBin(boundingbox, hitpolygons),
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
	if (res.targetAtlasId === GX_SYSTEM_TEXTURE_GROUP_ID) {
		imgmeta.gx_source_x = GX_SYSTEM_TEXTURE_X + res.textureU!;
		imgmeta.gx_source_y = GX_SYSTEM_TEXTURE_Y + res.textureV!;
	} else {
		imgmeta.gx_texture_resid = textureGroupResourceName(res.targetAtlasId);
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
	const parser = new LuaParser(tokens, path, splitText(source));
	const chunk = parser.parseChunk();
	const encoded = encodeBinary(chunk);
	return Buffer.from(encoded);
}

export async function buildBluaSourceContextAssets(luaRoots: readonly string[], virtualRoot: string): Promise<RomAsset[]> {
	const files: string[] = [];
	for (let index = 0; index < luaRoots.length; index += 1) {
		files.push(...await getFiles(luaRoots[index], [], '.lua'));
	}
	files.sort((a, b) => a.localeCompare(b));
	const assets: RomAsset[] = [];
	for (const file of files) {
		const sourcePath = normalizeWorkspacePath(resolveVirtualSourcePath(file, virtualRoot) ?? toWorkspaceRelativePath(file));
		const modulePath = toLuaModulePath(sourcePath);
		const buffer = await readFile(file);
		const source = buffer.toString('utf8');
		assets.push({
			resid: `__blua_source_context__/${sourcePath}`,
			type: 'lua',
			buffer,
			compiled_buffer: compileLuaChunkBuffer(source, modulePath),
			source_path: sourcePath,
		});
	}
	return assets;
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
			type = getDataSubtype(name);
			name = removeExtension(name);
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
 * Builds a list of resource objects located at `respaths` for the specified `romname`.
 * @param respaths An array of the paths to the resources to include in the list.
 * @param romname The name of the ROM pack to build the list for.
 * @returns An array of resources with basic metadata.
 */
export type ResourceScanOptions = {
	extraLuaPaths?: string[];
	virtualRoot?: string;
	systemResourceRoots?: readonly string[];
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
	 * Optional override for the system ROM path used by cart rebuild checks.
	 * Defaults to `dist/bmsx-bios[.debug].rom` (based on `debug`).
	 */
	biosRomFilePath?: string;
	libraryLuaPaths?: string[];
};

function isWorkspaceStateDirectory(name: string): boolean {
	return name.toLowerCase() === WORKSPACE_STATE_DIR_NAME;
}

function collectLiteralLuaRequires(source: string, path: string): string[] {
	const lexer = new LuaLexer(source, path);
	const tokens = lexer.scanTokens();
	const parser = new LuaParser(tokens, path, splitText(source));
	const chunk = parser.parseChunk();
	const requires: string[] = [];
	const visited = new WeakSet<object>();
	const visit = (node: unknown): void => {
		if (node === null || typeof node !== 'object') {
			return;
		}
		if (visited.has(node)) {
			return;
		}
		visited.add(node);
		if (Array.isArray(node)) {
			for (let index = 0; index < node.length; index += 1) {
				visit(node[index]);
			}
			return;
		}
		const record = node as Record<string, unknown>;
		const callee = record.callee as Record<string, unknown> | undefined;
		const args = record.arguments as ReadonlyArray<Record<string, unknown>> | undefined;
		if (callee?.name === 'require' && args && args.length > 0 && typeof args[0].value === 'string') {
			requires.push(args[0].value);
		}
		const values = Object.values(record);
		for (let index = 0; index < values.length; index += 1) {
			visit(values[index]);
		}
	};
	visit(chunk);
	return requires;
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
	const includedFiles: string[] = [];
	const queuedModules: string[] = [];
	const seenModules = new Set<string>();
	const scanRequires = (file: string): void => {
		const source = readFileSync(file, 'utf8');
		const modules = collectLiteralLuaRequires(source, file);
		for (let index = 0; index < modules.length; index += 1) {
			const modulePath = modules[index];
			if (!moduleFileByPath.has(modulePath) || seenModules.has(modulePath)) {
				continue;
			}
			seenModules.add(modulePath);
			queuedModules.push(modulePath);
		}
	};
	for (let index = 0; index < seedFiles.length; index += 1) {
		scanRequires(seedFiles[index]);
	}
	let queueIndex = 0;
	while (queueIndex < queuedModules.length) {
		const modulePath = queuedModules[queueIndex];
		queueIndex += 1;
		const file = moduleFileByPath.get(modulePath)!;
		includedFiles.push(file);
		scanRequires(file);
	}
	return includedFiles.sort((a, b) => a.localeCompare(b));
}

export async function getResMetaList(respaths: string[], _romname?: string, options: ResourceScanOptions = {}): Promise<Resource[]> {
	const arrayOfFiles: string[] = [];
	const virtualRoot = normalizeVirtualRootPath(options.virtualRoot);
	const cartProject = isCartPath(virtualRoot) || respaths.some(isCartPath);
	const scanRoots = cartProject
		? respaths.filter(path => !isFirmwareResPath(path))
		: respaths;
	const extraLuaRoots = options.extraLuaPaths;
	const systemResourceRoots = options.systemResourceRoots ?? DEFAULT_SYSTEM_RESOURCE_ROOTS;
	const seenPaths = new Set<string>();

	const pushFile = (filepath: string) => {
		const normalized = resolve(filepath);
		if (seenPaths.has(normalized)) return;
		seenPaths.add(normalized);
		arrayOfFiles.push(filepath);
	};

	for (const respath of scanRoots) {
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
	const seedFiles = arrayOfFiles.filter(file => file.toLowerCase().endsWith('.lua'));
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
	const targetAtlasIdSet = new Set<number>();
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
				const targetAtlasId = resolveTextureGroupId(filepath, systemResourceRoots, imgMeta.targetAtlasId);
				targetAtlasIdSet.add(targetAtlasId);
				result.push({
					filepath,
					name,
					ext,
					type,
					id: imgid,
					collisionType: imgMeta.collisionType,
					targetAtlasId,
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
			case 'aem': // AEM files are added to the data asset list
				// For data files, we use the name as is
				result.push({ filepath, name, ext, type, id: dataid, datatype: meta.datatype, sourcePath });
				++dataid;
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

	for (const id of Array.from(targetAtlasIdSet).sort((a, b) => a - b)) {
		const name = textureGroupResourceName(id);
		result.push({ name, ext: '.atlas', type: 'atlas', id: imgid++, atlasId: id });
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
 * and constructs a RomAsset for each. Producer-only image packing groups are omitted;
 * each cart texture group becomes an explicit texture resource and image records refer to it by id.
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
		resource.type === 'atlas' && resource.atlasId === GX_SYSTEM_TEXTURE_GROUP_ID);
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
					update_timestamp: res.update_timestamp,
				});
				break;
			}
			case 'data':
			case 'aem':
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
					default:
						throw new Error(`Unknown data type "${res.datatype}" for resource "${resid}"`);
				}
				romAssets.push({ resid, type, buffer, source_path: sourcePath });
				break;
			case 'bin':
				// Raw binary asset: emit owner-defined packed bytes as-is for typed struct-array reads.
				romAssets.push({ resid, type, buffer, source_path: sourcePath });
				break;
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
				if (res.atlasId !== GX_SYSTEM_TEXTURE_GROUP_ID) {
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
	externalLuaAssets: RomAsset[];
	generatedLuaModules: GeneratedLuaModule[];
	includeSymbols: boolean;
	optLevel: 0 | 1 | 2 | 3;
	imageOffset: number;
} & (
	| { domain: 'system' }
	| {
		domain: 'cart';
		systemImage: Blua32ImageLayout;
		systemSymbols: Blua32SymbolsImage;
	}
);

type RomBlua32TailCommon = {
	boot: Blua32BootHeader;
	layout: RomAssetPayloadLayout;
};

export type RomBlua32Tail = RomBlua32TailCommon & (
	| {
		domain: 'system';
		symbolsPayload: Uint8Array;
	}
	| {
		domain: 'cart';
	}
);

export function buildRomBlua32Tail(
	assetList: ReadonlyArray<RomAsset>,
	entryPath: string,
	options: BuildRomBlua32TailOptions,
): RomBlua32Tail {
	const luaAssets = assetList.filter(asset => asset.type === 'lua');
	const imageAddress = (options.domain === 'cart' ? CART_ROM_BASE : SYSTEM_ROM_BASE) + options.imageOffset;
	const linked = buildBlua32Image(options.domain === 'cart' ? {
		luaAssets,
		externalLuaAssets: options.externalLuaAssets,
		generatedLuaModules: options.generatedLuaModules,
		entryPath,
		loadAddress: imageAddress,
		optLevel: options.optLevel,
		domain: 'cart',
		systemImage: options.systemImage,
		systemSymbols: options.systemSymbols,
	} : {
		luaAssets,
		externalLuaAssets: options.externalLuaAssets,
		generatedLuaModules: options.generatedLuaModules,
		entryPath,
		loadAddress: imageAddress,
		optLevel: options.optLevel,
		domain: 'system',
	});
	const executableAssets: RomAsset[] = [{
		resid: BLUA32_IMAGE_ID,
		type: 'code',
		buffer: Buffer.from(linked.bytes),
		source_path: BLUA32_IMAGE_ID,
	}];
	const boot = {
		imageOffset: options.imageOffset,
		imageByteCount: linked.bytes.byteLength,
		startupFunctionAddress: linked.startupFunctionAddress,
		irqFunctionAddress: linked.irqFunctionAddress,
		exceptionFunctionAddress: linked.exceptionFunctionAddress,
		staticLayoutTokenLo: linked.symbols.staticLayoutToken.lo,
		staticLayoutTokenHi: linked.symbols.staticLayoutToken.hi,
	};
	if (options.domain === 'system') {
		const symbolsPayload = encodeBlua32SymbolsImage(linked.symbols);
		if (options.includeSymbols) {
			executableAssets.push({
				resid: BLUA32_SYMBOLS_IMAGE_ID,
				type: 'code',
				buffer: Buffer.from(symbolsPayload),
				source_path: BLUA32_SYMBOLS_IMAGE_ID,
			});
		}
		return {
			domain: 'system',
			boot,
			layout: layoutRomAssetPayloads(executableAssets, true, options.imageOffset),
			symbolsPayload,
		};
	}
	if (options.includeSymbols) {
		executableAssets.push({
			resid: BLUA32_SYMBOLS_IMAGE_ID,
			type: 'code',
			buffer: Buffer.from(encodeBlua32SymbolsImage(linked.symbols)),
			source_path: BLUA32_SYMBOLS_IMAGE_ID,
		});
	}
	return {
		domain: 'cart',
		boot,
		layout: layoutRomAssetPayloads(executableAssets, true, options.imageOffset),
	};
}

function textureGroupBuild(
	groupId: number,
	layout?: GxTextureLayout,
): { group: GxTextureGroupLayout; slots: GxTextureSlot[]; maxPixelWidth: number; maxHeight: number } {
	if (groupId === GX_SYSTEM_TEXTURE_GROUP_ID) {
		return {
			group: { mode: 'direct16', slots: [], page_local: true },
			slots: [],
			maxPixelWidth: GX_SYSTEM_TEXTURE_WIDTH,
			maxHeight: GX_SYSTEM_TEXTURE_HEIGHT,
		};
	}
	if (groupId >= GX_CART_TEXTURE_GROUP_ID_LIMIT) {
		throw new Error(`[RomPacker] Cart texture group id ${groupId} collides with reserved system texture group id ${GX_SYSTEM_TEXTURE_GROUP_ID}.`);
	}
	if (!layout) {
		throw new Error(`[RomPacker] Cart images require a gx_texture_layout in the ROM manifest.`);
	}
	const group = layout.groups[String(groupId)];
	if (!group) {
		throw new Error(`[RomPacker] GX texture group ${groupId} has no entry in gx_texture_layout.groups.`);
	}
	const slots = group.slots.map(slotName => layout.slots[slotName]);
	let maxWordWidth = slots[0].texture.width;
	let maxHeight = slots[0].texture.height;
	for (let slotIndex = 1; slotIndex < slots.length; slotIndex += 1) {
		const slot = slots[slotIndex];
		if (slot.texture.width < maxWordWidth) maxWordWidth = slot.texture.width;
		if (slot.texture.height < maxHeight) maxHeight = slot.texture.height;
	}
	return {
		group,
		slots,
		maxPixelWidth: group.mode === 'palette4' ? maxWordWidth * 4 : maxWordWidth,
		maxHeight,
	};
}

function assertTextureFitsSlots(
	groupId: number,
	group: GxTextureGroupLayout,
	slots: GxTextureSlot[],
	texture: NativeGxTexture,
	images: ImageResource[],
): void {
	for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
		const slot = slots[slotIndex];
		if (texture.wordWidth > slot.texture.width || texture.height > slot.texture.height) {
			throw new Error(`[RomPacker] GX texture group ${groupId} does not fit slot '${group.slots[slotIndex]}'.`);
		}
		if (!group.page_local) {
			continue;
		}
		for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
			const image = images[imageIndex];
			const sourceX = group.mode === 'palette4' ? image.textureU! : slot.texture.x + image.textureU!;
			const sourceY = slot.texture.y + image.textureV!;
			if ((sourceX & 0xff) + image.img!.width > GX_TEXTURE_PAGE_PIXELS
				|| (sourceY & 0xff) + image.img!.height > GX_TEXTURE_PAGE_PIXELS) {
				throw new Error(`[RomPacker] GX image '${image.name}' crosses a texture page in slot '${group.slots[slotIndex]}'.`);
			}
		}
	}
}

/** Builds producer-only image packing groups and destination-free GX texture payloads. */
export async function createTextureAtlases(
	resources: Resource[],
	layout?: GxTextureLayout,
	reportProgress?: ProgressNote,
): Promise<void> {
	const atlases = resources.filter((resource): resource is TextureAtlasResource => resource.type === 'atlas');
	const images = resources.filter((resource): resource is ImageResource => resource.type === 'image');
	if (images.length === 0) {
		return;
	}
	if (layout) {
		validateGxTextureLayout(layout);
	}
	for (let atlasIndex = 0; atlasIndex < atlases.length; atlasIndex += 1) {
		const atlas = atlases[atlasIndex];
		const groupImages = images.filter(image => image.targetAtlasId === atlas.atlasId);
		const build = textureGroupBuild(atlas.atlasId, layout);
		reportProgress?.(`texture group ${atlas.atlasId} (${groupImages.length} images)`);
		const canvas = createTextureAtlas(groupImages, {
			maxPixelWidth: build.maxPixelWidth,
			maxHeight: build.maxHeight,
			pageLocal: build.group.page_local,
		});
		atlas.img = canvas;
		const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
		let texture: NativeGxTexture;
		if (atlas.atlasId === GX_SYSTEM_TEXTURE_GROUP_ID) {
			texture = encodeDirect16GxTexture(canvas.width, canvas.height, rgba);
		} else {
			texture = build.group.mode === 'palette4'
				? encodePalette4GxTexture(canvas.width, canvas.height, rgba)
				: encodeDirect16GxTexture(canvas.width, canvas.height, rgba);
		}
		atlas.gxTexture = texture;
		assertTextureFitsSlots(atlas.atlasId, build.group, build.slots, texture, groupImages);
	}
	if (layout) {
		for (const groupId of Object.keys(layout.groups)) {
			if (!atlases.some(atlas => atlas.atlasId === Number(groupId))) {
				throw new Error(`[RomPacker] gx_texture_layout.groups.${groupId} has no images.`);
			}
		}
	}
}

/** Writes a completed ROM layout to its atomically published file. */
export async function finalizeRompack(
	rom_name: string,
	options: {
		projectRootPath?: string,
		status?: ProgressNote,
		debug: boolean,
		blua32: RomBlua32Tail,
		layout: RomPrefixLayout,
		outputDirectory: string,
		cartridgeBoardWord: number,
		cartridgeRamByteCount: number,
	}
) {
	const outfileBasename = `${rom_name}${options.debug ? '.debug' : ''}.rom`;
	const outputPath = join(options.outputDirectory, outfileBasename);
	const status = options.status;

	await mkdir(options.outputDirectory, { recursive: true });

	const tempDirectory = await mkdtemp(join(options.outputDirectory, '.rompack-'));
	const tempFile = join(tempDirectory, outfileBasename);
	const symbolsTempFile = join(tempDirectory, `${outfileBasename}${BLUA32_SYMBOLS_SIDECAR_SUFFIX}`);
	try {
		const writer = createWriteStream(tempFile);
		let offset = 0;
		let headerBuffer: Buffer;
		const wordPaddingByLength = Array.from({ length: CART_ROM_WORD_ALIGNMENT }, (_, length) => Buffer.alloc(length));

		const writeBuffer = async (payload: Uint8Array) => {
			if (payload.byteLength === 0) return;
			const ok = writer.write(payload);
			offset += payload.byteLength;
			if (!ok) {
				await once(writer, 'drain');
			}
		};
		const writePaddingTo = async (targetOffset: number) => {
			const paddingLength = targetOffset - offset;
			if (paddingLength !== 0) {
				await writeBuffer(wordPaddingByLength[paddingLength]);
			}
		};
		const writePayloadRanges = async (ranges: ReadonlyArray<RomAssetPayloadRange>) => {
			for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 1) {
				const range = ranges[rangeIndex];
				await writePaddingTo(range.start);
				await writeBuffer(range.buffer);
			}
		};

		try {
			await writeBuffer(Buffer.alloc(CART_ROM_HEADER_SIZE));
			status?.('write asset payloads');
			await writePayloadRanges(options.layout.assetRanges);

			if (options.layout.metadataHeader.byteLength !== 0) {
				status?.('write shared metadata');
				await writePaddingTo(options.layout.metadataOffset);
				await writeBuffer(options.layout.metadataHeader);
				for (let index = 0; index < options.layout.metadataPayloads.length; index += 1) {
					const asset = options.layout.metadataAssets[index];
					status?.(`meta ${asset.type}:${asset.resid}`);
					await writeBuffer(options.layout.metadataPayloads[index]);
				}
			}
			if (options.layout.manifest.byteLength !== 0) {
				status?.('write rom manifest');
				await writePaddingTo(options.layout.manifestOffset);
				await writeBuffer(options.layout.manifest);
			}

			await writePayloadRanges(options.blua32.layout.ranges);
			const dataOffset = options.layout.assetRanges.length === 0
				? options.blua32.layout.ranges[0].start
				: options.layout.assetRanges[0].start;
			const dataEnd = options.blua32.layout.ranges[options.blua32.layout.ranges.length - 1].end;

			status?.('encode toc');
			const entries = options.layout.entries.concat(options.blua32.layout.entries);
			const tocBuffer = Buffer.from(encodeRomToc({
				entries,
				projectRootPath: options.projectRootPath,
			}));
			const tocOffset = alignRomAssetOffset(offset);
			const romCapacity = options.blua32.domain === 'system' ? SYSTEM_ROM_SIZE : CART_ROM_SIZE;
			if (tocOffset + tocBuffer.byteLength > romCapacity) {
				throw new Error(`ROM payload exceeds the ${romCapacity}-byte ${options.blua32.domain} ROM window.`);
			}
			await writePaddingTo(tocOffset);
			const tocLength = tocBuffer.length;
			await writeBuffer(tocBuffer);

			headerBuffer = Buffer.alloc(CART_ROM_HEADER_SIZE);
			writeCartRomHeader(headerBuffer, {
				headerSize: CART_ROM_HEADER_SIZE,
				manifestOffset: options.layout.manifestOffset,
				manifestLength: options.layout.manifest.byteLength,
				tocOffset,
				tocLength,
				dataOffset,
				dataLength: dataEnd - dataOffset,
				blua32ImageOffset: options.blua32.boot.imageOffset,
				blua32ImageByteCount: options.blua32.boot.imageByteCount,
				blua32StartupFunctionAddress: options.blua32.boot.startupFunctionAddress,
				blua32IrqFunctionAddress: options.blua32.boot.irqFunctionAddress,
				blua32ExceptionFunctionAddress: options.blua32.boot.exceptionFunctionAddress,
				blua32StaticLayoutTokenLo: options.blua32.boot.staticLayoutTokenLo,
				blua32StaticLayoutTokenHi: options.blua32.boot.staticLayoutTokenHi,
				metadataOffset: options.layout.metadataOffset,
				metadataLength: options.layout.metadataLength,
				vdpClass: 'psx',
				cartridgeBoardWord: options.cartridgeBoardWord,
				cartridgeRamByteCount: options.cartridgeRamByteCount,
			});
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
		if (options.blua32.domain === 'system') {
			await writeFile(symbolsTempFile, options.blua32.symbolsPayload);
			await rename(symbolsTempFile, `${outputPath}${BLUA32_SYMBOLS_SIDECAR_SUFFIX}`);
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
 * Determines whether a rebuild of the ROM is required based on the modification times of the bootloader and resource files.
 * @param {string} romname - The name of the ROM.
 * @param {string} bootloaderPath - The path to the bootloader files.
 * @param {string} resPath - The path to the resource files.
 * @returns {Promise<boolean>} A Promise that resolves with a boolean indicating whether a rebuild is required.
 */
export async function isRebuildRequired(romname: string, bootloaderPath: string, resPath: string, options: ResourceScanOptions = {}): Promise<boolean> {
	let romFilePath = options.romFilePath;
	if (romFilePath === undefined) {
		romFilePath = `./dist/${romname}${options.debug ? '.debug' : ''}.rom`;
	}
	let biosRomFilePath = options.biosRomFilePath;
	if (biosRomFilePath === undefined) {
		biosRomFilePath = `./dist/bmsx-bios${options.debug ? '.debug' : ''}.rom`;
	}
	const extraLuaRoots = options.extraLuaPaths;
	const cartProject = isCartPath(resPath) || isCartPath(bootloaderPath) || isDefaultCartBootloader(bootloaderPath);

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
	if (cartProject) {
		let biosStats: Stats;
		try {
			biosStats = await stat(biosRomFilePath);
		} catch {
			return true;
		}
		if (biosStats.mtimeMs > romMtimeMs) {
			return true;
		}
	}

	const normalizedBoot = resolve(bootloaderPath);
	const normalizedRes = resolve(resPath);
	let extraNeedsRebuild = false;
	if (extraLuaRoots) {
		for (const root of extraLuaRoots) {
			if (!root || root.length === 0) continue;
			const normalized = resolve(root);
			if (normalized === normalizedRes || (!cartProject && normalized === normalizedBoot)) continue;
			if (await directoryHasRebuildInputNewerThan(root, romMtimeMs, true, cartProject, true)) {
				extraNeedsRebuild = true;
				break;
			}
		}
	}

	const bootloaderNeedsRebuild = cartProject ? false : await anyFileNewerThan(collectSourceFiles([bootloaderPath], CODE_FILE_EXTENSION_SET), romMtimeMs);
	const resNeedsRebuild = await anyFileNewerThan(await getFiles(resPath), romMtimeMs);
	return extraNeedsRebuild ||
		bootloaderNeedsRebuild ||
		resNeedsRebuild;
}

// Define common assets path
export const commonResPath = `./machine/firmware/res`;
const DEFAULT_SYSTEM_RESOURCE_ROOTS: readonly string[] = [commonResPath];
export const biosLuaPath = './machine/firmware/bios';
export const systemLuaPath = './machine/firmware/system';
export const cartlibLuaPath = './cartlib';
