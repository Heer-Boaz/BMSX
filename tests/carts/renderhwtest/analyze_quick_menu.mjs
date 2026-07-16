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

const game = frame(120);
const menu = frame(125);
assert.equal(game.width, 320);
assert.equal(game.height, 240);
assert.equal(menu.width, game.width);
assert.equal(menu.height, game.height);

const menuTextPixels = countPixels(menu, 88, 72, 220, 184, (red, green, blue) => red === green && green === blue && red > 150);
const menuTitlePixels = countPixels(menu, 94, 48, 190, 70, (red, green, blue) => red > 80 && red < 110 && green > 180 && green < 215 && blue > 240);
assert(menuTextPixels > 100, `quick menu option text is missing: ${menuTextPixels} pixels`);
assert(menuTitlePixels > 30, `quick menu title is missing: ${menuTitlePixels} pixels`);

console.log(JSON.stringify({ menuTextPixels, menuTitlePixels }, null, 2));
