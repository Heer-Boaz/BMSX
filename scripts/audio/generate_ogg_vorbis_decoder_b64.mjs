import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_INPUT = 'node_modules/@wasm-audio-decoders/ogg-vorbis/dist/ogg-vorbis-decoder.min.js';
const DEFAULT_OUTPUT = 'src/bmsx_hostplatform/browser/ogg_vorbis_decoder_base64.ts';
const CHUNK_SIZE = 120;

function chunkString(value, size) {
	const chunks = [];
	for (let offset = 0; offset < value.length; offset += size) {
		chunks.push(value.slice(offset, offset + size));
	}
	return chunks;
}

function main() {
	const inputPath = resolve(process.cwd(), process.argv[2] ?? DEFAULT_INPUT);
	const outputPath = resolve(process.cwd(), process.argv[3] ?? DEFAULT_OUTPUT);
	const base64 = readFileSync(inputPath).toString('base64');
	const chunks = chunkString(base64, CHUNK_SIZE);
	const body = chunks.map((chunk, index) => {
		const suffix = index === chunks.length - 1 ? '' : ' +';
		return `\t'${chunk}'${suffix}`;
	}).join('\n');
	const fileContents = `export const OGG_VORBIS_DECODER_B64 =\n${body};\n`;
	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, fileContents, 'utf8');
	console.log(`[generate_ogg_vorbis_decoder_b64] wrote ${outputPath} (${chunks.length} chunks, ${base64.length} chars)`);
}

main();
