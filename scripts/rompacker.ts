import { readdirSync, statSync, readFileSync, writeFileSync, copyFile, copyFileSync, existsSync, exists, createWriteStream } from "fs";
import { join, parse } from "path";
import { AudioMeta, AudioType, RomResource, RomMeta, ImgMeta } from '../src/bmsx/rompack';
const browserify = require("browserify");
const tsify = require("tsify");
const babelify = require("babelify");

const terser = require('terser');
const pako = require('pako');
const minify = require('@node-minify/core');
const cleanCSS = require('@node-minify/clean-css');
const cliProgress = require('cli-progress');
const _colors = require('colors');
const FtpDeploy = require('ftp-deploy');
const { createCanvas, loadImage } = require('canvas');

const ATLAS_PX_SIZE = 4096;
const CROP_ATLAS = true;
const GENERATE_AND_USE_TEXTURE_ATLAS = true;
const DONT_PACK_IMAGES_WHEN_USING_ATLAS = true;

const atlasCanvas: HTMLCanvasElement = createCanvas(ATLAS_PX_SIZE, ATLAS_PX_SIZE);
const ctx: CanvasRenderingContext2D = atlasCanvas.getContext('2d');
const atlasPos = { x: 0, y: 0 };
let atlasExploitedX = 0; // For cropping atlas later, because we are not sure that full width is exploited
let atlasUnsafeY = 0; // Also used for cropping atlas later, but primarily used to create atlas

interface LoadedResource {
	buffer: Buffer;
	img?: any;
	filepath: string;
	name: string;
	ext: string;
	type: string;
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
	process.stdout.write(`\b\b  \n`);
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
			if (filterExtension && ext == filterExtension) {
				arrayOfFiles.push(fullpath);
			}
			else if (ext != ".rom" && ext != ".js" && ext != ".ts" && ext != ".map" && ext != ".tsbuildinfo") {
				arrayOfFiles.push(fullpath);
			}
		}
	});

	return arrayOfFiles;
}

async function bundleGamecode(outfile: string): Promise<any> {
	log("Game compileren en bundleren...  ");
	startRotator();

	return new Promise(function (resolve, reject) {
		let writeOutput = createWriteStream('./rom/megarom.js');
		browserify({
			debug: true,
			basedir: '.',
			project: true,
			cache: {},
			packageCache: {},
			exposeAll: true,
			exclude: ['src/lib/rom.ts', 'src/lib/rompacker.ts'],
			ignore: ['node_modules', 'dist', 'rom']
		})
			.add("src/bootstrapper.ts")
			.plugin(tsify)
			.transform(babelify, {
				extensions: ['.ts'],
				plugins: ['@babel/plugin-transform-modules-commonjs'],
				sourceMaps: true,
				global: true,
			})
			.bundle()
			// .on('deps', dep => console.log(dep.file))
			.on("error", e => { stopRotator(); log(`\tGame bouwen faalde :-(\n`, 'error'); return reject(e); })
			.pipe(writeOutput);
		// .catch(e => { log(`\nGame bouwen faalde :-(\n`, 'error'); Promise.reject(e); });

		writeOutput.on('finish', () => {
			stopRotator();
			log("\tKlaar!\n");
			return resolve();
		});
		writeOutput.on("error", e => {
			stopRotator();
			log(`\tWegschrijven gamecode faalde: ${e.message}\n`, 'error');
			return reject(e);
		});
	});
}

