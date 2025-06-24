import { glsl } from "esbuild-plugin-glsl";
import type { Stats } from 'fs';
import type { AudioMeta, ImgMeta, RomAsset, vec2arr } from '../src/bmsx/rompack';
import { createOptimizedAtlas, generateAtlasName } from './atlasbuilder';
import { BoundingBoxExtractor } from './boundingbox_extractor';
import { LoadedResource, ResourceMeta, RomManifest, RomPackerOptions, type resourcetype } from './rompacker.rompack';
const { build } = require('esbuild');
const { join, parse } = require('path');

const { access, readdir, readFile, stat, writeFile } = require('fs/promises');
const term = require('terminal-kit').terminal;
const { encodeBinary } = require('../src/bmsx/binencoder');
const _colors = require('colors');
const pako = require('pako');
const minify = require('@node-minify/core');
const cleanCSS = require('@node-minify/clean-css');
const { loadImage } = require('canvas');
const yaml = require('js-yaml');

// Command line parameter for texture atlas usage
let GENERATE_AND_USE_TEXTURE_ATLAS = true;
const DONT_PACK_IMAGES_WHEN_USING_ATLAS = true;
const BOOTROM_TS_FILENAME = 'bootrom.ts';
const BOOTROM_JS_FILENAME = 'bootrom.js';
const ROM_TS_RELATIVE_PATH = `../scripts/${BOOTROM_TS_FILENAME}`;
const ROM_JS_RELATIVE_PATH = `../rom/${BOOTROM_JS_FILENAME}`;

const BOILERPLATE_RESOURCE_ID_BITMAP = `export enum BitmapId {
	none = 'none',
`; // Note: cannot use const enums here, because BFont uses BitmapId as a type (and const enums are not available at runtime)

const BOILERPLATE_RESOURCE_ID_AUDIO = `export enum AudioId {
	none = 'none',
`;

type logentryType = undefined | 'error' | 'warning';

function getParamOrEnv(args: string[], flag: string, envVar: string, fallback: string): string {
	const idx = args.indexOf(flag);
	if (idx !== -1 && args[idx + 1]) return args[idx + 1];
	if (process.env[envVar]) return process.env[envVar]!;
	return fallback;
}

function parseOptions(args: string[]): RomPackerOptions & { useTextureAtlas: boolean } {
	// Check for unrecognized arguments
	const knownArgs = ['-romname', '-title', '-bootloaderpath', '-respath', '--force', '--buildreslist', '--nodeploy', '--textureatlas'];
	const unrecognizedArgs = args.filter(arg => arg.startsWith('-') && !knownArgs.includes(arg));
	if (unrecognizedArgs.length > 0) {
		throw new Error(`Unrecognized argument(s): ${unrecognizedArgs.join(', ')}`);
	}

	// Handle the case for -h or --help
	if (args.includes('-h') || args.includes('--help')) {
		writeOut(`Usage: <command> [options]`, 'warning');
		writeOut(`Options:`, 'warning');
		writeOut(`  -romname <name>         Name of the ROM`, 'warning');
		writeOut(`  -title <title>         Title of the ROM`, 'warning');
		writeOut(`  -bootloaderpath <path> Path to the bootloader`, 'warning');
		writeOut(`  -respath <path>        Resource path`, 'warning');
		writeOut(`  --force                Force the compilation and build of the rompack`, 'warning');
		writeOut(`  --buildreslist         Build resource list`, 'warning');
		writeOut(`  --nodeploy         Skip deployment`, 'warning');
		writeOut(`  --textureatlas <yes|no>  Enable or disable texture atlas (default: yes)`, 'warning');
		process.exit(0);
	}

	// Parse options
	const useTextureAtlasArgIdx = args.indexOf('--textureatlas');
	let useTextureAtlas = true;
	if (useTextureAtlasArgIdx !== -1 && args[useTextureAtlasArgIdx + 1]) {
		const val = args[useTextureAtlasArgIdx + 1].toLowerCase();
		useTextureAtlas = val === 'yes' || val === 'true' || val === '1';
	}

	return {
		rom_name: getParamOrEnv(args, '-romname', 'ROM_NAME', null)?.toLowerCase(),
		title: getParamOrEnv(args, '-title', 'TITLE', null),
		bootloader_path: getParamOrEnv(args, '-bootloaderpath', 'BOOTLOADER_PATH', null),
		respath: getParamOrEnv(args, '-respath', 'RES_PATH', null),
		force: args.includes('--force'),
		buildreslist: args.includes('--buildreslist'),
		deploy: !args.includes('--nodeploy'),
		useTextureAtlas
	};
}

function writeOut(_tolog: string, type?: logentryType): void {
	let tolog: string;
	switch (type) {
		case 'error': tolog = _colors.red(_tolog); break;
		case 'warning': tolog = _colors.yellow(_tolog); break;
		default: tolog = _tolog; break;
	}
	term(tolog);
}

function timer(ms: number) {
	return new Promise(res => setTimeout(res, ms));
}

/**
 * Convert a string into a Uint8Array.
 * https://ourcodeworld.com/articles/read/164/how-to-convert-an-uint8array-to-string-in-javascript
 * @returns {Uint8Array}
 */
function encodeuint8arr(myString: string): Uint8Array {
	return new TextEncoder().encode(myString);
}

/**
 * Adds a file to an array of files.
 * @param {string} dirPath - The path of the directory containing the file.
 * @param {string} filePath - The path of the file to add.
 * @param {string[]} arrayOfFiles - The array of files to append to.
 * @returns {void}
 */
function addFile(dirPath: string, filePath: string, arrayOfFiles: string[]): void {
	arrayOfFiles.push(join(dirPath, "/", filePath));
}

/**
 * Recursively gets all files in a directory and its subdirectories, optionally filtered by file extension.
 * @param {string} dirPath - The path of the directory to search.
 * @param {string[]} [_arrayOfFiles] - An optional array of files to append to.
 * @param {string} [filterExtension] - An optional file extension to filter by.
 * @returns {string[]} An array of file paths.
 */
