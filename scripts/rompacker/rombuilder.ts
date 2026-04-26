import { glsl } from "esbuild-plugin-glsl";
// @ts-ignore
import type { Stats } from 'fs';
import { CART_ROM_HEADER_SIZE, CART_ROM_MAGIC_BYTES } from '../../src/bmsx/rompack/format';
import type { asset_type, AudioMeta, BoundingBoxPrecalc, GLTFMesh, HitPolygonsPrecalc, ImgMeta, Polygon, RectBounds, RomAsset, RomManifest, vec2arr } from '../../src/bmsx/rompack/format';
import { SYSTEM_BOOT_ENTRY_PATH } from '../../src/bmsx/core/system';
import { encodeRomToc } from '../../src/bmsx/rompack/toc';
import type { LuaChunk } from '../../src/bmsx/lua/syntax/ast';
import { encodeAudioAssetToAdpcm } from './adpcm';
import { resolveTargetAtlasId, createOptimizedAtlas, generateAtlasAssetId } from './atlasbuilder';
import { BoundingBoxExtractor } from './boundingbox_extractor';
import { loadGLTFModel } from './gltfloader';
import type { TextureAtlasResource, ImageResource, Resource, resourcetype, RomPackerTarget } from './rompacker.rompack';
import { collectSourceFiles } from '../analysis/file_scan';
import { collectCartSourceFiles } from './cart_source_files';
// @ts-ignore
const { build } = require('esbuild');
// @ts-ignore
const { join, parse, relative, resolve, sep } = require('path');

// @ts-ignore
const { access, mkdir, readdir, readFile, stat, writeFile, unlink, copyFile, open } = require('fs/promises');
// @ts-ignore
const { createWriteStream, statSync } = require('fs');
// @ts-ignore
const { once } = require('events');
// @ts-ignore
const { finished } = require('stream/promises');
// @ts-ignore
// Import encodeBinary from the public API surface
// Use direct path to avoid pulling entire engine via public alias during Node execution
// @ts-ignore
const { encodeBinary, decodeBinary } = require('../../src/bmsx/common/serializer/binencoder');
// @ts-ignore
const { buildRomMetadataSection } = require('../../src/bmsx/rompack/metadata');
// @ts-ignore
const { LuaLexer } = require('../../src/bmsx/lua/syntax/lexer');
// @ts-ignore
const { LuaParser } = require('../../src/bmsx/lua/syntax/parser');
// @ts-ignore
const { splitText } = require('../../src/bmsx/common/text_lines');
// @ts-ignore
const { compileLuaChunkToProgram, isLuaCompileError } = require('../../src/bmsx/machine/program/compiler');
// @ts-ignore
const {
	PROGRAM_ASSET_ID,
	PROGRAM_SYMBOLS_ASSET_ID,
	buildModuleAliasesFromPaths,
	buildProgramBootHeader,
	encodeProgram,
	encodeProgramAsset,
	encodeProgramSymbolsAsset,
} = require('../../src/bmsx/machine/program/asset');
// @ts-ignore
// @ts-ignore
const pako = require('pako');
// @ts-ignore
const { minify } = require('@node-minify/core');
// @ts-ignore
const { cleanCss: cleanCSS } = require('@node-minify/clean-css');
// @ts-ignore
const { loadImage } = require('canvas');
// @ts-ignore
const yaml = require('js-yaml');
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

export const DONT_PACK_IMAGES_WHEN_USING_ATLAS = true;
export const BOOTROM_TS_FILENAME = 'bootrom.ts';
export const BOOTROM_JS_FILENAME = 'bootrom.js';
export const BOOTROM_TS_RELATIVE_PATH = `../../scripts/bootrom/${BOOTROM_TS_FILENAME}`;
export const BOOTROM_JS_RELATIVE_PATH = `../../rom/${BOOTROM_JS_FILENAME}`;
export const NODE_BOOTROM_ENTRY_RELATIVE_PATH = `../../scripts/bootrom/platforms/node_entry.ts`;

export function getNodeLauncherFilename(platform: RomPackerTarget, debug: boolean): string {
	switch (platform) {
		case 'headless':
			return debug ? 'headless_debug.js' : 'headless.js';
		case 'cli':
			return debug ? 'cli_debug.js' : 'cli.js';
		case 'browser':
			throw new Error('Browser platform does not require a Node launcher filename.');
		default:
			throw new Error(`Unsupported platform "${platform}" for Node launcher filename resolution.`);
	}
}

declare global {
	var __dirname: string;
}

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

const CART_ROOT_SEGMENT = 'src/carts/';
const ENGINE_RES_SEGMENT = 'src/bmsx/res';
const DEFAULT_CART_BOOTLOADER_SEGMENT = 'src/bmsx/machine/firmware/default_cart';

function isCartPath(path?: string): boolean {
	if (!path || path.length === 0) return false;
	const normalized = normalizeWorkspacePath(path);
	return normalized.includes(CART_ROOT_SEGMENT);
}

