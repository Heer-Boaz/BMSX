import { readdirSync, statSync, readFileSync, writeFileSync, copyFile, copyFileSync, existsSync, exists, createWriteStream } from "fs";
import { join, parse } from "path";
import { AudioMeta, AudioType, RomResource, RomMeta, ImgMeta } from '../src/bmsx/rompack';
import * as browserify from 'browserify';
const tsify = require("tsify");
const babelify = require("babelify");

import * as terser from 'terser';
const pako = require('pako');
const minify = require('@node-minify/core');
const cleanCSS = require('@node-minify/clean-css');
const cliProgress = require('cli-progress');
const _colors = require('colors');
const FtpDeploy = require('ftp-deploy');
const { createCanvas, loadImage } = require('canvas');
const yaml = require('js-yaml');

const ATLAS_PX_SIZE = 4096;
const CROP_ATLAS = true;
const GENERATE_AND_USE_TEXTURE_ATLAS = true;
const DONT_PACK_IMAGES_WHEN_USING_ATLAS = true;

const atlasCanvas: HTMLCanvasElement = <any>createCanvas(ATLAS_PX_SIZE, ATLAS_PX_SIZE);
const ctx: CanvasRenderingContext2D = atlasCanvas.getContext('2d');
const atlasPos = { x: 0, y: 0 };
let atlasExploitedX = 0; // For cropping atlas later, because we are not sure that full width is exploited
let atlasUnsafeY = 0; // Also used for cropping atlas later, but primarily used to create atlas

interface LoadedResource extends ResourceMeta {
	buffer: Buffer;
	img?: any;
}

interface ResourceMeta {
	filepath: string;
	name: string;
	ext: string;
	type: string;
	id: number;
}

/**
 * Convert an Uint8Array into a string.
 * https://ourcodeworld.com/articles/read/164/how-to-convert-an-uint8array-to-string-in-javascript
 * @returns {String}
 */
function decodeuint8arr(uint8array: Uint8Array): string {
	return new TextDecoder("utf-8").decode(uint8array);
}

function log(_tolog: string, type?: string): void {
	let d = new Date();
	let tolog: string;
	switch (type) {
		case 'error': tolog = _colors.red(_tolog); break;
		default: tolog = _tolog; break;
	}
	process.stdout.write(`${_colors.cyan(d.toTimeString().split(' ')[0])}:${_colors.cyan(d.getMilliseconds().toString().substring(0, 3))} ${tolog}`);
}

function appendLogEntry(_toappend: string, type?: string): void {
	let toappend: string;
	switch (type) {
		case 'error': toappend = _colors.red(_toappend); break;
		default: toappend = _toappend; break;
	}
	process.stdout.write(toappend);
}

function timer(ms: number) {
	return new Promise(res => setTimeout(res, ms));
}

const rotatorchars = ['-', '\\', '|', '/'];
var runrotator = false;
async function startRotator() {
	runrotator = true;
	process.stdout.write(`/`);
	let i = 0;
	while (runrotator) {
		await timer(100);
		runrotator && process.stdout.write(`\b${rotatorchars[i]}`);
		if (++i >= rotatorchars.length) i = 0;
	}
}

function stopRotator(): void {
	runrotator = false;
	process.stdout.write(`\b\b  `);
}

/**
 * Convert a string into a Uint8Array.
 * https://ourcodeworld.com/articles/read/164/how-to-convert-an-uint8array-to-string-in-javascript
 * @returns {Uint8Array}
 */
function encodeuint8arr(myString: string): Uint8Array {
	return new TextEncoder().encode(myString);
}

function addFile(dirPath: string, filePath: string, arrayOfFiles: string[]): void {
	arrayOfFiles.push(join(dirPath, "/", filePath));
}

function getFiles(dirPath: string, arrayOfFiles?: string[], filterExtension?: string): string[] {
	return getAllNonRootDirs(dirPath, arrayOfFiles, filterExtension);
}

