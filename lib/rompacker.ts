import { readdirSync, statSync, readFileSync, writeFileSync, copyFile, copyFileSync, existsSync, exists, createWriteStream } from "fs";
import { join, parse } from "path";
import { AudioMeta, AudioType, RomResource, RomMeta } from "./rompack";
const browserify = require("browserify");
const tsify = require("tsify");
// const babelify = require("babelify");

const terser = require('terser');
const pako = require('../node_modules/pako');
const minify = require('@node-minify/core');
const cleanCSS = require('@node-minify/clean-css');

/**
 * Convert an Uint8Array into a string.
 * https://ourcodeworld.com/articles/read/164/how-to-convert-an-uint8array-to-string-in-javascript
 * @returns {String}
 */
function decodeuint8arr(uint8array: Uint8Array): string {
	return new TextDecoder("utf-8").decode(uint8array);
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

function copyResources(): void {
	copyFileSync("./rom/loading.png", "./dist/loading.png");
}

async function bundleGamecode(outfile: string): Promise<any> {
	let arrayOfFiles = getAllFiles("./src", [], ".ts");
	arrayOfFiles = getAllFiles("./BoazEngineJS", arrayOfFiles, ".ts");
	// console.log(arrayOfFiles);

	let writeOutput = createWriteStream('./rom/thegame.js');

	browserify({
		// basedir: '.',
		debug: false,
		project: ['./tsconfig.json'],
		cache: {},
		packageCache: {}
	})
		.add(arrayOfFiles)
		.plugin(tsify)
		// .transform(babelify, {
		// 	extensions: ['.tsx', '.ts'],
		// 	presets: ['es2015']
		// })
		.bundle()
		.on("error", function (e) {
			console.error(e.message);
			// throw e;
		})
		.pipe(writeOutput);

	return new Promise(function (resolve, reject) {
		writeOutput.on('finish', function () {
			console.info("finish!");
			resolve();
		});
		writeOutput.on('error', function (e) {
			console.error(e.message);
			reject(e);
		});
	});
}

function minifyGamecode(infile: string): void {
	let options = {
		compress: false,
		mangle: false,
		// compress: {
		// 	// module: true,
		// 	arrows: false,
		// 	warnings: true,
		// },
		// mangle: {
		// 	// properties: true,
		// 	// module: true,
		// 	safari10: true,
		// 	reserved: ["Bootstrapper", "Bootstrapper.h406A", "exports" ],

		// },
		sourceMap: {
			url: "inline",
			content: "inline",
			includeSources: true,
		},
		output: {
			safari10: true,
			webkit: true,
		},
		// wrap: "__rom__",
	};

	let gamejs = readFileSync(infile, 'utf8');
	let gamejsMinified = terser.minify(gamejs, options).code;

	writeFileSync("./rom/thegame.min.js", gamejsMinified);
}

function buildGameHtml(outfile: string): void {
	let html = readFileSync("./gamebase.html", 'utf8');
	let romjs = readFileSync("./rom/rom.js", 'utf8');
	let zipjs = readFileSync("./lib/pako_inflate.min.js", 'utf8');
	romjs = romjs.replace('Object.defineProperty(exports, "__esModule", { value: true });', '');
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
	let bmsx = readFileSync("./rom/bmsx.png");
	let bmsx_base64ed = bmsx.toString('base64');

	minify({
		compressor: cleanCSS,
		input: "./gamebase.css",
		output: "./gamebase.min.css",
		callback: function (err, cssMinified: string) {
			html = html.replace('//#romjs', romjsMinified);
			html = html.replace('//#zipjs', zipjs);
			html = html.replace('/*css*/', cssMinified);
			html = html.replace('#outfile', outfile);
			html = html.replace('#bmsxurl', "data:image/png;base64," + bmsx_base64ed);

			writeFileSync("./dist/game.html", html);
		}
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

async function buildRompackAndResourceList(outfile: string): Promise<void> {
	bundleGamecode("./rom/thegame.js")
		.then(() => {
			minifyGamecode("./rom/thegame.js");
			const arrayOfFiles = getFiles("./rom");
			addFile("./rom", "thegame.min.js", arrayOfFiles); // Add source at the end

			let buffers = new Array<Buffer>();
			arrayOfFiles.forEach(x => buffers.push(readFileSync(x)));

			let tsimgout = new Array<string>();
			let tssndout = new Array<string>();

			tsimgout.push("export const enum BitmapId {\n\tNone = 0,");
			tssndout.push("export const enum AudioId {\n\tNone = 0,");

			let jsonout = new Array<RomResource>();
			let bufferPointer = 0;
			let imgi = 1;
			let sndi = 1;
			for (let i = 0; i < arrayOfFiles.length; i++) {
				let type: string;
				let name = parse(arrayOfFiles[i]).name.replace(' ', '');
				switch (parse(arrayOfFiles[i]).ext) {
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
				switch (type) {
					case 'image':
						jsonout.push({ resid: imgi, resname: name, type: type, start: bufferPointer, end: bufferPointer + buffers[i].length, audiometa: null });
						tsimgout.push(`\t${name} = ${imgi},`);
						++imgi;
						break;
					case 'audio':
						{
							let parsedMeta = parseAudioMeta(name);
							name = parsedMeta.sanitizedName;
							jsonout.push({ resid: sndi, resname: name, type: type, start: bufferPointer, end: bufferPointer + buffers[i].length, audiometa: parsedMeta.meta });
						}
						tssndout.push(`\t${name} = ${sndi},`);
						++sndi;
						break;
					case 'source':
						name = name.replace('.min', '');
						jsonout.push({ resid: sndi, resname: name, type: type, start: bufferPointer, end: bufferPointer + buffers[i].length, audiometa: null });
						break;
				}
				bufferPointer += buffers[i].length;
			}

			tsimgout.push("}\n");
			tssndout.push("}\n");

			let jsonbuffer = Buffer.from(encodeuint8arr(JSON.stringify(jsonout)));
			buffers.push(jsonbuffer);

			let rommeta = <RomMeta>{
				start: bufferPointer,
				end: bufferPointer + jsonbuffer.length
			};
			let rommetastr = JSON.stringify(rommeta).padStart(100, ' ');
			buffers.push(Buffer.from(encodeuint8arr(rommetastr)));

			let zipped = zip(Buffer.concat(buffers));
			writeFileSync(`./dist/${outfile}`, zipped);
			writeFileSync("./src/resourceids.ts", tsimgout.concat(tssndout).join('\n'));
			writeFileSync("./rom/_ignore/romresources.json", jsonbuffer);
			console.info("Rom successfully packed!");
			console.info(`\tFiles: ${arrayOfFiles.length}\n\t\timages: ${imgi}\n\t\taudio: ${sndi}`);
			console.info(`\tSize: ${(Buffer.concat(buffers).length / (1024 * 1024)).toFixed(2)} mB\n\tDeflated size: ${(zipped.length / (1024 * 1024)).toFixed(2)} mB.`);
		}).catch(e => console.error(e));
}

try {
	let args = process.argv.slice(2);
	if (args.length <= 0) throw new Error("Missing parameter for output file (rom name, e.g. \"sintervania.rom\"");
	let outfile = args[0];
	let force = args.length > 1 ? args[1] : undefined;

	if (!force && existsSync(`./dist/${outfile}`) && existsSync(`"./rom/thegame.js"`)) {
		let romstats = statSync(`./dist/${outfile}`);
		let rommtime = romstats.mtime;
		let jsstats = statSync(`"./rom/thegame.js"`);
		let jsmtime = jsstats.mtime;
		if (jsmtime < rommtime) {
			console.info("No action performed: game rom was newer than code.\nUse --force option to ignore this check.");
			process.exit(0);
		}
	}

	buildRompackAndResourceList(outfile).then(() => {
		buildGameHtml(outfile);
		console.info("klaar");
	}).catch(e => console.error(e));
} catch (e) {
	console.error(e);
	process.exit(-1);
}
