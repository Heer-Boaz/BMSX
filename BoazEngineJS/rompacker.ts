import { readdirSync, statSync, readFileSync, writeFileSync } from "fs";
import { join, parse } from "path";

export interface RomResource {
	resid: number;
	resname: string;
	type: string;
	start: number;
	end: number;
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
		jsonout.push({ resid: i, resname: parse(arrayOfFiles[i]).name, type: type, start: bufferPointer, end: bufferPointer + buffers[i].length });
		bufferPointer += buffers[i].length;
		switch (type) {
			case 'image': tsimgout.push(`\t${parse(arrayOfFiles[i]).name} = ${imgi++},`); break;
			case 'audio': tssndout.push(`\t${parse(arrayOfFiles[i]).name} = ${sndi++},`); break;
		}
	}

	tsimgout.push("}\n");
	tssndout.push("}\n");

	writeFileSync("../rom/packed.rom", Buffer.concat(buffers));
	writeFileSync("../rom/romtable.json", JSON.stringify(jsonout));
	writeFileSync("../src/resourceids.ts", tsimgout.concat(tssndout).join('\n'));
} catch (e) {
	console.error(e);
}