function getAllNonRootDirs(dirPath: string, arrayOfFiles?: string[], filterExtension?: string): string[] {
	let entries = readdirSync(dirPath);
	entries.filter(entry => statSync(`${dirPath}/${entry}`).isDirectory() && `${dirPath}/${entry}`.indexOf("_ignore") === -1).forEach(entry => arrayOfFiles = getAllFiles(`${dirPath}/${entry}`, arrayOfFiles, filterExtension));
	return arrayOfFiles;
}

function getAllFiles(dirPath: string, arrayOfFiles?: string[], filterExtension?: string): string[] {
	let files = readdirSync(dirPath);

	arrayOfFiles = arrayOfFiles || [];

	files.filter(f => f.indexOf("_ignore") === -1).forEach(function (file) {
		let fullpath = `${dirPath}/${file}`;
		if (statSync(fullpath).isDirectory()) {
			arrayOfFiles = getAllFiles(fullpath, arrayOfFiles, filterExtension);
		} else {
			let ext = parse(file).ext;
			if (filterExtension) {
				if (ext === filterExtension) {
					arrayOfFiles.push(fullpath);
				}
			}
			else if (ext != ".rom" && ext != ".js" && ext != ".ts" && ext != ".map" && ext != ".tsbuildinfo") {
				arrayOfFiles.push(fullpath);
			}
		}
	});

	return arrayOfFiles;
}

function yaml2Json(): void {
	log("YAML bestanden omzetten in JSON voor importatie...  ");
	let yamlfiles = getAllFiles('./src', [], '.yaml');
	startRotator();
	for (let file of yamlfiles) {
		let doc = yaml.safeLoad(readFileSync(file, 'utf8'));
		let outfilename = file.replace('.yaml', '.json');
		writeFileSync(outfilename, Buffer.from(encodeuint8arr(JSON.stringify(doc))));
	}
	stopRotator();
	appendLogEntry(`${_colors.grey('[Donut]')}\n`);
}

async function bundleGamecode(outfile: string, bootloader_path: string): Promise<any> {
	log("Game compileren en bundleren...  ");
	startRotator();

	return new Promise((resolve, reject) => {
		let writeOutput = createWriteStream(`./${outfile}`);
		browserify({
			debug: true,
			basedir: '.',
			project: true,
			cache: {},
			packageCache: {},
			exposeAll: true,
			exclude: [],
			ignore: ['node_modules', 'dist', 'rom'],
		})
			.add(bootloader_path)
			.plugin(tsify)
			.transform(babelify, {
				extensions: ['.ts'],
				plugins: ['@babel/plugin-transform-modules-commonjs'],
				sourceMaps: true,
				sourceMapsAbsolute: false,
				global: true,
				retainLines: true,
				compact: true,
			})
			.bundle()
			.pipe(writeOutput)
			.on("error", e => { stopRotator(); log(`\tGame bouwen faalde :-(\n`, 'error'); reject(e); });
		writeOutput.on('finish', () => {
			stopRotator();
			appendLogEntry(`${_colors.grey('[Donut]')}\n`);
			resolve(null);
		});
		writeOutput.on("error", e => {
			stopRotator();
			log(`\tWegschrijven gamecode faalde! :-(\n`, 'error');
			reject(e);
		});
	});
}

function minifyGamecode(infile: string): Error {
	let options = <terser.MinifyOptions>{
		ecma: 2020,
		sourceMap: false,
		compress: <terser.CompressOptions>{
			keep_fargs: false, // Prevents the compressor from discarding unused function arguments. You need this for code which relies on Function.length
			passes: 1, // The maximum number of times to run compress. In some cases more than one pass leads to further compressed code. Keep in mind more passes will take more time
			ecma: 2020,
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
					"__importDefault"
				],
			properties: <terser.ManglePropertiesOptions>{
				keep_quoted: true,
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
						"__importDefault"
					],
			},
		},
		output: <terser.OutputOptions>{
			ecma: 2020,
			safari10: false,
			webkit: false,
			// max_line_len: 80,
			semicolons: true, // Must be true for Safari support (on iOS)! Otherwise, only black screen shows
			keep_quoted_props: true
		},
	};

	let gamejs = readFileSync(infile, 'utf8');
	let gamejsMinifiedResult = terser.minify(gamejs, options);
	if (gamejsMinifiedResult.code) {
		writeFileSync("./rom/megarom.min.js", gamejsMinifiedResult.code);
		return null;
	}
	else {
		// appendLogEntry("Minifying van gamecode faalde :-(   ", 'error');
		return gamejsMinifiedResult.error;
	}
}

