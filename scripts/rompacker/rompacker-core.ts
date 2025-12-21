import { glsl } from "esbuild-plugin-glsl";
// @ts-ignore
import type { Stats } from 'fs';
import type { asset_type, AudioMeta, CanonicalizationType, GLTFMesh, ImgMeta, Polygon, RomAsset, RomAssetListPayload, RomManifest } from '../../src/bmsx/rompack/rompack';
import type { LuaChunk } from '../../src/bmsx/lua/lua_ast';
import { atlasIndexResolver, createOptimizedAtlas, generateAtlasName } from './atlasbuilder';
import { BoundingBoxExtractor } from './boundingbox_extractor';
import { loadGLTFModel } from './gltfloader';
import type { AtlasResource, ImageResource, Resource, resourcetype, RomPackerTarget } from './rompacker.rompack';
// @ts-ignore
const { build } = require('esbuild');
// @ts-ignore
const { spawnSync } = require('child_process');
// @ts-ignore
const { join, parse, relative, resolve, sep } = require('path');

// @ts-ignore
const { access, mkdir, readdir, readFile, stat, writeFile, unlink, copyFile } = require('fs/promises');
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
const { encodeBinary, decodeBinary } = require('../../src/bmsx/serializer/binencoder');
// @ts-ignore
const { LuaLexer } = require('../../src/bmsx/lua/lualexer');
// @ts-ignore
const { LuaParser } = require('../../src/bmsx/lua/luaparser');
// @ts-ignore
const { compileLuaChunkToProgram } = require('../../src/bmsx/vm/program_compiler');
// @ts-ignore
const { VM_PROGRAM_ASSET_ID, buildModuleAliasesFromPaths, encodeProgramAsset } = require('../../src/bmsx/vm/vm_program_asset');
// @ts-ignore
const pako = require('pako');
// @ts-ignore
const minify = require('@node-minify/core');
// @ts-ignore
const cleanCSS = require('@node-minify/clean-css');
// @ts-ignore
const { loadImage } = require('canvas');
// @ts-ignore
const yaml = require('js-yaml');
// @ts-ignore
const { createHash } = require('crypto');

type ProgressNote = (message: string) => void;

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

const BOILERPLATE_RESOURCE_ID_BITMAP = `export enum BitmapId {
	none = 'none',`; // Note: cannot use const enums here, because BFont uses BitmapId as a type (and const enums are not available at runtime)

const BOILERPLATE_RESOURCE_ID_AUDIO = `export enum AudioId {
	none = 'none',`;

const BOILERPLATE_RESOURCE_ID_DATA = `export enum DataId {
	none = 'none',`;

const BOILERPLATE_RESOURCE_ID_MODEL = `export enum ModelId {
	none = 'none',`;

const BOILERPLATE_RESOURCE_ID_LUA = `export enum LuaId {
	none = 'none',`;

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
const DEFAULT_CART_BOOTLOADER_SEGMENT = 'src/bmsx/vm/default_cart';

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
		try {
			return JSON.parse(res) as RomManifest;
		} catch {
			return yaml.load(res) as RomManifest;
		}
	}
	else return null;
}

/**
 * Builds and bundles the source code for a ROM using esbuild.
 * @param {string} romname - The name of the ROM.
 * @param {string} bootloader_path - The path to the bootloader file.
 * @returns {Promise<any>} A promise that resolves when the ROM source code has been built and bundled.
 */
export async function esbuild(romname: string, bootloader_path: string, debug: boolean, tsconfigProjectOverride?: string): Promise<void> {
	const bootloader_ts_path = `${bootloader_path}/bootloader.ts`;
	// Prefer the game's tsconfig.json if present to ensure path mappings (e.g. "bmsx") resolve correctly
	const tsconfigPath = (() => {
		const fs = require('fs');
		try {
			if (tsconfigProjectOverride) {
				const p0 = tsconfigProjectOverride.startsWith('.') || tsconfigProjectOverride.startsWith('src/')
					? join(process.cwd(), tsconfigProjectOverride)
					: tsconfigProjectOverride;
				fs.accessSync(p0);
				return p0;
			}
			const p = join(process.cwd(), bootloader_path, 'tsconfig.json');
			fs.accessSync(p);
			// If the tsconfig extends another file, make sure that file exists to avoid esbuild errors
			const raw = fs.readFileSync(p, 'utf8');
			try {
				const json = JSON.parse(raw);
				if (typeof json.extends === 'string') {
					const base = json.extends.startsWith('.') || json.extends.startsWith('..')
						? join(process.cwd(), bootloader_path, json.extends)
						: json.extends;
					try { fs.accessSync(base); } catch { return undefined; }
				}
			} catch { /* ignore JSON parse errors; let esbuild decide */ }
			return p;
		} catch { return undefined; }
	})();
	const define = {
		'process.env.NODE_ENV': debug ? '"development"' : '"production"',
	};
	if (debug) {
		await build({
			entryPoints: [bootloader_ts_path], // Entry point for the rompack
			bundle: true, // Bundle all dependencies into a single file
			sourcemap: 'inline', // Include inline source maps for debugging
			sourcesContent: true,
			footer: {
				js: `\n//# sourceURL=${romname}.debug.rom`,
			},
			outfile: `./rom/${romname}.js`, // Output file for the bundled code
			platform: 'browser', // Target platform for the bundle
			target: 'es2024', // Specify the ECMAScript version to target
			// Specify the ECMAScript version to target
			loader: { '.glsl': 'text' }, // Handles GLSL files as text
			plugins: [glsl({ minify: true })],
			tsconfig: tsconfigPath,
			define,
			minify: false,
			keepNames: true,
			external: ['ts-key-enum'],
			treeShaking: true,
			logLevel: 'silent',
		});
	}
	else {
		await build({
			entryPoints: [bootloader_ts_path], // Entry point for the rompack
			bundle: true, // Bundle all dependencies into a single file
			sourcemap: false,
			sourcesContent: false,
			outfile: `./rom/${romname}.js`, // Output file for the bundled code
			platform: 'browser', // Target platform for the bundle
			target: 'es2024', // Specify the ECMAScript version to target
			// Specify the ECMAScript version to target
			loader: { '.glsl': 'text' }, // Handles GLSL files as text
			plugins: [glsl({ minify: true })],
			tsconfig: tsconfigPath,
			define,
			minify: true,
			keepNames: true,
			external: ['ts-key-enum'],
			treeShaking: true,
			logLevel: 'silent',
		});
	}
	return null;
}

