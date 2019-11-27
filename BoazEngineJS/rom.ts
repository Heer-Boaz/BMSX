
// /**
//  * Creates a new Uint8Array based on two different ArrayBuffers
//  * https://gist.github.com/72lions/4528834
//  * @param {ArrayBuffer} buffer1 The first buffer.
//  * @param {ArrayBuffer} buffer2 The second buffer.
//  * @return {ArrayBuffer} The new ArrayBuffer created out of the two.
//  */
// export function appendBuffer(buffer1: ArrayBuffer, buffer2: ArrayBuffer): ArrayBuffer {
// 	var tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
// 	tmp.set(new Uint8Array(buffer1), 0);
// 	tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
// 	return <ArrayBuffer>tmp.buffer;
// }

// export function bla(): void {
// 	const image = document.getElementById('target') as HTMLImageElement;

// 	// Fetch the original image
// 	fetch('tortoise.png')
// 		// Retrieve its body as ReadableStream
// 		.then(response => (response.body, response.blob))
// 		// Create a gray-scaled PNG stream out of the original
// 		// .then(rs => rs.pipeThrough(new TransformStream(new GrayscalePNGTransformer())))
// 		// Create a new response out of the stream
// 		// .then(rs => new Response(rs))
// 		// Create an object URL for the response
// 		// .then(response => response.blob())
// 		.then((body, blob) => URL.createObjectURL(blob))
// 		// Update image
// 		.then(url => image.src = url)
// 		.catch(console.error);

// 	var blob = new Blob([new Uint8Array(0)], { type: 'application/octet-stream' });
// }

import { readdirSync, statSync, readFileSync, writeFileSync } from "fs";
import { join, parse } from "path";

function getAllFiles(dirPath: string, arrayOfFiles?: string[]): string[] {
	let files = readdirSync(dirPath);

	arrayOfFiles = arrayOfFiles || [];

	files.forEach(function (file) {
		if (statSync(dirPath + "/" + file).isDirectory()) {
			arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
		} else {
			if (!file.endsWith('.rom') && !file.endsWith('.json'))
				arrayOfFiles.push(join(__dirname, dirPath, "/", file));
		}
	})

	return arrayOfFiles;
}

try {
	const arrayOfFiles = getAllFiles("../rom");
	console.log(`filecount: ${arrayOfFiles.length}`);

	let buffers = new Array<Buffer>();
	arrayOfFiles.forEach(x => buffers.push(readFileSync(x)));

	let tsout = new Array<string>();
	let jsonout = new Array<{ resid: number, resname: string, start: number, end: number }>();
	let bufferPointer = 0;
	for (let i = 0; i < arrayOfFiles.length; i++) {
		jsonout.push({ resid: i, resname: parse(arrayOfFiles[i]).name, start: bufferPointer, end: bufferPointer + buffers[i].length });
		bufferPointer += buffers[i].length;
	}

	writeFileSync("../rom/packed.rom", Buffer.concat(buffers));
	writeFileSync("../rom/romtable.json", JSON.stringify(jsonout));

} catch (e) {
	console.log(e);
}
