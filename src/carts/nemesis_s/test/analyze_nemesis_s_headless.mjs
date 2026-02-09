import fs from 'node:fs';

const logPath = process.argv[2] ?? '/tmp/nemesis_s_headless.log';

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

function approxEqual(a, b, epsilon = 1e-3) {
	return Math.abs(a - b) <= epsilon;
}

function filterRange(metrics, startFrame, endFrame, predicate) {
	const out = [];
	for (let i = 0; i < metrics.length; i += 1) {
		const m = metrics[i];
		const f = Number(m.f);
		if (f <= startFrame || f >= endFrame) {
			continue;
		}
		if (predicate(m)) {
			out.push(m);
		}
	}
	return out;
}

const content = fs.readFileSync(logPath, 'utf8');
const lines = content.split(/\r?\n/);

const playerMetrics = [];
const directorMetrics = [];
const playerEvents = [];
const directorEvents = [];

for (let i = 0; i < lines.length; i += 1) {
	const line = lines[i];
	if (line.startsWith('NEMESIS_S_METRIC|')) {
		const payload = parseTelemetryLine(line);
		if (payload.kind === 'player') {
			playerMetrics.push(payload);
		} else if (payload.kind === 'director') {
			directorMetrics.push(payload);
		}
		continue;
	}
	if (line.startsWith('NEMESIS_S_EVENT|')) {
		const payload = parseTelemetryLine(line);
		if (payload.kind === 'player') {
			playerEvents.push(payload);
		} else if (payload.kind === 'director') {
			directorEvents.push(payload);
		}
	}
}

if (playerMetrics.length === 0) {
	throw new Error(`No player metric lines found in '${logPath}'.`);
}

playerMetrics.sort((a, b) => Number(a.f) - Number(b.f));
directorMetrics.sort((a, b) => Number(a.f) - Number(b.f));
playerEvents.sort((a, b) => Number(a.f) - Number(b.f));
directorEvents.sort((a, b) => Number(a.f) - Number(b.f));

const failures = [];
function expect(condition, message) {
	if (!condition) {
		failures.push(message);
	}
}

expect(directorMetrics.length > 0, 'Missing director metric stream.');

for (let i = 0; i < playerMetrics.length; i += 1) {
	const m = playerMetrics[i];
	const x = Number(m.x);
	const y = Number(m.y);
	expect(x >= 0 && x <= 240, `Player X out of bounds at frame ${m.f}: x=${x} expected [0..240].`);
	expect(y >= 0 && y <= 166, `Player Y out of bounds at frame ${m.f}: y=${y} expected [0..166].`);
	expect(Number(m.pc) <= 2, `Projectile count exceeded limit at frame ${m.f}: pc=${m.pc} expected <=2.`);
}

const moveRightSamples = playerMetrics.filter((m) => Number(m.right) === 1 && Number(m.left) === 0 && Number(m.up) === 0 && Number(m.down) === 0);
expect(moveRightSamples.length >= 20, `Expected at least 20 right-move samples, got ${moveRightSamples.length}.`);
for (let i = 0; i < moveRightSamples.length; i += 1) {
	expect(approxEqual(Number(moveRightSamples[i].dx), 1), `Right move dx mismatch at frame ${moveRightSamples[i].f}: dx=${moveRightSamples[i].dx} expected 1.`);
}

const moveLeftSamples = playerMetrics.filter((m) => Number(m.left) === 1 && Number(m.right) === 0 && Number(m.up) === 0 && Number(m.down) === 0);
expect(moveLeftSamples.length >= 15, `Expected at least 15 left-move samples, got ${moveLeftSamples.length}.`);
for (let i = 0; i < moveLeftSamples.length; i += 1) {
	expect(approxEqual(Number(moveLeftSamples[i].dx), -1), `Left move dx mismatch at frame ${moveLeftSamples[i].f}: dx=${moveLeftSamples[i].dx} expected -1.`);
}

const moveUpSamples = playerMetrics.filter((m) => Number(m.up) === 1 && Number(m.down) === 0);
expect(moveUpSamples.length >= 15, `Expected at least 15 up-move samples, got ${moveUpSamples.length}.`);
for (let i = 0; i < moveUpSamples.length; i += 1) {
	expect(approxEqual(Number(moveUpSamples[i].dy), -1), `Up move dy mismatch at frame ${moveUpSamples[i].f}: dy=${moveUpSamples[i].dy} expected -1.`);
	expect(moveUpSamples[i].sprite === 'metallion_u', `Up sprite mismatch at frame ${moveUpSamples[i].f}: sprite=${moveUpSamples[i].sprite} expected metallion_u.`);
}

const moveDownSamples = playerMetrics.filter((m) => Number(m.down) === 1 && Number(m.up) === 0);
expect(moveDownSamples.length >= 20, `Expected at least 20 down-move samples, got ${moveDownSamples.length}.`);
for (let i = 0; i < moveDownSamples.length; i += 1) {
	expect(approxEqual(Number(moveDownSamples[i].dy), 1), `Down move dy mismatch at frame ${moveDownSamples[i].f}: dy=${moveDownSamples[i].dy} expected 1.`);
	expect(moveDownSamples[i].sprite === 'metallion_d', `Down sprite mismatch at frame ${moveDownSamples[i].f}: sprite=${moveDownSamples[i].sprite} expected metallion_d.`);
}

const neutralSample = first(
	playerMetrics,
	(m) => Number(m.up) === 0 && Number(m.down) === 0 && m.sprite === 'metallion_n',
);
expect(neutralSample !== null, 'Missing neutral sprite sample after vertical input release.');

