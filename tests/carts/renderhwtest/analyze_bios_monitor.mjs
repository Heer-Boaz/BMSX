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

const game = frame(120);
const monitor = frame(126);
const help = frame(160);
const resumed = frame(198);
for (const output of [game, monitor, help, resumed]) {
	assert.equal(output.width, 320);
	assert.equal(output.height, 240);
}

const retainedGameStart = 48 * game.width * 4;
assert.equal(
	Buffer.compare(game.data.subarray(retainedGameStart), monitor.data.subarray(retainedGameStart)),
	0,
	'BIOS monitor changed retained GX scanout below its character cells',
);
assert.equal(
	Buffer.compare(game.data.subarray(retainedGameStart), help.data.subarray(retainedGameStart)),
	0,
	'BIOS HELP command changed retained GX scanout below its character cells',
);

const entryTextPixels = countTerminalPixels(monitor, 0, 36);
const helpTextPixels = countTerminalPixels(help, 36, 48);
const resumedTextPixels = countTerminalPixels(resumed, 0, 48);
assert(entryTextPixels > 80, `BIOS monitor entry text is missing: ${entryTextPixels} pixels`);
assert(helpTextPixels > 30, `BIOS HELP output is missing: ${helpTextPixels} pixels`);
assert.equal(resumedTextPixels, 0, 'BIOS display circuit 2 remained enabled after CONT');

console.log(JSON.stringify({ entryTextPixels, helpTextPixels, resumedTextPixels }, null, 2));
