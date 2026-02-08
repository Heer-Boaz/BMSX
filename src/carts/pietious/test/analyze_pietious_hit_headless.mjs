import fs from 'node:fs';

const logPath = process.argv[2] ?? '/tmp/pietious_hit_headless.log';

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

const playerHitEvents = events.filter((e) => e.name === 'player_hit');
expect(playerHitEvents.length > 0, 'Missing player_hit event (hazard contact did not trigger damage).');

const firstHit = playerHitEvents[0] ?? null;
if (firstHit) {
	expect(firstHit.reason === 'spike', `Expected spike hit reason, got '${firstHit.reason}'.`);
}

const minHp = metrics.reduce((acc, m) => Math.min(acc, Number(m.hp)), Number.POSITIVE_INFINITY);
expect(Number.isFinite(minHp), 'Could not compute minimum hp from metrics.');
expect(minHp <= 44, `Expected hp drop to 44 or lower after at least one hit, got min_hp=${minHp}.`);

const hitFallSample = first(metrics, (m) => m.st === 'hit_fall');
const hitRecoverySample = first(metrics, (m) => m.st === 'hit_recovery');
expect(hitFallSample !== null, 'Missing hit_fall metric sample.');
expect(hitRecoverySample !== null, 'Missing hit_recovery metric sample.');

const toHitFallTransition = first(events, (e) => e.name === 'state' && e.to === 'hit_fall');
const hitRecoverTransition = first(events, (e) => e.name === 'state' && e.from === 'hit_fall' && e.to === 'hit_recovery');
const backToQuietTransition = first(events, (e) => e.name === 'state' && e.from === 'hit_recovery' && e.to === 'quiet');
expect(toHitFallTransition !== null, 'Missing transition to hit_fall state.');
expect(hitRecoverTransition !== null, 'Missing transition hit_fall -> hit_recovery.');
expect(backToQuietTransition !== null, 'Missing transition hit_recovery -> quiet.');

const invulnSamples = metrics.filter((m) => Number(m.hit_ifr) > 0);
expect(invulnSamples.length > 0, 'Missing invulnerability timer samples (hit_ifr > 0).');
const maxInvuln = invulnSamples.reduce((acc, m) => Math.max(acc, Number(m.hit_ifr)), 0);
expect(maxInvuln >= 31, `Expected hit_ifr to start near 32, got max hit_ifr=${maxInvuln}.`);

const blinkOnSample = first(invulnSamples, (m) => Number(m.blink) === 1);
const blinkOffSample = first(invulnSamples, (m) => Number(m.blink) === 0);
expect(blinkOnSample !== null, 'Missing blinking sample with blink=1 during invulnerability.');
expect(blinkOffSample !== null, 'Missing blinking sample with blink=0 during invulnerability.');

const recoveryMoved = first(metrics, (m) => m.st === 'hit_recovery' && (Number(m.dx) !== 0 || Number(m.dy) !== 0));
expect(recoveryMoved === null, 'Hit recovery should lock movement (dx/dy must remain 0).');

const deathEvent = first(events, (e) => e.name === 'player_death');
expect(deathEvent === null, 'Unexpected player_death event during basic hazard hit scenario.');

console.log(`PIETIOUS_HIT_ANALYSIS log=${logPath}`);
console.log(`samples metrics=${metrics.length} events=${events.length}`);
console.log(`hits=${playerHitEvents.length} min_hp=${minHp} max_hit_ifr=${maxInvuln}`);

if (failures.length > 0) {
	console.log('');
	console.log('PIETIOUS_HIT_ANALYSIS_FAIL');
	for (let i = 0; i < failures.length; i += 1) {
		console.log(`- ${failures[i]}`);
	}
	process.exit(1);
}

console.log('');
console.log('PIETIOUS_HIT_ANALYSIS_OK');
