import fs from 'node:fs';

const logPath = process.argv[2] ?? '/tmp/esther_headless_60.log';

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

function avg(values) {
	if (values.length === 0) {
		return 0;
	}
	let total = 0;
	for (let i = 0; i < values.length; i += 1) {
		total += values[i];
	}
	return total / values.length;
}

function max(values) {
	if (values.length === 0) {
		return 0;
	}
	let best = values[0];
	for (let i = 1; i < values.length; i += 1) {
		if (values[i] > best) {
			best = values[i];
		}
	}
	return best;
}

function first(items, predicate) {
	for (let i = 0; i < items.length; i += 1) {
		if (predicate(items[i])) {
			return items[i];
		}
	}
	return null;
}

function between(metrics, startFrame, endFrame) {
	return metrics.filter((m) => m.f >= startFrame && m.f <= endFrame);
}

function jumpSummary(jumpEvent, events, metrics, dtAvg) {
	const landing = first(events, (e) => e.name === 'land' && Number(e.f) > Number(jumpEvent.f));
	if (!landing) {
		return null;
	}
	const samples = between(metrics, Number(jumpEvent.f), Number(landing.f));
	if (samples.length === 0) {
		return null;
	}
	const startY = Number(samples[0].y);
	let apexY = startY;
	for (let i = 0; i < samples.length; i += 1) {
		const y = Number(samples[i].y);
		if (y < apexY) {
			apexY = y;
		}
	}
	return {
		jumpFrame: Number(jumpEvent.f),
		landFrame: Number(landing.f),
		airtimeFrames: Number(landing.f) - Number(jumpEvent.f),
		airtimeMs: (Number(landing.f) - Number(jumpEvent.f)) * dtAvg,
		apexPixels: startY - apexY,
	};
}

const content = fs.readFileSync(logPath, 'utf8');
const lines = content.split(/\r?\n/);
const metrics = [];
const events = [];

for (let i = 0; i < lines.length; i += 1) {
	const line = lines[i];
	if (line.startsWith('ESTHER_METRIC|')) {
		metrics.push(parseTelemetryLine(line));
		continue;
	}
	if (line.startsWith('ESTHER_EVENT|')) {
		events.push(parseTelemetryLine(line));
	}
}

if (metrics.length === 0) {
	throw new Error(`No ESTHER_METRIC lines found in '${logPath}'.`);
}

metrics.sort((a, b) => a.f - b.f);
events.sort((a, b) => a.f - b.f);

const dtAvg = avg(metrics.map((m) => Number(m.dt)));
const targets = {
	runSubpx: 768,
	rollSubpx: 1024,
	rollJumpSubpx: 1152,
};

const rollStarts = events.filter((e) => e.name === 'roll_start');
const rollEnds = events.filter((e) => e.name === 'roll_end');
const jumpStarts = events.filter((e) => e.name === 'jump_start');

const firstRollStartFrame = rollStarts.length > 0 ? Number(rollStarts[0].f) : Number.MAX_SAFE_INTEGER;
const preRollRun = metrics.filter((m) => m.f < firstRollStartFrame && m.run === 1 && m.ax === 1 && m.st === 'grounded');
const preRollRunAbs = preRollRun.map((m) => Math.abs(Number(m.spx)));
const runPeak = max(preRollRunAbs);
const runPlateau = avg(preRollRunAbs.slice(Math.max(0, preRollRunAbs.length - 20)));
const runStartFrame = preRollRun.length > 0 ? Number(preRollRun[0].f) : 0;
const run95Sample = first(preRollRun, (m) => Math.abs(Number(m.spx)) >= targets.runSubpx * 0.95);
const run95Frames = run95Sample ? Number(run95Sample.f) - runStartFrame : null;

const rollWindows = rollStarts.map((start, index) => {
	const startFrame = Number(start.f);
	const endEvent = first(rollEnds, (e) => Number(e.f) > startFrame);
	const endFrame = endEvent ? Number(endEvent.f) : startFrame;
	const samples = between(metrics, startFrame, endFrame).filter((m) => m.st === 'roll');
	const absSamples = samples.map((m) => Math.abs(Number(m.spx)));
	const id = index === 0 ? 'running_roll_prejump' : index === 1 ? 'standstill_roll' : index === 2 ? 'running_roll_nojump' : `roll_${index + 1}`;
	return {
		id,
		startFrame,
		endFrame,
		frames: samples.length,
		peak: max(absSamples),
		mean: avg(absSamples),
	};
});

const rollJumpEvent = first(jumpStarts, (e) => Number(e.from_roll) === 1);
const rollJumpSubpx = rollJumpEvent ? Number(rollJumpEvent.subpx) : 0;
const rollJumpSummary = rollJumpEvent ? jumpSummary(rollJumpEvent, events, metrics, dtAvg) : null;