async function getFiles(dirPath: string, arrayOfFiles?: string[], filterExtension?: string): Promise<string[]> {
	return getAllNonRootDirs(dirPath, arrayOfFiles, filterExtension);
}

/**
 * Retrieves all non-root directories within a given directory path.
 * This function is used to recursively retrieve all subdirectories within a directory.
 * It also filters out directories with the name "_ignore".
 *
 * @param dirPath - The path of the directory to search in.
 * @param arrayOfFiles - An array to store the paths of the non-root directories.
 * @param filterExtension - Optional filter for file extensions.
 * @returns A promise that resolves to an array of non-root directory paths.
 */
async function getAllNonRootDirs(dirPath: string, arrayOfFiles: string[] = [], filterExtension?: string): Promise<string[]> {
	let entries = await readdir(dirPath);

	for (let entry of entries) {
		let fullPath = `${dirPath}/${entry}`;
		let stats = await stat(fullPath);
		if (stats.isDirectory() && fullPath.indexOf("_ignore") === -1) {
			arrayOfFiles = await getAllFiles(fullPath, arrayOfFiles, filterExtension);
		}
	}

	return arrayOfFiles;
}

/**
 * Recursively retrieves all files in a directory.
 * If no filterExtension is provided, the function will filter out .rom, .js, .ts, .map, and .tsbuildinfo files.
 * If a filterExtension is provided, the function will filter out all files that do not have the specified extension.
 *
 * @param dirPath: string - The path of the directory to search in.
 * @param _arrayOfFiles: string[] - An optional array to store the file paths. If not provided, a new array will be created.
 * @param filterExtension: string - An optional file extension to filter the files by.
 * @returns An array of file paths.
 */
async function getAllFiles(dirPath: string, _arrayOfFiles?: string[], filterExtension?: string): Promise<string[]> {
	const files = await readdir(dirPath);

	let arrayOfFiles = _arrayOfFiles || [];

	for (let file of files) {
		if (file.indexOf("_ignore") === -1) {
			let fullpath = `${dirPath}/${file}`;
			let stats = await stat(fullpath);
			if (stats.isDirectory()) {
				arrayOfFiles = await getAllFiles(fullpath, arrayOfFiles, filterExtension);
			} else {
				let ext = parse(file).ext;
				if (filterExtension) {
					if (ext === filterExtension) {
						arrayOfFiles.push(fullpath);
					}
				}
				else if (ext != ".rom" && ext != ".js" && ext != ".ts" && ext != ".map" && ext != ".tsbuildinfo" && ext != ".rommanifest") {
					arrayOfFiles.push(fullpath);
				}
			}
		}
	}

	return arrayOfFiles;
}

async function getRomManifest(dirPath: string): Promise<RomManifest> {
	const files = await getAllFiles(dirPath, [], '.rommanifest');

	if (files.length > 1) {
		throw new Error(`More than one rommanifest found in ${dirPath}.`);
	}
	else if (files.length === 1) {
		const res = await readFile(files[0]);
		// Read and return the rommanifest file
		return JSON.parse(res.toString()) as RomManifest;
	}
	else return null;
}

async function yaml2Json(): Promise<void> {
	try {
		const yamlfiles = await getAllFiles('./src', [], '.yaml');
		await Promise.all(yamlfiles.map(async (file) => {
			const doc = yaml.load(await readFile(file, 'utf8'));
			const outfilename = file.replace('.yaml', '.json');
			await writeFile(outfilename, Buffer.from(encodeuint8arr(JSON.stringify(doc))));
		}));
	}
	catch (err) {
		throw new Error(`Error converting YAML to JSON: ${err.message}`);
	}
}

/**
 * Builds and bundles the source code for a ROM using esbuild.
 * @param {string} romname - The name of the ROM.
 * @param {string} bootloader_path - The path to the bootloader file.
 * @returns {Promise<any>} A promise that resolves when the ROM source code has been built and bundled.
 */
async function esbuild(romname: string, bootloader_path: string): Promise<void> {
	const bootloader_ts_path = `${bootloader_path}/bootloader.ts`;
	try {
		await build({
			entryPoints: [bootloader_ts_path], // Entry point for the rompack
			bundle: true, // Bundle all dependencies into a single file
			sourcemap: 'inline', // Include inline source maps for debugging
			sourcesContent: false,
			outfile: `./rom/${romname}.js`, // Output file for the bundled code
			platform: 'browser', // Target platform for the bundle
			target: 'es2020', // Specify the ECMAScript version to target
			// Specify the ECMAScript version to target
			loader: { '.glsl': 'text' }, // Handles GLSL files as text
			plugins: [glsl({
				minify: true
			})],
			define: { 'process.env.NODE_ENV': '"production"' },
			minify: true,
			keepNames: true,
			external: ['node_modules', 'dist', 'rom', 'ts-key-enum'],
			treeShaking: true,
		});
		return null;
	} catch (err) {
		throw err;
	}
}

/**
 * Applies a set of replacements to a given string.
 *
 * @param str - The string to apply replacements to.
 * @param replacements - An object mapping placeholders to their replacement values.
 * @returns The string with replacements applied.
 */
