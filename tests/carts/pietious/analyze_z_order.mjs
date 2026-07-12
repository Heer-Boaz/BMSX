import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const screenshotDir = process.argv[2] || path.join('tests', 'carts', 'pietious', 'screenshots');
const files = fs.readdirSync(screenshotDir).filter((file) => file.endsWith('.png')).sort();

const colors = files.map((file) => {
	const screenshot = PNG.sync.read(fs.readFileSync(path.join(screenshotDir, file)));
	let redPixels = 0;
	let bluePixels = 0;
	for (let offset = 0; offset < screenshot.data.length; offset += 4) {
		const red = screenshot.data[offset];
		const blue = screenshot.data[offset + 2];
		if (red > blue + 50) {
			redPixels += 1;
		}
		if (blue > red + 50) {
			bluePixels += 1;
		}
	}
	return { file, redPixels, bluePixels };
});

const highFrontIndex = colors.findIndex((frame) => frame.redPixels > 20 && frame.bluePixels === 0);
assert(highFrontIndex >= 0, 'higher-z red sprite was not drawn in front');
const lowFront = colors.slice(highFrontIndex + 1).find((frame) => frame.bluePixels > 20 && frame.redPixels === 0);
assert(lowFront, 'sprite draw order did not follow the changed z positions');

console.log(JSON.stringify({ highFront: colors[highFrontIndex], lowFront }, null, 2));
