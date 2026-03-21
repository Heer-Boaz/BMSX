import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

const workspaceRoot = process.cwd();
const outputDir = path.join(workspaceRoot, 'src/carts/pietious/res/img/castle_stuff');
const basePath = path.join(outputDir, 'water_surface_msx.png');
const frameCount = 64;

function readPng(filePath) {
	return PNG.sync.read(fs.readFileSync(filePath));
}

function writePng(filePath, png) {
	fs.writeFileSync(filePath, PNG.sync.write(png));
}

function clonePng(source) {
	const png = new PNG({ width: source.width, height: source.height });
	png.data = Buffer.from(source.data);
	return png;
}

function rotateRowLeft(png, y) {
	const rowOffset = y * png.width * 4;
	const firstPixel = Buffer.from(png.data.subarray(rowOffset, rowOffset + 4));
	for (let x = 0; x < png.width - 1; x++) {
		const sourceOffset = rowOffset + ((x + 1) * 4);
		const targetOffset = rowOffset + (x * 4);
		png.data.copyWithin(targetOffset, sourceOffset, sourceOffset + 4);
	}
	png.data.set(firstPixel, rowOffset + ((png.width - 1) * 4));
}

function applyMsxWaterSurfaceTick(png, tick) {
	rotateRowLeft(png, 5);
	rotateRowLeft(png, 6);
	rotateRowLeft(png, 7);
	if ((tick % 2) === 0) {
		rotateRowLeft(png, 3);
		rotateRowLeft(png, 4);
	}
	if ((tick % 4) === 0) {
		rotateRowLeft(png, 1);
		rotateRowLeft(png, 2);
	}
	if ((tick % 8) === 0) {
		rotateRowLeft(png, 0);
	}
}

function pngEquals(a, b) {
	if (a.width !== b.width || a.height !== b.height) {
		return false;
	}
	return Buffer.compare(a.data, b.data) === 0;
}

const base = readPng(basePath);
const frame = clonePng(base);

for (let tick = 1; tick < frameCount; tick++) {
	applyMsxWaterSurfaceTick(frame, tick);
	writePng(path.join(outputDir, `water_surface_msx_${String(tick).padStart(2, '0')}.png`), frame);
}

applyMsxWaterSurfaceTick(frame, frameCount);
if (!pngEquals(base, frame)) {
	throw new Error('Expected MSX water surface cycle to close after 64 ticks.');
}

console.log(`Generated ${frameCount - 1} ROM-derived water surface frames.`);
