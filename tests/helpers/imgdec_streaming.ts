import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { encodeDirect16GxTexture, encodePalette4GxTexture } from '../../toolchain/ts/rompack/gx_texture_codec';
import { encodeImgDecStream } from '../../toolchain/ts/rompack/imgdec_codec';
import { buildSourceCartridgeFixture } from './source_cartridge';

export type StreamingConfiguration = {
	width: number; height: number; palette4: boolean; uploads: number; actors: number; voices: number;
};

export const STREAMING_CONFIGURATIONS: Readonly<Record<string, StreamingConfiguration>> = {
	'direct16-128': { width: 128, height: 128, palette4: false, uploads: 1, actors: 32, voices: 4 },
	'direct16-128-idle': { width: 128, height: 128, palette4: false, uploads: 1, actors: 0, voices: 4 },
	'direct16-128-four': { width: 128, height: 128, palette4: false, uploads: 4, actors: 32, voices: 4 },
	'direct16-256': { width: 256, height: 224, palette4: false, uploads: 1, actors: 32, voices: 4 },
	'palette4-128': { width: 128, height: 128, palette4: true, uploads: 1, actors: 32, voices: 4 },
};

/** Mixed flat, checker, repeated and noisy tiles; no retained RAM upload image. */
export function streamingImage(width: number, height: number, frame: number, palette4 = false): Uint8ClampedArray {
	const rgba = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
		const tile = ((x >> 3) + (y >> 3)) & 3;
		let color = (frame + (x >> 3) + (y >> 3)) & 7;
		if (tile === 1) color = (frame + (x & 1) + (y & 1)) & 7;
		if (tile === 2) color = ((Math.imul(x + frame * 17, 0x45d9f3b) ^ Math.imul(y, 0x119de1f3)) >>> 16) & 7;
		if (tile === 3) color = (frame + (x >> 1)) & 7;
		const offset = (y * width + x) * 4;
		rgba[offset] = (color & 1) !== 0 ? 224 : 32;
		rgba[offset + 1] = (color & 2) !== 0 ? 224 : 32;
		rgba[offset + 2] = (color & 4) !== 0 ? 224 : 32;
		rgba[offset + 3] = 255;
		if (tile === 2 && !palette4) {
			const noise = Math.imul(x + frame * 17, 0x45d9f3b) ^ Math.imul(y, 0x119de1f3);
			rgba[offset] = ((noise >>> 17) & 31) << 3;
			rgba[offset + 1] = ((noise >>> 12) & 31) << 3;
			rgba[offset + 2] = ((noise >>> 7) & 31) << 3;
		}
		if (x < 12 && y < 4) {
			const marker = ((frame >> (x >> 2)) & 1) * 248;
			rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = marker;
		}
	}
	return rgba;
}

export async function buildStreamingCartridge(directory: string, systemRom: Uint8Array, configuration: StreamingConfiguration) {
	const project = 'carts/imgdec_streaming';
	const resources = join(directory, project, 'res');
	await mkdir(resources, { recursive: true });
	const frames = [];
	let textureWords = 0, clutWords = 0, wordWidth = 0;
	for (let frame = 0; frame < 8; frame += 1) {
		const rgba = streamingImage(configuration.width, configuration.height, frame, configuration.palette4);
		const texture = configuration.palette4
			? encodePalette4GxTexture(configuration.width, configuration.height, rgba)
			: encodeDirect16GxTexture(configuration.width, configuration.height, rgba);
		const compressed = encodeImgDecStream(texture.words, texture.textureWordCount, texture.clutWordCount);
		await writeFile(join(resources, `frame_${frame}.bin`), compressed);
		textureWords = texture.textureWordCount; clutWords = texture.clutWordCount; wordWidth = texture.wordWidth;
		frames.push({ frame, inputWords: compressed.length >> 2, decodedWords: textureWords + clutWords,
			sha256: createHash('sha256').update(compressed).digest('hex') });
	}
	const tone = Buffer.alloc(64);
	const cycle = [0, 3135, 5793, 7568, 8192, 7568, 5793, 3135, 0, -3135, -5793, -7568, -8192, -7568, -5793, -3135];
	for (let sample = 0; sample < 32; sample += 1) tone.writeInt16LE(cycle[sample & 15], sample * 2);
	await writeFile(join(resources, 'tone.bin'), tone);
	const values = { ...configuration, word_width: wordWidth, texture_words: textureWords, clut_words: clutWords };
	const config = `module<const>\nreturn { ${Object.entries(values).map(([key, value]) => `${key} = ${value}`).join(', ')} }\n`;
	const cart = await buildSourceCartridgeFixture(directory, project, systemRom, [
		{ path: 'cart', source: await readFile('tests/carts/imgdec_streaming/cart.lua', 'utf8') },
		{ path: 'config', source: config },
	], { traceStatements: 'erase', preloadModules: [], resourceRoots: [resources] });
	const manifest = { configuration, frames, systemRomSha256: createHash('sha256').update(systemRom).digest('hex'),
		cartridgeSha256: createHash('sha256').update(cart).digest('hex') };
	await writeFile(join(directory, 'streaming.rom'), cart);
	await writeFile(join(directory, 'streaming.json'), `${JSON.stringify(manifest, null, 2)}\n`);
	return { cart, manifest };
}