async function buildGameHtmlAndManifest(outfile: string, title: string): Promise<any> {
	log("game.html en game_debug.html bouwen...\n");
	let html = readFileSync("./gamebase.html", 'utf8');
	let release_html: string;
	let debug_html: string;
	let romjs = readFileSync("./rom/rom.js", 'utf8');
	let zipjs = readFileSync("./scripts/pako_inflate.min.js", 'utf8');
	romjs = romjs.replace('Object.defineProperty(exports, "__esModule", { value: true });', '');
	let options = {
		compress: {
			arrows: false
		},
		mangle: {
			// properties: true,
			toplevel: false,
			reserved: ["bootrom", "h406A", "rom"],
			safari10: true,
		},
		output: {
			safari10: true,
			webkit: true,
		}
	};
	let romjsMinified = terser.minify(romjs, options).code;
	let bmsx = readFileSync("./rom/bmsx.png");
	let bmsx_base64ed = bmsx.toString('base64');

	return new Promise<any>((resolve, reject) => {
		minify({
			compressor: cleanCSS,
			input: "./gamebase.css",
			output: "./gamebase.min.css",
			callback: (err, cssMinified: string) => {
				if (!cssMinified) {
					log(`Minifyen van CSS faalde :-(\n`);
					reject(err);
				}
				release_html = html.replace('//#romjs', romjsMinified);
				release_html = release_html.replace('//#zipjs', zipjs);
				release_html = release_html.replace('/*css*/', cssMinified);
				release_html = release_html.replace(/#title/g, title); // https://stackoverflow.com/questions/44324892/how-can-i-replace-multiple-characters-in-a-string
				release_html = release_html.replace('#outfile', outfile);
				release_html = release_html.replace('#bmsxurl', "data:image/png;base64," + bmsx_base64ed);
				release_html = release_html.replace('//#debug', '');

				writeFileSync("./dist/game.html", release_html);

				debug_html = html.replace('//#romjs', romjs);
				debug_html = debug_html.replace('//#zipjs', zipjs);
				debug_html = debug_html.replace('/*css*/', cssMinified);
				debug_html = debug_html.replace(/#title/g, title); // https://stackoverflow.com/questions/44324892/how-can-i-replace-multiple-characters-in-a-string
				debug_html = debug_html.replace('#outfile', outfile);
				debug_html = debug_html.replace('#bmsxurl', "data:image/png;base64," + bmsx_base64ed);
				debug_html = debug_html.replace('//#debug', 'bootrom.debug = true;\n');
				debug_html = debug_html.replace('//#localfetch', 'bootrom.localfetch = true;\n');
				writeFileSync("./dist/game_debug.html", debug_html);

				// Update the manifest.json-file that is used for app-versions of the webpage
				let manifest = readFileSync("./rom/manifest.json", 'utf8');
				manifest = manifest.replace('#title', title);
				// Write updated manifest to dist-folder
				writeFileSync("./dist/manifest.json", manifest);

				resolve(null);
			}
		});
	});
}

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
			audiotype: filename.indexOf('@m') >= 0 ? AudioType.music : AudioType.effect,
			priority: priority,
			loop: loop
		}
	};
}

function zip(content: Buffer): Uint8Array {
	let toCompress = new Uint8Array(content);
	return pako.deflate(toCompress);
}

