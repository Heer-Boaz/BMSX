import fs from 'node:fs';

const logPath = process.argv[2] ?? '/tmp/esther_headless.log';

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

function min(values) {
	if (values.length === 0) {
		return 0;
	}
	let best = values[0];
	for (let i = 1; i < values.length; i += 1) {
		if (values[i] < best) {
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
	return metrics.filter((m) => Number(m.f) >= startFrame && Number(m.f) <= endFrame);
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

function collectSpans(metrics, predicate) {
	const spans = [];
	let start = -1;
	for (let i = 0; i < metrics.length; i += 1) {
		const pass = predicate(metrics[i]);
		if (pass) {
			if (start < 0) {
				start = i;
			}
			continue;
		}
		if (start >= 0) {
			const end = i - 1;
			spans.push({
				startIndex: start,
				endIndex: end,
				startFrame: Number(metrics[start].f),
				endFrame: Number(metrics[end].f),
				samples: metrics.slice(start, end + 1),
			});
			start = -1;
		}
	}
	if (start >= 0) {
		const end = metrics.length - 1;
		spans.push({
			startIndex: start,
			endIndex: end,
			startFrame: Number(metrics[start].f),
			endFrame: Number(metrics[end].f),
			samples: metrics.slice(start, end + 1),
		});
	}
	return spans;
}

function longestSpan(spans) {
	if (spans.length === 0) {
		return null;
	}
	let best = spans[0];
	for (let i = 1; i < spans.length; i += 1) {
		const candidate = spans[i];
		const bestLen = best.endFrame - best.startFrame;
		const candidateLen = candidate.endFrame - candidate.startFrame;
		if (candidateLen > bestLen) {
			best = candidate;
		}
	}
	return best;
}

function pctError(measured, reference) {
	if (reference === 0) {
		return 0;
	}
	return ((measured - reference) / reference) * 100;
}

function firstPressedFrame(metrics, key) {
	const hit = first(metrics, (m) => Number(m[key]) === 1);
	return hit ? Number(hit.f) : null;
}

function findTurnProbe(metrics, walkSpeedSubpx) {
	let start = null;
	for (let i = 1; i < metrics.length; i += 1) {
		const prev = metrics[i - 1];
		const curr = metrics[i];
		if (Number(prev.ax) === 1 && Number(curr.ax) === -1) {
			start = Number(curr.f);
			break;
		}
	}
	if (start === null) {
		return null;
	}
	const crossZero = first(metrics, (m) => Number(m.f) >= start && Number(m.sx) <= 0);
	const reachLeftWalk = first(metrics, (m) => Number(m.f) >= start && Number(m.sx) <= -walkSpeedSubpx);
	return {
		startFrame: start,
		crossZeroFrame: crossZero ? Number(crossZero.f) : null,
		reachLeftWalkFrame: reachLeftWalk ? Number(reachLeftWalk.f) : null,
	};
}

const content = fs.readFileSync(logPath, 'utf8');
const lines = content.split(/\r?\n/);
const metrics = [];
const events = [];
const cameraMetrics = [];

for (let i = 0; i < lines.length; i += 1) {
	const line = lines[i];
	if (line.startsWith('ESTHER_METRIC|')) {
		metrics.push(parseTelemetryLine(line));
		continue;
	}
	if (line.startsWith('ESTHER_EVENT|')) {
		events.push(parseTelemetryLine(line));
		continue;
	}
	if (line.startsWith('ESTHER_CAMERA|')) {
		cameraMetrics.push(parseTelemetryLine(line));
	}
}

if (metrics.length === 0) {
	throw new Error(`No ESTHER_METRIC lines found in '${logPath}'.`);
}

metrics.sort((a, b) => Number(a.f) - Number(b.f));
events.sort((a, b) => Number(a.f) - Number(b.f));
cameraMetrics.sort((a, b) => Number(a.f) - Number(b.f));

const dtAvg = avg(metrics.map((m) => Number(m.dt)));
const ref = {
	walkSubpx: 0x0200,
	runSubpx: 0x0300,
	rollEntryCapSubpx: 0x0400,
	rollChainCapSubpx: 0x0800,
	jumpInitialSubpx: 0x0700,
	gravityHoldSubpx: -0x0048,
	gravityReleaseSubpx: -0x0070,
	maxFallSubpx: -0x0800,
};

const rollStarts = events.filter((e) => e.name === 'roll_start');
const firstRollFrame = rollStarts.length > 0 ? Number(rollStarts[0].f) : Number.POSITIVE_INFINITY;

const runSpans = collectSpans(
	metrics,
	(m) => Number(m.g) === 1 && Number(m.ax) === 1 && Number(m.run) === 1
);
const runSpan = longestSpan(runSpans);
const runPeak = runSpan ? max(runSpan.samples.map((m) => Math.abs(Number(m.sx)))) : 0;
const runTail = runSpan ? runSpan.samples.slice(Math.max(0, runSpan.samples.length - 24)) : [];
const runMean = avg(runTail.map((m) => Math.abs(Number(m.sx))));

let walkEndFrame = firstRollFrame;
if (runSpan) {
	const nextRollAfterRun = first(rollStarts, (e) => Number(e.f) > runSpan.endFrame);
	if (nextRollAfterRun) {
		walkEndFrame = Number(nextRollAfterRun.f);
	} else {
		walkEndFrame = Number.POSITIVE_INFINITY;
	}
}

const walkSpans = collectSpans(
	metrics.filter((m) => Number(m.f) > (runSpan ? runSpan.endFrame : 0) && Number(m.f) < walkEndFrame),
	(m) => Number(m.g) === 1 && Number(m.ax) === 1 && Number(m.run) === 0
);
const walkSpan = longestSpan(walkSpans);
const walkSamples = walkSpan ? walkSpan.samples.map((m) => Math.abs(Number(m.sx))) : [];
const walkMeanAll = avg(walkSamples);
const walkMean = avg(walkSamples.slice(Math.max(0, walkSamples.length - 24)));

const rollStartSpeeds = rollStarts.map((e) => Number(e.subpx));
const rollPeak = max(rollStartSpeeds);

const jumpStarts = events.filter((e) => e.name === 'jump_start');
const rollJumpEvent = first(jumpStarts, (e) => Number(e.from_roll) === 1);
const groundedJumpEvents = jumpStarts.filter((e) => Number(e.from_roll) === 0);

const groundedSummaries = [];
for (let i = 0; i < groundedJumpEvents.length; i += 1) {
	const summary = jumpSummary(groundedJumpEvents[i], events, metrics, dtAvg);
	if (summary) {
		groundedSummaries.push({
			...summary,
			takeoffSy: Number(groundedJumpEvents[i].sy),
		});
	}
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
}

const gravityHoldSamples = metrics
	.filter((m) => m.st === 'airborne' && Number(m.jh) === 1)
	.map((m) => Number(m.grav));
const gravityReleaseSamples = metrics
	.filter((m) => m.st === 'airborne' && Number(m.jh) === 0)
	.map((m) => Number(m.grav));

const gravityHoldMean = avg(gravityHoldSamples);
const gravityReleaseMean = avg(gravityReleaseSamples);

const minSyObserved = min(metrics.map((m) => Number(m.sy)));

const firstXHeldFrame = firstPressedFrame(metrics, 'xh');
const firstYHeldFrame = firstPressedFrame(metrics, 'yh');
const firstAHeldFrame = firstPressedFrame(metrics, 'ah');
const firstBHeldFrame = firstPressedFrame(metrics, 'bh');
const turnProbe = findTurnProbe(metrics, ref.walkSubpx);

const fractionalXSamples = metrics.filter((m) => Math.abs(Number(m.x) - Math.round(Number(m.x))) > 0.0001).length;
const fractionalYSamples = metrics.filter((m) => Math.abs(Number(m.y) - Math.round(Number(m.y))) > 0.0001).length;
const hitXFrames = metrics.filter((m) => Number(m.hx) === 1).length;
const hitYFrames = metrics.filter((m) => Number(m.hy) === 1).length;
const movedXAvg = avg(metrics.map((m) => Math.abs(Number(m.mx) || 0)));
const movedYAvg = avg(metrics.map((m) => Math.abs(Number(m.my) || 0)));
const subpxRemainderXMax = max(metrics.map((m) => Math.abs(Number(m.psx) % 256)));
const subpxRemainderYMax = max(metrics.map((m) => Math.abs(Number(m.psy) % 256)));

const cameraLagSamples = cameraMetrics.map((m) => Math.abs(Number(m.delta)));
const cameraLagMean = avg(cameraLagSamples);
const cameraLagMax = max(cameraLagSamples);
const metricsByFrame = new Map(metrics.map((m) => [Number(m.f), m]));
const runCameraLagSamples = [];
for (let i = 0; i < cameraMetrics.length; i += 1) {
	const camSample = cameraMetrics[i];
	const motionSample = metricsByFrame.get(Number(camSample.f));
	if (!motionSample) {
		continue;
	}
	if (Number(motionSample.run) === 1 && Number(motionSample.ax) === 1) {
		runCameraLagSamples.push(Math.abs(Number(camSample.delta)));
	}
}
const runCameraLagMean = avg(runCameraLagSamples);
const runCameraLagMax = max(runCameraLagSamples);

const imagesByState = new Map();
for (let i = 0; i < metrics.length; i += 1) {
	const sample = metrics[i];
	const stateName = String(sample.st ?? 'missing');
	if (!imagesByState.has(stateName)) {
		imagesByState.set(stateName, new Set());
	}
	imagesByState.get(stateName).add(String(sample.img ?? 'missing'));
}

console.log(`ESTHER_ANALYSIS log=${logPath}`);
console.log(`samples metrics=${metrics.length} events=${events.length} camera=${cameraMetrics.length} dt_avg_ms=${dtAvg.toFixed(4)}`);
console.log('');
console.log('Input detection probe:');
console.log(`first_xh_frame=${firstXHeldFrame ?? 'missing'} first_yh_frame=${firstYHeldFrame ?? 'missing'} first_ah_frame=${firstAHeldFrame ?? 'missing'} first_bh_frame=${firstBHeldFrame ?? 'missing'}`);
console.log('');
console.log('DKC reference constants (subpixels/frame):');
console.log(`walk=${ref.walkSubpx} run=${ref.runSubpx} roll_entry_cap=${ref.rollEntryCapSubpx} roll_chain_cap=${ref.rollChainCapSubpx}`);
console.log(`jump_initial=${ref.jumpInitialSubpx} gravity_hold=${ref.gravityHoldSubpx} gravity_release=${ref.gravityReleaseSubpx} max_fall=${ref.maxFallSubpx}`);
console.log('');
console.log('Run/walk lane:');
if (runSpan) {
	console.log(`run_span=${runSpan.startFrame}-${runSpan.endFrame} run_samples=${runSpan.samples.length}`);
} else {
	console.log('run_span=missing run_samples=0');
}
console.log(`run_peak=${runPeak.toFixed(2)} run_tail_mean=${runMean.toFixed(2)} run_error_pct=${pctError(runMean, ref.runSubpx).toFixed(2)}`);
if (walkSpan) {
	console.log(`walk_span=${walkSpan.startFrame}-${walkSpan.endFrame} walk_samples=${walkSpan.samples.length}`);
} else {
	console.log('walk_span=missing walk_samples=0');
}
console.log(`walk_mean=${walkMean.toFixed(2)} walk_error_pct=${pctError(walkMean, ref.walkSubpx).toFixed(2)}`);
console.log(`walk_mean_all=${walkMeanAll.toFixed(2)}`);
console.log('');
console.log('Roll starts:');
for (let i = 0; i < rollStarts.length; i += 1) {
	const event = rollStarts[i];
	console.log(`roll_${i + 1}: frame=${Number(event.f)} subpx=${Number(event.subpx).toFixed(2)} dir=${Number(event.dir)}`);
}
console.log(`roll_peak=${rollPeak.toFixed(2)} cap_error_pct=${pctError(rollPeak, ref.rollChainCapSubpx).toFixed(2)}`);
console.log('');
console.log('Jump probes:');
if (rollJumpEvent) {
	console.log(`roll_jump_takeoff: frame=${Number(rollJumpEvent.f)} sx=${Number(rollJumpEvent.sx)} sy=${Number(rollJumpEvent.sy)} sy_error_pct=${pctError(Number(rollJumpEvent.sy), ref.jumpInitialSubpx).toFixed(2)}`);
} else {
	console.log('roll_jump_takeoff: missing');
}
console.log(`ground_jump_samples=${groundedSummaries.length}`);
if (shortHop) {
	console.log(`short_hop: frame=${shortHop.jumpFrame} airtime_frames=${shortHop.airtimeFrames} apex_px=${shortHop.apexPixels.toFixed(3)} sy=${shortHop.takeoffSy}`);
} else {
	console.log('short_hop: missing');
}
if (fullHop) {
	console.log(`full_hop: frame=${fullHop.jumpFrame} airtime_frames=${fullHop.airtimeFrames} apex_px=${fullHop.apexPixels.toFixed(3)} sy=${fullHop.takeoffSy}`);
} else {
	console.log('full_hop: missing');
}
if (shortHop && fullHop) {
	console.log(`full_vs_short_airtime_ratio=${(fullHop.airtimeFrames / shortHop.airtimeFrames).toFixed(3)}`);
	console.log(`full_vs_short_apex_ratio=${(fullHop.apexPixels / shortHop.apexPixels).toFixed(3)}`);
}
console.log('');
console.log('Gravity profile:');
console.log(`hold_samples=${gravityHoldSamples.length} hold_mean=${gravityHoldMean.toFixed(2)} hold_error=${(gravityHoldMean - ref.gravityHoldSubpx).toFixed(2)}`);
console.log(`release_samples=${gravityReleaseSamples.length} release_mean=${gravityReleaseMean.toFixed(2)} release_error=${(gravityReleaseMean - ref.gravityReleaseSubpx).toFixed(2)}`);
console.log(`min_sy_observed=${minSyObserved.toFixed(2)} max_fall_error=${(minSyObserved - ref.maxFallSubpx).toFixed(2)}`);
console.log('');
console.log('Subpixel/collision probe:');
console.log(`fractional_x_samples=${fractionalXSamples} fractional_y_samples=${fractionalYSamples}`);
console.log(`avg_abs_moved_px_per_frame_x=${movedXAvg.toFixed(3)} y=${movedYAvg.toFixed(3)}`);
console.log(`collision_frames_x=${hitXFrames} collision_frames_y=${hitYFrames}`);
console.log(`subpx_remainder_max_x=${subpxRemainderXMax.toFixed(2)} subpx_remainder_max_y=${subpxRemainderYMax.toFixed(2)}`);
console.log('');
console.log('Turn probe (right -> left):');
if (turnProbe) {
	const crossZeroLatency = turnProbe.crossZeroFrame === null ? 'missing' : String(turnProbe.crossZeroFrame - turnProbe.startFrame);
	const walkLeftLatency = turnProbe.reachLeftWalkFrame === null ? 'missing' : String(turnProbe.reachLeftWalkFrame - turnProbe.startFrame);
	console.log(`turn_start_frame=${turnProbe.startFrame} cross_zero_latency_frames=${crossZeroLatency} reach_left_walk_latency_frames=${walkLeftLatency}`);
} else {
	console.log('turn_probe=missing');
}
console.log('');
console.log('Camera follow probe:');
console.log(`camera_lag_mean=${cameraLagMean.toFixed(3)} camera_lag_max=${cameraLagMax.toFixed(3)}`);
console.log(`run_camera_lag_mean=${runCameraLagMean.toFixed(3)} run_camera_lag_max=${runCameraLagMax.toFixed(3)}`);
console.log('');
console.log('Animation coverage:');
const stateNames = Array.from(imagesByState.keys()).sort();
for (let i = 0; i < stateNames.length; i += 1) {
	const stateName = stateNames[i];
	const images = Array.from(imagesByState.get(stateName)).sort();
	console.log(`state=${stateName} unique_images=${images.length} images=${images.join(',')}`);
}