function isEngineResPath(path?: string): boolean {
	if (!path || path.length === 0) return false;
	const normalized = normalizeWorkspacePath(path);
	return normalized === ENGINE_RES_SEGMENT || normalized.startsWith(`${ENGINE_RES_SEGMENT}/`);
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

export async function getRomManifest(dirPath: string): Promise<RomManifest> {
	const files = await getFiles(dirPath, [], '.rommanifest');

	if (files.length > 1) {
		throw new Error(`More than one rommanifest found in ${dirPath}.`);
	}
	else if (files.length === 1) {
		const res = (await readFile(files[0])).toString();
		// Read and return the rommanifest file
		let manifest: RomManifest;
		try {
			manifest = JSON.parse(res) as RomManifest;
		} catch {
			manifest = yaml.load(res) as RomManifest;
		}
		return manifest;
	}
	else return null;
}

export async function buildEngineRuntime(debug: boolean): Promise<void> {
	await mkdir('./rom', { recursive: true });

	const buildRuntime = async (outfile: string, buildDebug: boolean): Promise<void> => {
		await build({
			entryPoints: ['./src/bmsx/machine/program/engine_entry.ts'],
			bundle: true,
			platform: 'browser',
			format: 'iife',
			target: 'es2020',
			outfile,
			keepNames: true,
			minify: !buildDebug,
			sourcemap: buildDebug ? 'inline' : false,
			sourcesContent: buildDebug,
			define: {
				'process.env.NODE_ENV': buildDebug ? '"development"' : '"production"',
			},
			plugins: [
				glsl({ minify: !buildDebug }),
			],
			loader: {
				'.png': 'dataurl',
				'.glsl': 'text',
				'.json': 'json',
				'.html': 'text',
			},
		});
	};

	if (debug) {
		await buildRuntime('./rom/engine.debug.js', true);
	} else {
		await buildRuntime('./rom/engine.js', false);
	}

	await mkdir('./dist', { recursive: true });
	if (debug) {
		await copyFile('./rom/engine.debug.js', './dist/engine.debug.js');
	} else {
		await copyFile('./rom/engine.js', './dist/engine.js');
	}
}

/**
 * Applies a set of replacements to a given string.
 *
 * @param str - The string to apply replacements to.
 * @param replacements - An object mapping placeholders to their replacement values.
 * @returns The string with replacements applied.
 */
export function applyStringReplacements(str: string, replacements: { [key: string]: string }): string {
	let result = str;
	for (const [key, value] of Object.entries(replacements)) {
		result = result.split(key).join(value);
	}
	return result;
}

/**
 * Builds the game HTML and manifest files for the specified ROM.
 * @param {string} rom_name - The name of the ROM.
 * @param {string} title - The title of the game.
 * @param {string} short_name - The short name of the game.
 * @returns {Promise<any>} A promise that resolves when the game HTML and manifest files have been built.
 */
export async function buildGameHtmlAndManifest(rom_name: string, title: string, short_name: string, debug: boolean, deploy: boolean): Promise<any> {
	const IMAGE_PATHS = [
		'./rom/bmsx.png',
		'./rom/d-pad-neutral.png',
		'./rom/d-pad-u.png',
		'./rom/d-pad-ru.png',
		'./rom/d-pad-r.png',
		'./rom/d-pad-rd.png',
		'./rom/d-pad-d.png',
		'./rom/d-pad-ld.png',
		'./rom/d-pad-l.png',
		'./rom/d-pad-lu.png'
	];

	/**
	 * Loads an image from the specified file path and converts it to a base64 string.
	 *
	 * @param filepath - The path of the image file to load.
	 * @returns A promise that resolves to the base64 string representation of the image.
	 * @throws An error if there is an issue reading the file.
	 */
	async function loadImgAndConvertToBase64String(filepath: string): Promise<string> {
		try {
			const image = await readFile(filepath);
			return image.toString('base64');
		} catch (error) {
			throw new Error(`Error reading file "${__dirname}${filepath}": ${error.message}`);
		}
	}

	/**
	 * Loads multiple images and converts them to base64 strings.
	 *
	 * @param paths - An array of image file paths to load.
	 * @returns A promise that resolves to an object mapping file paths to base64 strings.
	 */
	async function loadImages(paths: string[]): Promise<{ [key: string]: string }> {
		const images: { [key: string]: string } = {};
		if (paths.length === 0) {
			return images;
		}
		let cursor = 0;
		const concurrency = Math.min(8, paths.length);
		const workers = Array.from({ length: concurrency }, async () => {
			while (true) {
				const index = cursor;
				cursor += 1;
				if (index >= paths.length) {
					break;
				}
				const path = paths[index];
				const base64 = await loadImgAndConvertToBase64String(path);
				images[path] = base64;
			}
		});
		await Promise.all(workers);
		return images;
	}

	/**
	 * Transforms the HTML template by replacing placeholders with actual values.
	 *
	 * @param htmlToTransform - The HTML template to transform.
	 * @param cssMinified - The minified CSS string.
	 * @param debug - A boolean indicating whether to include debug information.
	 * @returns A promise that resolves to the transformed HTML string.
	 */
	async function transformHtml(htmlToTransform: string, cssMinified: string, debug: boolean): Promise<string> {
		const imgPrefix = 'data:image/png;base64,';
		const defaultRom = deploy ? `${rom_name}.${debug ? 'debug.' : ''}rom` : '';
		const replacements = {
			'//#bootromjs': romjs,
			'//#zipjs': zipjs,
			'/*#css*/': cssMinified,
			'#title': title,
			'#enginejs': debug ? 'engine.debug.js' : 'engine.js',
			'//#debug': `bootrom.debug = ${debug};\n`,
			'#biospath': `./bmsx-bios.${debug ? 'debug.' : ''}rom`,
			'__DEFAULT_ROM__': defaultRom,
			'@@BMSX_LOGO@@': `${imgPrefix}${images['./rom/bmsx.png']}`,
			'@@DPAD_D@@': `${imgPrefix}${images['./rom/d-pad-d.png']}`,
			'@@DPAD_L@@': `${imgPrefix}${images['./rom/d-pad-l.png']}`,
			'@@DPAD_LD@@': `${imgPrefix}${images['./rom/d-pad-ld.png']}`,
			'@@DPAD_LU@@': `${imgPrefix}${images['./rom/d-pad-lu.png']}`,
			'@@DPAD_NEUTRAL@@': `${imgPrefix}${images['./rom/d-pad-neutral.png']}`,
			'@@DPAD_R@@': `${imgPrefix}${images['./rom/d-pad-r.png']}`,
			'@@DPAD_RD@@': `${imgPrefix}${images['./rom/d-pad-rd.png']}`,
			'@@DPAD_RU@@': `${imgPrefix}${images['./rom/d-pad-ru.png']}`,
			'@@DPAD_U@@': `${imgPrefix}${images['./rom/d-pad-u.png']}`,
		};

		return applyStringReplacements(htmlToTransform, replacements);
	}

	let html: string, romjs: string, zipjs: string;
	try {
		html = await readFile("./gamebase.html", 'utf8');
		romjs = await readFile(`./rom/${BOOTROM_JS_FILENAME}`, 'utf8');
		zipjs = await readFile("./scripts/pako_inflate.min.js", 'utf8');
	} catch (error) {
		throw new Error(`Error reading files while building HTML and Manifest files: ${error.message}`);
	}

	const images = await loadImages(IMAGE_PATHS);

	const cssMinified = await minify({
		compressor: cleanCSS,
		input: "./gamebase.css",
		output: "./rom/gamebase.min.css",
	});

	const transformedHtml = await transformHtml(html, cssMinified, debug);
	await writeFile(`./dist/index.html`, transformedHtml);

	// Write the PWA manifest to dist-folder. Keep it generic unless we explicitly deploy a game.
	const manifestTemplate = await readFile("./rom/manifest.json", 'utf8');
	const appName = deploy ? title : 'BMSX';
	const appShortName = deploy ? short_name : 'BMSX';
	const manifest = manifestTemplate.replace('#title', appName).replace('#short_name', appShortName);
	await writeFile("./dist/manifest.webmanifest", manifest);
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
	targetAtlasId?: number,
} {
	// Match @cc or @cx for collision type, and @atlas=n for texture atlas assignment (order-insensitive)
	const collisionMatch = filenameWithoutExt.match(/@(cc|cx)/i);
	let collisionType: 'concave' | 'convex' | 'aabb' = 'aabb';
	if (collisionMatch) {
		const code = collisionMatch[1].toLowerCase();
		collisionType = code === 'cc' ? 'concave' : code === 'cx' ? 'convex' : 'aabb';
	}
	let targetAtlasId = undefined;
	if (GENERATE_AND_USE_TEXTURE_ATLAS && DONT_PACK_IMAGES_WHEN_USING_ATLAS) {
		const atlasMatch = filenameWithoutExt.match(/@atlas=(\d+)/i);
		targetAtlasId = atlasMatch ? parseInt(atlasMatch[1], 10) : undefined;
	}

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
	let imgmeta: ImgMeta = {
		width: img.width,
		height: img.height,
		boundingbox: {
			original: collision.boundingbox.original,
		},
		centerpoint: collision.centerpoint,
		hitpolygons: collision.hitpolygons
			? {
				original: collision.hitpolygons.original,
			}
			: undefined,
	};
	if (GENERATE_AND_USE_TEXTURE_ATLAS) {
		const targetAtlasId = res.targetAtlasId;
		const texcoords = res.atlasTexcoords;
		imgmeta = {
			...imgmeta,
			atlasid: targetAtlasId !== undefined ? targetAtlasId : undefined,
			texcoords: texcoords ? [...texcoords] : undefined,
		};
	}
	return imgmeta;
}

/**
 * Compresses the given content using the zip algorithm and returns the compressed  content as a Uint8Array.
 *
 * @param content - The content to be compressed.
 * @returns The compressed content as a Uint8Array.
 */
// @ts-ignore
export function zip(content: Buffer): Uint8Array {
	const toCompress = new Uint8Array(content);
	return pako.deflate(toCompress, { level: 9 });
}

function formatLuaCompileError(error: { path: string; message: string; line: number; column: number }, source: string): string {
	// disable-next-line newline_normalization_pattern -- compiler diagnostics map a source location to one logical source line.
	const lines = source.split(/\r\n|\r|\n/);
	const sourceLine = lines[error.line - 1];
	const gutter = `${error.line} | `;
	const caret = Math.max(0, error.column - 1);
	return `${error.path}:${error.line}:${error.column}: ${error.message}\n${gutter}${sourceLine}\n${' '.repeat(gutter.length + caret)}^`;
}

function compileLuaChunkBuffer(source: string, path: string): Buffer {
	const lexer = new LuaLexer(source, path);
	const tokens = lexer.scanTokens();
	const parser = new LuaParser(tokens, path, splitText(source));
	const chunk = parser.parseChunk();
	const encoded = encodeBinary(chunk);
	return Buffer.from(encoded);
}

export async function buildLuaProgramContextAssets(luaRoot: string, virtualRoot: string): Promise<RomAsset[]> {
	const files = (await getFiles(luaRoot, [], '.lua')).sort((a, b) => a.localeCompare(b));
	const assets: RomAsset[] = [];
	for (const file of files) {
		const sourcePath = normalizeWorkspacePath(resolveVirtualSourcePath(file, virtualRoot) ?? toWorkspaceRelativePath(file));
		const buffer = await readFile(file);
		const source = buffer.toString('utf8');
		assets.push({
			resid: `__program_context__/${sourcePath}`,
			type: 'lua',
			buffer,
			compiled_buffer: compileLuaChunkBuffer(source, sourcePath),
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

	const getDataSubtype = (currentName: string): asset_type => {
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
	resolveAtlasId?: boolean;
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
	 * Optional override for the engine BIOS ROM path used by cart rebuild checks.
	 * Defaults to `dist/bmsx-bios[.debug].rom` (based on `debug`).
	 */
	biosRomFilePath?: string;
};

function isWorkspaceStateDirectory(name: string): boolean {
	return name.toLowerCase() === WORKSPACE_STATE_DIR_NAME;
}

export async function getResMetaList(respaths: string[], _romname?: string, options: ResourceScanOptions = {}): Promise<Resource[]> {
	const arrayOfFiles: string[] = [];
	const virtualRoot = normalizeVirtualRootPath(options.virtualRoot);
	const cartProject = isCartPath(virtualRoot) || respaths.some(isCartPath);
	const scanRoots = cartProject
		? respaths.filter(path => !isEngineResPath(path))
		: respaths;
	const extraLuaRoots = options.extraLuaPaths;
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
	arrayOfFiles.sort((a, b) => a.localeCompare(b));

	const result: Array<Resource> = [];
	const targetAtlasIdSet = new Set<number>();
	const imageNameRegistry = new Map<string, { filepath?: string }>();

	let imgid = 1;
	let sndid = 1;
	let dataid = 1;
	let modelid = 1;
	let luaid = 1;
	for (let i = 0; i < arrayOfFiles.length; i++) {
		const filepath = arrayOfFiles[i];
		const meta = getResMetaByFilename(filepath);

		const type = meta.type;
		let name = meta.name;
		const ext = meta.ext;
		const virtualSourcePath = resolveVirtualSourcePath(filepath, virtualRoot);
		const sourcePath = virtualSourcePath ?? toWorkspaceRelativePath(filepath);
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
				let targetAtlasId = imgMeta.targetAtlasId;
				if (options.resolveAtlasId) {
					const resolvedAtlasId = resolveTargetAtlasId(filepath, targetAtlasId);
					if (typeof resolvedAtlasId === 'number') {
						imgMeta.targetAtlasId = resolvedAtlasId;
						targetAtlasId = resolvedAtlasId;
					}
				}
				// If we are generating texture atlases, this image contributes to its target atlas.
				if (GENERATE_AND_USE_TEXTURE_ATLAS && DONT_PACK_IMAGES_WHEN_USING_ATLAS) {
					if (imgMeta.targetAtlasId !== undefined) {
						targetAtlasIdSet.add(imgMeta.targetAtlasId);
					}
				}
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
			case 'atlas':
				// Generated texture atlas resources are added below.
				break;
		}
	}

	// Ensure the default texture atlas (id 0) is always present when atlas packing is enabled.
	if (GENERATE_AND_USE_TEXTURE_ATLAS && DONT_PACK_IMAGES_WHEN_USING_ATLAS) {
		targetAtlasIdSet.add(0);
	}
	for (const id of Array.from(targetAtlasIdSet).sort((a, b) => a - b)) {
		const name = generateAtlasAssetId(id);
		result.push({ filepath: undefined, name, ext: '.atlas', type: 'atlas', id: imgid++, atlasId: id });
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
	checkDuplicateNames('data');
	checkDuplicateNames('image');
	checkDuplicateNames('audio');
	checkDuplicateNames('model');
	checkDuplicateNames('lua');

	return result;
}

/**
 * Builds a list of resources located at `respath` for the specified `romname`.
 * @param rom_name The name of the ROM pack to build the list for.
 * @returns An array of resources.
 */
export async function getResourcesList(resMetaList: Resource[]): Promise<Resource[]> {
	let resources: Array<Resource> = [];

	/**
	 * Loads an image from the specified resource object.
	 * @param _meta The resource object containing information about the image to load.
	 * @returns A Promise that resolves with the loaded image.
	 */
	// @ts-ignore
	async function getImageFromBuffer(buffer: Buffer) {
		const base64Encoded = buffer.toString('base64');
		const dataURL = `data:images/png;base64,${base64Encoded}`;
		return await loadImage(dataURL);
	}

	// Parallelize buffer and image loading
	const resourcePromises = resMetaList.map(async (meta): Promise<Resource> => {
		const metaObject = meta as unknown as Record<string, unknown>;
		const buffer = meta.filepath ? await readFile(meta.filepath) : undefined;
		switch (meta.type) {
			case 'image': {
				if (!buffer) {
					throw new Error(`Image resource "${meta.name}" is missing its binary payload.`);
				}
				const img = await getImageFromBuffer(buffer);
				return {
					...metaObject,
					buffer,
					img,
				} as Resource;
			}
			case 'audio':
			case 'data':
			case 'aem':
			case 'model':
			case 'romlabel':
			case 'atlas':
				return {
					...metaObject,
					buffer,
				} as Resource;
			case 'lua': {
				if (!buffer) {
					throw new Error(`[RomPacker] Lua resource "${meta.name}" is missing its source file payload.`);
				}
				return {
					...metaObject,
					buffer,
				} as Resource;
			}
			default:
				return {
					...metaObject,
					buffer,
				} as Resource;
		}
	});

	resources = await Promise.all(resourcePromises);

	return resources;
}

/**
 * Processes an array of resources to produce asset metadata and allocate buffer ranges.
 *
 * This function processes each loaded resource, extracting relevant metadata and buffer data,
 * and constructs a RomAsset for each. It handles different resource types such as images,
 * audio, code, atlases, and romlabels, and attaches the appropriate metadata to each asset.
 * For images and atlases, it generates image metadata; for audio, it parses audio metadata.
 * The resulting RomAsset array is used for ROM packing and serialization.
 *
 * @param resources - The array of resources to process.
 * @returns An object with three properties:
 * - `assetList` - The array of generated asset metadata objects (to be binary-encoded).
 * - `romlabel_buffer` - The buffer data for the "romlabel.png" resource if present.
 */

export async function generateRomAssets(resources: Resource[], reportProgress?: ProgressNote) {
	const romAssets: RomAsset[] = [];
	const compileErrors: string[] = [];
	// @ts-ignore
	let romlabel_buffer: Buffer;

	for (const res of resources) {
		const type = res.type;
		let sourcePath: string;
		if (res.sourcePath && res.sourcePath.length > 0) {
			sourcePath = res.sourcePath;
		} else if (res.filepath && res.filepath.length > 0) {
			sourcePath = toWorkspaceRelativePath(res.filepath);
		} else {
			sourcePath = undefined;
		}
		let resid = res.name;
		let buffer = res.buffer; // NOTE that we will remove the buffer during the finalization of the ROM pack. To do proper finalization, we need to store the buffer here right now. N.B. the bootrom will also add the buffer to the RomAsset, so that's why the property is relevant in the first place and we are now using it to temporarily hold the buffer per asset.
		reportProgress?.(`asset ${res.type}:${resid}`);

		switch (type) {
			case 'romlabel':
				romlabel_buffer = res.buffer;
				romAssets.push({ resid, type, imgmeta: undefined, buffer: romlabel_buffer, source_path: sourcePath });
				break;
			case 'image': {
				const collision = buildImageCollisionBuild(res);
				const imgmeta = buildImgMetaFromCollisionBuild(res, collision);
				let baseAsset: RomAsset;
				if (GENERATE_AND_USE_TEXTURE_ATLAS && DONT_PACK_IMAGES_WHEN_USING_ATLAS) {
					baseAsset = { resid, type, imgmeta, buffer: undefined, source_path: sourcePath };
				} else {
					baseAsset = { resid, type, imgmeta, buffer, source_path: sourcePath };
				}
				baseAsset.collision_bin_buffer = collision.collisionbin;
				romAssets.push({ ...baseAsset, });
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
				const luaSourcePath = sourcePath && sourcePath.length > 0 ? sourcePath : toWorkspaceRelativePath(res.filepath);
				const normalizedPath = normalizeWorkspacePath(luaSourcePath);
				const source = buffer.toString('utf8');
				let compiled_buffer: Buffer;
				try {
					compiled_buffer = compileLuaChunkBuffer(source, normalizedPath);
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
				const texture_buffer = Buffer.concat(texBuffers);
				romAssets.push({ resid, type, buffer, texture_buffer, source_path: sourcePath });
			}
				break;
			case 'atlas': {
				const imgmeta = buildImgMetaForAtlas(res);
				romAssets.push({ resid, type, imgmeta, buffer, source_path: sourcePath });
				break;
			}
			case 'romlabel':
				romAssets.push({ resid, type, buffer, source_path: sourcePath });
				break;
			default:
				// Skip unknown resource types without failing
				break;
		}
	}
	if (compileErrors.length > 0) {
		throw new Error(`Compilation failed with ${compileErrors.length} Lua error(s):\n${compileErrors.join('\n')}`);
	}
	return romAssets;
}

export function appendProgramAsset(
	assetList: RomAsset[],
	entryPath: string = SYSTEM_BOOT_ENTRY_PATH,
	options: {
		extraLuaAssets?: RomAsset[];
		externalLuaAssets?: RomAsset[];
		includeSymbols?: boolean;
		optLevel?: 0 | 1 | 2 | 3;
	} = {},
): {
	version: number;
	flags: number;
	entryProtoIndex: number;
	codeByteCount: number;
	constPoolCount: number;
	protoCount: number;
	moduleAliasCount: number;
	constRelocCount: number;
} {
	const hasProgramAsset = assetList.some(asset => asset.resid === PROGRAM_ASSET_ID);
	const hasSymbolsAsset = assetList.some(asset => asset.resid === PROGRAM_SYMBOLS_ASSET_ID);
	const includeSymbols = options.includeSymbols;
	if (hasProgramAsset || hasSymbolsAsset) {
		throw new Error('[RomPacker] appendProgramAsset() expects a fresh asset list without prebuilt program assets.');
	}
	const baseLuaAssets = assetList.filter(asset => asset.type === 'lua');
	const luaAssets = baseLuaAssets.slice();
	const extraLuaAssets = options.extraLuaAssets;
	if (extraLuaAssets && extraLuaAssets.length > 0) {
		const seenPaths = new Set<string>();
		for (const asset of baseLuaAssets) {
			const path = asset.source_path;
			seenPaths.add(path);
		}
		for (const asset of extraLuaAssets) {
			const path = asset.source_path;
			if (seenPaths.has(path)) {
				continue;
			}
			seenPaths.add(path);
			luaAssets.push(asset);
		}
	}
	if (luaAssets.length === 0) {
		throw new Error('[RomPacker] Cannot build program header without Lua assets.');
	}
	const entryAsset = luaAssets.find(asset => asset.source_path === entryPath);
	if (!entryAsset) {
		throw new Error(`[RomPacker] Lua entry '${entryPath}' not found in asset list.`);
	}

	const chunksByPath = new Map<string, LuaChunk>();
	const modulePaths: string[] = [];
	let entryChunk: LuaChunk = null;
	for (const asset of luaAssets) {
		if (!asset.compiled_buffer || asset.compiled_buffer.length === 0) {
			throw new Error(`[RomPacker] Lua asset '${asset.resid}' is missing its compiled buffer.`);
		}
		let decoded: LuaChunk;
		try {
			decoded = decodeBinary(new Uint8Array(asset.compiled_buffer)) as LuaChunk;
		} catch (error) {
			const bufferPreview = Buffer.from(asset.compiled_buffer).subarray(0, 24);
			const previewHex = Array.from(bufferPreview, byte => byte.toString(16).padStart(2, '0')).join(' ');
			const pathLabel = asset.source_path ?? asset.resid;
			throw new Error(`[RomPacker] Failed to decode compiled Lua chunk for "${pathLabel}". First bytes: ${previewHex}. ${error?.message ?? error}`);
		}
		const path = asset.source_path;
		chunksByPath.set(path, decoded);
		modulePaths.push(path);
		if (asset === entryAsset) {
			entryChunk = decoded;
		}
	}

	const modules: Array<{ path: string; chunk: LuaChunk; source: string }> = [];
	for (const asset of luaAssets) {
		if (asset === entryAsset) {
			continue;
		}
		const path = asset.source_path;
		const chunk = chunksByPath.get(path);
		modules.push({ path, chunk, source: asset.buffer.toString('utf8') });
	}
	const externalModules: Array<{ path: string; chunk: LuaChunk; source: string }> = [];
	const externalModulePaths: string[] = [];
	const externalLuaAssets = options.externalLuaAssets ?? [];
	for (const asset of externalLuaAssets) {
		if (!asset.compiled_buffer || asset.compiled_buffer.length === 0) {
			throw new Error(`[RomPacker] External Lua asset '${asset.resid}' is missing its compiled buffer.`);
		}
		const path = asset.source_path;
		if (!path || chunksByPath.has(path)) {
			continue;
		}
		const chunk = decodeBinary(new Uint8Array(asset.compiled_buffer)) as LuaChunk;
		externalModules.push({ path, chunk, source: asset.buffer.toString('utf8') });
		externalModulePaths.push(path);
	}

	const optLevel = options.optLevel ?? 3;

	const compiled = compileLuaChunkToProgram(entryChunk, modules, {
		optLevel,
		entrySource: entryAsset.buffer.toString('utf8'),
		externalModules,
	});
	const program = compiled.program;
	const programAsset = {
		entryProtoIndex: compiled.entryProtoIndex,
		program: encodeProgram(program),
		moduleProtos: Array.from(compiled.moduleProtoMap.entries(), ([path, protoIndex]) => ({ path, protoIndex })),
		moduleAliases: buildModuleAliasesFromPaths(modulePaths.concat(externalModulePaths)),
		staticModulePaths: compiled.staticModulePaths,
		link: {
			constRelocs: compiled.constRelocs,
		},
	};

	const buffer = Buffer.from(encodeProgramAsset(programAsset));
	assetList.push({
		resid: PROGRAM_ASSET_ID,
		type: 'data',
		buffer,
		source_path: PROGRAM_ASSET_ID,
	});
	if (includeSymbols) {
		const symbolsAsset = {
			metadata: compiled.metadata,
		};
		const symbolsBuffer = Buffer.from(encodeProgramSymbolsAsset(symbolsAsset));
		assetList.push({
			resid: PROGRAM_SYMBOLS_ASSET_ID,
			type: 'data',
			buffer: symbolsBuffer,
			source_path: PROGRAM_SYMBOLS_ASSET_ID,
		});
	}
	return buildProgramBootHeader(programAsset);
}

/**
 * Generates metadata for an image resource, optionally integrating texture atlas data.
 *
 * @param res - The resource containing the image and any existing metadata.
 * @returns An object containing image dimensions, bounding boxes, center point, and texture atlas coordinates when present.
 */
export function buildImgMeta(res: ImageResource): ImgMeta {
	return buildImgMetaFromCollisionBuild(res, buildImageCollisionBuild(res));
}

export function buildImgMetaForAtlas(res: TextureAtlasResource): ImgMeta {
	return {
		atlasid: res.atlasId,
		width: res.img.width,
		height: res.img.height,
	};
}

/**
 * Generates texture atlases from the loaded image resources.
 *
 * @param resources - An array of resources, including the texture atlas to be processed.
 * @param assetList - An array of RomAsset objects to be updated with image metadata.
 * @param bufferPointer - The starting position where texture atlas data should be written in the output buffers.
 * @param buffers - An array of Buffers where the texture atlas image data will be appended.
 * @returns A Promise that resolves once the texture atlas image is written to disk and metadata is updated.
 */
export async function createAtlasses(resources: Resource[], reportProgress?: ProgressNote) {
	if (GENERATE_AND_USE_TEXTURE_ATLAS) {
		const atlases = resources.filter((res): res is TextureAtlasResource => res.type === 'atlas');
		if (atlases.length === 0) throw new Error('No texture atlas resources found in the "resources"-list. The process of preparing the list of all resources (assets) should also add any texture atlases that are to be generated. Thus, this is a bug in the code that prepares the list of resources :-(');
		// Determine the texture atlas ids to generate
		for (const atlas of atlases) {
			const image_assets = resources.filter((resource): resource is ImageResource => resource.type === 'image');
			const filteredImages = image_assets.filter(resource => resource.targetAtlasId === atlas.atlasId);
			reportProgress?.(`atlas ${atlas.name} (${filteredImages.length} images)`);
			const atlasCanvas = createOptimizedAtlas(filteredImages);
			if (!atlasCanvas) throw new Error(`Failed to create atlases for ${atlas.name}.`);
			atlas.img = atlasCanvas; // Store the canvas in the resource (to extract the image properties later during `processResources`)
			atlas.buffer = atlasCanvas.toBuffer('image/png'); // Convert canvas to PNG buffer
			reportProgress?.(`write atlas ${atlas.name}`);
			await writeFile(`./rom/_ignore/${generateAtlasAssetId(atlas.atlasId)}.png`, atlas.buffer);
		}
	}
	else {
		throw new Error('No images found to generate texture atlases from. Please ensure you have images in your resource directory.');
	}
}

function encodeBiosManifest(manifest: RomManifest): Buffer {
	return Buffer.from(encodeBinary(manifest));
}

/**
 * Finalizes the ROM pack by concatenating all asset buffers, encoding metadata, and writing the packed ROM file.
 *
 * This function processes the provided asset list, removes per-asset metadata and buffers,
 * encodes the global asset metadata, and writes the final ROM file to disk. If a "romlabel" image is present,
 * it is prepended to the ROM file to allow the ROM to be recognized as a PNG image.
 * The function also writes a JSON file with the asset list for debugging purposes.
 *
 * @param assetList - The list of ROM assets to include in the pack.
 * @param rom_name - The name of the ROM, used for output file naming.
 * @returns A Promise that resolves when the ROM file and metadata have been written.
 */
export async function finalizeRompack(
	assetList: RomAsset[],
	rom_name: string,
	options: {
		projectRootPath?: string,
		status?: ProgressNote,
		manifest?: RomManifest | null,
		zipRom: boolean,
		debug: boolean,
		programBoot: {
			version: number;
			flags: number;
			entryProtoIndex: number;
			codeByteCount: number;
			constPoolCount: number;
			protoCount: number;
			moduleAliasCount: number;
			constRelocCount: number;
		},
	}
) {
	const outfileBasename = `${rom_name}${options.debug ? '.debug' : ''}.rom`;
	const distPath = `./dist/${outfileBasename}`;
	const ignoreDir = './rom/_ignore';
	const status = options.status;

	await mkdir('./dist', { recursive: true });
	await mkdir(ignoreDir, { recursive: true });

	let romlabelBuffer: Buffer;
	const romlabelIndex = assetList.findIndex(asset => asset.type === 'romlabel');
	if (romlabelIndex >= 0) {
		const [romlabel] = assetList.splice(romlabelIndex, 1);
		if (romlabel?.buffer && romlabel.buffer.length > 0) {
			romlabelBuffer = Buffer.from(romlabel.buffer);
		}
	}

	const tempFile = `${ignoreDir}/.${outfileBasename}.work`;
	const writer = createWriteStream(tempFile);
	let offset = 0;
	let headerBuffer: Buffer = null;
	const metadataEntries: Array<{ asset: RomAsset; meta: ImgMeta | AudioMeta }> = [];

	const writeBuffer = async (payload: Buffer) => {
		if (!payload || payload.length === 0) return;
		const ok = writer.write(payload);
		offset += payload.length;
		if (!ok) {
			await once(writer, 'drain');
		}
	};

	try {
		await writeBuffer(Buffer.alloc(CART_ROM_HEADER_SIZE));
		const dataOffset = offset;
		for (const asset of assetList) {
			status?.(`pack ${asset.type}:${asset.resid}`);
			if (asset.buffer && asset.buffer.length > 0) {
				const mainBuffer = Buffer.from(asset.buffer);
				asset.start = offset;
				asset.end = offset + mainBuffer.length;
				await writeBuffer(mainBuffer);
			}
			if (asset.compiled_buffer && asset.compiled_buffer.length > 0) {
				const compiledBuffer = Buffer.from(asset.compiled_buffer);
				asset.compiled_start = offset;
				asset.compiled_end = offset + compiledBuffer.length;
				await writeBuffer(compiledBuffer);
			}
			if (asset.texture_buffer && asset.texture_buffer.length > 0) {
				const textureBuffer = Buffer.from(asset.texture_buffer);
				asset.texture_start = offset;
				asset.texture_end = offset + textureBuffer.length;
				await writeBuffer(textureBuffer);
			}
			if (asset.collision_bin_buffer && asset.collision_bin_buffer.length > 0) {
				const collisionBinBuffer = Buffer.from(asset.collision_bin_buffer);
				asset.collision_bin_start = offset;
				asset.collision_bin_end = offset + collisionBinBuffer.length;
				await writeBuffer(collisionBinBuffer);
			}
			const perMeta = asset.imgmeta ?? asset.audiometa;
			if (perMeta) {
				metadataEntries.push({ asset, meta: perMeta });
			}
			delete asset.imgmeta;
			delete asset.audiometa;
			delete asset.buffer;
			delete asset.compiled_buffer;
			delete asset.texture_buffer;
			delete asset.collision_bin_buffer;
		}

		const dataLength = offset - dataOffset;
		let metadataOffset = 0;
		let metadataLength = 0;
		if (metadataEntries.length > 0) {
			status?.('encode shared metadata');
			const { header, payloads } = buildRomMetadataSection(metadataEntries.map(entry => entry.meta));
			metadataOffset = offset;
			await writeBuffer(Buffer.from(header));
			for (let index = 0; index < metadataEntries.length; index += 1) {
				const entry = metadataEntries[index];
				const encoded = Buffer.from(payloads[index]);
				status?.(`meta ${entry.asset.type}:${entry.asset.resid}`);
				entry.asset.metabuffer_start = offset;
				entry.asset.metabuffer_end = offset + encoded.length;
				await writeBuffer(encoded);
			}
			metadataLength = offset - metadataOffset;
		}
		let manifestOffset = 0;
		let manifestLength = 0;
		if (options.manifest) {
			status?.('encode rom manifest');
			const manifestBuffer = encodeBiosManifest(options.manifest);
			manifestOffset = offset;
			manifestLength = manifestBuffer.length;
			await writeBuffer(manifestBuffer);
		}

		status?.('encode toc');
		const tocBuffer = Buffer.from(encodeRomToc({
			assets: assetList,
			projectRootPath: options.projectRootPath,
		}));
		const tocOffset = offset;
		const tocLength = tocBuffer.length;
		await writeBuffer(tocBuffer);

		headerBuffer = Buffer.alloc(CART_ROM_HEADER_SIZE);
		Buffer.from(CART_ROM_MAGIC_BYTES).copy(headerBuffer, 0);
		headerBuffer.writeUInt32LE(CART_ROM_HEADER_SIZE, 4);
		headerBuffer.writeUInt32LE(manifestOffset, 8);
		headerBuffer.writeUInt32LE(manifestLength, 12);
		headerBuffer.writeUInt32LE(tocOffset, 16);
		headerBuffer.writeUInt32LE(tocLength, 20);
		headerBuffer.writeUInt32LE(dataOffset, 24);
		headerBuffer.writeUInt32LE(dataLength, 28);
		headerBuffer.writeUInt32LE(options.programBoot.version, 32);
		headerBuffer.writeUInt32LE(options.programBoot.flags, 36);
		headerBuffer.writeUInt32LE(options.programBoot.entryProtoIndex, 40);
		headerBuffer.writeUInt32LE(options.programBoot.codeByteCount, 44);
		headerBuffer.writeUInt32LE(options.programBoot.constPoolCount, 48);
		headerBuffer.writeUInt32LE(options.programBoot.protoCount, 52);
		headerBuffer.writeUInt32LE(options.programBoot.moduleAliasCount, 56);
		headerBuffer.writeUInt32LE(options.programBoot.constRelocCount, 60);
		headerBuffer.writeUInt32LE(metadataOffset, 64);
		headerBuffer.writeUInt32LE(metadataLength, 68);
	} finally {
		writer.end();
	}

	await finished(writer);
	if (headerBuffer) {
		const file = await open(tempFile, 'r+');
		try {
			await file.write(headerBuffer, 0, headerBuffer.length, 0);
		} finally {
			await file.close();
		}
	}
	const romBinary = await readFile(tempFile);
	const payload = options.zipRom ? Buffer.from(zip(romBinary)) : romBinary;
	const finalPayload = romlabelBuffer ? Buffer.concat([romlabelBuffer, payload]) : payload;

	await writeFile(distPath, finalPayload);
	await unlink(tempFile);
	await writeFile(`${ignoreDir}/romresources.json`, JSON.stringify(assetList, null, 2));
}

export async function deployToServer(_rom_name: string, _title: string) {
	throw new Error('Deploy is not implemented yet!');
}

/**
 * Checks if the TypeScript file for the ROM loader is newer than its compiled output
 * and compiles it if needed. This function ensures that the output is always up to date.
 *
 * @throws {Error} Will throw if the loader file does not exist or if compilation fails.
 * @returns {Promise<void>} A promise that resolves once the compilation process is complete
 *                         or if no action is needed.
 */
export interface BootromBuildOptions {
	debug: boolean;
	forceBuild: boolean;
	platform: RomPackerTarget;
}

async function buildBrowserBootrom(options: { debug: boolean; forceBuild: boolean; }): Promise<void> {
	const romTsPath = join(__dirname, BOOTROM_TS_RELATIVE_PATH);
	const romJsPath = join(__dirname, BOOTROM_JS_RELATIVE_PATH);

	try {
		await access(romTsPath);
	} catch {
		throw new Error(`"${BOOTROM_TS_FILENAME}" could not be found at "${romTsPath}"`);
	}

	const romTsStats = await stat(romTsPath);
	let romJsStats: Stats;

	try {
		await access(romJsPath);
		romJsStats = await stat(romJsPath);
	} catch {
		romJsStats = undefined;
	}

	if (romJsStats && !options.forceBuild && romTsStats.mtime <= romJsStats.mtime) {
		return;
	}

	const esbuildOptions: any = {
		entryPoints: [romTsPath],
		bundle: true,
		sourcemap: options.debug ? 'inline' : false,
		sourcesContent: options.debug,
		platform: 'browser',
		target: 'es2024',
		format: 'iife',
		minify: !options.debug,
		keepNames: true,
		outfile: romJsPath,
	};
	if (options.debug) {
		esbuildOptions['sourcemap'] = 'inline';
	}
	try {
		await build(esbuildOptions);
	} catch (e) {
		throw new Error(`Error while compiling "${BOOTROM_TS_FILENAME}" with esbuild: ${e?.message ?? e}`);
	}
}

async function buildNodeBootrom(options: BootromBuildOptions): Promise<void> {
	const romTsPath = join(__dirname, NODE_BOOTROM_ENTRY_RELATIVE_PATH);
	try {
		await access(romTsPath);
	} catch {
		throw new Error(`Node boot entry could not be found at "${romTsPath}"`);
	}

	const outfileName = getNodeLauncherFilename(options.platform, options.debug);
	const outPath = join(process.cwd(), 'dist', outfileName);

	let rebuild = options.forceBuild;
	if (!rebuild) {
		let outStats: Stats;
		let entryStats: Stats;
		try {
			outStats = await stat(outPath);
		} catch {
			outStats = undefined;
		}
		try {
			entryStats = await stat(romTsPath);
		} catch {
			entryStats = undefined;
		}
		rebuild = !outStats || !entryStats || entryStats.mtime > outStats.mtime;
	}
	if (!rebuild) {
		rebuild = await isEngineRuntimeRebuildRequired(outPath);
	}

	if (!rebuild) return;

	await mkdir(join(process.cwd(), 'dist'), { recursive: true });

	const define = {
		'__BOOTROM_TARGET__': JSON.stringify(options.platform),
		'__BOOTROM_DEBUG__': options.debug ? 'true' : 'false',
	};

	const esbuildOptions: any = {
		entryPoints: [romTsPath],
		bundle: true,
		platform: 'node',
		target: 'node22',
		format: 'cjs',
		minify: !options.debug,
		keepNames: true,
		define,
		external: ['canvas'],
		sourcemap: options.debug ? 'inline' : false,
		sourcesContent: options.debug,
		outfile: outPath,
	};
	if (options.debug) {
		esbuildOptions['sourcemap'] = 'inline';
	}
	try {
		await build(esbuildOptions);
	} catch (e) {
		throw new Error(`Error while compiling Node boot entry for platform "${options.platform}": ${e?.message ?? e}`);
	}
}

export async function buildBootromScriptIfNewer(options: BootromBuildOptions): Promise<void> {
	if (options.platform === 'browser') {
		await buildBrowserBootrom({ debug: options.debug, forceBuild: options.forceBuild });
		return;
	}
	if (options.platform === 'cli' || options.platform === 'headless') {
		await buildNodeBootrom(options);
		return;
	}
	throw new Error(`Unsupported platform "${options.platform}" when building bootrom script.`);
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
	const engineNeedsRebuild = cartProject ? false : await anyFileNewerThan(collectSourceFiles(['src/bmsx'], CODE_FILE_EXTENSION_SET), romMtimeMs);

	return extraNeedsRebuild ||
		bootloaderNeedsRebuild ||
		resNeedsRebuild ||
		engineNeedsRebuild;
}

export async function isEngineRuntimeRebuildRequired(outFilePath: string = './dist/engine.js'): Promise<boolean> {
	let outputStats: Stats;
	try {
		outputStats = await stat(outFilePath);
	} catch {
		return true;
	}

	return anyFileNewerThan(collectSourceFiles(['src/bmsx'], CODE_FILE_EXTENSION_SET), outputStats.mtimeMs);
}
export function setAtlasFlag(enabled: boolean): void {
	GENERATE_AND_USE_TEXTURE_ATLAS = enabled;
}

export let GENERATE_AND_USE_TEXTURE_ATLAS = true;
// Define common assets path
export const commonResPath = `./src/bmsx/res`;