async function deploy(outfile: string, title: string): Promise<any> {
	return new Promise<any>((resolve, reject) => {
		log("Deployeren... ");
		startRotator();
		let ftpDeploy = new FtpDeploy();

		let config = {
			user: "boazpat_el@ziggo.nl",
			password: "lars18th",
			host: "homedrive.ziggo.nl",
			port: 21,
			localRoot: "./dist",
			remoteRoot: `/${title.toLowerCase()}/`,
			// include: ["*", "**/*"],      // this would upload everything except dot files
			include: [outfile, "*.html", "manifest.json"],
			// e.g. exclude sourcemaps, and ALL files in node_modules (including dot files)
			exclude: [],//"dist/**/*.map", "node_modules/**", "node_modules/**/.*", ".git/**"],
			// delete ALL existing files at destination before uploading, if true
			deleteRemote: false,
			// Passive mode is forced (EPSV command is not sent)
			forcePasv: true
		};

		ftpDeploy
			.deploy(config)
			.then(res => { stopRotator(); appendLogEntry(`${res}. ${_colors.grey('[Donut]')}\n`); resolve(null); })
			.catch(err => { stopRotator(); log(`\tFTP upload mislukt :-(\n`, 'error'); reject(err); });
	});
}

function getResMetaByFilename(filepath: string): { name: string, ext: string, type: string; } {
	let name = parse(filepath).name.replace(' ', '');
	let ext = parse(filepath).ext;
	let type: string;

	switch (ext) {
		case '.wav':
			type = 'audio';
			break;
		case '.js':
			type = 'source';
			break;
		case '.png':
		default:
			type = 'image';
			break;
	}
	return { name: name, ext: ext, type: type };
}

function getResMetaList(respath: string): ResourceMeta[] {
	// log(`Lees all bestanden in de resource pad ${_colors.brightGreen(`"${respath}"`)}... `);
	// startRotator();
	const arrayOfFiles = getFiles(respath) ?? []; // Also handle corner case where we don't have any resources by adding "?? []"
	addFile("./rom", "megarom.min.js", arrayOfFiles); // Add source at the end
	// stopRotator();

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
			// case 'source':
			// 	name = name.replace('.min', '');
			// 	break;
		}
	}
	if (GENERATE_AND_USE_TEXTURE_ATLAS) {
		result.push({ filepath: null, name: '_atlas', ext: null, type: 'atlas', id: imgid }); // Note that 'atlas' is an internal type, used only for this script
	}

	// appendLogEntry(`${_colors.grey('[Donut]')}\n`);

	return result;
}

async function getLoadedResourcesList(respath: string, buffers: Array<Buffer>): Promise<LoadedResource[]> {
	let resMetaList = getResMetaList(respath);
	let loadedResources: Array<LoadedResource> = [];
	for (let i = 0; i < resMetaList.length; i++) {
		let meta = resMetaList[i];

		let name = meta.name;
		let ext = meta.ext;
		let type = meta.type;
		let id = meta.id;
		let buffer = meta.filepath ? readFileSync(meta.filepath) : null;

		let img: any = undefined;
		if (type === 'image') {
			if (GENERATE_AND_USE_TEXTURE_ATLAS) {
				const base64Encoded = readFileSync(meta.filepath, 'base64');
				const dataURL = `data:image/png;base64,${base64Encoded}`;
				img = await loadImage(dataURL);
			}
		}

		loadedResources.push({ buffer: buffer, filepath: meta.filepath, name: name, ext: ext, type: type, img: img, id: id });
	}

	// Manually add the ROM source code to the list
	loadedResources.push({
		buffer: readFileSync('./rom/megarom.min.js'),
		filepath: './rom/megarom.min.js',
		name: 'megarom.min.js',
		ext: '.js',
		type: 'source',
		id: 1
	});

	if (GENERATE_AND_USE_TEXTURE_ATLAS) {
		// Sort the files on buffer size for atlassing
		loadedResources = loadedResources.sort((b1, b2) => ((b1.img?.height || 0) - (b2.img?.height || 0)));
		// Also: place the atlas in the back, so that we can correctly use the bufferpointer to point to the atlas
		loadedResources = loadedResources.sort((b1, b2) => ((b1.type === 'atlas' ? 1 : 0) - (b2.type === 'atlas' ? 1 : 0)));
	}
	if (GENERATE_AND_USE_TEXTURE_ATLAS && DONT_PACK_IMAGES_WHEN_USING_ATLAS) {
		loadedResources.filter(x => x.type !== 'image' && x.type !== 'atlas').forEach(x => buffers.push(x.buffer));
	}
	else {
		loadedResources.forEach(x => buffers.push(x.buffer));
	}
	return loadedResources;
}

