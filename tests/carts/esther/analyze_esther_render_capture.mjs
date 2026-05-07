import fs from 'node:fs';

const capturePath = process.argv[2] ?? '/tmp/esther_render_capture.json';

function readCapture(filePath) {
	const content = fs.readFileSync(filePath, 'utf8');
	const parsed = JSON.parse(content);
	if (!Array.isArray(parsed.frames)) {
		throw new Error(`[analyze_esther_render_capture] Invalid capture file: ${filePath}`);
	}
	return parsed;
}

function sortByFrame(frames) {
	return frames.slice().sort((a, b) => Number(a.frame) - Number(b.frame));
}

function playerFrames(frames) {
	return frames.filter((frame) => frame.player != null);
}

function indexAtOrAfter(frames, timeMs) {
	for (let i = 0; i < frames.length; i += 1) {
		if (Number(frames[i].timeMs) >= timeMs) {
			return i;
		}
	}
	return -1;
}

function segment(frames, fromMs, toMs) {
	return frames.filter((frame) => Number(frame.timeMs) >= fromMs && Number(frame.timeMs) <= toMs);
}

function analyzeStop(frames, releaseMs) {
	const releaseIndex = indexAtOrAfter(frames, releaseMs);
	if (releaseIndex < 0) {
		return null;
	}

	const startFrame = frames[releaseIndex];
	const startX = Number(startFrame.player.pos.x);

	for (let i = releaseIndex + 3; i < frames.length; i += 1) {
		const dx0 = Math.abs(Number(frames[i - 2].player.pos.x) - Number(frames[i - 3].player.pos.x));
		const dx1 = Math.abs(Number(frames[i - 1].player.pos.x) - Number(frames[i - 2].player.pos.x));
		const dx2 = Math.abs(Number(frames[i].player.pos.x) - Number(frames[i - 1].player.pos.x));
		if (dx0 <= 0.05 && dx1 <= 0.05 && dx2 <= 0.05) {
			const endFrame = frames[i];
			return {
				startFrame: Number(startFrame.frame),
				endFrame: Number(endFrame.frame),
				stopFrames: Number(endFrame.frame) - Number(startFrame.frame),
				stopMs: Number(endFrame.timeMs) - Number(startFrame.timeMs),
				driftPx: Number(endFrame.player.pos.x) - startX,
			};
		}
	}

	const last = frames[frames.length - 1];
	return {
		startFrame: Number(startFrame.frame),
		endFrame: Number(last.frame),
		stopFrames: Number(last.frame) - Number(startFrame.frame),
		stopMs: Number(last.timeMs) - Number(startFrame.timeMs),
		driftPx: Number(last.player.pos.x) - startX,
		incomplete: true,
	};
}

function analyzeJump(frames, label) {
	if (frames.length < 4) {
		return { label, hasJump: false };
	}

	let takeoffIndex = -1;
	for (let i = 1; i < frames.length; i += 1) {
		const prevY = Number(frames[i - 1].player.pos.y);
		const y = Number(frames[i].player.pos.y);
		if (y < prevY - 0.05) {
			takeoffIndex = i - 1;
			break;
		}
	}
	if (takeoffIndex < 0) {
		return { label, hasJump: false };
	}

	let apexIndex = takeoffIndex;
	for (let i = takeoffIndex; i < frames.length; i += 1) {
		if (Number(frames[i].player.pos.y) < Number(frames[apexIndex].player.pos.y)) {
			apexIndex = i;
		}
	}

	const takeoffY = Number(frames[takeoffIndex].player.pos.y);
	const apexY = Number(frames[apexIndex].player.pos.y);

	let landingIndex = -1;
	for (let i = apexIndex + 1; i < frames.length; i += 1) {
		const y = Number(frames[i].player.pos.y);
		if (y >= takeoffY - 0.05) {
			landingIndex = i;
			break;
		}
	}

	return {
		label,
		hasJump: true,
		takeoffFrame: Number(frames[takeoffIndex].frame),
		apexFrame: Number(frames[apexIndex].frame),
		landingFrame: landingIndex >= 0 ? Number(frames[landingIndex].frame) : null,
		heightPx: takeoffY - apexY,
		airFrames: landingIndex >= 0 ? Number(frames[landingIndex].frame) - Number(frames[takeoffIndex].frame) : null,
	};
}

function countAirbornePhases(frames) {
	if (frames.length < 2) {
		return 0;
	}
	const baseline = Number(frames[0].player.pos.y);
	let airborne = false;
	let phases = 0;

	for (let i = 0; i < frames.length; i += 1) {
		const y = Number(frames[i].player.pos.y);
		const nowAirborne = y < baseline - 0.5;
		if (!airborne && nowAirborne) {
			phases += 1;
		}
		airborne = nowAirborne;
	}
	return phases;
}

const capture = readCapture(capturePath);
const allFrames = sortByFrame(capture.frames);
const frames = playerFrames(allFrames);

if (frames.length === 0) {
	throw new Error(`[analyze_esther_render_capture] No player frames found in ${capturePath}`);
}

const stop = analyzeStop(frames, 1800);
const standstillJump = analyzeJump(segment(frames, 2200, 3400), 'standstill_jump');
const movingJump = analyzeJump(segment(frames, 4000, 6200), 'moving_release_jump');
const holdOnlyWindow = segment(frames, 6100, 9000);
const holdOnlyJump = analyzeJump(holdOnlyWindow, 'hold_only_jump');
const holdOnlyAirPhases = countAirbornePhases(holdOnlyWindow);

const report = {
	capturePath,
	frameCount: frames.length,
	stop,
	standstillJump,
	movingJump,
	holdOnlyJump,
	holdOnlyAirPhases,
};

console.log(JSON.stringify(report, null, 2));
