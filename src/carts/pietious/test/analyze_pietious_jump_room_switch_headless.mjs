import fs from 'node:fs';

const logPath = process.argv[2] ?? '/tmp/pietious_jump_room_switch_headless.log';

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

const content = fs.readFileSync(logPath, 'utf8');
const lines = content.split(/\r?\n/);
const events = [];
const metrics = [];

for (let i = 0; i < lines.length; i += 1) {
	const line = lines[i];
	if (line.startsWith('PIETIOUS_EVENT|')) {
		events.push(parseTelemetryLine(line));
	}
	if (line.startsWith('PIETIOUS_METRIC|')) {
		metrics.push(parseTelemetryLine(line));
	}
}

const failures = [];
function expect(condition, message) {
	if (!condition) {
		failures.push(message);
	}
}

const firstJumpSwitch = events.find((e) => e.name === 'room_switch' && e.from === 'castle_stone_03' && e.to === 'castle_blue_02' && e.dir === 'left');
expect(firstJumpSwitch !== undefined, 'Missing left room_switch from castle_stone_03 to castle_blue_02 during jump test.');

if (firstJumpSwitch !== undefined) {
	const metricAtSwitch = metrics.find((m) => Number(m.f) === Number(firstJumpSwitch.f));
	expect(metricAtSwitch !== undefined, `Missing metric sample at room switch frame ${firstJumpSwitch.f}.`);
	if (metricAtSwitch !== undefined) {
		const airStates = new Set(['jumping', 'stopped_jumping', 'controlled_fall', 'uncontrolled_fall']);
		expect(
			airStates.has(metricAtSwitch.st),
			`Expected airborne room switch state, got st=${metricAtSwitch.st} at f=${metricAtSwitch.f}.`,
		);
	}
}

console.log(`PIETIOUS_JUMP_ROOM_SWITCH_ANALYSIS log=${logPath}`);
console.log(`events=${events.length} metrics=${metrics.length}`);
if (firstJumpSwitch) {
	console.log(
		`switch f=${firstJumpSwitch.f} from=${firstJumpSwitch.from} to=${firstJumpSwitch.to} dir=${firstJumpSwitch.dir} x=${firstJumpSwitch.x} y=${firstJumpSwitch.y}`,
	);
}

if (failures.length > 0) {
	console.log('');
	console.log('PIETIOUS_JUMP_ROOM_SWITCH_ANALYSIS_FAIL');
	for (let i = 0; i < failures.length; i += 1) {
		console.log(`- ${failures[i]}`);
	}
	process.exit(1);
}

console.log('');
console.log('PIETIOUS_JUMP_ROOM_SWITCH_ANALYSIS_OK');