function buildResourceList(respath: string): void {
	log("resourceids.ts knutselen...  ");
	let tsimgout = new Array<string>();
	let tssndout = new Array<string>();

	let metalist = getResMetaList(respath);

	tsimgout.push("export enum BitmapId {\n\tNone = 0,");
	tssndout.push("export enum AudioId {\n\tNone = 0,");

	for (let i = 0; i < metalist.length; i++) {
		let current = metalist[i];

		let type = current.type;
		let name = current.name;
		let id = current.id;
		switch (type) {
			case 'image':
			case 'atlas':
				tsimgout.push(`\t${name} = ${id},`);
				break;
			case 'audio':
				tssndout.push(`\t${name} = ${id},`);
				break;
		}
	}

	tsimgout.push("}\n");
	tssndout.push("}\n");

	let targetPath = respath.replace('/res', '/resourceids.ts');
	log(`resourceids.ts wegschrijven naar "${targetPath}"... `);
	startRotator();
	writeFileSync(targetPath, tsimgout.concat(tssndout).join('\n'));
	stopRotator();
	appendLogEntry(`${_colors.grey('[Donut]')}\n`);
}

async function buildRompack(outfile: string, respath: string): Promise<any> {
	return new Promise<any>(async (resolve, reject) => {
		log("Minifyen... ");
		startRotator();
		let minifyGamecodeResult = minifyGamecode("./megarom.js");
		stopRotator();
		(!minifyGamecodeResult) ? appendLogEntry(`${_colors.grey('[Donut]')}\n`) : (appendLogEntry(`[Failed]\n`, 'error'), reject(new Error(`Minifying game code failed: ${minifyGamecodeResult.message}`)));

		let buffers = new Array<Buffer>();
		log("Resource bestanden inladen en bufferen...  ");
		startRotator();
		let loadedResources = await getLoadedResourcesList(respath, buffers);
		stopRotator();
		appendLogEntry(`${_colors.grey('[Donut]')}\n`);

		log("romresources.json knutselen...  ");
		startRotator();

		let jsonout = new Array<RomResource>();
		let bufferPointer = 0;
		for (let i = 0; i < loadedResources.length; i++) {
			let res = loadedResources[i];
			let type = res.type;
			let name = res.name;
			let resid = res.id;
			switch (type) {
				case 'image':
					let img = res.img;
					let imgmeta: ImgMeta = null;
					if (GENERATE_AND_USE_TEXTURE_ATLAS) {
						imgmeta = addToAtlas(img);
						if (DONT_PACK_IMAGES_WHEN_USING_ATLAS) {
							jsonout.push({ resid: resid, resname: name, type: type, start: 0, end: 0, imgmeta: { atlassed: imgmeta.atlassed, width: imgmeta.width, height: imgmeta.height, texcoords: imgmeta.texcoords, texcoords_fliph: imgmeta.texcoords_fliph, texcoords_flipv: imgmeta.texcoords_flipv, texcoords_fliphv: imgmeta.texcoords_fliphv }, audiometa: null, });
						}
						else {
							jsonout.push({ resid: resid, resname: name, type: type, start: bufferPointer, end: bufferPointer + res.buffer.length, imgmeta: { atlassed: imgmeta.atlassed, width: imgmeta.width, height: imgmeta.height, texcoords: imgmeta.texcoords, texcoords_fliph: imgmeta.texcoords_fliph, texcoords_flipv: imgmeta.texcoords_flipv, texcoords_fliphv: imgmeta.texcoords_fliphv }, audiometa: null, });
							bufferPointer += res.buffer.length;
						}
					}
					else {
						jsonout.push({ resid: resid, resname: name, type: type, start: bufferPointer, end: bufferPointer + res.buffer.length, imgmeta: { atlassed: false, width: img.width, height: img.height, }, audiometa: null, });
						bufferPointer += res.buffer.length;
					}
					break;
				case 'audio':
					{
						let parsedMeta = parseAudioMeta(res.filepath);

						name = parsedMeta.sanitizedName;
						jsonout.push({ resid: resid, resname: name, type: type, start: bufferPointer, end: bufferPointer + res.buffer.length, imgmeta: null, audiometa: parsedMeta.meta });
					}
					bufferPointer += res.buffer.length;
					break;
				case 'source':
					name = name.replace('.min', '');
					jsonout.push({ resid: resid, resname: name, type: type, start: bufferPointer, end: bufferPointer + res.buffer.length, imgmeta: null, audiometa: null });
					bufferPointer += res.buffer.length;
					break;
				case 'atlas':
					break;
			}
		}

		if (GENERATE_AND_USE_TEXTURE_ATLAS) {
			let atlasbuffer: Buffer;
			let i = loadedResources.findIndex(x => x.type === 'atlas');
			let atlasSize = { x: atlasCanvas.width, y: atlasCanvas.height };
			if (CROP_ATLAS) {
				let croppedCanvas = cropAtlas(jsonout);
				atlasSize.x = croppedCanvas.width;
				atlasSize.y = croppedCanvas.height;

				atlasbuffer = (<any>croppedCanvas).toBuffer('image/png');
			}
			else {
				atlasbuffer = (<any>atlasCanvas).toBuffer('image/png');
			}
			buffers.push(atlasbuffer);

			jsonout.push({ resid: loadedResources[i].id, resname: loadedResources[i].name, type: 'image', start: bufferPointer, end: bufferPointer + atlasbuffer.length, imgmeta: { atlassed: false, width: atlasSize.x, height: atlasSize.y }, audiometa: null });
			bufferPointer += atlasbuffer.length;
			writeFileSync("./rom/_ignore/atlas.png", atlasbuffer);
		}

		let jsonbuffer = Buffer.from(encodeuint8arr(JSON.stringify(jsonout)));
		buffers.push(jsonbuffer);

		let rommeta = <RomMeta>{
			start: bufferPointer,
			end: bufferPointer + jsonbuffer.length
		};
		let rommetastr = JSON.stringify(rommeta).padStart(100, ' ');
		buffers.push(Buffer.from(encodeuint8arr(rommetastr)));
		stopRotator();
		appendLogEntry(`${_colors.grey('[Donut]')}\n`);
		log(`\t#images: ${loadedResources.filter(r => r.type == 'image').length}\n`);
		log(`\t#audio: ${loadedResources.filter(r => r.type == 'audio').length}\n`);

		log("Alles nu zippen... ");
		startRotator();
		// let zipped = Buffer.concat(buffers)//zip(Buffer.concat(buffers));
		let zipped = zip(Buffer.concat(buffers));
		stopRotator();
		appendLogEntry(`${_colors.grey('[Donut]')}\n`);
		log(`\tSize: ${_colors.red(`${(Buffer.concat(buffers).length / (1024 * 1024)).toFixed(2)} mB`)} ⇒  Deflated: ${_colors.blue(`${(zipped.length / (1024 * 1024)).toFixed(2)} mB (${((zipped.length / Buffer.concat(buffers).length) * 100).toFixed(0)}%)`)}\n`);

		log(`"${_colors.green(outfile)}" wegschrijven naar ${_colors.green(`\"./dist/${outfile}\"`)}...`);
		startRotator();
		writeFileSync(`./dist/${outfile}`, zipped);
		writeFileSync("./rom/_ignore/romresources.json", jsonbuffer);
		stopRotator();
		appendLogEntry(`${_colors.grey('[Donut]')}\n`);

		resolve(null);
	});
	// log("Rom is gepackt!!\n");
	// log(`\tFiles: ${arrayOfFiles.length}\n\t\timages: ${imgi}\n\t\taudio: ${sndi}\n`);
}

function addToAtlas(img: any): ImgMeta {
	function uvcoords(x: number, y: number, width: number, height: number, imageWidth: number, imageHeight: number) {
		let result: ImgMeta = {
			width: imageWidth, height: imageHeight, atlassed: true, texcoords: [], texcoords_fliph: [], texcoords_flipv: [], texcoords_fliphv: []
		};
		let left: number;
		let top: number;
		let right: number;
		let bottom: number;
		if (!CROP_ATLAS) {
			left = x / width;
			top = y / height;
			right = (x + imageWidth) / width;
			bottom = (y + imageHeight) / height;
		}
		else {
			left = x;
			top = y;
			right = (x + imageWidth);
			bottom = (y + imageHeight);
		}

		result.texcoords.push(left, top, right, top, left, bottom, left, bottom, right, top, right, bottom);
		result.texcoords_fliph.push(right, top, left, top, right, bottom, right, bottom, left, top, left, bottom);
		result.texcoords_flipv.push(left, bottom, right, bottom, left, top, left, top, right, bottom, right, top);
		result.texcoords_fliphv.push(right, bottom, left, bottom, right, top, right, top, left, bottom, left, top);
		return result;
	}

	if (atlasPos.x + img.width > ATLAS_PX_SIZE) {
		atlasPos.x = 0;
		atlasPos.y = atlasUnsafeY;
	}

	ctx.drawImage(img, atlasPos.x, atlasPos.y);
	if (atlasPos.y + img.height > atlasUnsafeY) {
		atlasUnsafeY = atlasPos.y + img.height;
		if (atlasUnsafeY > ATLAS_PX_SIZE) {
			log('Oh nee!! We krijgen de plaatjes niet meer in de atlas!', 'error');
		}
	}
	if (atlasPos.x + img.width > atlasExploitedX) {
		atlasExploitedX = atlasPos.x + img.width;
	}

	let result = uvcoords(atlasPos.x, atlasPos.y, ATLAS_PX_SIZE, ATLAS_PX_SIZE, img.width, img.height);
	atlasPos.x += img.width;

	return result;
}

function cropAtlas(romResources: Array<RomResource>): HTMLCanvasElement {
	let cropw = atlasExploitedX;
	let croph = atlasUnsafeY;
	// Handle corner case where there are no textures in the ROM
	if (cropw === 0) cropw = 1;
	if (croph === 0) croph = 1;

	const result: HTMLCanvasElement = <any>createCanvas(cropw, croph);
	const croppedctx: CanvasRenderingContext2D = result.getContext('2d');
	croppedctx.drawImage(atlasCanvas, 0, 0);

	let recalc = (coords: number[]) => {
		for (let i = 0; i < coords.length; i += 2) {
			coords[i] = coords[i] / cropw;
			coords[i + 1] = coords[i + 1] / croph;
		}
	};

	// Must also recalculate image texcoords, because while canvas size is taken into account
	romResources.filter(x => x.type === 'image').forEach(x => {
		recalc(x.imgmeta.texcoords);
		recalc(x.imgmeta.texcoords_fliph);
		recalc(x.imgmeta.texcoords_flipv);
		recalc(x.imgmeta.texcoords_fliphv);
	});

	return result;
}

try {
	log(_colors.brightGreen("┏————————————————————————————————————————┓\n"));
	log(_colors.brightGreen("|              BMSX ROMPACKER            |\n"));
	log(_colors.brightGreen("|                DOOR BOAZ©®             |\n"));
	log(_colors.brightGreen("┗————————————————————————————————————————┛\n"));
	let args = process.argv.slice(2);
	let outfile: string = undefined;
	let title: string = undefined;
	let bootloader_path: string = undefined;
	let respath: string = undefined;
	let force: boolean = undefined;
	let unrecognizedParam: boolean = false;
	let buildreslist: boolean = false;

	let i = 0;
	while (i < args.length) {
		switch (args[i]) {
			case '-title':
				++i;
				title = args[i];
				break;
			case '-outfile':
				++i;
				outfile = args[i].toLowerCase();
				break;
			case '-bootloaderpath':
				++i;
				bootloader_path = args[i];
				break;
			case '-respath':
				++i;
				respath = args[i];
				break;
			case '--force':
				force = true;
				break;
			case '--buildreslist':
				buildreslist = true;
				break;
			default:
				log(_colors.red(`Unrecognized argument: ${args[i]}.\n`));
				unrecognizedParam = true;
		}
		++i;
	}
	if (unrecognizedParam) throw new Error("Unrecognized parameter(s) passed. Exiting rompacker...");

	if (buildreslist) {
		log('Building resource list and writing output to "./src/bmsx/resourceids.ts"...\n');
		log('\tNote: ROM packing and deployemexdent are skipped this option (--buildreslist) is enabled!\n');
		buildResourceList(respath);
	}
	else {
		if (!title) throw new Error("Missing parameter for title ('title', e.g. 'Sintervania'.");
		if (!outfile) throw new Error("Missing parameter for output file ('outfile', e.g. 'sintervania.rom'.");
		if (!bootloader_path) throw new Error("Missing parameter for location of the bootloader.ts-file ('bootloader_path', e.g. 'src/bootloader.ts'.");
		if (!respath) throw new Error("Missing parameter for location of the resource folder ('respath', e.g. './src/sintervania/res'.");

		if (!force && existsSync(`./dist/${outfile}`) && existsSync(`"./rom/tsout.js"`)) {
			let romstats = statSync(`./dist/${outfile}`);
			let rommtime = romstats.mtime;
			let jsstats = statSync(`"./rom/tsout.js"`);
			let jsmtime = jsstats.mtime;
			if (jsmtime < rommtime) {
				log("No action performed: game rom was newer than code.\nUse --force option to ignore this check.");
				process.exit(0);
			}
		}

		log('Starting ROM packing and deployment process...\n');
		log('\tNote: build resource list instead by passing option "--buildreslist".\n');
		// const bar = new cliProgress.SingleBar({
		// 	format: 'Beunen: [' + _colors.brightBlue('{bar}') + '] {percentage}% |',
		// 	barCompleteChar: '=',
		// 	barIncompleteChar: '-',
		// 	hideCursor: true,
		// 	clearOnComplete: true,
		// 	forceRedraw: true
		// });
		// bar.start(5, 0);

		bundleGamecode('megarom.js', bootloader_path)
			.then((result) => (yaml2Json()))
			.then((result) => (buildRompack(outfile, respath)))
			.then((result) => (buildGameHtmlAndManifest(outfile, title)))
			.then((result) => (deploy(outfile, title)))
			.then((result) => (log(`${_colors.brightWhite.bold('[ALLES DONUT]')}\n`)))
			.catch(e => { appendLogEntry('\n'); log(`Er ging iets niet goed: "${e?.message ?? e ?? 'Geen error message'}; ${e?.stack ?? '\ben geen stacktrace beschikbaar :-(!'}\n`, 'error'); process.exit(-1); });
	}
} catch (e) {
	appendLogEntry('\n'); log(`Er ging iets niet goed: ${e?.message ?? e ?? 'Geen error message'}; ${e?.stack ?? '\ben geen stacktrace'}\n`, 'error');
	appendLogEntry('\n');
	process.exit(-1);
}
