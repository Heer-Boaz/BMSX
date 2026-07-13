import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const screenshotDir = process.argv[2] || path.join('tests', 'carts', 'cartlib_test', 'screenshots');
const files = fs.readdirSync(screenshotDir).filter((file) => file.endsWith('.png')).sort();

const samples = files.map((file) => {
	const screenshot = PNG.sync.read(fs.readFileSync(path.join(screenshotDir, file)));
	const offset = (80 * screenshot.width + 80) * 4;
	return { file, color: Array.from(screenshot.data.subarray(offset, offset + 3)) };
});

const spriteFrontIndex = samples.findIndex(({ color }) => color[0] > 240 && color[1] < 16 && color[2] < 16);
assert(spriteFrontIndex >= 0, 'higher-z sprite was not drawn in front');
const tileFront = samples.slice(spriteFrontIndex + 1).find(({ color }) => color[0] > 240 && color[1] > 240 && color[2] > 240);
assert(tileFront, 'visual draw order did not follow the changed z positions');

console.log(JSON.stringify({ spriteFront: samples[spriteFrontIndex], tileFront }, null, 2));
