#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const workspaceRoot = process.cwd();
const outputDir = path.join(workspaceRoot, 'src/carts/nemesis_s/res/img');
const sourceRoot = path.join(
	workspaceRoot,
	'.external/nemesis-s-bdx/UltimateMechSpaceWar/UltimateMechSpaceWarContent/Images',
);

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function decodeBmp(filePath) {
	const bytes = fs.readFileSync(filePath);
	assert(bytes.length >= 54, `BMP too small: ${filePath}`);
	assert(bytes.toString('ascii', 0, 2) === 'BM', `Not a BMP file: ${filePath}`);

	const pixelOffset = bytes.readUInt32LE(10);
	const dibHeaderSize = bytes.readUInt32LE(14);
	const widthSigned = bytes.readInt32LE(18);
	const heightSigned = bytes.readInt32LE(22);
	const planes = bytes.readUInt16LE(26);
	const bitsPerPixel = bytes.readUInt16LE(28);
	const compression = bytes.readUInt32LE(30);
	const colorsUsed = bytes.readUInt32LE(46);

	assert(planes === 1, `Unexpected BMP planes=${planes}: ${filePath}`);
	assert(compression === 0, `Unsupported BMP compression=${compression}: ${filePath}`);

	const width = Math.abs(widthSigned);
	const height = Math.abs(heightSigned);
	const isTopDown = heightSigned < 0;
	assert(width > 0 && height > 0, `Invalid BMP dimensions ${width}x${height}: ${filePath}`);

	const rgba = new Uint8Array(width * height * 4);
	const rowStrideBytes = Math.floor((bitsPerPixel * width + 31) / 32) * 4;

	let palette = null;
	if (bitsPerPixel <= 8) {
		const paletteSize = colorsUsed || (1 << bitsPerPixel);
		const paletteOffset = 14 + dibHeaderSize;
		palette = new Array(paletteSize);
		for (let i = 0; i < paletteSize; i += 1) {
			const p = paletteOffset + i * 4;
			const blue = bytes[p];
			const green = bytes[p + 1];
			const red = bytes[p + 2];
			palette[i] = { r: red, g: green, b: blue, a: 255 };
		}
	}

	for (let y = 0; y < height; y += 1) {
		const srcY = isTopDown ? y : height - 1 - y;
		const rowStart = pixelOffset + srcY * rowStrideBytes;
		for (let x = 0; x < width; x += 1) {
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 255;

			if (bitsPerPixel === 24) {
				const p = rowStart + x * 3;
				b = bytes[p];
				g = bytes[p + 1];
				r = bytes[p + 2];
			} else if (bitsPerPixel === 32) {
				const p = rowStart + x * 4;
				b = bytes[p];
				g = bytes[p + 1];
				r = bytes[p + 2];
				a = bytes[p + 3];
			} else if (bitsPerPixel === 8) {
				const idx = bytes[rowStart + x];
				const color = palette[idx];
				r = color.r;
				g = color.g;
				b = color.b;
				a = color.a;
			} else if (bitsPerPixel === 4) {
				const packed = bytes[rowStart + Math.floor(x / 2)];
				const idx = x % 2 === 0 ? packed >> 4 : packed & 0x0f;
				const color = palette[idx];
				r = color.r;
				g = color.g;
				b = color.b;
				a = color.a;
			} else if (bitsPerPixel === 1) {
				const packed = bytes[rowStart + Math.floor(x / 8)];
				const shift = 7 - (x % 8);
				const idx = (packed >> shift) & 1;
				const color = palette[idx];
				r = color.r;
				g = color.g;
				b = color.b;
				a = color.a;
			} else {
				throw new Error(`Unsupported BMP bpp=${bitsPerPixel}: ${filePath}`);
			}

			const outIndex = (y * width + x) * 4;
			rgba[outIndex] = r;
			rgba[outIndex + 1] = g;
			rgba[outIndex + 2] = b;
			rgba[outIndex + 3] = a;
		}
	}

	return { width, height, data: rgba };
}

function applyColorKey(image, keyColor) {
	if (!keyColor) {
		return image;
	}
	for (let i = 0; i < image.data.length; i += 4) {
		if (
			image.data[i] === keyColor.r &&
			image.data[i + 1] === keyColor.g &&
			image.data[i + 2] === keyColor.b
		) {
			image.data[i + 3] = 0;
		}
	}
	return image;
}

function writePng(filePath, image) {
	const png = new PNG({ width: image.width, height: image.height });
	png.data = Buffer.from(image.data);
	const encoded = PNG.sync.write(png);
	fs.writeFileSync(filePath, encoded);
}

function getMappings() {
	return [
		{
			source: 'Player/Metallion_n.bmp',
			target: 'metallion_n.png',
			colorKey: { r: 0, g: 0, b: 0 },
		},
		{
			source: 'Player/Metallion_u.bmp',
			target: 'metallion_u.png',
			colorKey: { r: 0, g: 0, b: 0 },
		},
		{
			source: 'Player/Metallion_d.bmp',
			target: 'metallion_d.png',
			colorKey: { r: 0, g: 0, b: 0 },
		},
		{
			source: 'Projectiles/Kogeltje.bmp',
			target: 'kogeltje.png',
			colorKey: { r: 0, g: 0, b: 0 },
		},
		{
			source: 'Story/Sterrenachtergrond.bmp',
			target: 'sterrenachtergrond.png',
		},
		{
			source: 'Misc/Star_Blue.bmp',
			target: 'star_blue.png',
		},
		{
			source: 'Misc/Star_Yellow.bmp',
			target: 'star_yellow.png',
		},
		{
			source: 'Stage/ground.bmp',
			target: 'ground.png',
		},
		{
			source: 'Stage/ground2.bmp',
			target: 'ground2.png',
		},
		{
			source: 'Stage/ground_V.bmp',
			target: 'ground_v.png',
		},
		{
			source: 'Stage/ground2_V.bmp',
			target: 'ground2_v.png',
		},
		{
			source: 'Stage/ground3.bmp',
			target: 'ground3.png',
		},
		{
			source: 'Stage/ground4.bmp',
			target: 'ground4.png',
		},
		{
			source: 'Stage/groundStart.bmp',
			target: 'ground_start.png',
		},
		{
			source: 'Stage/groundEnd.bmp',
			target: 'ground_end.png',
		},
		{
			source: 'Stage/groundStart_V.bmp',
			target: 'ground_start_v.png',
		},
		{
			source: 'Stage/groundEnd_V.bmp',
			target: 'ground_end_v.png',
		},
		{
			source: 'Stage/snow.bmp',
			target: 'snow.png',
		},
	];
}

function main() {
	assert(fs.existsSync(sourceRoot), `Source root missing: ${sourceRoot}`);
	fs.mkdirSync(outputDir, { recursive: true });

	const mappings = getMappings();
	for (let i = 0; i < mappings.length; i += 1) {
		const mapping = mappings[i];
		const sourcePath = path.join(sourceRoot, mapping.source);
		assert(fs.existsSync(sourcePath), `Source file missing: ${sourcePath}`);

		let image = decodeBmp(sourcePath);
		if (mapping.colorKey) {
			image = applyColorKey(image, mapping.colorKey);
		}

		const targetPath = path.join(outputDir, mapping.target);
		writePng(targetPath, image);
	}

	console.log(`Converted ${mappings.length} nemesis_s PNG assets into ${outputDir}`);
}

main();