function applyStringReplacements(str: string, replacements: { [key: string]: string }): string {
	let result = str;
	for (const [key, value] of Object.entries(replacements)) {
		result = result.replace(new RegExp(key, 'g'), value);
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
async function buildGameHtmlAndManifest(rom_name: string, title: string, short_name: string): Promise<any> {
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
		const results = await Promise.all(paths.map(async (path) => {
			return [path, await loadImgAndConvertToBase64String(path)] as [string, string];
		}));
		for (const [path, base64] of results) {
			images[path] = base64;
		}
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
			'//#romjs': romjs,
			'//#zipjs': zipjs,
			'/\\*#css\\*/': cssMinified,
			'#title': title,
			'//#debug': `bootrom.debug = ${debug};\n\t\tbootrom.romname = getRomNameFromUrlParameter() ?? '${rom_name}';\n`,
			'#romname': rom_name,
			'#outfile': `${rom_name}.rom`,
			'#bmsxurl': `${imgPrefix}${images['./rom/bmsx.png']}`,
			'#d-pad-d_': `${imgPrefix}${images['./rom/d-pad-d.png']}`, // Note: the trailing underscore is used to prevent the replacement of other placeholders
			'#d-pad-l_': `${imgPrefix}${images['./rom/d-pad-l.png']}`, // Note: the trailing underscore is used to prevent the replacement of other placeholders
			'#d-pad-ld': `${imgPrefix}${images['./rom/d-pad-ld.png']}`,
			'#d-pad-lu': `${imgPrefix}${images['./rom/d-pad-lu.png']}`,
			'#d-pad-neutral': `${imgPrefix}${images['./rom/d-pad-neutral.png']}`,
			'#d-pad-r_': `${imgPrefix}${images['./rom/d-pad-r.png']}`, // Note: the trailing underscore is used to prevent the replacement of other placeholders
			'#d-pad-rd': `${imgPrefix}${images['./rom/d-pad-rd.png']}`,
			'#d-pad-ru': `${imgPrefix}${images['./rom/d-pad-ru.png']}`,
			'#d-pad-u_': `${imgPrefix}${images['./rom/d-pad-u.png']}`, // Note: the trailing underscore is used to prevent the replacement of other placeholders
		};

		return applyStringReplacements(htmlToTransform, replacements);
	}

	let html: string, romjs: string, zipjs: string;
	try {
		html = await readFile("./gamebase.html", 'utf8');
		romjs = (await readFile(`./rom/${BOOTROM_JS_FILENAME}`, 'utf8')).replace('Object.defineProperty(exports, "__esModule", { value: true });', '');
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
					const transformedHtml = await transformHtml(html, cssMinified, false);
					const transformedDebugHtml = await transformHtml(html, cssMinified, true);

					await writeFile("./dist/game.html", transformedHtml);
					await writeFile("./dist/game_debug.html", transformedDebugHtml);

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
function parseAudioMeta(filename: string) {
	const priorityregex = /@p\=\d+/;
	const priorityresult = priorityregex.exec(filename);
	const prioritystr = priorityresult ? priorityresult[0] : undefined;
	const priority = prioritystr ? parseInt(prioritystr.slice(3)) : 0;

	const loopregex = /@l\=\d+(,\d+)?/;
	const loopresult = loopregex.exec(filename);
	const loopstr = loopresult ? loopresult[0] : undefined;
	const loop = loopstr ? parseFloat(loopstr.replace(',', '.').slice(3)) : null;

	const sanitizedName = filename.replace(priorityregex, '').replace(loopregex, '').replace('@m', '');
	const audiometa: AudioMeta =
	{
		audiotype: filename.indexOf('@m') >= 0 ? 'music' : 'sfx',
		priority: priority,
		loop: loop !== null ? loop : undefined
	};
	return { sanitizedName, audiometa };
}

// --- Image filename collision-type suffix parser ---
function parseImageMeta(filenameWithoutExt: string): { sanitizedName: string, collisionType: 'concave' | 'convex' | 'aabb', targetAtlas?: number } {
	// Match @cc or @cx for collision type, and @atlas=n for atlas assignment (order-insensitive)
	const collisionMatch = filenameWithoutExt.match(/@(cc|cx)/i);
	let collisionType: 'concave' | 'convex' | 'aabb' = 'aabb';
	if (collisionMatch) {
		const code = collisionMatch[1].toLowerCase();
		collisionType = code === 'cc' ? 'concave' : code === 'cx' ? 'convex' : 'aabb';
	}
	let targetAtlas = undefined;
	if (GENERATE_AND_USE_TEXTURE_ATLAS && DONT_PACK_IMAGES_WHEN_USING_ATLAS) {
		const atlasMatch = filenameWithoutExt.match(/@atlas=(\d+)/i);
		targetAtlas = atlasMatch ? parseInt(atlasMatch[1], 10) : undefined;
		if (targetAtlas === undefined) {
			// If no atlas is specified, we use the default atlas 0
			targetAtlas = 0;
		}
	}

	// Remove all @cc, @cx, and @atlas=n (in any order)
	const sanitizedName = filenameWithoutExt
		.replace(/@(cc|cx)/ig, '')
		.replace(/@atlas=\d+/ig, '');

	return { sanitizedName, collisionType, targetAtlas };
}

/**
 * Compresses the given content using the zip algorithm and returns the compressed content as a Uint8Array.
 *
 * @param content - The content to be compressed.
 * @returns The compressed content as a Uint8Array.
 */
function zip(content: Buffer): Uint8Array {
	const toCompress = new Uint8Array(content);
	return pako.deflate(toCompress);
}

/**
 * Returns an object containing the name, extension, and type of a resource file based on its filepath.
 * @param filepath The path of the resource file.
 * @returns An object containing the name, extension, and type of the resource file.
 */
function getResMetaByFilename(filepath: string): { name: string, ext: string, type: resourcetype, collisionType?: 'concave' | 'convex' | 'aabb' | undefined } {
	let name = parse(filepath).name.replace(' ', '').toLowerCase();
	const ext = parse(filepath).ext.toLowerCase();
	let type: resourcetype;
	let collisionType: 'concave' | 'convex' | 'aabb' | undefined = undefined;

	switch (ext) {
		case '.wav':
			type = 'audio';
			break;
		case '.js':
			type = 'code';
			break;
		case '.rommanifest':
			type = 'rommanifest';
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
		default:
			break;
	}
	return { name: name, ext: ext, type: type, collisionType: collisionType };
}

/**
 * Builds a list of `ResourceMeta` objects located at `respath` for the specified `romname`.
 * @param respath The path to the resources to include in the list.
 * @param romname The name of the ROM pack to build the list for.
 * @returns An array of `ResourceMeta` objects.
 */
async function getResMetaList(respath: string, romname?: string) {
	const arrayOfFiles = await getFiles(respath) ?? []; // Also handle corner case where we don't have any resources by adding "?? []"
	const megarom_filename = `${romname}.js`;
	// Note that romname can be undefined when building the resource enum file, so we only add the file if romname is defined
	if (romname) {
		addFile("./rom", megarom_filename, arrayOfFiles); // Add source at the end
	}

	const result: Array<ResourceMeta> = [];
	const targetAtlasIdSet = new Set<number>();

	let imgid = 1;
	let sndid = 1;
	for (let i = 0; i < arrayOfFiles.length; i++) {
		const filepath = arrayOfFiles[i];
		const meta = getResMetaByFilename(filepath);

		const type = meta.type;
		let name = meta.name;
		const ext = meta.ext;
		switch (type) {
			case 'image':
				const imgMeta = parseImageMeta(name);
				name = imgMeta.sanitizedName; // Remove metadata from the name
				// If we are generating and using texture atlases, we need to add the image to the atlas
				if (GENERATE_AND_USE_TEXTURE_ATLAS && DONT_PACK_IMAGES_WHEN_USING_ATLAS) {
					if (imgMeta.targetAtlas !== undefined) targetAtlasIdSet.add(imgMeta.targetAtlas);
				}
				result.push({ filepath: filepath, name: name, ext: ext, type: type, id: imgid, collisionType: imgMeta.collisionType, targetAtlasIndex: imgMeta.targetAtlas });
				++imgid;
				break;
			case 'audio':
				const parsedMeta = parseAudioMeta(name);
				name = parsedMeta.sanitizedName; // Remove metadata from the name
				result.push({ filepath: filepath, name: name, ext: ext, type: type, id: sndid });
				++sndid;
				break;
			case 'romlabel':
				result.push({ filepath: filepath, name: name, ext: ext, type: type, id: undefined });
				break;
			case 'rommanifest':
				result.push({ filepath: filepath, name: name, ext: ext, type: type, id: undefined });
				break;
			case 'code':
				// For code files, we use the romname as the name
				break;
			case 'atlas':
				// Atlas files are not real files, but we add them to the resource list in the next step
				break;
		}
	}

	// If we are generating and using texture atlases, we need to add the atlasses to the resource list
	// @ts-ignore
	for (const id of targetAtlasIdSet) {
		const name = generateAtlasName(id);
		result.push({ filepath: undefined, name, ext: '.atlas', type: 'atlas', id: imgid++, collisionType: undefined, targetAtlasIndex: undefined, atlasid: id });
	}

	// Validation: ensure no duplicate IDs within the same resource type (image or audio)
	const checkDuplicateIds = (type: string) => {
		const filtered = result.filter(r => r.type === type && typeof r.id === 'number');
		const idMap = new Map<number, string[]>();
		for (const r of filtered) {
			if (!idMap.has(r.id)) idMap.set(r.id, []);
			idMap.get(r.id)!.push(r.name);
		}
		const dups = Array.from(idMap.entries()).filter(([id, names]) => names.length > 1);
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
		const dups = Array.from(nameMap.entries()).filter(([name, paths]) => paths.length > 1);
		if (dups.length > 0) {
			const msg = dups.map(([name, paths]) => `Name "${name}" used by: ${paths.join(', ')}`).join('\n');
			throw new Error(`Duplicate ${type} resource names found!\n${msg}`);
		}
	};

	checkDuplicateIds('image');
	checkDuplicateIds('audio');
	checkDuplicateNames('image');
	checkDuplicateNames('audio');

	return result;
}

/**
 * Builds a list of loaded resources located at `respath` for the specified `romname`.
 * @param rom_name The name of the ROM pack to build the list for.
 * @returns An array of loaded resources.
 */
async function getLoadedResourcesList(resMetaList: ResourceMeta[], rom_name: string): Promise<LoadedResource[]> {
	let loadedResources: Array<LoadedResource> = [];

	/**
	 * Loads an image from the specified `ResourceMeta` object.
	 * @param _meta The `ResourceMeta` object containing information about the image to load.
	 * @returns A Promise that resolves with the loaded image.
	 */
	async function getImageFromBuffer(buffer: Buffer) {
		const base64Encoded = buffer.toString('base64');
		const dataURL = `data:images/png;base64,${base64Encoded}`;
		return await loadImage(dataURL);
	}

	// Parallelize buffer and image loading
	const resourcePromises = resMetaList.map(async (meta) => {
		const type = meta.type;
		const buffer = meta.filepath ? await readFile(meta.filepath) : null;
		let img: any = undefined;
		if (type === 'image') img = await getImageFromBuffer(buffer);
		const toAdd: LoadedResource = {
			...meta,
			buffer: buffer,
			img: img,
		};

		return toAdd;
	});
	resourcePromises.push((async () => {
		const megarom_filename = `${rom_name}.js`;
		const filepath = `./rom/${megarom_filename}`;
		// Manually add the ROM source code to the list
		return {
			buffer: await readFile(filepath),
			filepath: filepath,
			name: megarom_filename,
			ext: '.js',
			type: 'code',
			img: undefined, // Add missing fields to match LoadedResource
			id: 1,
			collisionType: undefined // Add missing fields to match LoadedResource
		};
	})());

	loadedResources = await Promise.all(resourcePromises);

	if (GENERATE_AND_USE_TEXTURE_ATLAS) {
		// Sort the files on buffer size for atlassing
		// Also: place the atlas in the back, so that we can correctly use the bufferpointer to point to the atlas
		loadedResources = loadedResources.sort((b1, b2) => ((b1.type === 'atlas' ? 1 : 0) - (b2.type === 'atlas' ? 1 : 0)));
		// Also: place the romlabel in front, so that it is put at the start of the rom and will be recognized as a proper image
		loadedResources = loadedResources.sort((b1, b2) => ((b1.type === 'romlabel' ? 0 : 1) - (b2.type === 'romlabel' ? 0 : 1)));
	}
	return loadedResources;
}

/**
 * Builds a list of resources located at `respath` for the specified `romname`.
 * @param respath The path to the resources to include in the list.
 * @param rom_name The name of the ROM pack to build the list for.
 */
async function buildResourceList(respath: string, rom_name?: string) {
	const tsimgout = new Array<string>();
	const tssndout = new Array<string>();
	const metalist = await getResMetaList(respath, rom_name);

	tsimgout.push(BOILERPLATE_RESOURCE_ID_BITMAP);
	tssndout.push(BOILERPLATE_RESOURCE_ID_AUDIO);

	for (let i = 0; i < metalist.length; i++) {
		const current = metalist[i];

		const type = current.type;
		const name = current.name;
		switch (type) {
			case 'image':
			case 'atlas': // Atlas is also an image and thus is added to the image enum
				const property_to_add = `\t${name} = '${name}', `;
				tsimgout.push(`${property_to_add} `);
				break;
			case 'audio':
				const enum_member_to_add = `\t${name} = '${name}', `;
				tssndout.push(`${enum_member_to_add} `);
				break;
			case 'romlabel':
				// Ignore this part
				break;
		}
	}

	tsimgout.push("}\n");
	tssndout.push("}\n");

	const total_output: string = tsimgout.concat(tssndout).join('\n');

	const targetPath = respath.replace('/res', '/resourceids.ts');
	await writeFile(targetPath, total_output);
}

/**
 * Processes an array of loaded resources to produce asset metadata and allocate buffer ranges.
 *
 * @remarks
 * This function iterates over the given resources and creates corresponding entries in
 * a binary-encoded asset metadata array. Depending on the resource type, the function may parse additional data
 * (such as audio metadata) or adjust resource names (e.g., `.min` filenames). An optional
 * texture atlas can be used to bundle image data.
 *
 * @param loadedResources - The array of loaded resources to process.
 * @returns An object with three properties:
 * - `assetList` - The array of generated asset metadata objects (to be binary-encoded).
 * - `romlabel_buffer` - The buffer data for the "romlabel.png" resource if present.
 */
function generateRomAssets(loadedResources: LoadedResource[]) {
	const romAssets: RomAsset[] = [];
	let romlabel_buffer: Buffer | undefined;

	for (let i = 0; i < loadedResources.length; i++) {
		const res = loadedResources[i];
		const type = res.type;
		let resname = res.name;
		const resid = res.id;
		const buffer = res.buffer; // NOTE that we will remove the buffer during the finalization of the ROM pack. To do proper finalization, we need to store the buffer here right now. N.B. the bootrom will also add the buffer to the RomAsset, so that's why the property is relevant in the first place and we are now using it to temporarily hold the buffer per asset.

		switch (type) {
			case 'romlabel':
				if (i > 0) throw new Error('"romlabel.png" must appear at start of the ResourceMeta-list!');
				romlabel_buffer = res.buffer;
				break;
			case 'image': {
				const imgmeta = buildImgMeta(res);
				let baseAsset: RomAsset;
				if (GENERATE_AND_USE_TEXTURE_ATLAS && DONT_PACK_IMAGES_WHEN_USING_ATLAS) {
					baseAsset = { resid, resname, type, imgmeta, buffer: undefined, };
				} else {
					baseAsset = { resid, resname, type, imgmeta, buffer };
				}
				romAssets.push({ ...baseAsset, });
			}
				break;
			case 'audio':
				// Note that the name has already been sanitized in the `getResMetaList` function
				const { audiometa } = parseAudioMeta(res.filepath);
				romAssets.push({ resid, resname, type, audiometa, buffer });
				break;
			case 'code':
				resname = resname.replace('.min', '');
				romAssets.push({ resid, resname, type, buffer });
				break;
			case 'atlas': {
				// Atlas resources are handled similarly to images but with a twist
				const imgmeta = buildImgMetaForAtlas(res);
				const baseAsset = { resid, resname, type, imgmeta, buffer };
				romAssets.push({ ...baseAsset, });
			}
				break;
			case 'rommanifest':
				break;
		}
	}
	return { assetList: romAssets, romlabel_buffer };
}

/**
 * Generates metadata for an image resource, optionally integrating texture atlas data.
 *
 * @param res - The loaded resource containing the image and any existing metadata.
 * @param generated_atlas - An optional canvas element where an atlas has been generated.
 * @returns An object containing image dimensions, bounding boxes, center point, and (if atlas usage is enabled) texture coordinates.
 */
function buildImgMeta(res: LoadedResource): ImgMeta {
	const img = res.img;
	const img_boundingbox = BoundingBoxExtractor.extractBoundingBox(img);
	let extracted_hitpolygon: vec2arr[][] | vec2arr[] = undefined;
	let hitpolygons: {
		original: vec2arr[][],
		fliph: vec2arr[][],
		flipv: vec2arr[][],
		fliphv: vec2arr[][]
	} = undefined;
	switch (res.collisionType) {
		case 'concave':
			extracted_hitpolygon = BoundingBoxExtractor.extractConcaveHull(img) as vec2arr[][];
			hitpolygons = {
				original: extracted_hitpolygon,
				fliph: flipPolygons(extracted_hitpolygon, true, false),
				flipv: flipPolygons(extracted_hitpolygon, false, true),
				fliphv: flipPolygons(extracted_hitpolygon, true, true)
			};
			break;
		case 'convex':
			extracted_hitpolygon = BoundingBoxExtractor.extractConvexHull(img) as vec2arr[];
			hitpolygons = {
				original: [extracted_hitpolygon],
				fliph: flipPolygons([extracted_hitpolygon], true, false),
				flipv: flipPolygons([extracted_hitpolygon], false, true),
				fliphv: flipPolygons([extracted_hitpolygon], true, true)
			};
			break;
		case 'aabb':
			// No hit polygon, use bounding box instead
			break;
	}
	const img_boundingbox_precalc = BoundingBoxExtractor.generateFlippedBoundingBox(img, img_boundingbox);
	const img_centerpoint = BoundingBoxExtractor.calculateCenterPoint(img_boundingbox);

	// Generate flipped variants for polygons
	function flipPolygons(polys: vec2arr[][], flipH: boolean, flipV: boolean): vec2arr[][] {
		return polys.map(poly => poly.map(pt => ([
			flipH ? img.width - 1 - pt[0] : pt[0],
			flipV ? img.height - 1 - pt[1] : pt[1]
		])));
	}

	let imgmeta: ImgMeta = {
		atlassed: false,
		atlasid: null,
		width: img.width,
		height: img.height,
		boundingbox: img_boundingbox_precalc,
		centerpoint: img_centerpoint,
		hitpolygons: hitpolygons
	};
	if (GENERATE_AND_USE_TEXTURE_ATLAS) {
		imgmeta = {
			...imgmeta,
			atlassed: res.targetAtlasIndex !== undefined,
			atlasid: res.targetAtlasIndex,
			texcoords: res.imgmeta.texcoords,
			texcoords_fliph: res.imgmeta.texcoords_fliph,
			texcoords_flipv: res.imgmeta.texcoords_flipv,
			texcoords_fliphv: res.imgmeta.texcoords_fliphv,
		};
	}
	return imgmeta;
}

function buildImgMetaForAtlas(res: LoadedResource): ImgMeta {
	return {
		atlassed: false,
		atlasid: res.atlasid, // Use the atlas ID from the base ResourceMeta
		width: res.img.width,
		height: res.img.height,
	};
}

/**
 * Asynchronously processes the loaded atlas resource and updates the asset metadata array with image metadata.
 *
 * @param loadedResources - An array of loaded resources, including the atlas to be processed.
 * @param generated_atlas - The HTMLCanvasElement representing the generated atlas image.
 * @param assetList - An array of RomAsset objects to be updated with image metadata.
 * @param bufferPointer - The starting position where atlas data should be written in the output buffers.
 * @param buffers - An array of Buffers where the atlas image data will be appended.
 * @returns A Promise that resolves once the atlas image is written to disk and metadata is updated.
 */
async function createAtlasses(loadedResources: LoadedResource[]) {
	if (GENERATE_AND_USE_TEXTURE_ATLAS) {
		const atlasses = loadedResources.filter(res => res.type === 'atlas');
		if (atlasses.length === 0) throw new Error('No atlas resources found in the "loaded resources"-list. The process of preparing the list of all resources (assets) should also add any atlasses that are to be generated. Thus, this is a bug in the code that prepares the list of resources :-(');
		// Determine the indexes of atlasses to be generated
		for (const atlas of atlasses) {
			const image_assets = loadedResources.filter(resource => resource.type === 'image');
			const filteredImages = image_assets.filter(resource => resource.targetAtlasIndex === atlas.atlasid);
			const atlasCanvas = createOptimizedAtlas(filteredImages);
			if (!atlasCanvas) throw new Error(`Failed to create texture atlas for ${atlas.name}.`);
			atlas.img = atlasCanvas; // Store the canvas in the resource (to extract the image properties later during `processResources`)
			atlas.buffer = (atlasCanvas as any).toBuffer('image/png'); // Convert canvas to PNG buffer
			await writeFile(`./rom/_ignore/${generateAtlasName(atlas.atlasid)}.png`, atlas.buffer);
		}
	}
	else {
		throw new Error('No images found to generate texture atlas from. Please ensure you have images in your resource directory.');
	}
}

/**
 * Finalizes a ROM pack by concatenating buffers, generating metadata,
 * writing zipped output to disk, and exporting a JSON file that
 * references the assets used in the ROM pack.
 *
 * IMPORTANT: The 16-byte footer (metadata offset/length) is appended to the end of the uncompressed buffer
 * BEFORE zipping. This means that after decompression, the footer is always present at the end of the buffer.
 *
 * The loader uses this footer to find the metadata (resource list), but all asset/code offsets in the metadata
 * are relative to the start of the decompressed buffer and never include the footer. The footer is ignored for
 * all other purposes. This is a common pattern in file formats and is robust as long as the packer and loader agree.
 * The great thing is that I came up with this before ChatGPT/Copilot did, but now I can use it to explain it better! :D
 *
 * @param jsonout - An array of ROM assets describing the mappings to be finalized.
 * @param buffers - The buffers that will be concatenated and zipped.
 * @param romlabel_buffer - An optional buffer representing any additional
 *                          ROM label or header information.
 * @param outfile - The name of the output file to which the ROM pack is written.
 * @returns A promise that resolves when all files have been successfully written.
 */
async function finalizeRompack(
	assetList: RomAsset[],
	romlabel_buffer: Buffer | undefined,
	rom_name: string,
) {
	// Capture resource buffers in the order as given by the assetList
	const buffers: Buffer[] = [];
	const outfile = `${rom_name}.rom`; // Use the provided rom_name as the output file name
	let offset = 0; // Offset for the next buffer to be added

	for (const asset of assetList) {
		// Main buffer (if nonzero length)
		const hasBuffer = asset.buffer !== undefined && asset.buffer.length > 0;
		if (hasBuffer) {
			// Copy the buffer to avoid modifying the original
			const resBuf = Buffer.from(asset.buffer);
			// Update asset offsets
			asset.start = offset;
			asset.end = offset + resBuf.length;
			buffers.push(resBuf);
			offset += resBuf.length;
		}
		// Per-asset metadata
		const perMeta = asset.imgmeta ?? asset.audiometa;
		if (perMeta) {
			const metaBuf = Buffer.from(encodeBinary(perMeta));
			asset.metabuffer_start = offset;
			asset.metabuffer_end = offset + metaBuf.length;
			buffers.push(metaBuf);
			offset += metaBuf.length;
		}
		// Remove per-asset fields
		delete asset.imgmeta;
		delete asset.audiometa;
		// Remove the buffer from the asset, so that it is not included in the final JSON output
		delete asset.buffer;
	}

	// Global metadata
	const binaryAssetListBuffer = Buffer.from(encodeBinary(assetList));
	const globalMetadataOffset = offset;
	const globalMetadataLength = binaryAssetListBuffer.length;
	buffers.push(binaryAssetListBuffer);

	// Footer
	const rompackFooter = Buffer.alloc(16);
	rompackFooter.writeBigUInt64LE(BigInt(globalMetadataOffset), 0);
	rompackFooter.writeBigUInt64LE(BigInt(globalMetadataLength), 8);
	buffers.push(rompackFooter);

	// Write final output
	const all = Buffer.concat(buffers);
	const zipped = zip(all);
	await writeFile(`./dist/${outfile}`, Buffer.concat([romlabel_buffer ?? Buffer.alloc(0), zipped]));
	await writeFile("./rom/_ignore/romresources.json", JSON.stringify(assetList, null, 2));
}

async function deployToServer(rom_name: string, title: string) {
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
async function buildBootromScriptIfNewer(): Promise<void> {
	const romTsPath = join(__dirname, ROM_TS_RELATIVE_PATH);
	const romJsPath = join(__dirname, ROM_JS_RELATIVE_PATH);

	try {
		await access(romTsPath);
	} catch {
		throw new Error(`"${BOOTROM_TS_FILENAME}" could not be found at "${romTsPath}"`);
	}

	const romTsStats = await stat(romTsPath);
	let romJsStats: Stats | undefined;

	try {
		await access(romJsPath);
		romJsStats = await stat(romJsPath);
	}
	catch { } // Ignore error if rom.js does not exist yet

	if (!romJsStats || romTsStats.mtime > romJsStats.mtime) {
		try {
			await build({
				entryPoints: [romTsPath],
				bundle: true,
				minify: true,
				sourcemap: false,
				platform: 'browser',
				target: 'es2020',
				format: 'iife',
				outfile: romJsPath,
			});
		} catch (e) {
			throw new Error(`Error while compiling "${BOOTROM_TS_FILENAME}" with esbuild: ${e?.message ?? e} `);
		}
		return;
	}
	// rom.js is newer or up to date. No need to compile
}

const codeFileExtensions = ['.ts', '.glsl', '.js', '.jsx', '.tsx', '.html', '.css', '.json', '.xml'];

const isCodeFile = (filename: string) => codeFileExtensions.some(extension => filename.endsWith(extension));
const shouldCheckFile = (filename: string, checkCodeFiles: boolean, checkAssets: boolean) => (checkCodeFiles && isCodeFile(filename)) || checkAssets;

/**
 * Determines whether a rebuild of the ROM is required based on the modification times of the bootloader and resource files.
 * @param {string} romname - The name of the ROM.
 * @param {string} bootloaderPath - The path to the bootloader files.
 * @param {string} resPath - The path to the resource files.
 * @returns {Promise<boolean>} A Promise that resolves with a boolean indicating whether a rebuild is required.
 */
async function isRebuildRequired(romname: string, bootloaderPath: string, resPath: string): Promise<boolean> {
	const romFilePath = `./dist/${romname}.rom`;
	const minifiedJsFilePath = `./rom/${romname}.js`;

	async function checkPaths() {
		try {
			await access(romFilePath);
			await access(minifiedJsFilePath);
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
				if (entry.name === '_ignore') {
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

	const shouldCheckCodeFiles = dir => dir.startsWith(bootloaderPath);
	const shouldCheckAssets = dir => dir.startsWith(resPath);

	return await shouldRebuild(bootloaderPath, shouldCheckCodeFiles(bootloaderPath), shouldCheckAssets(bootloaderPath)) ||
		await shouldRebuild(resPath, shouldCheckCodeFiles(resPath), shouldCheckAssets(resPath)) ||
		await shouldRebuild('src/bmsx', true, false);
}

class ProgressReporter {
	private gauge: any;
	private tasks: string[];
	private totalTasks: number;
	private completedTasks: number = 0;

	constructor(tasks: string[]) {
		const Gauge = require('gauge');
		this.gauge = new Gauge(process.stdout, {
			updateInterval: 20,
			cleanupOnExit: false,
			autoSize: false,
		});
		this.gauge.setTemplate([
			{ type: 'progressbar', length: 50 },
			{ type: 'section', kerning: 1, default: '' },
			{ type: 'subsection', kerning: 1, default: '' },
		]);
		this.tasks = [...tasks];
		this.totalTasks = tasks.length;
	}

	public async taskCompleted() {
		this.completedTasks++;
		const progressPercentage = this.completedTasks / this.totalTasks;
		if (this.tasks.length) {
			const currentTask = this.tasks.shift()!;
			this.gauge.show(currentTask, progressPercentage);
			await this.pulse();
		} else {
			await this.showDone();
		}
	}

	public showInitial() {
		if (this.tasks.length) {
			this.gauge.show(this.tasks[0], 0);
			this.gauge.pulse();
		}
	}

	public skipTasks(count: number) {
		for (let i = 0; i < count && this.tasks.length; i++) {
			this.tasks.shift();
			this.completedTasks++;
		}
	}

	public removeTask(task: string) {
		const index = this.tasks.indexOf(task);
		if (index !== -1) {
			this.tasks.splice(index, 1);
			this.totalTasks--;
		}
	}

	public async showDone() {
		this.gauge.show('ROM PACKING GE-DONUT!! :-)', 1);
		await this.pulse();
	}

	public async pulse() {
		this.gauge.pulse();
		await timer(10);
	}
}

async function main() {
	const outputError = (e: any) => writeOut(`\n[GEFAALD] ${e?.stack ?? e?.message ?? e ?? 'Geen melding en/of stacktrace beschikbaar :-('} \n`, 'error');
	const taskList = [
		'Rom manifest zoekeren en parseren',
		'Game compileren+bundleren',
		'YAML bestanden omzetten in JSON voor importatie',
		'Resource lijst bouwen',
		'Resources laden en metadata genereren',
		'Atlassen puzellen (indien nodig)',
		'Rom-assets genereren',
		'Rompakket finaliseren',
		`"${BOOTROM_TS_FILENAME}" compileren(als nodig)`,
		'"game.html" en "game_debug.html" bouwen',
		'Deployeren',
		'ROM PACKING GE-DONUT!! :-)',
	];
	const progress = new ProgressReporter(taskList);
	try {
		// #region stuff
		term.clear();
		writeOut(_colors.brightGreen.bold('┏————————————————————————————————————————————————————————————————————————————————┓\n'));
		writeOut(_colors.brightGreen.bold('|                          BMSX ROMPACKER DOOR BOAZ©®™                           |\n'));
		writeOut(_colors.brightGreen.bold('┗————————————————————————————————————————————————————————————————————————————————┛\n'));
		const args = process.argv.slice(2);
		let { title, rom_name, bootloader_path, respath, force, buildreslist, deploy, useTextureAtlas } = parseOptions(args);
		GENERATE_AND_USE_TEXTURE_ATLAS = useTextureAtlas;

		if (buildreslist) {
			if (!respath) {
				throw new Error("Missing parameter for location of the resource folder ('respath', e.g. './src/testrom/res'.");
			}
			writeOut(`Building resource list and writing output to "${respath}"...\n`);
			writeOut('Note: ROM packing and deployment are skipped.\n');
			await buildResourceList(respath);
			writeOut(`\n${_colors.brightWhite.bold('[Resource list bouwen ge-DONUT]')} \n`);
			return;
		} else {
			// Check for required arguments
			if (!rom_name) {
				throw new Error('Missing required argument: --romname or ROM_NAME environment variable, or --buildreslist (to build resource list only).');
			}

			if (rom_name.includes('.')) {
				throw new Error(`'-romname' should not contain any extensions! The given romname was ${rom_name}. Example of good '-romname': 'testrom'.`);
			}
			rom_name = rom_name.toLowerCase();
		}

		if (!title) throw new Error("Missing parameter for title ('title', e.g. 'Sintervania'.");
		if (!bootloader_path) throw new Error("Missing parameter for location of the bootloader.ts-file ('bootloader_path', e.g. 'src/testrom'.");
		if (!respath) throw new Error("Missing parameter for location of the resource folder ('respath', e.g. './src/testrom/res'.");

		let rebuildRequired = true;
		if (force) {
			writeOut(`Note: Recompilation and building forced via ${_colors.yellow.bold('--force')} \n`);
		}
		else {
			writeOut(`Note: Recompilation and building only if required (based on file modification times).\n`);
		}
		if (useTextureAtlas) {
			writeOut(`Note: Texture atlas generation enabled via ${_colors.brightGreen.bold('--textureatlas yes')} \n`);
		}
		else {
			writeOut(`Note: Texture atlas generation disabled via ${_colors.brightRed.bold('--textureatlas no')} \n`);
		}
		if (!deploy) writeOut(`Note: Deploy to FTP server disabled via ${_colors.brightRed.bold('--nodeploy')} \n`);
		writeOut(`Starting ROM packing and deployment process for ROM ${_colors.brightBlue.bold(`${rom_name}`)}...\n`);
		progress.showInitial();
		await progress.taskCompleted(); // Need to complete the initial task as it will be triggered twice or so

		try {
			let romManifest: RomManifest;
			let short_name: string = 'BMSX';
			romManifest = await getRomManifest(respath);
			await progress.taskCompleted();
			if (!romManifest) throw new Error(`Rom manifest not found at "${respath}"!`);
			rom_name = romManifest?.rom_name ?? rom_name;
			title = romManifest?.title ?? title;
			short_name = romManifest?.short_name ?? short_name;

			if (!force) {
				rebuildRequired = await isRebuildRequired(rom_name, bootloader_path, respath);
				if (!rebuildRequired) {
					writeOut('Rebuild skipped: game rom was newer than code/assets (use --force option to ignore this check).\n');
				}
			} else rebuildRequired = true;

			if (!deploy) progress.removeTask('Deployeren');
			if (!rebuildRequired) {
				progress.skipTasks(7);
			}

			// #endregion
			if (rebuildRequired) {
				await esbuild(rom_name, bootloader_path);
				await progress?.taskCompleted();
				await yaml2Json();
				await progress?.taskCompleted();
				const resMetaList = await getResMetaList(respath, rom_name);
				await progress?.taskCompleted();
				const loadedResources = await getLoadedResourcesList(resMetaList, rom_name);
				await progress?.taskCompleted();

				if (GENERATE_AND_USE_TEXTURE_ATLAS) {
					await createAtlasses(loadedResources);
				}
				await progress?.taskCompleted();

				const { assetList, romlabel_buffer } = generateRomAssets(loadedResources);
				await progress?.taskCompleted();

				await finalizeRompack(assetList, romlabel_buffer, rom_name);
				await progress?.taskCompleted();
			}
			await buildBootromScriptIfNewer();
			await progress?.taskCompleted();
			await buildGameHtmlAndManifest(rom_name, title, short_name);
			await progress?.taskCompleted();
			if (deploy) {
				await deployToServer(rom_name, title);
				await progress?.taskCompleted();
			}
			await progress.showDone();
			writeOut(`\n`);
		} catch (e) {
			await progress.pulse();
			writeOut(`\n`);
			throw e;
		}
	} catch (e) {
		outputError(e);
	}
}

main();