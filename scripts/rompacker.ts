import { exec } from 'child_process';
import { build } from 'esbuild';
import { Stats } from 'fs';
import { dirname, join, parse } from 'path';
import { createOptimizedAtlas } from './atlasbuilder';
import { BoundingBoxExtractor } from './boundingbox_extractor';
import { AudioMeta, ImgMeta, RomAsset, RomMeta, vec2 } from './rompacker.rompack';
const Gauge = require('gauge');

import { access, readdir, readFile, stat, writeFile } from 'fs/promises';
import * as term from 'terminal-kit';
const _colors = require('colors');
const pako = require('pako');
const minify = require('@node-minify/core');
const cleanCSS = require('@node-minify/clean-css');
const { loadImage } = require('canvas');
const yaml = require('js-yaml');

const GENERATE_AND_USE_TEXTURE_ATLAS = true;
const DONT_PACK_IMAGES_WHEN_USING_ATLAS = true;

const BOILERPLATE_RESOURCE_ID_BITMAP = `export enum BitmapId {
	none = 'none',
`; // Note: cannot use const enums here, because BFont uses BitmapId as a type (and const enums are not available at runtime)

const BOILERPLATE_RESOURCE_ID_AUDIO = `export enum AudioId {
	none = 'none',
`;

interface RomPackerOptions {
	rom_name: string;
	title: string;
	bootloader_path: string;
	respath: string;
	force: boolean;
	buildreslist: boolean;
	deploy: boolean;
}

function getParamOrEnv(args: string[], flag: string, envVar: string, fallback: string): string {
	const idx = args.indexOf(flag);
	if (idx !== -1 && args[idx + 1]) return args[idx + 1];
	if (process.env[envVar]) return process.env[envVar]!;
	return fallback;
}

function parseOptions(args: string[]): RomPackerOptions {
	// Check for unrecognized arguments
	const knownArgs = ['-romname', '-title', '-bootloaderpath', '-respath', '--force', '--buildreslist', '--nodeploy'];
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
		process.exit(0);
	}

	// Parse options
	return {
		rom_name: getParamOrEnv(args, '-romname', 'ROM_NAME', null)?.toLowerCase(),
		title: getParamOrEnv(args, '-title', 'TITLE', null),
		bootloader_path: getParamOrEnv(args, '-bootloaderpath', 'BOOTLOADER_PATH', null),
		respath: getParamOrEnv(args, '-respath', 'RES_PATH', null),
		force: args.includes('--force'),
		buildreslist: args.includes('--buildreslist'),
		deploy: !args.includes('--nodeploy')
	};
}

/**
 * Interface for a loaded resource, which includes metadata about the resource.
 */
export interface ILoadedResource extends ResourceMeta {
	buffer: Buffer;
	img?: any;
	imgmeta?: ImgMeta;
}

/**
 * Interface for metadata about a resource.
 */
export interface ResourceMeta {
	filepath?: string;
	name: string;
	ext?: string;
	type: string;
	id: number;
}

interface RomManifest {
	title?: string;
	short_name?: string;
	rom_name?: string;
}

type logentryType = undefined | 'error' | 'warning';

function writeOut(_tolog: string, type?: logentryType): void {
	let tolog: string;
	switch (type) {
		case 'error': tolog = _colors.red(_tolog); break;
		case 'warning': tolog = _colors.yellow(_tolog); break;
		default: tolog = _tolog; break;
	}
	term.terminal(tolog);
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
 * @param dirPath - The path of the directory to search in.
 * @param _arrayOfFiles - An optional array to store the file paths. If not provided, a new array will be created.
 * @param filterExtension - An optional file extension to filter the files by.
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
		// Read the rommanifest file
		JSON.parse(res.toString()) as RomManifest;

		return JSON.parse(res.toString()) as RomManifest;
	}
	else return null;
}

