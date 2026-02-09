import fs from 'node:fs';

const logPath = process.argv[2] ?? '/tmp/pietious_vertical_room_switch_headless.log';

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

const roomSwitches = events.filter((e) => e.name === 'room_switch');
const stairsDownStart = events.find((e) => e.name === 'stairs_start' && Number(e.dir) > 0);
expect(stairsDownStart !== undefined, 'Missing stairs_start with down direction.');

let stairsDownEnd;
if (stairsDownStart) {
	stairsDownEnd = events.find((e) => e.name === 'stairs_end' && e.mode === 'bottom' && Number(e.f) >= Number(stairsDownStart.f));
	expect(stairsDownEnd !== undefined, 'Missing stairs_end mode=bottom after stairs down start.');
}

const roomSwitchDuringDown = stairsDownStart && stairsDownEnd
	? roomSwitches.find((e) => Number(e.f) >= Number(stairsDownStart.f) && Number(e.f) <= Number(stairsDownEnd.f) + 4)
	: undefined;
expect(
	roomSwitchDuringDown === undefined,
	'Unexpected room_switch while descending stairs before completing the bottom exit window.',
);

expect(roomSwitches.length === 0, `Expected 0 room_switch events in this regression timeline, got ${roomSwitches.length}.`);

console.log(`PIETIOUS_VERTICAL_ROOM_SWITCH_ANALYSIS log=${logPath}`);
console.log(`events=${events.length} metrics=${metrics.length} room_switches=${roomSwitches.length}`);
if (stairsDownStart) {
	console.log(`stairs_down_start f=${stairsDownStart.f} x=${stairsDownStart.x} y=${stairsDownStart.y} dir=${stairsDownStart.dir}`);
}
if (stairsDownEnd) {
	console.log(`stairs_down_end f=${stairsDownEnd.f} x=${stairsDownEnd.x} y=${stairsDownEnd.y} mode=${stairsDownEnd.mode}`);
}
if (roomSwitchDuringDown) {
	console.log(
		`unexpected_switch f=${roomSwitchDuringDown.f} from=${roomSwitchDuringDown.from} to=${roomSwitchDuringDown.to} dir=${roomSwitchDuringDown.dir} x=${roomSwitchDuringDown.x} y=${roomSwitchDuringDown.y}`,
	);
}

if (failures.length > 0) {
	console.log('');
	console.log('PIETIOUS_VERTICAL_ROOM_SWITCH_ANALYSIS_FAIL');
	for (let i = 0; i < failures.length; i += 1) {
		console.log(`- ${failures[i]}`);
	}
	process.exit(1);
}

console.log('');
console.log('PIETIOUS_VERTICAL_ROOM_SWITCH_ANALYSIS_OK');
