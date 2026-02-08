import fs from 'node:fs';

const logPath = process.argv[2] ?? '/tmp/pietious_headless.log';

function parseTelemetryLine(line) {
	const payload = {};
	const parts = line.trim().split('|');
	for (let i = 1; i < parts.length; i += 1) {
		const token = parts[i];
		const eq = token.indexOf('=');
		if (eq < 0) {
			continue;
		}
		const key = token.slice(0, eq);
		const raw = token.slice(eq + 1);
		const asNumber = Number(raw);
		payload[key] = Number.isFinite(asNumber) && raw !== '' ? asNumber : raw;
	}
	return payload;
}

function arraysEqual(a, b) {
	if (a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i += 1) {
		if (a[i] !== b[i]) {
			return false;
		}
	}
	return true;
}

function first(items, predicate) {
	for (let i = 0; i < items.length; i += 1) {
		if (predicate(items[i])) {
			return items[i];
		}
	}
	return null;
}

function firstLandAfter(events, frame) {
	return first(events, (e) => e.name === 'land' && Number(e.f) > frame);
}

function collectRiseSequence(metrics, jumpFrame) {
	const rise = [];
	let started = false;

	for (let i = 0; i < metrics.length; i += 1) {
		const m = metrics[i];
		const f = Number(m.f);
		if (f <= jumpFrame) {
			continue;
		}
		if (m.st !== 'jumping') {
			if (started) {
				break;
			}
			continue;
		}
		const dy = Number(m.dy);
		if (dy < 0) {
			rise.push(dy);
			started = true;
			continue;
		}
		if (started && dy >= 0) {
			break;
		}
	}

	return rise;
}

function collectSegmentMetrics(metrics, startFrame, endFrame, stateName, requireSubstate) {
	const out = [];
	for (let i = 0; i < metrics.length; i += 1) {
		const m = metrics[i];
		const f = Number(m.f);
		if (f <= startFrame || f >= endFrame) {
			continue;
		}
		if (m.st !== stateName) {
			continue;
		}
		if (requireSubstate && Number(m.fsub) < 0) {
			continue;
		}
		out.push(m);
	}
	return out;
}

const content = fs.readFileSync(logPath, 'utf8');
const lines = content.split(/\r?\n/);
const metrics = [];
const events = [];

for (let i = 0; i < lines.length; i += 1) {
	const line = lines[i];
	if (line.startsWith('PIETIOUS_METRIC|')) {
		metrics.push(parseTelemetryLine(line));
		continue;
	}
	if (line.startsWith('PIETIOUS_EVENT|')) {
		events.push(parseTelemetryLine(line));
	}
}

if (metrics.length === 0) {
	throw new Error(`No PIETIOUS_METRIC lines found in '${logPath}'.`);
}

metrics.sort((a, b) => Number(a.f) - Number(b.f));
events.sort((a, b) => Number(a.f) - Number(b.f));

const failures = [];
function expect(condition, message) {
	if (!condition) {
		failures.push(message);
	}
}

let minY = Number.POSITIVE_INFINITY;
for (let i = 0; i < metrics.length; i += 1) {
	const y = Number(metrics[i].y);
	if (y < minY) {
		minY = y;
	}
}
expect(minY >= 32, `Player Y went above HUD ceiling. minimum_y=${minY}, expected >= 32.`);

const jumpFacingRightSample = first(metrics, (m) => {
	if (m.st !== 'jumping' && m.st !== 'stopped_jumping') {
		return false;
	}
	return Number(m.right) === 1 && Number(m.left) === 0;
});
expect(jumpFacingRightSample !== null, 'Missing jump sample with right input held.');
if (jumpFacingRightSample) {
	expect(Number(jumpFacingRightSample.face) === 1, `Jump facing mismatch for right input. got face=${jumpFacingRightSample.face}, expected 1.`);
}

const jumpFacingLeftSample = first(metrics, (m) => {
	if (m.st !== 'jumping' && m.st !== 'stopped_jumping') {
		return false;
	}
	return Number(m.left) === 1 && Number(m.right) === 0;
});
expect(jumpFacingLeftSample !== null, 'Missing jump sample with left input held.');
if (jumpFacingLeftSample) {
	expect(Number(jumpFacingLeftSample.face) === -1, `Jump facing mismatch for left input. got face=${jumpFacingLeftSample.face}, expected -1.`);
}

const jumpStarts = events.filter((e) => e.name === 'jump_start');
const jumpAnalyses = jumpStarts.map((j) => {
	return {
		event: j,
		rise: collectRiseSequence(metrics, Number(j.f)),
	};
});

const walkRightStart = first(events, (e) => e.name === 'state' && e.from === 'quiet' && e.to === 'walking_right');
expect(walkRightStart !== null, 'Missing state transition quiet->walking_right.');

if (walkRightStart) {
	const samples = [];
	for (let i = 0; i < metrics.length; i += 1) {
		const m = metrics[i];
		if (Number(m.f) <= Number(walkRightStart.f)) {
			continue;
		}
		if (m.st !== 'walking_right') {
			if (samples.length > 0) {
				break;
			}
			continue;
		}
		if (Number(m.dx) === 2 && Number(m.right) === 1) {
			samples.push(m);
		}
	}
	expect(samples.length >= 8, 'Walking-right baseline must show at least 8 samples with dx=2 while right is held.');
}

const popolonRiseReference = [-7, -6, -6, -6, -5, -5, -5, -4, -4, -3, -2, -1];
const shortHopReference = {
	minLength: 2,
	maxLength: 4,
	firstDy: -7,
	lastDy: -1,
};
const uncontrolledReference = [1, 2, 3, 4, 4, 5];
const controlledReference = [0, 0, 0, 1, 2, 3, 4, 4];