const groundedJumps = jumpStarts.filter((e) => Number(e.from_roll) === 0);
const groundedSummaries = [];
for (let i = 0; i < groundedJumps.length; i += 1) {
	const event = groundedJumps[i];
	const summary = jumpSummary(event, events, metrics, dtAvg);
	if (!summary) {
		continue;
	}
	groundedSummaries.push({
		...summary,
		fromRoll: Number(event.from_roll),
		takeoffSubpx: Number(event.subpx),
	});
}

let shortHop = null;
let fullHop = null;
if (groundedSummaries.length > 0) {
	shortHop = groundedSummaries[0];
	fullHop = groundedSummaries[0];
	for (let i = 1; i < groundedSummaries.length; i += 1) {
		const candidate = groundedSummaries[i];
		if (candidate.apexPixels < shortHop.apexPixels || (candidate.apexPixels === shortHop.apexPixels && candidate.airtimeFrames < shortHop.airtimeFrames)) {
			shortHop = candidate;
		}
		if (candidate.apexPixels > fullHop.apexPixels || (candidate.apexPixels === fullHop.apexPixels && candidate.airtimeFrames > fullHop.airtimeFrames)) {
			fullHop = candidate;
		}
	}
	if (groundedSummaries.length === 1) {
		fullHop = null;
	}
}

console.log(`ESTHER_ANALYSIS log=${logPath}`);
console.log(`samples metrics=${metrics.length} events=${events.length} dt_avg_ms=${dtAvg.toFixed(4)}`);
console.log('');
console.log('Targets (SNES reference units, subpixels/frame):');
console.log(`run=${targets.runSubpx} roll=${targets.rollSubpx} roll_jump=${targets.rollJumpSubpx}`);
console.log('');
console.log('Run segment (pre first roll):');
console.log(`run_samples=${preRollRun.length}`);
console.log(`run_peak_subpx=${runPeak.toFixed(2)}`);
console.log(`run_plateau_subpx=${runPlateau.toFixed(2)}`);
console.log(`run_plateau_error_pct=${(((runPlateau - targets.runSubpx) / targets.runSubpx) * 100).toFixed(2)}`);
if (run95Frames !== null) {
	console.log(`run_time_to_95pct_frames=${run95Frames}`);
	console.log(`run_time_to_95pct_ms=${(run95Frames * dtAvg).toFixed(2)}`);
} else {
	console.log('run_time_to_95pct_frames=not_reached');
}
console.log('');
console.log('Roll windows:');
for (let i = 0; i < rollWindows.length; i += 1) {
	const roll = rollWindows[i];
	const errorPct = ((roll.peak - targets.rollSubpx) / targets.rollSubpx) * 100;
	console.log(`${roll.id}: frames=${roll.frames} start=${roll.startFrame} end=${roll.endFrame} peak_subpx=${roll.peak.toFixed(2)} mean_subpx=${roll.mean.toFixed(2)} error_pct=${errorPct.toFixed(2)}`);
}
console.log('');
console.log('Roll-jump takeoff:');
if (rollJumpEvent) {
	console.log(`takeoff_frame=${Number(rollJumpEvent.f)} subpx=${rollJumpSubpx.toFixed(2)} error_pct=${(((rollJumpSubpx - targets.rollJumpSubpx) / targets.rollJumpSubpx) * 100).toFixed(2)}`);
} else {
	console.log('takeoff_frame=missing');
}
if (rollJumpSummary) {
	console.log(`roll_jump_airtime_frames=${rollJumpSummary.airtimeFrames}`);
	console.log(`roll_jump_airtime_ms=${rollJumpSummary.airtimeMs.toFixed(2)}`);
	console.log(`roll_jump_apex_px=${rollJumpSummary.apexPixels.toFixed(3)}`);
}
console.log('');
console.log('Ground jumps:');
console.log(`ground_jump_samples=${groundedSummaries.length}`);
if (shortHop) {
	console.log(`short_hop: jump_frame=${shortHop.jumpFrame} airtime_frames=${shortHop.airtimeFrames} airtime_ms=${shortHop.airtimeMs.toFixed(2)} apex_px=${shortHop.apexPixels.toFixed(3)} takeoff_subpx=${shortHop.takeoffSubpx.toFixed(2)}`);
} else {
	console.log('short_hop: missing');
}
if (fullHop) {
	console.log(`full_hop: jump_frame=${fullHop.jumpFrame} airtime_frames=${fullHop.airtimeFrames} airtime_ms=${fullHop.airtimeMs.toFixed(2)} apex_px=${fullHop.apexPixels.toFixed(3)} takeoff_subpx=${fullHop.takeoffSubpx.toFixed(2)}`);
} else {
	console.log('full_hop: missing');
}
if (shortHop && fullHop) {
	console.log(`full_vs_short_airtime_ratio=${(fullHop.airtimeFrames / shortHop.airtimeFrames).toFixed(3)}`);
	console.log(`full_vs_short_apex_ratio=${(fullHop.apexPixels / shortHop.apexPixels).toFixed(3)}`);
}
