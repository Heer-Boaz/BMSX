import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const screenshotDir = process.argv[2] || path.join('tests', 'carts', 'renderhwtest', 'screenshots');

function frame(frameNumber) {
	const file = path.join(screenshotDir, `frame_${String(frameNumber).padStart(5, '0')}.png`);
	return PNG.sync.read(fs.readFileSync(file));
}

function countPixels(png, left, top, right, bottom, predicate) {
	let count = 0;
	for (let y = top; y < bottom; y += 1) {
		for (let x = left; x < right; x += 1) {
			const offset = (y * png.width + x) * 4;
			if (predicate(png.data[offset], png.data[offset + 1], png.data[offset + 2])) {
				count += 1;
			}
		}
	}
	return count;
}

const terminal = frame(124);
const menu = frame(164);
assert.equal(terminal.width, 320);
assert.equal(terminal.height, 240);
assert.equal(menu.width, terminal.width);
assert.equal(menu.height, terminal.height);

const terminalTextPixels = countPixels(terminal, 0, 0, 120, 24, (r, g, b) => r > 120 && g > 120 && b > 120);
assert(terminalTextPixels > 20, `terminal overlay text is missing: ${terminalTextPixels} bright top pixels`);
const menuTextPixels = countPixels(menu, 88, 72, 220, 184, (r, g, b) => r === g && g === b && r > 150);
assert(menuTextPixels > 100, `quick menu option text is missing: ${menuTextPixels} bright panel pixels`);
const menuTitlePixels = countPixels(menu, 94, 48, 190, 70, (r, g, b) => r > 80 && r < 110 && g > 180 && g < 215 && b > 240);
assert(menuTitlePixels > 30, `quick menu title is missing: ${menuTitlePixels} cyan title pixels`);

console.log(JSON.stringify({ terminalTextPixels, menuTextPixels, menuTitlePixels }, null, 2));
