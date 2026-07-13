import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const screenshotDir = process.argv[2] || path.join('tests', 'carts', '2025', 'screenshots');
const names = fs.readdirSync(screenshotDir).filter(name => name.endsWith('.png')).sort();
const frames = names.map(name => PNG.sync.read(fs.readFileSync(path.join(screenshotDir, name))));

assert.equal(frames.length, 52, `expected 52 stagger/results/combat frames, got ${frames.length}`);

function lumaAt(png, offset) {
	return png.data[offset] * 0.2126 + png.data[offset + 1] * 0.7152 + png.data[offset + 2] * 0.0722;
}

const hiddenText = frames[1];
const visibleText = frames[13];
const glyphOffsets = [];
for (let y = 80; y < 110; y += 1) {
	for (let x = 100; x < 230; x += 1) {
		const offset = (y * hiddenText.width + x) * 4;
		if (lumaAt(visibleText, offset) > lumaAt(hiddenText, offset) + 32) {
			glyphOffsets.push(offset);
		}
	}
}
assert(glyphOffsets.length > 100, `stagger probe did not expose enough glyph pixels: ${glyphOffsets.length}`);

let previousGlyphLuma = 0;
for (let frameIndex = 1; frameIndex <= 13; frameIndex += 1) {
	let sum = 0;
	for (let index = 0; index < glyphOffsets.length; index += 1) {
		sum += lumaAt(frames[frameIndex], glyphOffsets[index]);
	}
	const currentGlyphLuma = sum / glyphOffsets.length;
	assert(currentGlyphLuma >= previousGlyphLuma, `stagger glyph brightness regressed at capture ${frameIndex}`);
	previousGlyphLuma = currentGlyphLuma;
}
assert(previousGlyphLuma > 240, `stagger glyphs did not reach full brightness: ${previousGlyphLuma}`);

const combatFrameStats = [];
for (let frameIndex = 13; frameIndex < 16; frameIndex += 1) {
	const png = frames[frameIndex];
	let nonBlackPixels = 0;
	let bluePixels = 0;
	let whitePixels = 0;
	for (let offset = 0; offset < png.data.length; offset += 4) {
		const red = png.data[offset];
		const green = png.data[offset + 1];
		const blue = png.data[offset + 2];
		if (red !== 0 || green !== 0 || blue !== 0) nonBlackPixels += 1;
		if (blue > 80 && blue > red && blue > green) bluePixels += 1;
		if (red > 220 && green > 220 && blue > 220) whitePixels += 1;
	}
	combatFrameStats.push({ nonBlackPixels, bluePixels, whitePixels });
}
assert(combatFrameStats[0].nonBlackPixels > 10000, 'combat intro did not draw Maya B');
assert(combatFrameStats[1].nonBlackPixels > 50000 && combatFrameStats[1].bluePixels > 2000, 'combat workset did not draw the clock scene');
assert(combatFrameStats[2].whitePixels > 400, 'combat prompt did not become visible');

let previousResultLuma = 0;
for (let frameIndex = 17; frameIndex < 51; frameIndex += 1) {
	const png = frames[frameIndex];
	const offset = (220 * png.width + 10) * 4;
	const currentResultLuma = lumaAt(png, offset);
	assert(currentResultLuma >= previousResultLuma, `combat-results background regressed at capture ${frameIndex}`);
	previousResultLuma = currentResultLuma;
}
const finalResult = frames[50];
const finalOffset = (220 * finalResult.width + 10) * 4;
const finalColor = [finalResult.data[finalOffset], finalResult.data[finalOffset + 1], finalResult.data[finalOffset + 2]];
assert.deepEqual(finalColor, [16, 66, 206], 'combat-results background lost its Persona blue');

console.log(JSON.stringify({
	screenshotDir,
	frameCount: frames.length,
	staggerFinalLuma: previousGlyphLuma,
	combatResultsFinalColor: finalColor,
	combatFrameStats,
}, null, 2));