function minifyGamecode(infile: string): void {
	let options = {
		compress: false,
		mangle: {
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
			properties: {
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
			safari10: true,
		},
		sourceMap: false,
		output: {
			safari10: true,
			webkit: true,
			max_line_len: 80,
			keep_quoted_props: true
		},
	};

	let gamejs = readFileSync(infile, 'utf8');
	let gamejsMinifiedResult = terser.minify(gamejs, options);
	if (gamejsMinifiedResult.code) {
		writeFileSync("./rom/megarom.min.js", gamejsMinifiedResult.code);
	}
	else {
		log("Minifying van gamecode faalde :-( ", 'error');
	}
}

async function buildGameHtml(outfile: string): Promise<void> {
	log("game.html en game_debug.html bouwen...\n");
	const bar = new cliProgress.SingleBar({
		format: 'Beunen: |' + _colors.brightBlue('{bar}') + '| {percentage}% |',
		barCompleteChar: '\u2588',
		barIncompleteChar: '\u2591',
		hideCursor: true
	});

	bar.start(13, 0);

	let html = readFileSync("./gamebase.html", 'utf8');
	bar.increment(1);
	let release_html: string;
	let debug_html: string;
	let romjs = readFileSync("./rom/rom.js", 'utf8');
	bar.increment(1);
	let zipjs = readFileSync("./scripts/pako_inflate.min.js", 'utf8');
	bar.increment(1);
	let glmatrixjs = readFileSync("./scripts/gl-matrix-min.js", 'utf8');
	bar.increment(1);
	romjs = romjs.replace('Object.defineProperty(exports, "__esModule", { value: true });', '');
	bar.increment(1);
	let options = {
		compress: {
			arrows: false
		},
		mangle: {
			// properties: true,
			toplevel: false,
			reserved: ["basic", "h406A", "rom"],
			safari10: true,
		},
		output: {
			safari10: true,
			webkit: true,
		}
	};
	let romjsMinified = terser.minify(romjs, options).code;
	bar.increment(1);
	let bmsx = readFileSync("./rom/bmsx.png");
	bar.increment(1);
	let bmsx_base64ed = bmsx.toString('base64');
	bar.increment(1);

	return new Promise<void>((resolve, reject) => {
		minify({
			compressor: cleanCSS,
			input: "./gamebase.css",
			output: "./gamebase.min.css",
			callback: function (err, cssMinified: string) {
				if (!cssMinified) {
					log(`Minifyen van CSS faalde :-(\n`);
					return reject(err);
				}
				bar.increment(1);
				release_html = html.replace('//#romjs', romjsMinified);
				release_html = release_html.replace('//#zipjs', zipjs);
				// release_html = release_html.replace('//#gl-matrix', glmatrixjs);
				release_html = release_html.replace('/*css*/', cssMinified);
				release_html = release_html.replace('#outfile', outfile);
				release_html = release_html.replace('#bmsxurl', "data:image/png;base64," + bmsx_base64ed);
				release_html = release_html.replace('//#debug', '');
				// release_html = release_html.replace('//#localfetch', 'basic.localfetch = true;\n');
				bar.increment(1);

				writeFileSync("./dist/game.html", release_html);
				bar.increment(1);

				debug_html = html.replace('//#romjs', romjs);
				debug_html = debug_html.replace('//#zipjs', zipjs);
				// release_html = release_html.replace('//#gl-matrix', glmatrixjs);
				debug_html = debug_html.replace('/*css*/', cssMinified);
				debug_html = debug_html.replace('#outfile', outfile);
				debug_html = debug_html.replace('#bmsxurl', "data:image/png;base64," + bmsx_base64ed);
				debug_html = debug_html.replace('//#debug', 'basic.debug = true;\n');
				debug_html = debug_html.replace('//#localfetch', 'basic.localfetch = true;\n');
				bar.increment(1);
				writeFileSync("./dist/game_debug.html", debug_html);
				bar.increment(1);
				bar.stop();
				return resolve();
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

function zip(content: Buffer): string {
	let toCompress = new Uint8Array(content);
	return pako.deflate(toCompress);
}

async function deploy(): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		log("Deployeren... ");
		startRotator();
		let ftpDeploy = new FtpDeploy();

		let config = {
			user: "boazpat_el@ziggo.nl",
			password: "lars18th",
			host: "homedrive.ziggo.nl",
			port: 21,
			localRoot: "./dist",
			remoteRoot: "/sintervania/",
			// include: ["*", "**/*"],      // this would upload everything except dot files
			include: ["*.rom", "*.html",],
			// e.g. exclude sourcemaps, and ALL files in node_modules (including dot files)
			exclude: [],//"dist/**/*.map", "node_modules/**", "node_modules/**/.*", ".git/**"],
			// delete ALL existing files at destination before uploading, if true
			deleteRemote: false,
			// Passive mode is forced (EPSV command is not sent)
			forcePasv: true
		};

		ftpDeploy
			.deploy(config)
			.then(res => { stopRotator(); log(`\tKlaar!: ${res}\n`); return resolve(); })
			.catch(err => { stopRotator(); log(`\tFTP upload mislukt :-(\n`, 'error'); return reject(err); });
	});
}

async function getLoadedResourcesList(arrayOfFiles: string[], buffers: Array<Buffer>): Promise<LoadedResource[]> {
	const bar = new cliProgress.SingleBar({
		format: 'Beunen: |' + _colors.brightBlue('{bar}') + '| {percentage}% |',
		barCompleteChar: '\u2588',
		barIncompleteChar: '\u2591',
		hideCursor: true
	});

	bar.start(arrayOfFiles.length, 0);
	let loadedResources: Array<LoadedResource> = [];
	for (let i = 0; i < arrayOfFiles.length; i++) {
		let filepath = arrayOfFiles[i];

		let buffer = readFileSync(filepath);
		let name = parse(filepath).name.replace(' ', '');
		let ext = parse(filepath).ext;
		let type: string;
		let img: any = undefined;

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
				if (GENERATE_AND_USE_TEXTURE_ATLAS) {
					const base64Encoded = readFileSync(filepath, 'base64');
					const dataURL = `data:image/png;base64,${base64Encoded}`;
					img = await loadImage(dataURL);
				}
				break;
		}

		loadedResources.push({ buffer: buffer, filepath: filepath, name: name, ext: ext, type: type, img: img });
		bar.increment(1);
	}
	if (GENERATE_AND_USE_TEXTURE_ATLAS) {
		// Sort the files on buffer size for atlassing
		loadedResources = loadedResources.sort((b1, b2) => ((b1.img?.height || 0) - (b2.img?.height || 0)));
	}
	if (GENERATE_AND_USE_TEXTURE_ATLAS && DONT_PACK_IMAGES_WHEN_USING_ATLAS) {
		loadedResources.filter(x => x.type !== 'image').forEach(x => buffers.push(x.buffer));
	}
	else {
		loadedResources.forEach(x => buffers.push(x.buffer));
	}
	bar.stop();

	return loadedResources;
}

async function buildRompackAndResourceList(outfile: string): Promise<void> {
	log("Minifyen... ");
	startRotator();
	minifyGamecode("./rom/megarom.js");
	stopRotator();
	log("\tKlaar!\n");

	log("Alle files ophalen... ");
	startRotator();
	const arrayOfFiles = getFiles("./rom");
	addFile("./rom", "megarom.min.js", arrayOfFiles); // Add source at the end
	stopRotator();
	log("\tKlaar!\n");

	let buffers = new Array<Buffer>();
	log("Resource bestanden inladen en bufferen...\n");
	const bar = new cliProgress.SingleBar({
		format: 'Beunen: |' + _colors.brightBlue('{bar}') + '| {percentage}% |',
		barCompleteChar: '\u2588',
		barIncompleteChar: '\u2591',
		hideCursor: true
	});

	let loadedResources = await getLoadedResourcesList(arrayOfFiles, buffers);

	log("romresources.json knutselen...\n");
	let tsimgout = new Array<string>();
	let tssndout = new Array<string>();

	bar.start(arrayOfFiles.length + 2 + (GENERATE_AND_USE_TEXTURE_ATLAS ? 5 : 0), 0);

	tsimgout.push("export const enum BitmapId {\n\tNone = 0,");
	tssndout.push("export const enum AudioId {\n\tNone = 0,");

	let jsonout = new Array<RomResource>();
	let bufferPointer = 0;
	let imgi = 1;
	let sndi = 1;
	for (let i = 0; i < loadedResources.length; i++) {
		let res = loadedResources[i];
		let type = res.type;
		let name = res.name;
		switch (type) {
			case 'image':
				let img = res.img;
				let imgmeta: ImgMeta = null;
				if (GENERATE_AND_USE_TEXTURE_ATLAS) {
					imgmeta = addToAtlas(img);
					if (DONT_PACK_IMAGES_WHEN_USING_ATLAS) {
						jsonout.push({ resid: imgi, resname: name, type: type, start: 0, end: 0, imgmeta: { atlassed: imgmeta.atlassed, width: imgmeta.width, height: imgmeta.height, texcoords: imgmeta.texcoords, texcoords_fliph: imgmeta.texcoords_fliph, texcoords_flipv: imgmeta.texcoords_flipv, texcoords_fliphv: imgmeta.texcoords_fliphv }, audiometa: null, });
					}
					else {
						jsonout.push({ resid: imgi, resname: name, type: type, start: bufferPointer, end: bufferPointer + res.buffer.length, imgmeta: { atlassed: imgmeta.atlassed, width: imgmeta.width, height: imgmeta.height, texcoords: imgmeta.texcoords, texcoords_fliph: imgmeta.texcoords_fliph, texcoords_flipv: imgmeta.texcoords_flipv, texcoords_fliphv: imgmeta.texcoords_fliphv }, audiometa: null, });
						bufferPointer += res.buffer.length;
					}
				}
				else {
					jsonout.push({ resid: imgi, resname: name, type: type, start: bufferPointer, end: bufferPointer + res.buffer.length, imgmeta: { atlassed: false, width: img.width, height: img.height, }, audiometa: null, });
					bufferPointer += res.buffer.length;
				}
				tsimgout.push(`\t${name} = ${imgi},`);
				++imgi;
				break;
			case 'audio':
				{
					let parsedMeta = parseAudioMeta(name);

					name = parsedMeta.sanitizedName;
					jsonout.push({ resid: sndi, resname: name, type: type, start: bufferPointer, end: bufferPointer + res.buffer.length, imgmeta: null, audiometa: parsedMeta.meta });
				}
				tssndout.push(`\t${name} = ${sndi},`);
				++sndi;
				bufferPointer += res.buffer.length;
				break;
			case 'source':
				name = name.replace('.min', '');
				jsonout.push({ resid: sndi, resname: name, type: type, start: bufferPointer, end: bufferPointer + res.buffer.length, imgmeta: null, audiometa: null });
				bufferPointer += res.buffer.length;
				break;
		}
		bar.increment(1);
	}

	let atlasbuffer: Buffer;

	if (GENERATE_AND_USE_TEXTURE_ATLAS) {
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

		jsonout.push({ resid: imgi, resname: '_atlas', type: 'image', start: bufferPointer, end: bufferPointer + atlasbuffer.length, imgmeta: { atlassed: false, width: atlasSize.x, height: atlasSize.y }, audiometa: null });
		tsimgout.push(`\t_atlas = ${imgi},`);
		bufferPointer += atlasbuffer.length;
		bar.increment(5);
	}

	tsimgout.push("}\n");
	tssndout.push("}\n");

	let jsonbuffer = Buffer.from(encodeuint8arr(JSON.stringify(jsonout)));
	buffers.push(jsonbuffer);
	bar.increment(1);

	let rommeta = <RomMeta>{
		start: bufferPointer,
		end: bufferPointer + jsonbuffer.length
	};
	let rommetastr = JSON.stringify(rommeta).padStart(100, ' ');
	buffers.push(Buffer.from(encodeuint8arr(rommetastr)));
	bar.increment(1);
	bar.stop();

	log("Alles nu zippen... ");
	startRotator();
	let zipped = zip(Buffer.concat(buffers));
	stopRotator();
	log("\tKlaar!\n");
	log(`"${_colors.green(outfile)}" wegschrijven naar ${_colors.green(`\"./dist/${outfile}\"`)}...`);
	startRotator();
	writeFileSync(`./dist/${outfile}`, zipped);
	stopRotator();
	log("\tKlaar!\n");
	log(`resourceids.ts maken...`);
	startRotator();
	writeFileSync("./src/bmsx/resourceids.ts", tsimgout.concat(tssndout).join('\n'));
	writeFileSync("./rom/_ignore/romresources.json", jsonbuffer);
	if (GENERATE_AND_USE_TEXTURE_ATLAS) {
		writeFileSync("./rom/_ignore/atlas.png", atlasbuffer);
	}
	stopRotator();
	log("\tKlaar!\n");
	log("Rom is gepackt!!\n");
	log(`\tFiles: ${arrayOfFiles.length}\n\t\timages: ${imgi}\n\t\taudio: ${sndi}\n`);
	log(`\tSize: ${(Buffer.concat(buffers).length / (1024 * 1024)).toFixed(2)} mB\n\tDeflated size: ${(zipped.length / (1024 * 1024)).toFixed(2)} mB.\n`);
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
	// log("Texture atlas cropperen... ");
	// startRotator();

	let cropw = atlasExploitedX;
	let croph = atlasUnsafeY;
	const result: HTMLCanvasElement = createCanvas(cropw, croph);
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

	// stopRotator();
	// log("\tKlaar!\n");

	return result;
}

try {
	log(_colors.brightGreen("┏————————————————————————————————————————┓\n"));
	log(_colors.brightGreen("|              BMSX ROMPACKER            |\n"));
	log(_colors.brightGreen("|                DOOR BOAZ©®             |\n"));
	log(_colors.brightGreen("┗————————————————————————————————————————┛\n"));
	let args = process.argv.slice(2);
	if (args.length <= 0) throw new Error("Missing parameter for output file (rom name, e.g. \"sintervania.rom\"");
	let outfile = args[0];
	let force = args.length > 1 ? args[1] : undefined;

	if (!force && existsSync(`./dist/${outfile}`) && existsSync(`"./rom/tsout.js"`)) {
		let romstats = statSync(`./dist/${outfile}`);
		let rommtime = romstats.mtime;
		let jsstats = statSync(`"./rom/tsout.js"`);
		let jsmtime = jsstats.mtime;
		if (jsmtime < rommtime) {
			console.info("No action performed: game rom was newer than code.\nUse --force option to ignore this check.");
			process.exit(0);
		}
	}

	bundleGamecode("./rom/tsout.js")
		.then(() => buildRompackAndResourceList(outfile))
		.then(() => buildGameHtml(outfile))
		.then(() => deploy())
		.then(() => log(_colors.brightGreen("===  ALLES DONUT!  ===\n")))
		.catch(e => { log(`Er ging iets niet goed: ${e?.message ?? 'en ook geen foutmelding beschikbaar :-('}\n`, 'error'); process.exit(-1); });
} catch (e) {
	log(`Er ging iets niet goed: ${e.message}\n`, 'error');
	process.exit(-1);
}
