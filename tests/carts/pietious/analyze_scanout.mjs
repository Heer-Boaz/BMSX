import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const screenshotDir = process.argv[2] || path.join('tests', 'carts', 'pietious', 'screenshots');
const screenshot = PNG.sync.read(fs.readFileSync(path.join(screenshotDir, 'frame_00620.png')));
assert.equal(screenshot.width, 256);
assert.equal(screenshot.height, 192);

let bottomActivePixels = 0;
for (let y = 177; y < 192; y += 1) {
	for (let x = 0; x < screenshot.width; x += 1) {
		const offset = (y * screenshot.width + x) * 4;
		if (screenshot.data[offset] !== 0 || screenshot.data[offset + 1] !== 0 || screenshot.data[offset + 2] !== 0) {
			bottomActivePixels += 1;
		}
	}
}
assert(bottomActivePixels > 2400, `native 192-line scanout does not reach its bottom edge: ${bottomActivePixels}`);

console.log(JSON.stringify({ bottomActivePixels }, null, 2));
