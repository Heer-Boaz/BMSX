import { createOptimizedAtlas } from './atlasbuilder';
import { createWriteStream, Stats } from 'fs';
import { join, parse } from 'path';
import { AudioMeta, RomAsset, RomMeta, ImgMeta, Area, vec2, AudioType, BoundingBoxesPrecalc, BoundingBoxPrecalc } from './rompacker.rompack';
import { exec } from 'child_process';
const Gauge = require('gauge');
import * as browserify from 'browserify';
const tsify = require('tsify');

import * as terser from 'terser';
import * as term from 'terminal-kit';
import { access, copyFile, readFile, writeFile, readdir, stat, rm } from 'fs/promises';
const _colors = require('colors');
const pako = require('pako');
const minify = require('@node-minify/core');
const cleanCSS = require('@node-minify/clean-css');
const FtpDeploy = require('ftp-deploy');
const { loadImage } = require('canvas');
const yaml = require('js-yaml');
import { Image, createCanvas } from 'canvas';

const GENERATE_AND_USE_TEXTURE_ATLAS = true;
const DONT_PACK_IMAGES_WHEN_USING_ATLAS = true;

const BOILERPLATE_RESOURCE_ID_BITMAP = `export enum BitmapId {
	none = 'none',
`; // Note: cannot use const enums here, because BFont uses BitmapId as a type (and const enums are not available at runtime)

const BOILERPLATE_RESOURCE_ID_AUDIO = `export enum AudioId {
	none = 'none',
`;

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
	let d = new Date();
	let tolog: string;
	switch (type) {
		case 'error': tolog = _colors.red(_tolog); break;
		case 'warning': tolog = _colors.yellow(_tolog); break;
		default: tolog = _tolog; break;
	}
	term.terminal(`${tolog}`);
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
async function getFiles(dirPath: string, arrayOfFiles?: string[], filterExtension?: string) {
	return getAllNonRootDirs(dirPath, arrayOfFiles, filterExtension);
}