async function yaml2Json(progress?: ProgressReporter): Promise<void> {
	try {
		const yamlfiles = await getAllFiles('./src', [], '.yaml');
		await Promise.all(yamlfiles.map(async (file) => {
			const doc = yaml.load(await readFile(file, 'utf8'));
			const outfilename = file.replace('.yaml', '.json');
			await writeFile(outfilename, Buffer.from(encodeuint8arr(JSON.stringify(doc))));
		}));
		if (progress) progress.taskCompleted();
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
async function esbuild(romname: string, bootloader_path: string, progress?: ProgressReporter): Promise<void> {
	const bootloader_ts_path = `${bootloader_path}/bootloader.ts`;
	try {
		await build({
			entryPoints: [bootloader_ts_path], // Entry point for the rompack
			bundle: true, // Bundle all dependencies into a single file
			sourcemap: 'inline', // Include inline source maps for debugging
			sourcesContent: false, // Do not include source content in the output
			outfile: `./rom/${romname}.js`, // Output file for the bundled code
			platform: 'browser', // Target platform for the bundle
			target: ['es2020'], // Specify the ECMAScript version to target
			loader: { '.glsl': 'text' }, // Handles GLSL files as text
			define: { 'process.env.NODE_ENV': '"production"' }, // Define environment variables for the build
			minifyWhitespace: true, // Minify whitespace in the output
			minifySyntax: true, // Minify syntax in the output
			mangleQuoted: false, // Do not mangle quoted identifiers (required to fetch rompack resources correctly)
			external: ['node_modules', 'dist', 'rom', 'ts-key-enum'], // Exclude these directories from the bundle
			treeShaking: true, // Enable tree shaking to remove unused code
		});
		if (progress) progress.taskCompleted();
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
async function buildGameHtmlAndManifest(rom_name: string, title: string, short_name: string, progress?: ProgressReporter): Promise<any> {
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
		romjs = (await readFile("./rom/rom.js", 'utf8')).replace('Object.defineProperty(exports, "__esModule", { value: true });', '');
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

					if (progress) progress.taskCompleted();
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
function parseAudioMeta(filename: string): { sanitizedName: string, meta: AudioMeta; } {
	const priorityregex = /@p\=\d+/;
	const priorityresult = priorityregex.exec(filename);
	const prioritystr = priorityresult ? priorityresult[0] : undefined;
	const priority = prioritystr ? parseInt(prioritystr.slice(3)) : 0;

	const loopregex = /@l\=\d+(,\d+)?/;
	const loopresult = loopregex.exec(filename);
	const loopstr = loopresult ? loopresult[0] : undefined;
	const loop = loopstr ? parseFloat(loopstr.replace(',', '.').slice(3)) : null;

	const sanitized = filename.replace(priorityregex, '').replace(loopregex, '').replace('@m', '');
	return {
		sanitizedName: sanitized,
		meta:
		{
			audiotype: filename.indexOf('@m') >= 0 ? 'music' : 'sfx',
			priority: priority,
			loop: loop!
		}
	};
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
function getResMetaByFilename(filepath: string): { name: string, ext: string, type: string; } {
	const name = parse(filepath).name.replace(' ', '').toLowerCase();
	const ext = parse(filepath).ext.toLowerCase();
	let type: string;

	switch (name) {
		case 'romlabel':
			if (ext === '.png')
				return { name: name, ext: ext, type: 'romlabel' };
	}

	switch (ext) {
		case '.wav':
			type = 'audio';
			break;
		case '.js':
			type = 'source';
			break;
		case '.rommanifest':
			type = 'rommanifest';
			break;
		case '.png':
		default:
			type = 'image';
			break;
	}
	return { name: name, ext: ext, type: type };
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
				result.push({ filepath: filepath, name: name, ext: ext, type: type, id: imgid });
				++imgid;
				break;
			case 'audio':
				let parsedMeta = parseAudioMeta(name);
				name = parsedMeta.sanitizedName;
				result.push({ filepath: filepath, name: name, ext: ext, type: type, id: sndid });
				++sndid;
				break;
			case 'romlabel':
				result.push({ filepath: filepath, name: name, ext: ext, type: type, id: undefined });
				break;
			case 'rommanifest':
				result.push({ filepath: filepath, name: name, ext: ext, type: type, id: undefined });
				break;
		}
	}
	if (GENERATE_AND_USE_TEXTURE_ATLAS) {
		result.push({ filepath: undefined, name: '_atlas', ext: undefined, type: 'atlas', id: imgid }); // Note that 'atlas' is an internal type, used only for this script
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
	checkDuplicateIds('image');
	checkDuplicateIds('audio');

	return result;
}

/**
 * Loads an image from the specified `ResourceMeta` object.
 * @param _meta The `ResourceMeta` object containing information about the image to load.
 * @returns A Promise that resolves with the loaded image.
 */
async function load_img(_meta: ResourceMeta) {
	const base64Encoded = await readFile(_meta.filepath!, 'base64');
	const dataURL = `data:image/png;base64,${base64Encoded}`;
	return await loadImage(dataURL);
}


/**
 * Builds a list of loaded resources located at `respath` for the specified `romname`.
 * @param respath The path to the resources to include in the list.
 * @param buffers An array of buffers to add the loaded resources to.
 * @param rom_name The name of the ROM pack to build the list for.
 * @returns An array of loaded resources.
 */
async function getLoadedResourcesList(respath: string, buffers: Array<Buffer>, rom_name: string): Promise<ILoadedResource[]> {
	const resMetaList = await getResMetaList(respath, rom_name);
	let loadedResources: Array<ILoadedResource> = [];

	// Parallelize buffer and image loading
	const resourcePromises = resMetaList.map(async (meta) => {
		const name = meta.name;
		const ext = meta.ext;
		const type = meta.type;
		const id = meta.id;
		const buffer = meta.filepath ? await readFile(meta.filepath) : null;
		let img: any = undefined;
		if (type === 'image' && GENERATE_AND_USE_TEXTURE_ATLAS) {
			img = await load_img(meta);
		}
		return { buffer: buffer!, filepath: meta.filepath, name: name, ext: ext, type: type, img: img, id: id };
	});
	loadedResources = await Promise.all(resourcePromises);

	const megarom_filename = `${rom_name}.js`;
	const filepath = `./rom/${megarom_filename}`;
	// Manually add the ROM source code to the list
	loadedResources.push({
		buffer: await readFile(filepath),
		filepath: filepath,
		name: megarom_filename,
		ext: '.js',
		type: 'source',
		id: 1
	});

	if (GENERATE_AND_USE_TEXTURE_ATLAS) {
		// Sort the files on buffer size for atlassing
		// Also: place the atlas in the back, so that we can correctly use the bufferpointer to point to the atlas
		loadedResources = loadedResources.sort((b1, b2) => ((b1.type === 'atlas' ? 1 : 0) - (b2.type === 'atlas' ? 1 : 0)));
		// Also: place the romlabel in front, so that it is put at the start of the rom and will be recognized as a proper image
		loadedResources = loadedResources.sort((b1, b2) => ((b1.type === 'romlabel' ? 0 : 1) - (b2.type === 'romlabel' ? 0 : 1)));
	}
	if (GENERATE_AND_USE_TEXTURE_ATLAS && DONT_PACK_IMAGES_WHEN_USING_ATLAS) {
		loadedResources.filter(x => x.type !== 'image' && x.type !== 'atlas' && x.type !== 'romlabel').forEach(x => buffers.push(x.buffer));
	}
	else {
		loadedResources.filter(x => x.type !== 'romlabel').forEach(x => buffers.push(x.buffer));
	}
	return loadedResources;
}

/**
 * Builds a list of resources located at `respath` for the specified `romname`.
 * @param respath The path to the resources to include in the list.
 * @param romname The name of the ROM pack to build the list for.
 */
async function buildResourceList(respath: string, romname?: string) {
	const tsimgout = new Array<string>();
	const tssndout = new Array<string>();
	const metalist = await getResMetaList(respath, romname);

	tsimgout.push(BOILERPLATE_RESOURCE_ID_BITMAP);
	tssndout.push(BOILERPLATE_RESOURCE_ID_AUDIO);

	for (let i = 0; i < metalist.length; i++) {
		const current = metalist[i];

		const type = current.type;
		const name = current.name;
		switch (type) {
			case 'image':
			case 'atlas':
				const property_to_add = `\t${name} = '${name}',`;
				tsimgout.push(`${property_to_add}`);
				break;
			case 'audio':
				const enummember_to_add = `\t${name} = '${name}',`;
				tssndout.push(`${enummember_to_add}`);
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
 * Builds a ROM pack for a given title, loading required resources, optionally generating
 * a texture atlas, and finalizing the packed output.
 *
 * @param rom_name - The name of the ROM, used when creating the output file.
 * @param respath - The base path to the resource files used in the ROM pack.
 * @returns A promise that resolves when the ROM pack creation is complete.
 */
async function buildRompack(rom_name: string, respath: string, progress?: ProgressReporter): Promise<void> {
	const outfile = rom_name.concat('.rom');
	const megarom_filename = `${rom_name}.js`;
	const megarom_filepath = `./rom/${megarom_filename}`;

	const buffers: Buffer[] = [];
	const loadedResources = await getLoadedResourcesList(respath, buffers, rom_name);
	if (progress) progress.taskCompleted();

	let generated_atlas: HTMLCanvasElement | undefined;
	if (GENERATE_AND_USE_TEXTURE_ATLAS) {
		generated_atlas = createOptimizedAtlas(loadedResources);
	}
	if (progress) progress.taskCompleted();

	const { jsonout, bufferPointer, romlabel_buffer } = processResources(loadedResources, generated_atlas);

	if (GENERATE_AND_USE_TEXTURE_ATLAS && generated_atlas) {
		await handleAtlas(loadedResources, generated_atlas, jsonout, bufferPointer, buffers, progress);
	}

	await finalizeRompack(jsonout, buffers, romlabel_buffer, outfile, progress);
}

/**
 * Processes an array of loaded resources to produce metadata and allocate buffer ranges.
 *
 * @remarks
 * This function iterates over the given resources and creates corresponding entries in
 * a metadata array. Depending on the resource type, the function may parse additional data
 * (such as audio metadata) or adjust resource names (e.g., `.min` filenames). An optional
 * texture atlas can be used to bundle image data.
 *
 * @param loadedResources - The array of loaded resources to process.
 * @param generated_atlas - An optional canvas element used for generating texture atlas data.
 * @returns An object with three properties:
 * - `jsonout` - The array of generated metadata objects.
 * - `bufferPointer` - The current offset in the resource buffer after processing.
 * - `romlabel_buffer` - The buffer data for the "romlabel.png" resource if present.
 */
function processResources(loadedResources: ILoadedResource[], generated_atlas?: HTMLCanvasElement) {
	const jsonout: RomAsset[] = [];
	let bufferPointer = 0;
	let romlabel_buffer: Buffer | undefined;

	for (let i = 0; i < loadedResources.length; i++) {
		const res = loadedResources[i];
		const type = res.type;
		let name = res.name;
		const resid = res.id;

		switch (type) {
			case 'romlabel':
				if (i > 0) throw new Error('"romlabel.png" must appear at start of the ResourceMeta-list!');
				romlabel_buffer = res.buffer;
				break;
			case 'image':
				const imgmeta = buildImgMeta(res, generated_atlas);
				const baseJson = { resid, resname: name, type, imgmeta };
				if (GENERATE_AND_USE_TEXTURE_ATLAS && !DONT_PACK_IMAGES_WHEN_USING_ATLAS) {
					jsonout.push({ ...baseJson, start: bufferPointer, end: bufferPointer + res.buffer.length });
					bufferPointer += res.buffer.length;
				} else {
					jsonout.push({ ...baseJson, start: 0, end: 0 });
				}
				break;
			case 'audio':
				const parsedMeta = parseAudioMeta(res.filepath);
				jsonout.push({ resid, resname: name, type, start: bufferPointer, end: bufferPointer + res.buffer.length, imgmeta: undefined, audiometa: parsedMeta.meta });
				bufferPointer += res.buffer.length;
				break;
			case 'source':
				name = name.replace('.min', '');
				jsonout.push({ resid, resname: name, type, start: bufferPointer, end: bufferPointer + res.buffer.length, imgmeta: undefined, audiometa: undefined });
				bufferPointer += res.buffer.length;
				break;
			case 'atlas':
			case 'rommanifest':
				break;
		}
	}
	return { jsonout, bufferPointer, romlabel_buffer };
}

/**
 * Generates metadata for an image resource, optionally integrating texture atlas data.
 *
 * @param res - The loaded resource containing the image and any existing metadata.
 * @param generated_atlas - An optional canvas element where an atlas has been generated.
 * @returns An object containing image dimensions, bounding boxes, center point, and (if atlas usage is enabled) texture coordinates.
 */
function buildImgMeta(res: ILoadedResource, generated_atlas?: HTMLCanvasElement): ImgMeta {
	const img = res.img;
	const img_boundingbox = BoundingBoxExtractor.extractBoundingBox(img);
	const img_boundingbox_precalc = BoundingBoxExtractor.generateFlippedBoundingBox(img, img_boundingbox);
	const img_centerpoint = BoundingBoxExtractor.calculateCenterPoint(img_boundingbox);

	// Extract original polygons
	const img_polygon = BoundingBoxExtractor.extractConcavePolygon(img);
	// Generate flipped variants for polygons
	function flipPolygons(polys: vec2[][], flipH: boolean, flipV: boolean): vec2[][] {
		return polys.map(poly => poly.map(pt => ({
			x: flipH ? img.width - 1 - pt.x : pt.x,
			y: flipV ? img.height - 1 - pt.y : pt.y
		})));
	}
	const polygon = {
		original: img_polygon,
		fliph: flipPolygons(img_polygon, true, false),
		flipv: flipPolygons(img_polygon, false, true),
		fliphv: flipPolygons(img_polygon, true, true)
	};

	let imgmeta: ImgMeta = {
		atlassed: false,
		width: img.width,
		height: img.height,
		boundingbox: img_boundingbox_precalc,
		centerpoint: img_centerpoint,
		concavepolygons: polygon
	};
	if (GENERATE_AND_USE_TEXTURE_ATLAS) {
		imgmeta = {
			...imgmeta,
			atlassed: res.imgmeta.atlassed,
			texcoords: res.imgmeta.texcoords,
			texcoords_fliph: res.imgmeta.texcoords_fliph,
			texcoords_flipv: res.imgmeta.texcoords_flipv,
			texcoords_fliphv: res.imgmeta.texcoords_fliphv,
		};
	}
	return imgmeta;
}

/**
 * Asynchronously processes the loaded atlas resource and updates the JSON output with metadata.
 *
 * @param loadedResources - An array of loaded resources, including the atlas to be processed.
 * @param generated_atlas - The HTMLCanvasElement representing the generated atlas image.
 * @param jsonout - An array of RomAsset objects to be updated with image metadata.
 * @param bufferPointer - The starting position where atlas data should be written in the output buffers.
 * @param buffers - An array of Buffers where the atlas image data will be appended.
 * @returns A Promise that resolves once the atlas image is written to disk and metadata is updated.
 */
async function handleAtlas(
	loadedResources: ILoadedResource[],
	generated_atlas: HTMLCanvasElement,
	jsonout: RomAsset[],
	bufferPointer: number,
	buffers: Buffer[],
	progress?: ProgressReporter
) {
	const i = loadedResources.findIndex(x => x.type === 'atlas');
	const atlasSize = { x: generated_atlas.width, y: generated_atlas.height };
	const atlasbuffer: Buffer = (<any>generated_atlas).toBuffer('image/png');
	buffers.push(atlasbuffer);

	jsonout.push({
		resid: loadedResources[i].id,
		resname: loadedResources[i].name,
		type: 'image',
		start: bufferPointer,
		end: bufferPointer + atlasbuffer.length,
		imgmeta: { atlassed: false, width: atlasSize.x, height: atlasSize.y },
		audiometa: undefined
	});
	await writeFile("./rom/_ignore/atlas.png", atlasbuffer);
	if (progress) progress.taskCompleted();
}

/**
 * Finalizes a ROM pack by concatenating buffers, generating metadata,
 * writing zipped output to disk, and exporting a JSON file that
 * references the assets used in the ROM pack.
 *
 * @param jsonout - An array of ROM assets describing the mappings to be finalized.
 * @param buffers - The buffers that will be concatenated and zipped.
 * @param romlabel_buffer - An optional buffer representing any additional
 *                          ROM label or header information.
 * @param outfile - The name of the output file to which the ROM pack is written.
 * @returns A promise that resolves when all files have been successfully written.
 */
async function finalizeRompack(
	jsonout: RomAsset[],
	buffers: Buffer[],
	romlabel_buffer: Buffer | undefined,
	outfile: string,
	progress?: ProgressReporter
) {
	const jsonbuffer = Buffer.from(encodeuint8arr(JSON.stringify(jsonout)));
	buffers.push(jsonbuffer);

	const bufferPointer = buffers.reduce((acc, buf) => acc + buf.length, 0) - jsonbuffer.length;
	const rommeta: RomMeta = { start: bufferPointer, end: bufferPointer + jsonbuffer.length };
	const rom_meta_string = JSON.stringify(rommeta).padStart(100, ' ');
	buffers.push(Buffer.from(encodeuint8arr(rom_meta_string)));
	const all_buffers = Buffer.concat(buffers);
	const zipped = zip(all_buffers);
	const blobmeta: RomMeta = {
		start: romlabel_buffer?.length ?? 0,
		end: zipped.length + (romlabel_buffer?.length ?? 0)
	};
	const blob_meta_string = JSON.stringify(blobmeta).padStart(100, ' ');
	const blob_meta_as_buffer = Buffer.from(encodeuint8arr(blob_meta_string));

	if (progress) progress.taskCompleted();
	await writeFile(`./dist/${outfile}`, Buffer.concat([romlabel_buffer ?? Buffer.alloc(0), zipped, blob_meta_as_buffer]));
	await writeFile("./rom/_ignore/romresources.json", jsonbuffer);
	if (progress) progress.taskCompleted();
}

async function deployToServer(rom_name: string, title: string) {
	throw new Error('Deploy is not implemented yet!');
}

/**
 * Checks if the TypeScript file for the ROM loader is newer than its compiled output
 * and compiles it if needed. This function ensures that the output is always up to date.
 *
 * @throws {Error} Will throw if the rom.ts file does not exist or if compilation fails.
 * @returns {Promise<void>} A promise that resolves once the compilation process is complete
 *                         or if no action is needed.
 */
async function compileRomLoaderScriptIfNewer(progress?: ProgressReporter) {
	const romTsPath = join(__dirname, '../scripts/rom.ts');
	const romJsPath = join(__dirname, '../rom/rom.js');
	const romTsDir = dirname(romTsPath);

	try {
		await access(romTsPath);
	} catch {
		throw new Error(`rom.ts could not be found at "${romTsPath}"`);
	}

	const romTsStats = await stat(romTsPath);
	let romJsStats: Stats | undefined;

	try {
		await access(romJsPath);
		romJsStats = await stat(romJsPath);
	}
	catch { } // Ignore error if rom.js does not exist yet
	if (progress) progress.taskCompleted();

	if (!romJsStats || romTsStats.mtime > romJsStats.mtime) {
		return new Promise<void>((resolve, reject) => {
			try {
				exec(`npx tsc ${romTsPath} --removeComments -m commonjs -t ES2020 --rootDir "." --outDir ${join(__dirname, '../rom/')}`,
					{ cwd: romTsDir }, (error, stdout, stderr) => {
						if (error || stderr) {
							throw new Error(`Error while compiling "rom.ts": ${error?.message ?? stderr}`);
						} else {
							if (progress) progress.taskCompleted();
							resolve();
						}
					});
			} catch (e) {
				throw new Error(`Error while compiling "rom.ts": ${e?.message ?? e}`);
			}
		});
	}
	// rom.js is newer or up to date. No need to compile
	if (progress) progress.taskCompleted();
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
			throw new Error(`Directory "${dir}" bestaat niet!`);
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
			{ type: 'activityIndicator', kerning: 1, length: 1 },
			{ type: 'section', kerning: 1, default: '' },
			{ type: 'subsection', kerning: 1, default: '' },
		]);
		this.tasks = [...tasks];
		this.totalTasks = tasks.length;
	}

	public taskCompleted() {
		this.completedTasks++;
		const progressPercentage = this.completedTasks / this.totalTasks;
		if (this.tasks.length) {
			const currentTask = this.tasks.shift()!;
			this.gauge.show(currentTask, progressPercentage);
			this.gauge.pulse();
		} else {
			this.showDone();
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

	public removeLastTask() {
		if (this.tasks.length) {
			this.tasks.pop();
			this.totalTasks--;
		}
	}

	public showDone() {
		this.gauge.show('ALLES DONUT', 1);
		this.gauge.pulse();
	}

	public pulse() {
		this.gauge.pulse();
	}
}

async function main() {
	const outputError = (e: any) => writeOut(`\n[GEFAALD]\nEr ging iets niet goed:\n${e?.message ?? e ?? 'Geen error message'};\n${e?.stack ?? 'Geen stacktrace.'}\n`, 'error');
	const taskList = [
		'Rom manifest zoekeren en parseren',
		'Game compileren+bundleren',
		'YAML bestanden omzetten in JSON voor importatie',
		'Resource bestanden inladen en bufferen',
		'Textuuratlas bouwen die gierig-optimaal klein is',
		'Resource bibliotheek bouwen for in rompakket',
		'Totale rompakket wegschrijven',
		'Check "rom.ts" vereist recompilatie',
		'"rom.ts" compileren (als nodig)',
		'game.html en game_debug.html bouwen',
		'Deployeren'
	];
	const progress = new ProgressReporter(taskList);
	try {
		// #region stuff
		term.terminal.clear();
		writeOut(_colors.brightGreen.bold('┏————————————————————————————————————————————————————————————————————————————————┓\n'));
		writeOut(_colors.brightGreen.bold('|                          BMSX ROMPACKER DOOR BOAZ©®™                           |\n'));
		writeOut(_colors.brightGreen.bold('┗————————————————————————————————————————————————————————————————————————————————┛\n'));
		const args = process.argv.slice(2);
		let { title, rom_name, bootloader_path, respath, force, buildreslist, deploy } = parseOptions(args);

		if (buildreslist) {
			if (!respath) {
				throw new Error("Missing parameter for location of the resource folder ('respath', e.g. './src/testrom/res'.");
			}
			writeOut(`Building resource list and writing output to "${respath}"...\n`);
			writeOut('Note: ROM packing and deployment are skipped.\n');
			await buildResourceList(respath);
			writeOut(`\n${_colors.brightWhite.bold('[Resource list bouwen ge-DONUT]')}\n`);
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
			writeOut(`Note: Recompilation and Building forced via ${_colors.brightRed.bold('--force')}\n`);
		}
		if (!deploy) writeOut(`Note: Deploy to FTP server disabled via ${_colors.brightRed.bold('--nodeploy')}\n`);
		writeOut(`Starting ROM packing and deployment process for ROM ${_colors.brightBlue.bold(`${rom_name}`)}...\n`);
		progress.showInitial();

		try {
			let romManifest: RomManifest;
			let short_name: string = 'BMSX';
			romManifest = await getRomManifest(respath);
			progress.taskCompleted();
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

			if (!deploy) progress.removeLastTask();
			if (!rebuildRequired) {
				progress.skipTasks(4);
			}

			// #endregion
			if (rebuildRequired) {
				await esbuild(rom_name, bootloader_path, progress);
				await yaml2Json(progress);
				await buildRompack(rom_name, respath, progress);
			}
			await compileRomLoaderScriptIfNewer(progress);
			await buildGameHtmlAndManifest(rom_name, title, short_name, progress);
			if (deploy) {
				await deployToServer(rom_name, title); progress.taskCompleted();
			}
			progress.showDone();
			await timer(100);
		} catch (e) {
			progress.pulse();
			outputError(e);
		}
	} catch (e) {
		outputError(e);
	}
}

main();