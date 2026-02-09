import fs from 'node:fs';

const logPath = process.argv[2] ?? '/tmp/esther_headless_dkcflags.log';

const DKC = {
	jumpInitialSubpx: 0x0700,
	gravityHoldSubpx: -0x0048,
	gravityReleaseSubpx: -0x0070,
	maxFallSubpx: -0x0800,
	flagHoldGravity: 0x0002,
	barrelGroundSpeedSubpx: 0x0600,
	barrelGroundUpSubpx: 0x0180,
	barrelAirSpeedSubpx: 0x0580,
	barrelAirUpSubpx: 0x0100,
	barrelGravitySubpx: -0x0060,
	barrelMaxFallSubpx: -0x0800,
};

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

function first(items, predicate) {
	for (let i = 0; i < items.length; i += 1) {
		if (predicate(items[i])) {
			return items[i];
		}
	}
	return null;
}

function between(items, startFrame, endFrame) {
	return items.filter((item) => Number(item.f) >= startFrame && Number(item.f) <= endFrame);
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

metrics.sort((a, b) => Number(a.f) - Number(b.f));
events.sort((a, b) => Number(a.f) - Number(b.f));

const errors = [];

function check(condition, message) {
	if (!condition) {
		errors.push(message);
	}
}

for (let i = 0; i < metrics.length; i += 1) {
	const m = metrics[i];
	const sy = Number(m.sy);
	check(sy >= DKC.maxFallSubpx, `frame=${m.f}: sy=${sy} is below maxFall=${DKC.maxFallSubpx}`);
}

const jumpStarts = events.filter((e) => e.name === 'jump_start');
check(jumpStarts.length > 0, 'No jump_start events found.');

for (let i = 0; i < jumpStarts.length; i += 1) {
	const jump = jumpStarts[i];
	const jumpFrame = Number(jump.f);

	const takeoffMetric = first(metrics, (m) => Number(m.f) >= jumpFrame && m.st === 'airborne');
	if (!takeoffMetric) {
		errors.push(`jump@${jumpFrame}: no airborne metric found at/after jump_start`);
		continue;
	}

	const takeoffFrame = Number(takeoffMetric.f);
	const eventSy = Number(jump.sy);
	const takeoffSy = Number(takeoffMetric.sy);
	const takeoffFlags1699 = Number(takeoffMetric.f1699);
	check(
		eventSy > 0 && eventSy <= DKC.jumpInitialSubpx,
		`jump@${jumpFrame}: jump_start sy=${eventSy}, expected 0 < sy <= ${DKC.jumpInitialSubpx}`
	);
	check(
		takeoffSy <= DKC.jumpInitialSubpx,
		`jump@${jumpFrame}: first airborne sy=${takeoffSy} exceeds jump initial=${DKC.jumpInitialSubpx}`
	);
	check(
		(takeoffFlags1699 & DKC.flagHoldGravity) !== 0,
		`jump@${jumpFrame}: takeoff f1699=${takeoffFlags1699} missing hold-gravity bit`
	);

	const landing = first(events, (e) => e.name === 'land' && Number(e.f) > takeoffFrame);
	const endFrame = landing ? Number(landing.f) : Number(metrics[metrics.length - 1].f);
	const airSamples = between(metrics, takeoffFrame, endFrame).filter((m) => m.st === 'airborne');
	const dynamicAirSamples = airSamples.filter((m) => Number(m.f) > takeoffFrame);

	const firstRelease = first(dynamicAirSamples, (m) => Number(m.jr) === 1);
	const releaseFrame = firstRelease ? Number(firstRelease.f) : null;

	for (let s = 0; s < dynamicAirSamples.length; s += 1) {
		const sample = dynamicAirSamples[s];
		const frame = Number(sample.f);
		const flags1699 = Number(sample.f1699);
		const flags16f9 = Number(sample.f16f9);
		const gravity = Number(sample.grav);
		const holdActive = (flags1699 & DKC.flagHoldGravity) !== 0;
		const expectedGravity = holdActive ? flags16f9 : DKC.gravityReleaseSubpx;
		check(
			gravity === expectedGravity,
			`jump@${jumpFrame} frame=${frame}: grav=${gravity}, expected=${expectedGravity} (f1699=${flags1699}, f16f9=${flags16f9})`
		);
		check(
			flags16f9 === DKC.gravityHoldSubpx,
			`jump@${jumpFrame} frame=${frame}: f16f9=${flags16f9}, expected=${DKC.gravityHoldSubpx}`
		);
		if (releaseFrame !== null && frame > releaseFrame) {
			check(
				(flags1699 & DKC.flagHoldGravity) === 0,
				`jump@${jumpFrame} frame=${frame}: hold-gravity bit re-enabled after release (f1699=${flags1699})`
			);
		}
	}
}

const barrelThrows = events.filter((e) => e.name === 'barrel_throw');
check(barrelThrows.length > 0, 'No barrel_throw events found.');

for (let i = 0; i < barrelThrows.length; i += 1) {
	const throwEvent = barrelThrows[i];
	const throwFrame = Number(throwEvent.f);
	const mode = String(throwEvent.mode ?? 'ground');
	const face = Number(throwEvent.face);
	const expectedBaseSx = mode === 'air' ? DKC.barrelAirSpeedSubpx : DKC.barrelGroundSpeedSubpx;
	const expectedBaseSy = mode === 'air' ? DKC.barrelAirUpSubpx : DKC.barrelGroundUpSubpx;
	const baseSx = Number(throwEvent.bsx);
	const baseSy = Number(throwEvent.bsy);
	const throwSx = Number(throwEvent.sx);
	const throwSy = Number(throwEvent.sy);
	const barrelIdx = Number(throwEvent.idx);

	check(face === -1 || face === 1, `barrel_throw@${throwFrame}: invalid face=${face}`);
	check(baseSx === expectedBaseSx, `barrel_throw@${throwFrame}: bsx=${baseSx}, expected=${expectedBaseSx} (mode=${mode})`);
	check(baseSy === expectedBaseSy, `barrel_throw@${throwFrame}: bsy=${baseSy}, expected=${expectedBaseSy} (mode=${mode})`);
	check(throwSx === face * expectedBaseSx, `barrel_throw@${throwFrame}: sx=${throwSx}, expected=${face * expectedBaseSx}`);
	check(throwSy === expectedBaseSy, `barrel_throw@${throwFrame}: sy=${throwSy}, expected=${expectedBaseSy}`);

	const terminal = first(
		events,
		(e) =>
			Number(e.f) > throwFrame &&
			(e.name === 'barrel_land' || e.name === 'barrel_break') &&
			Number(e.idx) === barrelIdx
	);
	check(terminal !== null, `barrel_throw@${throwFrame}: missing barrel_land/barrel_break`);
	const terminalFrame = terminal ? Number(terminal.f) : Number(metrics[metrics.length - 1].f);

	const steps = events
		.filter(
			(e) =>
				e.name === 'barrel_step' &&
				Number(e.idx) === barrelIdx &&
				Number(e.f) >= throwFrame &&
				Number(e.f) <= terminalFrame
		)
		.sort((a, b) => Number(a.f) - Number(b.f));
	check(steps.length > 0, `barrel_throw@${throwFrame}: missing barrel_step trace`);

	if (steps.length > 0) {
		const firstStepSy = Number(steps[0].sy);
		const expectedFirstStepSy = Math.max(throwSy + DKC.barrelGravitySubpx, DKC.barrelMaxFallSubpx);
		check(
			firstStepSy === expectedFirstStepSy,
			`barrel_throw@${throwFrame}: first step sy=${firstStepSy}, expected=${expectedFirstStepSy}`
		);
	}

	for (let s = 1; s < steps.length; s += 1) {
		const prev = steps[s - 1];
		const curr = steps[s];
		const prevGrounded = Number(prev.g) === 1;
		const currGrounded = Number(curr.g) === 1;
		if (prevGrounded || currGrounded) {
			continue;
		}
		const prevSy = Number(prev.sy);
		const currSy = Number(curr.sy);
		const expectedSy = Math.max(prevSy + DKC.barrelGravitySubpx, DKC.barrelMaxFallSubpx);
		check(
			currSy === expectedSy,
			`barrel_throw@${throwFrame} frame=${Number(curr.f)}: sy=${currSy}, expected=${expectedSy}`
		);
	}
}

if (errors.length > 0) {
	console.error(`DKC_PARITY FAIL (${errors.length} issues)`);
	for (let i = 0; i < errors.length; i += 1) {
		console.error(`- ${errors[i]}`);
	}
	process.exit(1);
}

console.log(`DKC_PARITY PASS jumps=${jumpStarts.length} metrics=${metrics.length} log=${logPath}`);
