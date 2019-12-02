import { readdirSync, statSync, readFileSync, writeFileSync, copyFile, copyFileSync } from "fs";
import { join, parse } from "path";
var terser = require('terser');
const minify = require('@node-minify/core');
const cleanCSS = require('@node-minify/clean-css');

interface RomResource {
	resid: number;
	resname: string;
	type: string;
	start: number;
	end: number;
}

interface RomMeta {
	start: number;
	end: number;
}

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

function getAllFiles(dirPath: string, arrayOfFiles?: string[]): string[] {
	let files = readdirSync(dirPath);

	arrayOfFiles = arrayOfFiles || [];

	files.forEach(function (file) {
		if (statSync(dirPath + "/" + file).isDirectory()) {
			arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
		} else {
			if (!file.endsWith("loading.png") && !file.endsWith('.rom') && !file.endsWith('.json') && !file.endsWith('.js') && !file.endsWith('.map') && !file.endsWith('.tsbuildinfo'))
				arrayOfFiles.push(join(dirPath, "/", file));
		}
	})

	return arrayOfFiles;
}

function copyResources(): void {
	copyFileSync("./rom/loading.png", "./dist/loading.png");
}

function buildGameHtml(outfile: string): void {
	let html = readFileSync("./gamebase.html", 'utf8');
	let romjs = readFileSync("./rom/rom.js", 'utf8');
	var options = {
		mangle: {
			toplevel: true,
			reserved: ["basic"],
		},
	};
	let romjsMinified = terser.minify(romjs, options).code;
	let bmsx = readFileSync("./rom/bmsx.png");
	let bmsx_base64ed = bmsx.toString('base64');

	minify({
		compressor: cleanCSS,
		input: "./gamebase.css",
		output: "./gamebase.min.css",
		callback: function (err, cssMinified: string) {
			// let css = readFileSync("./gamebase.css", 'utf8');
			// let cssMinified = terser.minify(css).code;
			html = html.replace('//#romjs', romjsMinified);
			html = html.replace('/*css*/', cssMinified);
			html = html.replace('#outfile', outfile);
			html = html.replace('#bmsxurl', "data:image/png;base64," + bmsx_base64ed);

			writeFileSync("./dist/game.html", html);
		}
	});
}

function buildRompackAndResourceList(outfile: string): void {
	const arrayOfFiles = getAllFiles("./rom");
	addFile("./rom", "thegame.js", arrayOfFiles); // Add source at the end
	console.info(`Filecount: ${arrayOfFiles.length}`);

	let buffers = new Array<Buffer>();
	arrayOfFiles.forEach(x => buffers.push(readFileSync(x)));

	let tsimgout = new Array<string>();
	let tssndout = new Array<string>();

	tsimgout.push("export const enum BitmapId {\n\tNone = -1,");
	tssndout.push("export const enum AudioId {\n\tNone = -1,");

	let jsonout = new Array<RomResource>();
	let bufferPointer = 0;
	let imgi = 0;
	let sndi = 0;
	for (let i = 0; i < arrayOfFiles.length; i++) {
		let type: string;
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
				jsonout.push({ resid: imgi, resname: parse(arrayOfFiles[i]).name, type: type, start: bufferPointer, end: bufferPointer + buffers[i].length });
				tsimgout.push(`\t${parse(arrayOfFiles[i]).name} = ${imgi},`);
				++imgi;
				break;
			case 'audio':
				jsonout.push({ resid: sndi, resname: parse(arrayOfFiles[i]).name, type: type, start: bufferPointer, end: bufferPointer + buffers[i].length });
				tssndout.push(`\t${parse(arrayOfFiles[i]).name} = ${sndi},`);
				++sndi;
				break;
			case 'source':
				jsonout.push({ resid: sndi, resname: parse(arrayOfFiles[i]).name, type: type, start: bufferPointer, end: bufferPointer + buffers[i].length });
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

	writeFileSync(`./dist/${outfile}`, Buffer.concat(buffers));
	writeFileSync("./src/resourceids.ts", tsimgout.concat(tssndout).join('\n'));
	// writeFileSync("../rom/romtable.json", JSON.stringify(jsonout));
}

try {
	let args = process.argv.slice(2);
	if (args.length <= 0) throw new Error("Missing parameter for output file (rom name, e.g. \"sintervania.rom\"");
	let outfile = args[0];
	buildRompackAndResourceList(outfile);
	buildGameHtml(outfile);
	// copyResources();
} catch (e) {
	console.error(e);
}
