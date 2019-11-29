import { readdirSync, statSync, readFileSync, writeFileSync } from "fs";
import { join, parse } from "path";

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

function getAllFiles(dirPath: string, arrayOfFiles?: string[]): string[] {
	let files = readdirSync(dirPath);

	arrayOfFiles = arrayOfFiles || [];

	files.forEach(function (file) {
		if (statSync(dirPath + "/" + file).isDirectory()) {
			arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
		} else {
			if (!file.endsWith('.rom') && !file.endsWith('.json') && !file.endsWith('.js') && !file.endsWith('.map') && !file.endsWith('.tsbuildinfo'))
				arrayOfFiles.push(join(__dirname, dirPath, "/", file));
		}
	})

	return arrayOfFiles;
}

try {
	const arrayOfFiles = getAllFiles("../rom");
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
		let type = parse(arrayOfFiles[i]).ext === '.wav' ? 'audio' : 'image';
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

	writeFileSync("../rom/packed.rom", Buffer.concat(buffers));
	// writeFileSync("../rom/romtable.json", JSON.stringify(jsonout));
	writeFileSync("../src/resourceids.ts", tsimgout.concat(tssndout).join('\n'));
} catch (e) {
	console.error(e);
}
