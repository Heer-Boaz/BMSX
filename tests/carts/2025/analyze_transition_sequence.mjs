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

for (let frameNumber = 58; frameNumber <= 150; frameNumber += 1) {
	frame(frameNumber);
}

assert(meanLuma(frame(61)) > 40, 'transition fade-out did not begin from the visible title frame');
assertMonotonicLuma(61, 74, false);
assert(meanLuma(frame(74)) < 0.1, 'transition fade-out did not reach black');
for (let frameNumber = 74; frameNumber <= 91; frameNumber += 1) {
	assert(meanLuma(frame(frameNumber)) < 0.1, `frame ${frameNumber} flashed during the black atlas-swap interval`);
}

const ink = pixel(frame(123), 10, 100);
assert(ink[2] > ink[1] && ink[1] >= ink[0], `transition ink background lost its blue hue: ${ink}`);
const blue = pixel(frame(104), 160, 30);
assert(blue[2] > 150 && blue[2] > blue[1] * 2, `transition primary panel is not saturated blue: ${blue}`);
const cyan = pixel(frame(117), 20, 90);
assert(cyan[1] > 180 && cyan[2] > 220 && cyan[0] < 120, `transition accent is not cyan: ${cyan}`);

let montageBluePixels = 0;
let montageCyanPixels = 0;
let montageInkPixels = 0;
let montagePixelCount = 0;
let previousMontageFrame = frame(92);
for (let frameNumber = 92; frameNumber <= 133; frameNumber += 1) {
	const currentFrame = frame(frameNumber);
	if (frameNumber > 92) {
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
		if (blueChannel >= 16 && blueChannel > green && green >= red && red <= 8) {
			montageInkPixels += 1;
		}
	}
	previousMontageFrame = currentFrame;
}
assert(montageBluePixels > montagePixelCount * 0.05, 'transition montage lost its blue panel coverage');
assert(montageCyanPixels > montagePixelCount * 0.005, 'transition montage lost its cyan accent coverage');
assert(montageInkPixels > montagePixelCount * 0.5, 'transition montage lost its ink background coverage');

assert(meanLuma(frame(134)) < 0.1, 'transition fade-in did not begin from black');
assertMonotonicLuma(134, 149, true);
assert(meanLuma(frame(149)) > 85, 'transition fade-in did not restore the target background');

console.log(JSON.stringify({
	screenshotDir,
	fadeOut: [meanLuma(frame(61)), meanLuma(frame(74))],
	fadeIn: [meanLuma(frame(134)), meanLuma(frame(149))],
	colors: { ink, blue, cyan },
	montagePixels: { blue: montageBluePixels, cyan: montageCyanPixels, ink: montageInkPixels },
}, null, 2));