export async function buildEngineRuntime(options: { debug: boolean }): Promise<void> {
	const { debug } = options;
	await mkdir('./rom', { recursive: true });
	await build({
		entryPoints: ['./src/bmsx/vm/engine_entry.ts'],
		bundle: true,
		platform: 'browser',
		format: 'iife',
		target: 'es2020',
		outfile: './rom/engine.js',
		keepNames: true,
		minify: !debug,
		sourcemap: debug ? 'inline' : false,
		sourcesContent: debug,
		define: {
			'process.env.NODE_ENV': debug ? '"development"' : '"production"',
		},
		plugins: [
			glsl({ minify: !debug }),
		],
		loader: {
			'.png': 'dataurl',
			'.glsl': 'text',
			'.json': 'json',
			'.html': 'text',
		},
	});
	await mkdir('./dist', { recursive: true });
	await copyFile('./rom/engine.js', './dist/engine.js');
}

/**
 * Type-check the engine and the selected game without emitting files.
 * Aborts on first error.
 */
export function typecheckBeforeBuild(
	bootloader_path: string,
	emitOutput: (text: string) => void,
	gameProjectOverride?: string,
): void {
	// Resolve local TypeScript CLI entry
	let tscBin: string;
	try {
		// @ts-ignore
		tscBin = require.resolve('typescript/bin/tsc');
	} catch {
		throw new Error('TypeScript is not installed locally. Install it with: npm i -D typescript');
	}

	const run = (projectPath: string, label: string) => {
		const args = [tscBin, '-p', projectPath, '--noEmit'];
		const res = spawnSync(process.execPath, args, { stdio: 'pipe', encoding: 'utf8' });
		emitOutput(res.stdout ?? res.stderr); // Emit either stdout or stderr. Also note that `emitOutput` already handles undefined strings
		if (res.status !== 0) {
			throw new Error(`Type-check failed for ${label} (project: ${projectPath}).`);
		}
	};

	const fs = require('fs');
	const engineProject = 'src/bmsx/tsconfig.json';
	fs.accessSync(engineProject);
	run(engineProject, 'engine');

	const gameTsconfig = gameProjectOverride
		? (gameProjectOverride.startsWith('.') || gameProjectOverride.startsWith('src/')
			? join(process.cwd(), gameProjectOverride)
			: gameProjectOverride)
		: join(process.cwd(), bootloader_path, 'tsconfig.json');
	try {
		fs.accessSync(gameTsconfig);
	} catch {
		// No per-game tsconfig.json; skip
		return;
	}
	run(gameTsconfig, 'game');
}