const fullJump = first(jumpAnalyses, (j) => arraysEqual(j.rise, popolonRiseReference));
const shortHop = first(jumpAnalyses, (j) => {
	const rise = j.rise;
	if (rise.length < shortHopReference.minLength || rise.length > shortHopReference.maxLength) {
		return false;
	}
	return rise[0] === shortHopReference.firstDy && rise[rise.length - 1] === shortHopReference.lastDy;
});

expect(fullJump !== null, `No full jump found with rise profile ${JSON.stringify(popolonRiseReference)}.`);
expect(
	shortHop !== null,
	`No short hop found with rise profile constraints first=${shortHopReference.firstDy}, last=${shortHopReference.lastDy}, length=[${shortHopReference.minLength}..${shortHopReference.maxLength}].`,
);

const ledgeDrop = first(events, (e) => e.name === 'ledge_drop');
expect(ledgeDrop !== null, 'Missing ledge_drop event (uncontrolled fall probe did not happen).');

if (ledgeDrop) {
	const landAfterLedge = firstLandAfter(events, Number(ledgeDrop.f));
	expect(landAfterLedge !== null, 'Missing land event after ledge_drop.');
	if (landAfterLedge) {
		const uncontrolled = collectSegmentMetrics(
			metrics,
			Number(ledgeDrop.f),
			Number(landAfterLedge.f) + 1,
			'uncontrolled_fall',
			true,
		);
		const uncontrolledPrefix = uncontrolled.slice(0, uncontrolledReference.length).map((m) => Number(m.dy));
		expect(
			uncontrolledPrefix.length === uncontrolledReference.length,
			`Need at least ${uncontrolledReference.length} uncontrolled_fall samples after ledge_drop.`,
		);
		expect(
			arraysEqual(uncontrolledPrefix, uncontrolledReference),
			`Uncontrolled fall prefix mismatch. got=${JSON.stringify(uncontrolledPrefix)} expected=${JSON.stringify(uncontrolledReference)}`,
		);
	}
}

if (fullJump) {
	const fullJumpFrame = Number(fullJump.event.f);
	const fullJumpLand = firstLandAfter(events, fullJumpFrame);
	expect(fullJumpLand !== null, 'Missing land event after full jump.');

	if (fullJumpLand) {
		const controlled = collectSegmentMetrics(
			metrics,
			fullJumpFrame,
			Number(fullJumpLand.f) + 1,
			'controlled_fall',
			true,
		);
		const controlledWithEntry = collectSegmentMetrics(
			metrics,
			fullJumpFrame,
			Number(fullJumpLand.f) + 1,
			'controlled_fall',
			false,
		);

		const controlledPrefix = controlled.slice(0, controlledReference.length).map((m) => Number(m.dy));
		expect(
			controlledPrefix.length === controlledReference.length,
			`Need at least ${controlledReference.length} controlled_fall samples in full jump segment.`,
		);
		expect(
			arraysEqual(controlledPrefix, controlledReference),
			`Controlled fall prefix mismatch. got=${JSON.stringify(controlledPrefix)} expected=${JSON.stringify(controlledReference)}`,
		);

		const forwardAssistBoosted = first(
			controlledWithEntry,
			(m) => Number(m.inertia) === 1 && Number(m.right) === 1 && Number(m.left) === 0 && Number(m.dx) === 3,
		);
		const forwardAssistTransition = first(
			controlledWithEntry,
			(m) => Number(m.inertia) === 1 && Number(m.right) === 1 && Number(m.left) === 0 && Number(m.dx) === 2,
		);
		expect(
			forwardAssistBoosted !== null || forwardAssistTransition !== null,
			'Missing controlled_fall sample with inertia=1 and right input.',
		);

		const oppositeControlWithInertia = first(controlled, (m) => Number(m.inertia) === 1 && Number(m.left) === 1 && Number(m.right) === 0);
		const oppositeControlAfterInertiaReset = first(controlled, (m) => Number(m.inertia) === 0 && Number(m.left) === 1 && Number(m.right) === 0);
		expect(
			oppositeControlWithInertia !== null || oppositeControlAfterInertiaReset !== null,
			'Missing controlled_fall sample with opposite (left) input.',
		);
		if (oppositeControlWithInertia) {
			expect(
				Number(oppositeControlWithInertia.dx) === 1,
				`Expected opposite-control dx=1 when inertia=1, got ${oppositeControlWithInertia.dx}.`,
			);
		} else if (oppositeControlAfterInertiaReset) {
			expect(
				Number(oppositeControlAfterInertiaReset.dx) === -2,
				`Expected opposite-control dx=-2 after inertia reset, got ${oppositeControlAfterInertiaReset.dx}.`,
			);
		}
	}
}

console.log(`PIETIOUS_ANALYSIS log=${logPath}`);
console.log(`samples metrics=${metrics.length} events=${events.length}`);
console.log(`jump_profiles=${JSON.stringify(jumpAnalyses.map((j) => ({ f: Number(j.event.f), inertia: Number(j.event.inertia), rise: j.rise })))}`);
console.log(`full_jump_rise_ref=${JSON.stringify(popolonRiseReference)}`);
console.log(`short_hop_rise_ref=${JSON.stringify(shortHopReference)}`);
console.log(`uncontrolled_prefix_ref=${JSON.stringify(uncontrolledReference)}`);
console.log(`controlled_prefix_ref=${JSON.stringify(controlledReference)}`);

if (failures.length > 0) {
	console.log('');
	console.log('PIETIOUS_ANALYSIS_FAIL');
	for (let i = 0; i < failures.length; i += 1) {
		console.log(`- ${failures[i]}`);
	}
	process.exit(1);
}

console.log('');
console.log('PIETIOUS_ANALYSIS_OK');
