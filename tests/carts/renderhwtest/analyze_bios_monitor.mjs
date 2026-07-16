import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const screenshotDir = process.argv[2] || path.join('tests', 'carts', 'renderhwtest', 'screenshots');

function frame(frameNumber) {
	const file = path.join(screenshotDir, `frame_${String(frameNumber).padStart(5, '0')}.png`);
	return PNG.sync.read(fs.readFileSync(file));
}

function countTerminalPixels(png, top, bottom) {
	let count = 0;
	for (let y = top; y < bottom; y += 1) {
		for (let x = 0; x < png.width; x += 1) {
			const offset = (y * png.width + x) * 4;
			const red = png.data[offset];
			const green = png.data[offset + 1];
			const blue = png.data[offset + 2];
			if ((red === 255 && green === 255 && blue === 255)
				|| (red === 0 && green === 255 && blue === 255)) {
				count += 1;
			}
		}
	}
	return count;
}

const game = frame(121);
const monitor = frame(127);
const help = frame(161);
assert.equal(game.width, 320);
assert.equal(game.height, 240);
for (const output of [monitor, help]) {
	assert.equal(output.width, 256);
	assert.equal(output.height, 192);
}

const entryTextPixels = countTerminalPixels(monitor, 0, 36);
const helpTextPixels = countTerminalPixels(help, 36, 48);
assert(entryTextPixels > 80, `BIOS monitor entry text is missing: ${entryTextPixels} pixels`);
assert(helpTextPixels > 30, `BIOS HELP output is missing: ${helpTextPixels} pixels`);

console.log(JSON.stringify({ entryTextPixels, helpTextPixels }, null, 2));