const fireSpawnEvents = playerEvents.filter((e) => e.name === 'fire_spawn');
const fireBlockedEvents = playerEvents.filter((e) => e.name === 'fire_blocked');
const fireDespawnEvents = playerEvents.filter((e) => e.name === 'fire_despawn');

expect(fireSpawnEvents.length >= 3, `Expected at least 3 fire_spawn events, got ${fireSpawnEvents.length}.`);
expect(fireBlockedEvents.length >= 1, `Expected at least 1 fire_blocked event, got ${fireBlockedEvents.length}.`);
expect(fireDespawnEvents.length >= 2, `Expected at least 2 fire_despawn events, got ${fireDespawnEvents.length}.`);

const fireHoldStreaks = [];
let streakStart = -1;
let streakEnd = -1;
let streakPressCount = 0;
for (let i = 0; i < playerMetrics.length; i += 1) {
	const metric = playerMetrics[i];
	const fireHeld = Number(metric.fire) === 1;
	if (fireHeld) {
		if (streakStart < 0) {
			streakStart = Number(metric.f);
			streakPressCount = 0;
		}
		streakEnd = Number(metric.f);
		if (Number(metric.fire_press) === 1) {
			streakPressCount += 1;
		}
		continue;
	}
	if (streakStart >= 0) {
		fireHoldStreaks.push({
			start: streakStart,
			end: streakEnd,
			length: streakEnd - streakStart + 1,
			firePressCount: streakPressCount,
		});
		streakStart = -1;
		streakEnd = -1;
		streakPressCount = 0;
	}
}
if (streakStart >= 0) {
	fireHoldStreaks.push({
		start: streakStart,
		end: streakEnd,
		length: streakEnd - streakStart + 1,
		firePressCount: streakPressCount,
	});
}

const longFireHoldStreaks = fireHoldStreaks.filter((streak) => streak.length >= 8);
expect(longFireHoldStreaks.length > 0, 'Expected at least one long fire-hold streak (length >= 8 frames).');
for (let i = 0; i < longFireHoldStreaks.length; i += 1) {
	const streak = longFireHoldStreaks[i];
	expect(
		streak.firePressCount === 1,
		`Fire hold streak [${streak.start}, ${streak.end}] has fire_press_count=${streak.firePressCount}, expected exactly 1.`,
	);
}

const firstSpawn = fireSpawnEvents[0];
const firstSpawnFrameMetric = first(playerMetrics, (m) => Number(m.f) === Number(firstSpawn.f));
expect(firstSpawnFrameMetric !== null, 'Missing player metric for first fire_spawn frame.');
if (firstSpawnFrameMetric) {
	expect(
		approxEqual(Number(firstSpawn.x), Number(firstSpawnFrameMetric.x) + 16),
		`First spawn x mismatch: spawn.x=${firstSpawn.x}, player.x=${firstSpawnFrameMetric.x}, expected player.x+16.`,
	);
	expect(
		approxEqual(Number(firstSpawn.y), Number(firstSpawnFrameMetric.y) + 5),
		`First spawn y mismatch: spawn.y=${firstSpawn.y}, player.y=${firstSpawnFrameMetric.y}, expected player.y+5.`,
	);
}

const projectileDeltas = [];
for (let i = 0; i < playerMetrics.length - 1; i += 1) {
	const current = playerMetrics[i];
	const next = playerMetrics[i + 1];
	const pc0 = Number(current.pc);
	const pc1 = Number(next.pc);
	if (pc0 < 1 || pc1 < 1) {
		continue;
	}
	const x0 = Number(current.p0x);
	const x1 = Number(next.p0x);
	if (x0 < 0 || x1 < 0) {
		continue;
	}
	const delta = x1 - x0;
	if (delta > 0) {
		projectileDeltas.push(delta);
	}
}

const matchingProjectileDeltas = projectileDeltas.filter((delta) => approxEqual(delta, 6, 0.2));
expect(
	matchingProjectileDeltas.length >= 20,
	`Expected >=20 projectile movement samples with delta~6, got ${matchingProjectileDeltas.length} from ${projectileDeltas.length}.`,
);

if (directorMetrics.length > 1) {
	let stableScrollSamples = 0;
	for (let i = 0; i < directorMetrics.length - 1; i += 1) {
		const current = Number(directorMetrics[i].scroll);
		const nextRaw = Number(directorMetrics[i + 1].scroll);
		let delta = nextRaw - current;
		if (delta < 0) {
			delta += 256;
		}
		if (approxEqual(delta, 0.625, 0.05)) {
			stableScrollSamples += 1;
		}
	}
	expect(stableScrollSamples >= 40, `Expected >=40 director scroll deltas near 0.625, got ${stableScrollSamples}.`);
}

const blinkEvents = directorEvents.filter((e) => e.name === 'star_blink_toggle');
expect(blinkEvents.length > 0, 'Missing star_blink_toggle events.');

if (failures.length > 0) {
	console.error('nemesis_s headless analysis failed:');
	for (let i = 0; i < failures.length; i += 1) {
		console.error(` - ${failures[i]}`);
	}
	process.exit(1);
}

console.log('nemesis_s headless analysis passed.');
console.log(
	JSON.stringify(
		{
			playerMetrics: playerMetrics.length,
			playerEvents: playerEvents.length,
			directorMetrics: directorMetrics.length,
			directorEvents: directorEvents.length,
			fireSpawnEvents: fireSpawnEvents.length,
			fireBlockedEvents: fireBlockedEvents.length,
			fireDespawnEvents: fireDespawnEvents.length,
			projectileDeltaMatches: matchingProjectileDeltas.length,
		},
		null,
		2,
	),
);