/** Type-check the game against a provided directory of engine declaration files. */
export function typecheckGameWithDts(
	bootloader_path: string,
	dtsDir: string,
	emitOutput: (text: string) => void,
	baseProjectOverride?: string
): void {
	let tscBin: string;
	try { tscBin = require.resolve('typescript/bin/tsc'); }
	catch { throw new Error('TypeScript is not installed locally. Install it with: npm i -D typescript'); }

	const fs = require('fs');
	const path = require('path'); // Prefer the game's tsconfig.json if present to ensure path mappings (e.g. "bmsx") resolve correctly

	const gameTsconfig = (() => { // Try to locate the game's tsconfig.json if present (cart games don't always have one)
		try {
			const p = path.join(process.cwd(), bootloader_path, 'tsconfig.json');
			fs.accessSync(p);
			return p;
		} catch { return undefined; }
	})();

	const bootloaderIdRaw = bootloader_path ? path.basename(bootloader_path) : 'game';
	const bootloaderId = bootloaderIdRaw.replace(/[^a-zA-Z0-9_-]/g, '_') || 'game';
	const tmpCfg = path.join(process.cwd(), 'rom', '_ignore', `tsconfig.game.with.dts.${bootloaderId}.json`);
	const extendsPath = (baseProjectOverride
		? ((baseProjectOverride.startsWith('.') || baseProjectOverride.startsWith('src/'))
			? path.join(process.cwd(), baseProjectOverride)
			: baseProjectOverride)
		: gameTsconfig) ?? path.join(process.cwd(), 'tsconfig.base.json');
	const cfg = {
		extends: path.relative(path.dirname(tmpCfg), extendsPath),
		compilerOptions: {
			noEmit: true,
			baseUrl: '.',
			paths: {
				bmsx: [path.relative(path.dirname(tmpCfg), path.join(dtsDir, 'index.d.ts'))],
				'bmsx/*': [path.relative(path.dirname(tmpCfg), path.join(dtsDir, '*'))]
			}
		},
		include: [path.join(bootloader_path, '**/*.ts')]
	};
	const dir = path.dirname(tmpCfg);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(tmpCfg, JSON.stringify(cfg, null, 2));

	const res = spawnSync(process.execPath, [tscBin, '-p', tmpCfg], { stdio: 'pipe', encoding: 'utf8' });
	emitOutput(res.stdout ?? res.stderr); // Emit either stdout or stderr. Also note that `emitOutput` already handles undefined strings
	if (res.status !== 0) {
		const reason = 'Type-check with engine declarations failed.';
		throw new Error(reason);
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
export async function buildGameHtmlAndManifest(rom_name: string, title: string, short_name: string, debug: boolean): Promise<any> {
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
		const replacements = {
			'//#bootromjs': romjs,
			'//#zipjs': zipjs,
			'/*#css*/': cssMinified,
			'#title': title,
			'//#debug': `bootrom.debug = ${debug};\n\t\tbootrom.romname = getRomNameFromUrlParameter() ?? '${rom_name}';\n`,
			'#outfile': `${rom_name}.${debug ? 'debug.' : ''}rom`,
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

	return new Promise<any>((resolve, reject) => {
		minify({
			compressor: cleanCSS,
			input: "./gamebase.css",
			output: "./rom/gamebase.min.css",
			callback: async (err: any, cssMinified: string) => {
				if (!cssMinified) {
					return reject(err);
				}

				try {
					const transformedHtml = await transformHtml(html, cssMinified, debug);
					await writeFile(`./dist/game${debug ? '_debug' : ''}.html`, transformedHtml);

					// Update the manifest.json-file that is used for app-versions of the webpage
					const manifest = (await readFile("./rom/manifest.json", 'utf8')).replace('#title', title).replace('#short_name', short_name);

					// Write updated manifest to dist-folder
					await writeFile("./dist/manifest.webmanifest", manifest);

					resolve(null);
				} catch (error) {
					reject(error);
				}
			}
		});
	});
}

/**
 * Parses the metadata of an audio file from its filename.
 * @param {string} filename - The name of the audio file.
 * @returns {Object} An object containing the sanitized name of the audio file and its metadata.
 */
export function parseAudioMeta(filename: string) {
	const priorityregex = /@p\=\d+/;
	const priorityresult = priorityregex.exec(filename);
	const prioritystr = priorityresult ? priorityresult[0] : undefined;
	const priority = prioritystr ? parseInt(prioritystr.slice(3)) : 0;

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
	targetAtlas?: number,
	skipAtlas?: boolean,
} {
	// Match @cc or @cx for collision type, and @atlas=n for atlas assignment (order-insensitive)
	const collisionMatch = filenameWithoutExt.match(/@(cc|cx)/i);
	let collisionType: 'concave' | 'convex' | 'aabb' = 'aabb';
	if (collisionMatch) {
		const code = collisionMatch[1].toLowerCase();
		collisionType = code === 'cc' ? 'concave' : code === 'cx' ? 'convex' : 'aabb';
	}
	const skipAtlas = /@noatlas/i.test(filenameWithoutExt);
	let targetAtlas = undefined;
	if (!skipAtlas && GENERATE_AND_USE_TEXTURE_ATLAS && DONT_PACK_IMAGES_WHEN_USING_ATLAS) {
		const atlasMatch = filenameWithoutExt.match(/@atlas=(\d+)/i);
		targetAtlas = atlasMatch ? parseInt(atlasMatch[1], 10) : undefined;
	}

	// Remove all @cc, @cx, and @atlas=n (in any order)
	const sanitizedName = filenameWithoutExt
		.replace(/@(cc|cx)/ig, '')
		.replace(/@atlas=\d+/ig, '')
		.replace(/@noatlas/ig, '');

	return { sanitizedName, collisionType, targetAtlas, skipAtlas };
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

function compileLuaChunkBuffer(source: string, path: string): Buffer {
	const lexer = new LuaLexer(source, path, { canonicalizeIdentifiers: LUA_CANONICALIZATION });
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
			type = 'audio';
			break;
		case '.js':
			type = 'code';
			break;
		case '.atlas': // `.atlas`-files don't exist. We use this to add the atlas to the resource list
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
	includeCode?: boolean;
	extraLuaPaths?: string[];
	virtualRoot?: string;
	resolveAtlasIndex?: boolean;
};


function isWorkspaceStateDirectory(name: string): boolean {
	return name.toLowerCase() === WORKSPACE_STATE_DIR_NAME;
}

export async function getResMetaList(respaths: string[], romname?: string, options: ResourceScanOptions = {}): Promise<Resource[]> {
	const EXTRA_LUA_SCAN_SKIP = new Set<string>([
		'.git',
		'.svn',
		'.hg',
		'.cache',
		'node_modules',
		'dist',
		'build',
		'out',
		'rom',
		'res',
	]);

	EXTRA_LUA_SCAN_SKIP.add(WORKSPACE_STATE_DIR_NAME);
	const arrayOfFiles: string[] = [];
	const virtualRoot = normalizeVirtualRootPath(options.virtualRoot);
	const cartProject = isCartPath(virtualRoot) || respaths.some(isCartPath);
	const includeCode = options.includeCode !== false && !cartProject;
	const scanRoots = cartProject
		? respaths.filter(path => !isEngineResPath(path))
		: respaths;
	const extraLuaRoots = options.extraLuaPaths ?? [];
	const seenPaths = new Set<string>();

	const pushFile = (filepath: string) => {
		const normalized = resolve(filepath);
		if (seenPaths.has(normalized)) return;
		seenPaths.add(normalized);
		arrayOfFiles.push(filepath);
	};

	for (const respath of scanRoots) {
		const files = await getFiles(respath) ?? [];
		for (const file of files) {
			pushFile(file);
		}
	}

	async function appendLuaFilesFromRoot(root: string): Promise<void> {
		let entries: import('fs').Dirent[];
		try {
			entries = await readdir(root, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (EXTRA_LUA_SCAN_SKIP.has(entry.name.toLowerCase()) || isWorkspaceStateDirectory(entry.name)) continue;
			const entryPath = join(root, entry.name);
			if (entry.isDirectory()) {
				await appendLuaFilesFromRoot(entryPath);
			} else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lua')) {
				pushFile(entryPath);
			}
		}
	}

	for (const luaRoot of extraLuaRoots) {
		if (!luaRoot || luaRoot.length === 0) continue;
		await appendLuaFilesFromRoot(luaRoot);
	}

	const megarom_filename = `${romname}.js`;
	// Note that romname can be undefined when building the resource enum file, so we only add the file if romname is defined
	if (romname && includeCode) {
		pushFile(`./rom/${megarom_filename}`);
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
	let codeFileCount = 0;
	for (let i = 0; i < arrayOfFiles.length; i++) {
		const filepath = arrayOfFiles[i];
		const meta = getResMetaByFilename(filepath);

		const type = meta.type;
		if (type === 'code' && !includeCode) {
			continue;
		}
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
				let targetAtlasIndex = imgMeta.skipAtlas ? undefined : imgMeta.targetAtlas;
				if (!imgMeta.skipAtlas && options.resolveAtlasIndex === true) {
					const resolvedIndex = atlasIndexResolver(filepath, targetAtlasIndex);
					// Accept 0 as a valid atlas index;
					if (typeof resolvedIndex === 'number') {
						imgMeta.targetAtlas = resolvedIndex;
						targetAtlasIndex = resolvedIndex;
					}
				}
				// If we are generating and using texture atlases, we need to add the image to the atlas.
				if (GENERATE_AND_USE_TEXTURE_ATLAS && DONT_PACK_IMAGES_WHEN_USING_ATLAS && !imgMeta.skipAtlas) {
					if (imgMeta.targetAtlas !== undefined) {
						targetAtlasIdSet.add(imgMeta.targetAtlas);
					}
				}
				result.push({
					filepath,
					name,
					ext,
					type,
					id: imgid,
					collisionType: imgMeta.collisionType,
					targetAtlasIndex,
					sourcePath,
					skipAtlas: imgMeta.skipAtlas,
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
			case 'code':
				result.push({ filepath, name, ext, type, id: 1, sourcePath });
				codeFileCount += 1;
				break;
			case 'data':
			case 'aem': // AEM files are added to the data asset list
				// For data files, we use the name as is
				result.push({ filepath, name, ext, type, id: dataid, datatype: meta.datatype, sourcePath });
				++dataid;
				break;
			case 'lua':
				// For Lua files, we also determine the current datetime to allow the workspace to detect changes and choosing which source to regard as newer
				result.push({ filepath, name, ext, type, id: luaid, sourcePath, update_timestamp: meta.update_timestamp });
				++luaid;
				break;
			case 'model':
				result.push({ filepath, name, ext, type, id: modelid, datatype: meta.datatype, sourcePath });
				++modelid;
				break;
			case 'atlas':
				// Atlas files are not real files, but we add them to the resource list in the next step
				break;
		}
	}

	// Ensure the default atlas (index 0) is always present when atlases are generated and packed.
	if (GENERATE_AND_USE_TEXTURE_ATLAS && DONT_PACK_IMAGES_WHEN_USING_ATLAS) {
		targetAtlasIdSet.add(0);
	}
	// If we are generating and using texture atlases, we need to add the atlasses to the resource list
	// @ts-ignore
	for (const id of Array.from(targetAtlasIdSet).sort((a, b) => a - b)) {
		const name = generateAtlasName(id);
		result.push({ filepath: undefined, name, ext: '.atlas', type: 'atlas', id: imgid++, atlasid: id });
	}

	if (codeFileCount > 1) {
		throw new Error(`Expected a single ROM source bundle, but found ${codeFileCount}. Ensure only one generated "${romname}.js" exists.`);
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

type LuaCaseState =
	| { kind: 'normal' }
	| { kind: 'shortString'; delimiter: '\'' | '"'; escaped: boolean }
	| { kind: 'lineComment' }
	| { kind: 'longString'; closing: string }
	| { kind: 'longComment'; closing: string };

type LuaLongBracketMatch = { length: number; closing: string };

function matchLuaLongBracket(source: string, start: number): LuaLongBracketMatch {
	if (source.charCodeAt(start) !== 91) {
		return null;
	}
	const length = source.length;
	let index = start + 1;
	let equalsCount = 0;
	while (index < length && source.charCodeAt(index) === 61) {
		equalsCount += 1;
		index += 1;
	}
	if (index >= length || source.charCodeAt(index) !== 91) {
		return null;
	}
	const openingLength = index - start + 1;
	const closing = `]${'='.repeat(equalsCount)}]`;
	return { length: openingLength, closing };
}

function changeCasingLuaSourceExceptStrings(source: string): string {
	if (source.length === 0) {
		return source;
	}
	const builder: string[] = [];
	const changeCasing = (text: string) => {
		switch (LUA_CANONICALIZATION) {
			case 'none':
				return text;
			case 'upper':
				return text.toUpperCase();
			case 'lower':
				return text.toLowerCase();
		}
	};
	let state: LuaCaseState = { kind: 'normal' };
	let index = 0;
	while (index < source.length) {
		const current = source.charAt(index);
		switch (state.kind) {
			case 'shortString': {
				builder.push(current);
				index += 1;
				if (!state.escaped) {
					if (current === '\\') {
						state = { kind: 'shortString', delimiter: state.delimiter, escaped: true };
						break;
					}
					if (current === state.delimiter) {
						state = { kind: 'normal' };
					}
					break;
				}
				state = { kind: 'shortString', delimiter: state.delimiter, escaped: false };
				break;
			}
			case 'longString': {
				if (source.startsWith(state.closing, index)) {
					builder.push(state.closing);
					index += state.closing.length;
					state = { kind: 'normal' };
					break;
				}
				builder.push(current);
				index += 1;
				break;
			}
			case 'longComment': {
				if (source.startsWith(state.closing, index)) {
					builder.push(state.closing);
					index += state.closing.length;
					state = { kind: 'normal' };
					break;
				}
				builder.push(changeCasing(current));
				index += 1;
				break;
			}
			case 'lineComment': {
				builder.push(changeCasing(current));
				index += 1;
				if (current === '\n' || current === '\r') {
					state = { kind: 'normal' };
				}
				break;
			}
			default: {
				if (current === '\'' || current === '"') {
					builder.push(current);
					index += 1;
					state = { kind: 'shortString', delimiter: current as '\'' | '"', escaped: false };
					break;
				}
				if (current === '-' && index + 1 < source.length && source.charAt(index + 1) === '-') {
					builder.push('-');
					builder.push('-');
					index += 2;
					if (index < source.length && source.charAt(index) === '[') {
						const longComment = matchLuaLongBracket(source, index);
						if (longComment) {
							builder.push(source.slice(index, index + longComment.length));
							index += longComment.length;
							state = { kind: 'longComment', closing: longComment.closing };
							break;
						}
					}
					state = { kind: 'lineComment' };
					break;
				}
				if (current === '[') {
					const longString = matchLuaLongBracket(source, index);
					if (longString) {
						builder.push(source.slice(index, index + longString.length));
						index += longString.length;
						state = { kind: 'longString', closing: longString.closing };
						break;
					}
				}
				builder.push(changeCasing(current));
				index += 1;
				break;
			}
		}
	}
	return builder.join('');
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
		const buffer = meta.filepath ? await readFile(meta.filepath) : undefined;
		switch (meta.type) {
			case 'image': {
				if (!buffer) {
					throw new Error(`Image resource "${meta.name}" is missing its binary payload.`);
				}
				const img = await getImageFromBuffer(buffer);
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
				return {
					...meta,
					buffer,
				};
			case 'lua': {
				if (!buffer) {
					throw new Error(`[RomPacker] Lua resource "${meta.name}" is missing its source file payload.`);
				}
				if (!LUA_CANONICALIZATION) {
					return {
						...meta,
						buffer,
					};
				}
				const source = buffer.toString('utf8');
				const uppercased = changeCasingLuaSourceExceptStrings(source);
				const upperBuffer = Buffer.from(uppercased, 'utf8');
				return {
					...meta,
					buffer: upperBuffer,
				};
			}
			default:
				return {
					...meta,
					buffer,
				};
		}
	});

	resources = await Promise.all(resourcePromises);

	return resources;
}

/**
 * Builds a list of resources located at `respaths` for the specified `romname`.
 * @param respaths An array of the paths to the resources to include in the list.
 * @param rom_name The name of the ROM pack to build the list for.
 */
export async function buildResourceList(respaths: string[], rom_name?: string, options?: ResourceScanOptions): Promise<void> {
	const tsimgout = new Array<string>();
	const tssndout = new Array<string>();
	const tsdataout = new Array<string>();
	const tsmodelout = new Array<string>();
	const tsluaout = new Array<string>();

	const metalist: Resource[] = await getResMetaList(respaths, rom_name, options);

	tsimgout.push(BOILERPLATE_RESOURCE_ID_BITMAP);
	tssndout.push(BOILERPLATE_RESOURCE_ID_AUDIO);
	tsdataout.push(BOILERPLATE_RESOURCE_ID_DATA);
	tsmodelout.push(BOILERPLATE_RESOURCE_ID_MODEL);
	tsluaout.push(BOILERPLATE_RESOURCE_ID_LUA);

	for (let i = 0; i < metalist.length; i++) {
		const current = metalist[i];

		const type = current.type;
		const name = current.name;
		const enum_member_to_add = `\t${name} = '${name}', `;
		switch (type) {
			case 'image':
			case 'atlas': // Atlas is also an image and thus is added to the image enum
				tsimgout.push(`${enum_member_to_add} `);
				break;
			case 'audio':
				tssndout.push(`${enum_member_to_add} `);
				break;
			case 'data':
				tsdataout.push(`${enum_member_to_add} `);
				break;
			case 'lua':
				tsluaout.push(`${enum_member_to_add} `);
				break;
			case 'model':
				tsmodelout.push(`${enum_member_to_add} `);
				break;
			case 'romlabel':
				// Ignore this part
				break;
			default:
				// Ignore unknown resource types
				break;
		}
	}

	tsimgout.push("}\n");
	tssndout.push("}\n");
	tsdataout.push("}\n");
	tsmodelout.push("}\n");
	tsluaout.push("}\n");

	const total_output: string = tsimgout.concat(tssndout, tsdataout, tsmodelout, tsluaout).join('\n');

	const targetPath = respaths[0].replace('/res', '/resourceids.ts');
	await writeFile(targetPath, total_output);
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
				const imgmeta = buildImgMeta(res);
				let baseAsset: RomAsset;
				if (GENERATE_AND_USE_TEXTURE_ATLAS && DONT_PACK_IMAGES_WHEN_USING_ATLAS) {
					// Preserve raw image buffer for images explicitly marked to skip atlas (@noatlas)
					const keepOriginal = !!(res as any).skipAtlas;
					baseAsset = { resid, type, imgmeta, buffer: keepOriginal ? buffer : undefined, source_path: sourcePath };
				} else {
					baseAsset = { resid, type, imgmeta, buffer, source_path: sourcePath };
				}
				romAssets.push({ ...baseAsset, });
			}
				break;
			case 'audio':
				// Note that the name has already been sanitized in the `getResMetaList` function
				const { audiometa } = parseAudioMeta(res.filepath);
				romAssets.push({ resid, type, audiometa, buffer, source_path: sourcePath });
				break;
			case 'code':
				resid = resid.replace('.min', '');
				romAssets.push({ resid, type, buffer, source_path: sourcePath });
				break;
			case 'lua': {
				if (!res.filepath || res.filepath.length === 0) {
					throw new Error(`[RomPacker] Lua resource "${resid}" is missing its source file path.`);
				}
				const luaSourcePath = sourcePath && sourcePath.length > 0 ? sourcePath : toWorkspaceRelativePath(res.filepath);
				const normalizedPath = normalizeWorkspacePath(luaSourcePath);
				const compiled_buffer = compileLuaChunkBuffer(buffer.toString('utf8'), normalizedPath);
				romAssets.push({
					resid,
					type,
					buffer,
					compiled_buffer,
					source_path: normalizedPath,
					normalized_source_path: normalizedPath,
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
				const ext = (pathInfo.ext || '').toLowerCase();
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
	return romAssets;
}

export function appendVmProgramAsset(assetList: RomAsset[], manifest: RomManifest): void {
	if (!manifest || !manifest.lua || !manifest.lua.entry_path) {
		throw new Error('[RomPacker] Manifest is missing lua.entry_path; cannot build VM program asset.');
	}
	const entryPath = manifest.lua.entry_path;
	if (assetList.some(asset => asset.resid === VM_PROGRAM_ASSET_ID)) {
		throw new Error(`[RomPacker] VM program asset id '${VM_PROGRAM_ASSET_ID}' already exists in asset list.`);
	}
	const luaAssets = assetList.filter(asset => asset.type === 'lua');
	if (luaAssets.length === 0) {
		throw new Error('[RomPacker] No Lua assets found; cannot build VM program asset.');
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
		const decoded = decodeBinary(new Uint8Array(asset.compiled_buffer)) as LuaChunk;
		const path = asset.normalized_source_path ?? asset.source_path;
		chunksByPath.set(path, decoded);
		modulePaths.push(path);
		if (asset === entryAsset) {
			entryChunk = decoded;
		}
	}

	const modules: Array<{ path: string; chunk: LuaChunk }> = [];
	for (const asset of luaAssets) {
		if (asset === entryAsset) {
			continue;
		}
		const path = asset.normalized_source_path ?? asset.source_path;
		const chunk = chunksByPath.get(path);
		modules.push({ path, chunk });
	}

	const compiled = compileLuaChunkToProgram(entryChunk, modules);
	const program = compiled.program;
	const programAsset = {
		entryProtoIndex: compiled.entryProtoIndex,
		program: {
			code: new Uint8Array(program.code.buffer, program.code.byteOffset, program.code.byteLength),
			constPool: program.constPool,
			protos: program.protos,
			debugRanges: program.debugRanges,
			protoIds: program.protoIds,
		},
		moduleProtos: Array.from(compiled.moduleProtoMap.entries(), ([path, protoIndex]) => ({ path, protoIndex })),
		moduleAliases: buildModuleAliasesFromPaths(modulePaths),
	};

	const buffer = Buffer.from(encodeProgramAsset(programAsset));
	assetList.push({
		resid: VM_PROGRAM_ASSET_ID,
		type: 'data',
		buffer,
		source_path: VM_PROGRAM_ASSET_ID,
	});
}

/**
 * Generates metadata for an image resource, optionally integrating texture atlas data.
 *
 * @param res - The resource containing the image and any existing metadata.
 * @param generated_atlas - An optional canvas element where an atlas has been generated.
 * @returns An object containing image dimensions, bounding boxes, center point, and (if atlas usage is enabled) texture coordinates.
 */
export function buildImgMeta(res: ImageResource): ImgMeta {
	const img = res.img;
	if (!img) {
		throw new Error(`Image resource "${res.name}" is missing its decoded image data.`);
	}
	const img_boundingbox = BoundingBoxExtractor.extractBoundingBox(img);
	let extracted_hitpolygon: Polygon[] = undefined;
	let hitpolygons: {
		original: Polygon[],
		fliph: Polygon[],
		flipv: Polygon[],
		fliphv: Polygon[]
	} = undefined;
	switch (res.collisionType) {
		case 'concave':
			extracted_hitpolygon = BoundingBoxExtractor.extractConcaveHull(img);//, { thicken: 1, closeGaps: true });
			// Decompose to convex pieces (triangles) at pack time
			extracted_hitpolygon = BoundingBoxExtractor.decomposeConcaveToConvex(extracted_hitpolygon, res);
			hitpolygons = {
				original: extracted_hitpolygon,
				fliph: null,
				flipv: null,
				fliphv: null
			};
			break;
		case 'convex':
			extracted_hitpolygon = [BoundingBoxExtractor.extractConvexHull(img)].filter(p => (p?.length ?? 0) >= 6);
			hitpolygons = {
				original: extracted_hitpolygon,
				fliph: null,
				flipv: null,
				fliphv: null
			};
			break;
		case 'aabb':
			// No hit polygon, use bounding box instead
			break;
	}
	// const img_boundingbox_precalc = BoundingBoxExtractor.generateFlippedBoundingBox(img, img_boundingbox);
	const img_centerpoint = BoundingBoxExtractor.calculateCenterPoint(img_boundingbox);

	let imgmeta: ImgMeta = {
		atlassed: false,
		atlasid: null,
		width: img.width,
		height: img.height,
		boundingbox: { original: img_boundingbox, fliph: null, flipv: null, fliphv: null },
		centerpoint: img_centerpoint,
		hitpolygons: hitpolygons
	};
	if (GENERATE_AND_USE_TEXTURE_ATLAS) {
		const targetAtlas = res.targetAtlasIndex;
		const texcoords = res.atlasTexcoords;
		imgmeta = {
			...imgmeta,
			atlassed: targetAtlas !== undefined,
			atlasid: targetAtlas,
			texcoords: texcoords ? [...texcoords] : undefined,
		};
	}
	return imgmeta;
}

export function buildImgMetaForAtlas(res: AtlasResource): ImgMeta {
	return {
		atlassed: false,
		atlasid: res.atlasid, // Use the atlas ID from the base resource
		width: res.img.width,
		height: res.img.height,
	};
}

/**
 * Generates texture atlases from the loaded image resources and updates the corresponding atlas resources.
 *
 * @param resources - An array of resources, including the atlas to be processed.
 * @param generated_atlas - The HTMLCanvasElement representing the generated atlas image.
 * @param assetList - An array of RomAsset objects to be updated with image metadata.
 * @param bufferPointer - The starting position where atlas data should be written in the output buffers.
 * @param buffers - An array of Buffers where the atlas image data will be appended.
 * @returns A Promise that resolves once the atlas image is written to disk and metadata is updated.
 */
export async function createAtlasses(resources: Resource[], reportProgress?: ProgressNote) {
	if (GENERATE_AND_USE_TEXTURE_ATLAS) {
		const atlasses = resources.filter((res): res is AtlasResource => res.type === 'atlas');
		if (atlasses.length === 0) throw new Error('No atlas resources found in the "resources"-list. The process of preparing the list of all resources (assets) should also add any atlasses that are to be generated. Thus, this is a bug in the code that prepares the list of resources :-(');
		// Determine the indexes of atlasses to be generated
		for (const atlas of atlasses) {
			const image_assets = resources.filter((resource): resource is ImageResource => resource.type === 'image');
			const filteredImages = image_assets.filter(resource => resource.targetAtlasIndex === atlas.atlasid);
			reportProgress?.(`atlas ${atlas.name} (${filteredImages.length} images)`);
			const atlasCanvas = createOptimizedAtlas(filteredImages);
			if (!atlasCanvas) throw new Error(`Failed to create texture atlas for ${atlas.name}.`);
			atlas.img = atlasCanvas; // Store the canvas in the resource (to extract the image properties later during `processResources`)
			atlas.buffer = atlasCanvas.toBuffer('image/png'); // Convert canvas to PNG buffer
			reportProgress?.(`write atlas ${atlas.name}`);
			await writeFile(`./rom/_ignore/${generateAtlasName(atlas.atlasid)}.png`, atlas.buffer);
		}
	}
	else {
		throw new Error('No images found to generate texture atlas from. Please ensure you have images in your resource directory.');
	}
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
	debug: boolean,
	options: { projectRootPath?: string, status?: ProgressNote, manifest?: RomManifest } = {}
) {
	const outfileBasename = `${rom_name}${debug ? '.debug' : ''}.rom`;
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

	const writeBuffer = async (payload: Buffer) => {
		if (!payload || payload.length === 0) return;
		const ok = writer.write(payload);
		offset += payload.length;
		if (!ok) {
			await once(writer, 'drain');
		}
	};

	try {
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
			const perMeta = asset.imgmeta ?? asset.audiometa;
			if (perMeta) {
				status?.(`meta ${asset.type}:${asset.resid}`);
				const encoded = Buffer.from(encodeBinary(perMeta));
				asset.metabuffer_start = offset;
				asset.metabuffer_end = offset + encoded.length;
				await writeBuffer(encoded);
			}
			delete asset.imgmeta;
			delete asset.audiometa;
			delete asset.buffer;
			delete asset.compiled_buffer;
			delete asset.texture_buffer;
		}

		status?.('encode manifest');
		const metadataPayload: RomAssetListPayload = {
			assets: assetList,
			projectRootPath: options.projectRootPath,
			manifest: options.manifest,
		};
		const metadataBuffer = Buffer.from(encodeBinary(metadataPayload));
		const globalMetadataOffset = offset;
		const globalMetadataLength = metadataBuffer.length;
		await writeBuffer(metadataBuffer);

		status?.('write footer');
		const footer = Buffer.alloc(16);
		footer.writeBigUInt64LE(BigInt(globalMetadataOffset), 0);
		footer.writeBigUInt64LE(BigInt(globalMetadataLength), 8);
		await writeBuffer(footer);
	} finally {
		writer.end();
	}

	await finished(writer);
	const romBinary = await readFile(tempFile);
	const compressed = Buffer.from(zip(romBinary));
	const finalPayload = romlabelBuffer
		? Buffer.concat([romlabelBuffer, compressed])
		: compressed;

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
 * @throws {Error} Will throw if the romloader file does not exist or if compilation fails.
 * @returns {Promise<void>} A promise that resolves once the compilation process is complete
 *                         or if no action is needed.
 */
export interface BootromBuildOptions {
	debug: boolean;
	forceBuild: boolean;
	platform: RomPackerTarget;
	romName: string;
	canonicalization: CanonicalizationType;
}

async function buildBrowserBootrom(options: { debug: boolean; forceBuild: boolean; canonicalization: CanonicalizationType; }): Promise<void> {
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

	const define = {
		'__BOOTROM_CANONICALIZATION__': JSON.stringify(options.canonicalization),
	};

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
		define,
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

	if (!rebuild) return;

	try {
		await mkdir(join(process.cwd(), 'dist'), { recursive: true });
	} catch {
		// Ignore errors; directory may already exist or be created elsewhere
	}

	const define = {
		'__BOOTROM_TARGET__': JSON.stringify(options.platform),
		'__BOOTROM_ROM_NAME__': JSON.stringify(options.romName),
		'__BOOTROM_DEBUG__': options.debug ? 'true' : 'false',
		'__BOOTROM_CANONICALIZATION__': JSON.stringify(options.canonicalization),
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
		await buildBrowserBootrom({ debug: options.debug, forceBuild: options.forceBuild, canonicalization: options.canonicalization });
		return;
	}
	if (options.platform === 'cli' || options.platform === 'headless') {
		await buildNodeBootrom(options);
		return;
	}
	throw new Error(`Unsupported platform "${options.platform}" when building bootrom script.`);
}

export const codeFileExtensions = ['.ts', '.glsl', '.js', '.jsx', '.tsx', '.html', '.css', '.json', '.xml', '.lua'];

export const isCodeFile = (filename: string) => codeFileExtensions.some(extension => filename.endsWith(extension));
export const shouldCheckFile = (filename: string, checkCodeFiles: boolean, checkAssets: boolean) => (checkCodeFiles && isCodeFile(filename)) || checkAssets;

/**
 * Determines whether a rebuild of the ROM is required based on the modification times of the bootloader and resource files.
 * @param {string} romname - The name of the ROM.
 * @param {string} bootloaderPath - The path to the bootloader files.
 * @param {string} resPath - The path to the resource files.
 * @returns {Promise<boolean>} A Promise that resolves with a boolean indicating whether a rebuild is required.
 */
export async function isRebuildRequired(romname: string, bootloaderPath: string, resPath: string, options: ResourceScanOptions = {}): Promise<boolean> {
	const romFilePath = `./dist/${romname}.rom`;
	const minifiedJsFilePath = `./rom/${romname}.js`;
	const extraLuaRoots = options.extraLuaPaths ?? [];
	const cartProject = isCartPath(resPath) || isCartPath(bootloaderPath) || isDefaultCartBootloader(bootloaderPath);
	const includeCode = options.includeCode !== false && !cartProject;

	async function checkPaths() {
		try {
			await access(romFilePath);
			if (includeCode) {
				await access(minifiedJsFilePath);
			}
			return false;
		} catch {
			return true;
		}
	}
	if (await checkPaths()) {
		return true;
	}

	const romStats = await stat(romFilePath);
	const romMtime = romStats.mtime;

	const shouldRebuild = async (dir: string, checkCodeFiles: boolean, checkAssets: boolean): Promise<boolean> => {
		try {
			await access(dir);
		} catch {
			throw new Error(`Directory "${dir}" can't be accessed!`);
		}
		const entries = await readdir(dir, { withFileTypes: true });

		for (let entry of entries) {
			const entryPath = join(dir, entry.name);

			if (entry.isDirectory()) {
				if (entry.name === '_ignore' || entry.name === 'node_modules' || isWorkspaceStateDirectory(entry.name)) {
					continue;
				}
				const rebuild = await shouldRebuild(entryPath, checkCodeFiles, checkAssets);
				if (rebuild) {
					return true;
				}
			} else {
				if (shouldCheckFile(entry.name, checkCodeFiles, checkAssets)) {
					try {
						await access(entryPath);
						const entryStats = await stat(entryPath);
						const entryMtime = entryStats.mtime;

						if (entryMtime > romMtime) {
							return true;
						}
					} catch {
						// File does not exist, ignore
					}
				}
			}
		}

		return false;
	};

	const shouldCheckCodeFiles = (dir: string) => includeCode && dir.startsWith(bootloaderPath);
	const shouldCheckAssets = (dir: string) => dir.startsWith(resPath);

	const extraChecks: Array<Promise<boolean>> = [];
	const normalizedBoot = resolve(bootloaderPath);
	const normalizedRes = resolve(resPath);
	for (const root of extraLuaRoots) {
		if (!root || root.length === 0) continue;
		const normalized = resolve(root);
		if (normalized === normalizedBoot || normalized === normalizedRes) continue;
		extraChecks.push(shouldRebuild(root, true, false));
	}

	const extraNeedsRebuild = extraChecks.length > 0 ? await Promise.all(extraChecks).then(results => results.some(Boolean)) : false;

	const bootloaderNeedsRebuild = includeCode
		? await shouldRebuild(bootloaderPath, shouldCheckCodeFiles(bootloaderPath), shouldCheckAssets(bootloaderPath))
		: false;
	const resNeedsRebuild = await shouldRebuild(resPath, shouldCheckCodeFiles(resPath), shouldCheckAssets(resPath));
	const engineNeedsRebuild = cartProject ? false : await shouldRebuild('src/bmsx', true, false);

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

	const outputMtime = outputStats.mtime;

	const shouldRebuild = async (dir: string): Promise<boolean> => {
		try {
			await access(dir);
		} catch {
			throw new Error(`Directory "${dir}" can't be accessed!`);
		}
		const entries = await readdir(dir, { withFileTypes: true });

		for (const entry of entries) {
			const entryPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === '_ignore' || entry.name === 'node_modules' || isWorkspaceStateDirectory(entry.name)) {
					continue;
				}
				if (await shouldRebuild(entryPath)) {
					return true;
				}
			} else {
				if (shouldCheckFile(entry.name, true, false)) {
					const entryStats = await stat(entryPath);
					if (entryStats.mtime > outputMtime) {
						return true;
					}
				}
			}
		}
		return false;
	};

	return await shouldRebuild('src/bmsx');
}
export function setAtlasFlag(enabled: boolean): void {
	GENERATE_AND_USE_TEXTURE_ATLAS = enabled;
}

export const ENGINE_ATLAS_INDEX = 254; // Keep in sync with src/bmsx/render/atlas.ts// Command line parameter for texture atlas usage

export let GENERATE_AND_USE_TEXTURE_ATLAS = true;
// Define common assets path
export const commonResPath = `./src/bmsx/res`;

export let LUA_CANONICALIZATION: CanonicalizationType = 'none';

export function setLuaCanonicalization(type: CanonicalizationType): void {
	LUA_CANONICALIZATION = type;
}