async function getAllNonRootDirs(dirPath: string, arrayOfFiles: string[] = [], filterExtension?: string) {
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

async function getAllFiles(dirPath: string, _arrayOfFiles?: string[], filterExtension?: string) {
	let files = await readdir(dirPath);

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
	let files = await getAllFiles(dirPath, [], '.rommanifest');

	if (files.length > 1) {
		throw new Error(`More than one rommanifest found in ${dirPath}.`);
	}
	else if (files.length === 1) {
		let res = await readFile(files[0]);
		// Read the rommanifest file
		JSON.parse(res.toString()) as RomManifest;

		return JSON.parse(res.toString()) as RomManifest;
	}
	else return null;
}

async function yaml2Json(): Promise<void> {
	try {
		let yamlfiles = await getAllFiles('./src', [], '.yaml');
		for (let file of yamlfiles) {
			let doc = yaml.load(await readFile(file, 'utf8'));
			let outfilename = file.replace('.yaml', '.json');
			await writeFile(outfilename, Buffer.from(encodeuint8arr(JSON.stringify(doc))));
		}
		taakAfgevinkt();
	}
	catch (err) {
		console.error(err);
	}
}

/**
 * Builds and bundles the source code for a ROM.
 * @param {string} romname - The name of the ROM.
 * @param {string} bootloader_path - The path to the bootloader file.
 * @returns {Promise<any>} A promise that resolves when the ROM source code has been built and bundled.
 */
async function buildAndBundleRomSource(romname: string, bootloader_path: string): Promise<any> {
	const bootloader_ts_path = `${bootloader_path}/bootloader.ts`;
	return new Promise((resolve, reject) => {
		try {
			let writeOutput = createWriteStream(`./rom/${romname}.js`);
			browserify({
				debug: true,
				basedir: '.',
				// project: true,
				cache: {},
				packageCache: {},
				exposeAll: true,
				exclude: [],
				ignore: ['node_modules', 'dist', 'rom'],
				// standalone: 'bootrom',
				entries: [bootloader_ts_path], // Note: this is the entry point for the bundler
			})
				.add(bootloader_ts_path)
				.plugin(tsify, {
					noImplicitAny: false,
					files: [bootloader_ts_path],
					project: bootloader_path,
				})
				.bundle()
				.on('error', e => {
					reject(e);
				})
				.pipe(writeOutput);
			writeOutput.on('finish', () => {
				taakAfgevinkt();
				resolve(null);
			});
			writeOutput.on('error', e => {
				reject(e);
			});
		} catch (err) {
			reject(err);
		}
	});
}

async function minifyGamecode(infile: string): Promise<terser.MinifyOutput> {
	try {
		let options = <terser.MinifyOptions>{
			ecma: 2020,
			sourceMap: false,
			keep_fnames: /^_/,
			keep_classnames: true,
			compress: <terser.CompressOptions>{
				passes: 3, // The maximum number of times to run compress. In some cases more than one pass leads to further compressed code. Keep in mind more passes will take more time
				ecma: 2020,
				collapse_vars: true,
				join_vars: true,
				loops: true,
				sequences: true,
				switches: true,
				drop_console: true,
			},
			mangle: <terser.MangleOptions>{
				reserved:
					[
						"exports",
						"global",
						"factory",
						"__extends",
						"__assign",
						"__rest",
						"__decorate",
						"__param",
						"__metadata",
						"__awaiter",
						"__generator",
						"__exportStar",
						"__values",
						"__read",
						"__spread",
						"__spreadArrays",
						"__await",
						"__asyncGenerator",
						"__asyncDelegator",
						"__asyncValues",
						"__makeTemplateObject",
						"__importStar",
						"__importDefault",
					],
				properties: false,
			},
			output: <terser.FormatOptions>{
				ecma: 2020,
				safari10: false,
				webkit: true,
				semicolons: true, // Must be true for Safari support (on iOS)! Otherwise, only black screen shows
				keep_quoted_props: true,
				keep_numbers: true,
				source_map: null,
				comments: false,
			},
		};

		let gamejs = await readFile(infile, 'utf8');
		let gamejsMinifiedResult = terser.minify(gamejs, options);
		return gamejsMinifiedResult;
	}
	catch (err) {
		return err;
	}
}

/**
 * Builds the game HTML and manifest files for the specified ROM.
 * @param {string} rom_name - The name of the ROM.
 * @param {string} title - The title of the game.
 * @returns {Promise<any>} A promise that resolves when the game HTML and manifest files have been built.
 */
async function buildGameHtmlAndManifest(rom_name: string, title: string, short_name: string): Promise<any> {
	let html, romjs, zipjs;
	try {
		html = await readFile("./gamebase.html", 'utf8');
		romjs = (await readFile("./rom/rom.js", 'utf8')).replace('Object.defineProperty(exports, "__esModule", { value: true });', '');
		zipjs = await readFile("./scripts/pako_inflate.min.js", 'utf8');
	} catch (error) {
		throw new Error(`Error reading files while building HTML and Manifest files: ${error.message}`);
	}
	let options = {
		compress: {
			arrows: false
		},
		mangle: {
			toplevel: false,
			reserved: ["bootrom", "h406A", "rom"],
			safari10: true,
		},
		output: {
			safari10: true,
			webkit: true,
		}
	};
	let romjsMinified = (await terser.minify(romjs, options)).code!;
	let bmsx;
	try {
		bmsx = await readFile("./rom/bmsx.png");
	}
	catch (error) {
		throw new Error(`Error reading file "${__dirname}/rom/bmsx.png": ${error.message}`);
	}
	let bmsx_base64ed = bmsx.toString('base64');

	return new Promise<any>((resolve, reject) => {
		minify({
			compressor: cleanCSS,
			input: "./gamebase.css",
			output: "./gamebase.min.css",
			callback: async (err, cssMinified: string) => {
				if (!cssMinified) {
					reject(err);
				}

				let transformHtml = async (htmlToTransform: string, debug: boolean) => {
					return htmlToTransform.replace('//#romjs', debug ? romjs : romjsMinified)
						.replace('//#zipjs', zipjs)
						.replace('/*css*/', cssMinified)
						.replace(/#title/g, title) // https://stackoverflow.com/questions/44324892/how-can-i-replace-multiple-characters-in-a-string
						.replace('#romname', `${rom_name}`)
						.replace('#outfile', `${rom_name}.rom`)
						.replace('#bmsxurl', "data:image/png;base64," + bmsx_base64ed)
						.replace('//#debug', `bootrom.debug = ${debug};\n`)
				};
				writeFile("./dist/game.html", await transformHtml(html, false));
				writeFile("./dist/game_debug.html", await transformHtml(html, true));

				// Update the manifest.json-file that is used for app-versions of the webpage
				let manifest = (await readFile("./rom/manifest.json", 'utf8')).replace('#title', title).replace('#short_name', short_name);

				// Write updated manifest to dist-folder
				await writeFile("./dist/manifest.webmanifest", manifest);

				taakAfgevinkt();
				resolve(null);
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
	let priorityregex = /@p\=\d+/;
	let priorityresult = priorityregex.exec(filename);
	let prioritystr = priorityresult ? priorityresult[0] : undefined;
	let priority = prioritystr ? parseInt(prioritystr.slice(3)) : 0;

	let loopregex = /@l\=\d+(,\d+)?/;
	let loopresult = loopregex.exec(filename);
	let loopstr = loopresult ? loopresult[0] : undefined;
	let loop = loopstr ? parseFloat(loopstr.replace(',', '.').slice(3)) : null;

	let sanitized = filename.replace(priorityregex, '').replace(loopregex, '').replace('@m', '');
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

function zip(content: Buffer): Uint8Array {
	let toCompress = new Uint8Array(content);
	return pako.deflate(toCompress);
}

async function deploy(romname: string, title: string): Promise<any> {
	return new Promise<any>((resolve, reject) => {
		const outfile = romname.concat('.rom');
		const ftpDeploy = new FtpDeploy();

		ftpDeploy.on("upload-error", function (data) {
			// Error already handled through catch.
			// This handler will remove default handler that outputs error message
			// reject(data.err); // data will also include filename, relativePath, and other goodies
		});

		const config = {
			user: "boazpat_el@ziggo.nl",
			password: "lars18th",
			host: "homedrive.ziggo.nl",
			port: 21,
			localRoot: "./dist",
			remoteRoot: `/${title.toLowerCase()}/`,
			// include: ["*", "**/*"],      // this would upload everything except dot files
			include: [outfile, "*.html", "manifest.*"],
			// e.g. exclude sourcemaps, and ALL files in node_modules (including dot files)
			exclude: [],//"dist/**/*.map", "node_modules/**", "node_modules/**/.*", ".git/**"],
			// delete ALL existing files at destination before uploading, if true
			deleteRemote: false,
			// Passive mode is forced (EPSV command is not sent)
			forcePasv: true
		};

		ftpDeploy
			.deploy(config)
			.then(res => {
				taakAfgevinkt();
				resolve(null);
			})
			.catch(err => {
				reject(err);
			});
	});
	// import simpleGit, { SimpleGit } from 'simple-git';

	// async function deploy(romname: string, title: string): Promise<any> {
	//     return new Promise<any>((resolve, reject) => {
	//         log("Deploying... ");
	//         const outfile = romname.concat('.rom');
	//         const localRoot = "./dist";
	//         const git: SimpleGit = simpleGit();

	//         git.init()
	//             .then(() => git.addConfig('user.name', 'Your Name'))
	//             .then(() => git.addConfig('user.email', 'Your Email'))
	//             .then(() => git.add('./*'))
	//             .then(() => git.commit('Auto-deploy commit'))
	//             .then(() => git.addRemote('origin', 'https://username:password@github.com/username/repo.git'))
	//             .then(() => git.push('origin', 'master'))
	//             .then(() => resolve(null))
	//             .catch((err: any) => reject(err));
	//     });
	// }

}

/**
 * Returns an object containing the name, extension, and type of a resource file based on its filepath.
 * @param filepath The path of the resource file.
 * @returns An object containing the name, extension, and type of the resource file.
 */
function getResMetaByFilename(filepath: string): { name: string, ext: string, type: string; } {
	let name = parse(filepath).name.replace(' ', '').toLowerCase();
	let ext = parse(filepath).ext.toLowerCase();
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
async function getResMetaList(respath: string, romname: string) {
	let arrayOfFiles = await getFiles(respath) ?? []; // Also handle corner case where we don't have any resources by adding "?? []"
	const megarom_filename = `${romname}.min.js`;
	addFile("./rom", megarom_filename, arrayOfFiles); // Add source at the end

	let result: Array<ResourceMeta> = [];

	let imgid = 1;
	let sndid = 1;
	for (let i = 0; i < arrayOfFiles.length; i++) {
		let filepath = arrayOfFiles[i];
		let meta = getResMetaByFilename(filepath);

		let type = meta.type;
		let name = meta.name;
		let ext = meta.ext;
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

function extractBoundingBox(image: Image): Area {
	const canvas = createCanvas(image.width, image.height);
	const context = canvas.getContext('2d');

	context.drawImage(image, 0, 0, image.width, image.height);

	const imageData = context.getImageData(0, 0, image.width, image.height);
	const data = imageData.data;

	let startx = image.width, starty = image.height, endx = 0, endy = 0;
	let totalWeightX = 0, totalWeightY = 0;
	let totalAlpha = 0;

	for (let y = 0; y < image.height; y++) {
		for (let x = 0; x < image.width; x++) {
			const index = (y * image.width + x) * 4;
			const alpha = data[index + 3];

			if (alpha !== 0) {
				startx = Math.min(startx, x);
				starty = Math.min(starty, y);
				endx = Math.max(endx, x);
				endy = Math.max(endy, y);

				totalWeightX += x * alpha;
				totalWeightY += y * alpha;
				totalAlpha += alpha;
			}
		}
	}

	// const weightedCenterX = totalAlpha ? totalWeightX / totalAlpha : 0;
	// const weightedCenterY = totalAlpha ? totalWeightY / totalAlpha : 0;

	// // Adjust bounding box based on weighted average
	// const width = endx - startx;
	// const height = endy - starty;

	// const adjustedStartX = Math.max(startx, weightedCenterX - width / 2);
	// const adjustedEndX = Math.min(endx, weightedCenterX + width / 2);
	// const adjustedStartY = Math.max(starty, weightedCenterY - height / 2);
	// const adjustedEndY = Math.min(endy, weightedCenterY + height / 2);

	// return { start: { x: ~~adjustedStartX, y: ~~adjustedStartY }, end: { x: ~~adjustedEndX, y: ~~adjustedEndY } };
	return { start: { x: ~~startx, y: ~~starty }, end: { x: ~~endx, y: ~~endy } };
}

function extractBoundingBoxes(image: Image, extractedBoundingBox: Area, boxsize: number = 8): Area[] {
	function adjustBoundingBoxes(image: Image, boundingBoxes: Area[]): Area[] {
		const imageBoundingBox = extractedBoundingBox;

		return boundingBoxes.map(box => ({
			start: {
				x: Math.max(imageBoundingBox.start.x, box.start.x),
				y: Math.max(imageBoundingBox.start.y, box.start.y),
			},
			end: {
				x: Math.min(imageBoundingBox.end.x, box.end.x),
				y: Math.min(imageBoundingBox.end.y, box.end.y),
			},
		}));
	}
	const canvas = createCanvas(image.width, image.height);
	const context = canvas.getContext('2d');
	context.drawImage(image, 0, 0);
	const imageData = context.getImageData(0, 0, image.width, image.height);
	const data = imageData.data;

	const boundingBoxes: Area[] = [];

	// Split the image into boxsize x boxsize pixel blocks
	for (let y = 0; y < image.height; y += boxsize) {
		for (let x = 0; x < image.width; x += boxsize) {
			let blockHasAlpha = false;

			// Check each pixel in the block
			blockLoop:
			for (let blockY = y; blockY < y + boxsize && blockY < image.height; blockY++) {
				for (let blockX = x; blockX < x + boxsize && blockX < image.width; blockX++) {
					const index = (blockY * image.width + blockX) * 4;
					if (data[index + 3] !== 0) {
						blockHasAlpha = true;
						break blockLoop;
					}
				}
			}

			// If the block has at least one non-transparent pixel, add it to the list of bounding boxes
			if (blockHasAlpha) {
				let merged = false;
				// Try to merge this block with an existing bounding box if they are adjacent and the block has non-transparent pixels
				for (let box of boundingBoxes) {
					if (y >= box.start.y && y <= box.end.y + boxsize && x >= box.start.x && x <= box.end.x + boxsize) {
						const index = (y * image.width + x) * 4;
						if (data[index + 3] !== 0) {
							box.end.x = Math.max(box.end.x, x + (boxsize - 1));
							box.end.y = Math.max(box.end.y, y + (boxsize - 1));
							merged = true;
							break;
						}
					}
				}
				// If no merge happened, add as a new bounding box
				if (!merged) {
					boundingBoxes.push({
						start: { x, y },
						end: { x: x + (boxsize - 1), y: y + (boxsize - 1) },
					});
				}
			}
		}
	}

	return adjustBoundingBoxes(image, boundingBoxes);
}

function flipBoundingBoxHorizontally(box: Area, width: number): Area {
	return {
		start: { x: width - box.end.x, y: box.start.y },
		end: { x: width - box.start.x, y: box.end.y }
	};
}

function flipBoundingBoxVertically(box: Area, height: number): Area {
	return {
		start: { x: box.start.x, y: height - box.end.y },
		end: { x: box.end.x, y: height - box.start.y }
	};
}

function generateFlippedBoundingBox(image: Image, extractedBoundingBox: Area): BoundingBoxPrecalc {
	const originalBoundingBox = extractedBoundingBox;

	const horizontalFlipped = flipBoundingBoxHorizontally(originalBoundingBox, image.width);
	const verticalFlipped = flipBoundingBoxVertically(originalBoundingBox, image.height);
	const bothFlipped = flipBoundingBoxHorizontally(flipBoundingBoxVertically(originalBoundingBox, image.height), image.width);

	return {
		original: originalBoundingBox,
		fliph: horizontalFlipped,
		flipv: verticalFlipped,
		fliphv: bothFlipped
	};
}

function generateFlippedBoundingBoxes(image: Image, extractedBoundingBoxes: Area[]): BoundingBoxesPrecalc {
	const originalBoundingBoxes = extractedBoundingBoxes;

	const horizontalFlipped = originalBoundingBoxes.map(box => flipBoundingBoxHorizontally(box, image.width));
	const verticalFlipped = originalBoundingBoxes.map(box => flipBoundingBoxVertically(box, image.height));
	const bothFlipped = originalBoundingBoxes.map(box => flipBoundingBoxHorizontally(flipBoundingBoxVertically(box, image.height), image.width));

	return {
		original: originalBoundingBoxes,
		fliph: horizontalFlipped,
		flipv: verticalFlipped,
		fliphv: bothFlipped
	};
}

function calculateCenterPoint(boundingBox: Area): vec2 {
	const middlex = (boundingBox.start.x + boundingBox.end.x) / 2;
	const middley = (boundingBox.start.y + boundingBox.end.y) / 2;

	return { x: ~~middlex, y: ~~middley };
}

// function createAsciiBoundingBoxMap(image: Image, boundingBoxes: Area[], boxsize: number = boxsize) {
//     const asciiMap: string[][] = Array.from({ length: ~~Math.ceil(image.height / boxsize) }, () => Array(~~Math.ceil(image.width / boxsize)).fill(' '));

//     for (const box of boundingBoxes) {
//         const startX = ~~Math.floor(box.start.x / boxsize);
//         const startY = ~~Math.floor(box.start.y / boxsize);
//         const endX = ~~Math.ceil(box.end.x / boxsize);
//         const endY = ~~Math.ceil(box.end.y / boxsize);

//         for (let y = startY; y < endY; y++) {
//             for (let x = startX; x < endX; x++) {
//                 asciiMap[y][x] = '#';
//             }
//         }
//     }

//     return asciiMap.map(row => row.join(''));
// }

/**
 * Builds a list of loaded resources located at `respath` for the specified `romname`.
 * @param respath The path to the resources to include in the list.
 * @param buffers An array of buffers to add the loaded resources to.
 * @param rom_name The name of the ROM pack to build the list for.
 * @returns An array of loaded resources.
 */
async function getLoadedResourcesList(respath: string, buffers: Array<Buffer>, rom_name: string): Promise<ILoadedResource[]> {
	let resMetaList = await getResMetaList(respath, rom_name);
	let loadedResources: Array<ILoadedResource> = [];
	for (let i = 0; i < resMetaList.length; i++) {
		let meta = resMetaList[i];

		let name = meta.name;
		let ext = meta.ext;
		let type = meta.type;
		let id = meta.id;
		let buffer = meta.filepath ? await readFile(meta.filepath) : null;

		let img: any = undefined;

		switch (type) {
			case 'romlabel':
				break;
			case 'image':
				if (GENERATE_AND_USE_TEXTURE_ATLAS) {
					// We only load the actual image when we need to place it in an atlas. Otherwise, we already have the buffer loaded from the resource URI
					img = await load_img(meta);
				}
				break;
		}

		loadedResources.push({ buffer: buffer!, filepath: meta.filepath, name: name, ext: ext, type: type, img: img, id: id });
	}

	const megarom_filename = `${rom_name}.min.js`;
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
async function buildResourceList(respath: string, romname: string) {
	let tsimgout = new Array<string>();
	let tssndout = new Array<string>();

	let metalist = await getResMetaList(respath, romname);

	tsimgout.push(BOILERPLATE_RESOURCE_ID_BITMAP);
	tssndout.push(BOILERPLATE_RESOURCE_ID_AUDIO);

	for (let i = 0; i < metalist.length; i++) {
		let current = metalist[i];

		let type = current.type;
		let name = current.name;
		switch (type) {
			case 'image':
			case 'atlas':
				let property_to_add = `\t${name} = '${name}',`;
				tsimgout.push(`${property_to_add}`);
				break;
			case 'audio':
				let enummember_to_add = `\t${name} = '${name}',`;
				tssndout.push(`${enummember_to_add}`);
				break;
			case 'romlabel':
				// Ignore this part
				break;
		}
	}

	tsimgout.push("}\n");
	tssndout.push("}\n");

	let total_output: string = tsimgout.concat(tssndout).join('\n');

	let targetPath = respath.replace('/res', '/resourceids.ts');
	await writeFile(targetPath, total_output);
}

/**
 * Builds a ROM pack for the specified `romname` using the resources located at `respath`.
 * @param rom_name The name of the ROM pack to build.
 * @param respath The path to the resources to include in the ROM pack.
 * @returns A Promise that resolves when the ROM pack has been successfully built.
 */
async function buildRompack(rom_name: string, respath: string): Promise<void> {
	return new Promise<any>(async (resolve, reject) => {
		const outfile = rom_name.concat('.rom');
		const megarom_filename = `${rom_name}.js`;
		const megarom_min_filename = `${rom_name}.min.js`;
		const megarom_min_map_filename = `${rom_name}.min.map`;
		const megarom_filepath = `./rom/${megarom_filename}`;
		const megarom_min_filepath = `./rom/${megarom_min_filename}`;
		const megarom_min_map_filepath = `./rom/${megarom_min_map_filename}`;

		const minifyGamecodeResult = await minifyGamecode(megarom_filepath);
		taakAfgevinkt();

		await writeFile(megarom_min_filepath, minifyGamecodeResult.code!);
		if (minifyGamecodeResult.map) {
			await writeFile(megarom_min_map_filepath, minifyGamecodeResult.map as string);
		}
		taakAfgevinkt();

		// Copy the minified file to the root folder and remove the original file
		// This is required for the source map to work correctly
		await copyFile(megarom_filepath, `./${megarom_filename}`);
		await rm(megarom_filepath);
		taakAfgevinkt();

		const buffers = new Array<Buffer>();
		const loadedResources: ILoadedResource[] = await getLoadedResourcesList(respath, buffers, rom_name).catch(err => reject(err)) as ILoadedResource[];
		taakAfgevinkt();
		let generated_atlas: HTMLCanvasElement = undefined;
		if (GENERATE_AND_USE_TEXTURE_ATLAS) {
			// Use algorithm to optimize atlas
			generated_atlas = createOptimizedAtlas(loadedResources);
		}
		taakAfgevinkt();

		let jsonout = new Array<RomAsset>();
		let bufferPointer = 0;
		let romlabel_buffer: Buffer = undefined;
		for (let i = 0; i < loadedResources.length; i++) {
			let res: ILoadedResource = loadedResources[i];
			let type = res.type;
			let name = res.name;
			let resid = res.id;
			switch (type) {
				case 'romlabel':
					if (i > 0) throw '"romlabel.png" must appear at start of the ResourceMeta-list, while building the rompack ("romresources.json")! Thus, this is a bug and a fix is required!';
					// Ignore this part. Don't even increase the buffer pointer (all other buffers will be zipped)!
					romlabel_buffer = res.buffer;
					break;
				case 'image':
					const img = res.img;
					const img_boundingbox = extractBoundingBox(img); // Extract the bounding box of the image (i.e. the smallest rectangle that contains all non-transparent pixels)
					const img_boundingbox_precalc: BoundingBoxPrecalc = generateFlippedBoundingBox(img, img_boundingbox);
					const img_boundingboxes = extractBoundingBoxes(img, img_boundingbox, 2); // Extract the bounding boxes of the image (i.e. the smallest rectangles that contain all non-transparent pixels)
					// const img_ascii_boundingbox_map = createAsciiBoundingBoxMap(img, img_boundingboxes);
					const img_boundingboxes_precalc: BoundingBoxesPrecalc = {
						original: img_boundingboxes,
						...generateFlippedBoundingBoxes(img, img_boundingboxes),
					};
					const img_centerpoint = calculateCenterPoint(img_boundingbox);

					let imgmeta: ImgMeta = {
						atlassed: false,
						width: img.width,
						height: img.height,
						boundingbox: img_boundingbox_precalc,
						boundingboxes: img_boundingboxes_precalc,
						centerpoint: img_centerpoint,
						// ascii_boundingbox_map: img_ascii_boundingbox_map,
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

					const baseJson = {
						resid: resid,
						resname: name,
						type: type,
						imgmeta: imgmeta
					};

					if (GENERATE_AND_USE_TEXTURE_ATLAS && !DONT_PACK_IMAGES_WHEN_USING_ATLAS) {
						jsonout.push({
							...baseJson,
							start: bufferPointer,
							end: bufferPointer + res.buffer.length,
						});
						bufferPointer += res.buffer.length;
					} else {
						jsonout.push({
							...baseJson,
							start: 0,
							end: 0,
						});
					}
					break;
				case 'audio':
					{
						let parsedMeta = parseAudioMeta(res.filepath);
						jsonout.push({ resid: resid, resname: name, type: type, start: bufferPointer, end: bufferPointer + res.buffer.length, imgmeta: undefined, audiometa: parsedMeta.meta });
					}
					bufferPointer += res.buffer.length;
					break;
				case 'source':
					name = name.replace('.min', '');
					jsonout.push({ resid: resid, resname: name, type: type, start: bufferPointer, end: bufferPointer + res.buffer.length, imgmeta: undefined, audiometa: undefined });
					bufferPointer += res.buffer.length;
					break;
				case 'atlas':
					// Ignore this part - don't increase the buffer pointer.
					break;
				case 'rommanifest':
					// Ignore this part - don't increase the buffer pointer.
					break;
			}
		}

		if (GENERATE_AND_USE_TEXTURE_ATLAS) {
			let i = loadedResources.findIndex(x => x.type === 'atlas');
			const atlasSize = { x: generated_atlas.width, y: generated_atlas.height };
			const atlasbuffer: Buffer = (<any>generated_atlas).toBuffer('image/png');
			buffers.push(atlasbuffer);

			jsonout.push({ resid: loadedResources[i].id, resname: loadedResources[i].name, type: 'image', start: bufferPointer, end: bufferPointer + atlasbuffer.length, imgmeta: { atlassed: false, width: atlasSize.x, height: atlasSize.y }, audiometa: undefined });
			bufferPointer += atlasbuffer.length;
			await writeFile("./rom/_ignore/atlas.png", atlasbuffer);
		}

		const jsonbuffer = Buffer.from(encodeuint8arr(JSON.stringify(jsonout)));
		buffers.push(jsonbuffer);

		const rommeta = <RomMeta>{
			start: bufferPointer,
			end: bufferPointer + jsonbuffer.length
		};
		const rom_meta_string = JSON.stringify(rommeta).padStart(100, ' ');
		buffers.push(Buffer.from(encodeuint8arr(rom_meta_string)));
		const all_buffers = Buffer.concat(buffers);
		const zipped = zip(all_buffers);
		const blobmeta = <RomMeta>{
			start: romlabel_buffer?.length ?? 0,
			end: zipped.length + (romlabel_buffer?.length ?? 0)
		};
		const blob_meta_string = JSON.stringify(blobmeta).padStart(100, ' ');
		const blob_meta_as_buffer = Buffer.from(encodeuint8arr(blob_meta_string));
		// log(`\tSize: ${_colors.red(`${(Buffer.concat(buffers).length / (1024 * 1024)).toFixed(2)} mB`)} ⇒  Deflated: ${_colors.blue(`${(zipped.length / (1024 * 1024)).toFixed(2)} mB (${((zipped.length / Buffer.concat(buffers).length) * 100).toFixed(0)}%)`)}\n`);

		taakAfgevinkt();
		await writeFile(`./dist/${outfile}`, Buffer.concat([romlabel_buffer ?? Buffer.alloc(0), zipped, blob_meta_as_buffer]));
		await writeFile("./rom/_ignore/romresources.json", jsonbuffer);
		taakAfgevinkt();

		resolve(null);
	});
}

async function compileRomLoaderScriptIfNewer() {
	const romTsPath = join(__dirname, '../scripts/rom.ts');
	const romJsPath = join(__dirname, '../rom/rom.js');

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
	taakAfgevinkt();

	if (!romJsStats || romTsStats.mtime > romJsStats.mtime) {
		return new Promise<void>((resolve, reject) => {
			try {
				exec(`npx tsc ${romTsPath} --removeComments -m commonjs -t ES2017 --outDir ${join(__dirname, '../rom/')}`, (error, stdout, stderr) => {
					if (error || stderr) {
						throw new Error(`Error while compiling "rom.ts": ${error?.message ?? stderr}`);
					} else {
						taakAfgevinkt();
						resolve();
					}
				});
			} catch (e) {
				throw new Error(`Error while compiling "rom.ts": ${e?.message ?? e}`);
			}
		});
	}
	// rom.js is newer or up to date. No need to compile
	taakAfgevinkt();
}

/**
 * Determines whether a rebuild of the ROM is required based on the modification times of the bootloader and resource files.
 * @param {string} romname - The name of the ROM.
 * @param {string} bootloaderPath - The path to the bootloader files.
 * @param {string} resPath - The path to the resource files.
 * @returns {Promise<boolean>} A Promise that resolves with a boolean indicating whether a rebuild is required.
 */
async function isRebuildRequired(romname: string, bootloaderPath: string, resPath: string): Promise<boolean> {
	const distPath = `./dist/${romname}.rom`;
	const distPath2 = `./rom/${romname}.min.js`; // TODO: LELIJK! PROBLEEM IS DAT NORMALE .JS WORDT VERPLAATST NAAR ROOT-FOLDER (EN DAT IS OOK LELIJK!)

	async function checkPaths() {
		try {
			await access(distPath);
			await access(distPath2);
			return false;
		} catch {
			return true;
		}
	}
	if (await checkPaths()) {
		return true;
	}

	const romStats = await stat(distPath);
	const romMtime = romStats.mtime;

	const shouldRebuild = async (dir: string, checkTsFiles: boolean, checkAssets: boolean): Promise<boolean> => {
		try {
			await access(dir);
		} catch {
			throw new Error(`Directory "${dir}" bestaat niet!`);
		}
		const entries = await readdir(dir, { withFileTypes: true });

		for (const entry of entries) {
			const entryPath = join(dir, entry.name);

			if (entry.isDirectory()) {
				if (entry.name === '_ignore') {
					continue;
				}
				const rebuild = await shouldRebuild(entryPath, checkTsFiles, checkAssets);
				if (rebuild) {
					return true;
				}
			} else {
				if (
					(checkTsFiles && entry.name.endsWith('.ts')) ||
					(checkAssets)
				) {
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

	const shouldCheckTsFiles = dir => dir.startsWith(bootloaderPath);
	const shouldCheckAssets = dir => dir.startsWith(resPath);

	return await shouldRebuild(bootloaderPath, shouldCheckTsFiles(bootloaderPath), shouldCheckAssets(bootloaderPath)) ||
		await shouldRebuild(resPath, shouldCheckTsFiles(resPath), shouldCheckAssets(resPath)) ||
		await shouldRebuild('src/bmsx', true, false);
}

const takenlijst = ['Rom manifest zoekeren en parseren', 'Game compileren en bundleren', 'YAML bestanden omzetten in JSON voor importatie', 'Minifieëren', 'MiniJS wegschrijveren', 'Uitvoer kopieëren en plakken naar wortel-folder', 'Resource bestanden inladen en bufferen', 'Textuuratlas bouwen die optimaal klein is', 'Resource bibliotheek bouwen for in rompack', 'Totale rompack wegschrijven', 'Check "rom.ts" vereist recompilatie', '"rom.ts" compileren (als nodig)', 'game.html en game_debug.html bouwen', 'Deployeren'];

const totaalTaken = takenlijst.length;
let afgevinkteTaken = 0;

const gauge = new Gauge(process.stdout, {
	updateInterval: 20,
	cleanupOnExit: false,
	autoSize: false,
});
gauge.setTemplate([
	{ type: 'progressbar', length: 50 },
	{ type: 'activityIndicator', kerning: 1, length: 1 },
	{ type: 'section', kerning: 1, default: '' },
	{ type: 'subsection', kerning: 1, default: '' },
]);

const taakAfgevinkt = () => {
	afgevinkteTaken++;
	const progressPercentage = afgevinkteTaken / totaalTaken;
	if (takenlijst.length) {

		const huidigeTaak = takenlijst.shift()!;
		gauge.show(huidigeTaak, progressPercentage);
		gauge.pulse();
	}
	else {
		gauge.show('ALLES DONUT', 1);
		gauge.pulse();
	}
};

/**
 * The main function that runs the ROM packing and deployment process.
 * @returns {Promise<void>} A Promise that resolves when the process is complete.
 */
async function main() {
	const outputError = (e: any) => writeOut(`\n[GEFAALD]\nEr ging iets niet goed:\n${e?.message ?? e ?? 'Geen error message'};\n${e?.stack ?? 'Geen stacktrace.'}\n`, 'error');
	try {
		// #region stuff
		term.terminal.clear();
		writeOut(_colors.brightGreen.bold('┏————————————————————————————————————————————————————————————————————————————————┓\n'));
		writeOut(_colors.brightGreen.bold('|                          BMSX ROMPACKER DOOR BOAZ©®™                           |\n'));
		writeOut(_colors.brightGreen.bold('┗————————————————————————————————————————————————————————————————————————————————┛\n'));
		const args = process.argv.slice(2);
		let rom_name: string = 'not-parsed!';
		let title: string = 'not-parsed!';
		let bootloader_path: string = 'not-parsed!';
		let respath: string = 'not-parsed!';
		let force: boolean = false;
		let unrecognizedParam: boolean = false;
		let buildreslist: boolean = false;
		let deployToFtp: boolean = true;

		for (let i = 0; i < args.length; i++) {
			switch (args[i]) {
				case '-title':
					title = args[++i];
					break;
				case '-romname':
					rom_name = args[++i].toLowerCase();
					if (rom_name.includes('.')) {
						throw new Error(`'-romname' should not contain any extensions! The given romname was ${rom_name}. Example of good '-romname': 'testrom'.`);
					}
					break;
				case '-bootloaderpath':
					bootloader_path = args[++i];
					break;
				case '-respath':
					respath = args[++i];
					break;
				case '--force':
					force = true;
					break;
				case '--buildreslist':
					buildreslist = true;
					break;
				case '--nodeploy':
					deployToFtp = false;
					break;
				default:
					writeOut(_colors.red(`Unrecognized argument: ${args[i]}.\n`));
					unrecognizedParam = true;
					break;
			}
		}
		if (unrecognizedParam) throw new Error("Unrecognized parameter(s) passed. Exiting rompacker...");

		if (buildreslist) {
			writeOut('Building resource list and writing output to "./src/bmsx/resourceids.ts"...\n');
			writeOut('Note: ROM packing and deployement are skipped.\n');
			await buildResourceList(respath, rom_name);
			writeOut(`\n${_colors.brightWhite.bold('[Resource list bouwen ge-DONUT]')}\n`);
			return;
		}

		if (!title) throw new Error("Missing parameter for title ('title', e.g. 'Sintervania'.");
		if (!rom_name) throw new Error("Missing parameter for output file ('outfile', e.g. 'sintervania.rom'.");
		if (!bootloader_path) throw new Error("Missing parameter for location of the bootloader.ts-file ('bootloader_path', e.g. 'src/testrom'.");
		if (!respath) throw new Error("Missing parameter for location of the resource folder ('respath', e.g. './src/testrom/res'.");

		let rebuildRequired = true;

		if (!force) {
			rebuildRequired = await isRebuildRequired(rom_name, bootloader_path, respath);
			if (!rebuildRequired) {
				writeOut('Rebuild skipped: game rom was newer than code/assets (use --force option to ignore this check).');
			}
		}
		else writeOut(`Note: Recompilation and Building forced via ${_colors.brightRed.bold('--force')}\n`);
		if (!deployToFtp) writeOut(`Note: Deploy to FTP server disabled via ${_colors.brightRed.bold('--nodeploy')}\n`);

		writeOut(`Starting ROM packing and deployment process for ROM ${_colors.brightBlue.bold(`${rom_name}`)}...\n`);

		if (!deployToFtp) takenlijst.pop();
		if (!rebuildRequired) {
			takenlijst.shift();
			takenlijst.shift();
			takenlijst.shift();
			takenlijst.shift();
		}

		gauge.show(takenlijst.shift(), 0);
		gauge.pulse();
		// #endregion
		try {
			let romManifest: RomManifest;
			let short_name: string = 'BMSX';
			if (rebuildRequired) {
				romManifest = await getRomManifest(respath);
				taakAfgevinkt();
				if (!romManifest) throw new Error(`Rom manifest not found at "${respath}"!`);
				rom_name = romManifest?.rom_name ?? rom_name;
				title = romManifest?.title ?? title;
				short_name = romManifest?.short_name ?? short_name;
				await buildAndBundleRomSource(rom_name, bootloader_path);
				await yaml2Json();
				await buildRompack(rom_name, respath);
			}
			await compileRomLoaderScriptIfNewer();

			await buildGameHtmlAndManifest(rom_name, title, short_name);
			if (deployToFtp) {
				await deploy(rom_name, title);
			}
			gauge.show('ALLES DONUT', 1);
			gauge.pulse();
			await timer(100);

			// writeOut(`\n${_colors.brightWhite.bold('[ALLES DONUT]')}\n`);
		} catch (e) {
			gauge.pulse();
			outputError(e);
		}
	} catch (e) {
		outputError(e);
	}
}

main();