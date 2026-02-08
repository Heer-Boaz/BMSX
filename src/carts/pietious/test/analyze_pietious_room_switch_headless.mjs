import fs from 'node:fs';

const logPath = process.argv[2] ?? '/tmp/pietious_room_switch_headless.log';

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

for (let i = 0; i < lines.length; i += 1) {
	const line = lines[i];
	if (line.startsWith('PIETIOUS_EVENT|')) {
		events.push(parseTelemetryLine(line));
	}
}

const failures = [];
function expect(condition, message) {
	if (!condition) {
		failures.push(message);
	}
}

const roomSwitches = events.filter((e) => e.name === 'room_switch');
expect(roomSwitches.length >= 2, `Expected at least 2 room_switch events, got ${roomSwitches.length}.`);

const firstSwitch = roomSwitches[0] ?? null;
const secondSwitch = roomSwitches[1] ?? null;

if (firstSwitch) {
	expect(
		firstSwitch.from === 'castle_stone_03' && firstSwitch.to === 'castle_blue_02' && firstSwitch.dir === 'left',
		`First switch mismatch. got from=${firstSwitch.from} to=${firstSwitch.to} dir=${firstSwitch.dir}.`,
	);
	expect(Number(firstSwitch.x) === 240, `Left switch entry x mismatch. got x=${firstSwitch.x}, expected 240.`);
}

if (secondSwitch) {
	expect(
		secondSwitch.from === 'castle_blue_02' && secondSwitch.to === 'castle_stone_03' && secondSwitch.dir === 'right',
		`Second switch mismatch. got from=${secondSwitch.from} to=${secondSwitch.to} dir=${secondSwitch.dir}.`,
	);
	expect(Number(secondSwitch.x) === 0, `Right switch entry x mismatch. got x=${secondSwitch.x}, expected 0.`);
}

console.log(`PIETIOUS_ROOM_SWITCH_ANALYSIS log=${logPath}`);
console.log(`events=${events.length} room_switches=${roomSwitches.length}`);
if (firstSwitch) {
	console.log(
		`first_switch f=${firstSwitch.f} from=${firstSwitch.from} to=${firstSwitch.to} dir=${firstSwitch.dir} x=${firstSwitch.x} y=${firstSwitch.y}`,
	);
}
if (secondSwitch) {
	console.log(
		`second_switch f=${secondSwitch.f} from=${secondSwitch.from} to=${secondSwitch.to} dir=${secondSwitch.dir} x=${secondSwitch.x} y=${secondSwitch.y}`,
	);
}

if (failures.length > 0) {
	console.log('');
	console.log('PIETIOUS_ROOM_SWITCH_ANALYSIS_FAIL');
	for (let i = 0; i < failures.length; i += 1) {
		console.log(`- ${failures[i]}`);
	}
	process.exit(1);
}

console.log('');
console.log('PIETIOUS_ROOM_SWITCH_ANALYSIS_OK');
