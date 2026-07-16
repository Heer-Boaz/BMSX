import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const screenshotDir = process.argv[2] || path.join('tests', 'carts', 'bare_metal_cart', 'screenshots');
const framePattern = /^frame_(\d+)\.png$/;
const blackFlashMinimumLitPixels = 60000;
const maxAverageLumaDelta = 2.0;
const sceneDifferenceChangedPixels = 4000;
const sceneDifferenceMeanAbs = 6.0;
const frameWindows = [
	[121, 129, 'baseline'],
	[201, 217, 'shards'],
	[331, 347, 'flare'],
	[461, 477, 'particles'],
	[591, 607, 'idol'],
	[701, 745, 'echo'],
	[921, 937, 'morph'],
];
const sceneFrames = [
	[121, 'baseline'],
	[201, 'shards'],
	[331, 'flare'],
	[461, 'particles'],
	[591, 'idol'],
	[701, 'echo'],
	[801, 'idol-return'],
	[921, 'morph'],
	[1021, 'echo-return'],
];

function readFrame(filePath) {
	const png = PNG.sync.read(fs.readFileSync(filePath));
	const data = png.data;
	const pixelCount = png.width * png.height;
	let litPixels = 0;
	let lumaTotal = 0;
	for (let index = 0; index < data.length; index += 4) {
		const r = data[index];
		const g = data[index + 1];
		const b = data[index + 2];
		if (r !== 0 || g !== 0 || b !== 0) {
			litPixels += 1;
		}
		lumaTotal += (r * 77 + g * 150 + b * 29) >> 8;
	}
	return {
		averageLuma: lumaTotal / pixelCount,
		data,
		height: png.height,
		litPixels,
		width: png.width,
	};
}

function loadFrames(dir) {
	const frames = new Map();
	for (const name of fs.readdirSync(dir)) {
		const match = framePattern.exec(name);
		if (match) {
			frames.set(Number(match[1]), readFrame(path.join(dir, name)));
		}
	}
	return frames;
}

function assertFrameWindow(frames, startFrame, endFrame, label) {
	let previous = frames.get(startFrame);
	if (!previous) {
		throw new Error(`[bare_metal_cart:frame-scan] Missing ${label} frame ${startFrame}.`);
	}
	if (previous.litPixels < blackFlashMinimumLitPixels) {
		throw new Error(`[bare_metal_cart:frame-scan] ${label} frame ${startFrame} dropped to ${previous.litPixels} lit pixels.`);
	}
	let maxDelta = 0;
	for (let frame = startFrame + 1; frame <= endFrame; frame += 1) {
		const current = frames.get(frame);
		if (!current) {
			throw new Error(`[bare_metal_cart:frame-scan] Missing ${label} frame ${frame}.`);
		}
		if (current.litPixels < blackFlashMinimumLitPixels) {
			throw new Error(`[bare_metal_cart:frame-scan] ${label} frame ${frame} dropped to ${current.litPixels} lit pixels.`);
		}
		const delta = Math.abs(current.averageLuma - previous.averageLuma);
		if (delta > maxDelta) {
			maxDelta = delta;
		}
		if (delta > maxAverageLumaDelta) {
			throw new Error(`[bare_metal_cart:frame-scan] ${label} frame ${frame - 1}->${frame} luma delta ${delta.toFixed(2)} exceeds ${maxAverageLumaDelta}.`);
		}
		previous = current;
	}
	return { label, startFrame, endFrame, maxDelta };
}

function frameDifference(a, b) {
	let changedPixels = 0;
	let sumAbs = 0;
	const pixelCount = a.width * a.height;
	for (let index = 0; index < a.data.length; index += 4) {
		const delta = Math.abs(a.data[index] - b.data[index])
			+ Math.abs(a.data[index + 1] - b.data[index + 1])
			+ Math.abs(a.data[index + 2] - b.data[index + 2]);
		sumAbs += delta;
		if (delta > 24) {
			changedPixels += 1;
		}
	}
	return { changedPixels, meanAbs: sumAbs / pixelCount };
}

function assertSceneDifference(frames, leftFrame, leftLabel, rightFrame, rightLabel) {
	const left = frames.get(leftFrame);
	const right = frames.get(rightFrame);
	if (!left || !right) {
		throw new Error(`[bare_metal_cart:frame-scan] Missing scene comparison ${leftLabel}->${rightLabel}.`);
	}
	const diff = frameDifference(left, right);
	if (diff.changedPixels < sceneDifferenceChangedPixels || diff.meanAbs < sceneDifferenceMeanAbs) {
		throw new Error(`[bare_metal_cart:frame-scan] ${leftLabel}->${rightLabel} changed ${diff.changedPixels} pixels meanAbs ${diff.meanAbs.toFixed(2)}; controls did not visibly select a distinct scene.`);
	}
	return { leftLabel, rightLabel, leftFrame, rightFrame, ...diff };
}

function assertControlSceneIdentity(frames) {
	const idol = frames.get(591);
	const echo = frames.get(701);
	const idolReturned = frames.get(801);
	const morph = frames.get(921);
	const echoReturned = frames.get(1021);
	if (!idol || !echo || !idolReturned || !morph || !echoReturned) {
		throw new Error('[bare_metal_cart:frame-scan] Missing idol/echo/morph/returned frames for carousel control assertions.');
	}
	const returnedToIdol = frameDifference(idolReturned, idol);
	const returnedToEcho = frameDifference(idolReturned, echo);
	if (returnedToIdol.meanAbs * 2 >= returnedToEcho.meanAbs) {
		throw new Error(`[bare_metal_cart:frame-scan] ArrowLeft return frame is closer to echo (${returnedToEcho.meanAbs.toFixed(2)}) than idol (${returnedToIdol.meanAbs.toFixed(2)}).`);
	}
	const morphBackToEcho = frameDifference(echoReturned, echo);
	const morphBackToMorph = frameDifference(echoReturned, morph);
	if (morphBackToEcho.meanAbs * 2 >= morphBackToMorph.meanAbs) {
		throw new Error(`[bare_metal_cart:frame-scan] Morph ArrowLeft return frame is closer to morph (${morphBackToMorph.meanAbs.toFixed(2)}) than echo (${morphBackToEcho.meanAbs.toFixed(2)}).`);
	}
	return { returnedToIdol, returnedToEcho, morphBackToEcho, morphBackToMorph };
}

const frames = loadFrames(screenshotDir);
const windows = frameWindows.map(([startFrame, endFrame, label]) => assertFrameWindow(frames, startFrame, endFrame, label));
const sceneDiffs = [];
for (let index = 0; index + 1 < sceneFrames.length; index += 1) {
	const [leftFrame, leftLabel] = sceneFrames[index];
	const [rightFrame, rightLabel] = sceneFrames[index + 1];
	sceneDiffs.push(assertSceneDifference(frames, leftFrame, leftLabel, rightFrame, rightLabel));
}
const controls = assertControlSceneIdentity(frames);
console.log(JSON.stringify({ screenshotDir, frameCount: frames.size, windows, sceneDiffs, controls }, null, 2));
