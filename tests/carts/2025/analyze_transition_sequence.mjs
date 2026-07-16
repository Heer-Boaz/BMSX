import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const screenshotDir = process.argv[2] || path.join('tests', 'carts', '2025', 'screenshots');
const frames = new Map();

function frame(frameNumber) {
	let png = frames.get(frameNumber);
	if (png !== undefined) {
		return png;
	}
	const file = path.join(screenshotDir, `frame_${String(frameNumber).padStart(5, '0')}.png`);
	png = PNG.sync.read(fs.readFileSync(file));
	frames.set(frameNumber, png);
	return png;
}

function meanLuma(png) {
	let sum = 0;
	for (let offset = 0; offset < png.data.length; offset += 4) {
		sum += png.data[offset] * 0.2126;
		sum += png.data[offset + 1] * 0.7152;
		sum += png.data[offset + 2] * 0.0722;
	}
	return sum / (png.width * png.height);
}

function meanRgbDelta(left, right) {
	let sum = 0;
	for (let offset = 0; offset < left.data.length; offset += 4) {
		sum += Math.abs(left.data[offset] - right.data[offset]);
		sum += Math.abs(left.data[offset + 1] - right.data[offset + 1]);
		sum += Math.abs(left.data[offset + 2] - right.data[offset + 2]);
	}
	return sum / (left.width * left.height * 3);
}

function pixel(png, x, y) {
	const offset = (y * png.width + x) * 4;
	return [png.data[offset], png.data[offset + 1], png.data[offset + 2]];
}

function assertMonotonicLuma(firstFrame, lastFrame, ascending) {
	let previousFrame = frame(firstFrame);
	let previousLuma = meanLuma(previousFrame);
	let maxDelta = 0;
	for (let frameNumber = firstFrame + 1; frameNumber <= lastFrame; frameNumber += 1) {
		const currentFrame = frame(frameNumber);
		const currentLuma = meanLuma(currentFrame);
		if (ascending) {
			assert(currentLuma >= previousLuma - 0.01, `frame ${frameNumber} regressed during fade-in: ${currentLuma} < ${previousLuma}`);
		} else {
			assert(currentLuma <= previousLuma + 0.01, `frame ${frameNumber} flashed during fade-out: ${currentLuma} > ${previousLuma}`);
		}
		const delta = meanRgbDelta(previousFrame, currentFrame);
		if (delta > maxDelta) {
			maxDelta = delta;
		}
		previousFrame = currentFrame;
		previousLuma = currentLuma;
	}
	assert(maxDelta < 16, `fade window contains a malformed frame jump: mean RGB delta ${maxDelta}`);
}

for (let frameNumber = 59; frameNumber <= 151; frameNumber += 1) {
	frame(frameNumber);
}

assert(meanLuma(frame(62)) > 40, 'transition fade-out did not begin from the visible title frame');
assertMonotonicLuma(62, 75, false);
assert(meanLuma(frame(75)) < 0.1, 'transition fade-out did not reach black');
for (let frameNumber = 75; frameNumber <= 79; frameNumber += 1) {
	assert(meanLuma(frame(frameNumber)) < 0.1, `frame ${frameNumber} flashed while the background texture bank changed`);
}

const ink = pixel(frame(80), 10, 100);
assert.deepEqual(ink, [0, 24, 57], 'transition ink background lost its Persona blue');
const blue = pixel(frame(85), 160, 30);
assert.deepEqual(blue, [16, 66, 206], 'transition primary panel lost its Persona blue');
const cyan = pixel(frame(105), 20, 90);
assert.deepEqual(cyan, [82, 222, 255], 'transition accent lost its Persona cyan');

let montageBluePixels = 0;
let montageCyanPixels = 0;
let montageInkPixels = 0;
let montagePixelCount = 0;
let previousMontageFrame = frame(80);
for (let frameNumber = 80; frameNumber <= 122; frameNumber += 1) {
	const currentFrame = frame(frameNumber);
	if (frameNumber > 80) {
		assert(meanRgbDelta(previousMontageFrame, currentFrame) < 16, `montage frame ${frameNumber} contains a malformed frame jump`);
	}
	for (let offset = 0; offset < currentFrame.data.length; offset += 4) {
		const red = currentFrame.data[offset];
		const green = currentFrame.data[offset + 1];
		const blueChannel = currentFrame.data[offset + 2];
		montagePixelCount += 1;
		if (blueChannel > 150 && blueChannel > green * 2 && green > red) {
			montageBluePixels += 1;
		}
		if (green > 180 && blueChannel > 220 && red < 120) {
			montageCyanPixels += 1;
		}
		if (blueChannel >= 48 && blueChannel > green && green >= red && red <= 8) {
			montageInkPixels += 1;
		}
	}
	previousMontageFrame = currentFrame;
}
assert(montageBluePixels > montagePixelCount * 0.05, 'transition montage lost its blue panel coverage');
assert(montageCyanPixels > montagePixelCount * 0.005, 'transition montage lost its cyan accent coverage');
assert(montageInkPixels > montagePixelCount * 0.5, 'transition montage lost its ink background coverage');

assert(meanLuma(frame(123)) < 1, 'transition fade-in did not begin from black');
assertMonotonicLuma(123, 137, true);
assert(meanLuma(frame(137)) > 85, 'transition fade-in did not restore the target background');

console.log(JSON.stringify({
	screenshotDir,
	fadeOut: [meanLuma(frame(62)), meanLuma(frame(75))],
	fadeIn: [meanLuma(frame(123)), meanLuma(frame(137))],
	colors: { ink, blue, cyan },
	montagePixels: { blue: montageBluePixels, cyan: montageCyanPixels, ink: montageInkPixels },
}, null, 2));
