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
const findSwitch = (from, to, dir) => roomSwitches.find((e) => e.from === from && e.to === to && e.dir === dir);

const stairsDownSwitch = findSwitch('castle_stone_03', 'castle_blue_01', 'down');
const stairsUpSwitch = findSwitch('castle_blue_01', 'castle_gold_06', 'up');
const chainUpSwitch = findSwitch('castle_gold_06', 'castle_gold_13', 'up');
const fallDownSwitch = findSwitch('castle_gold_13', 'castle_gold_06', 'down');

expect(stairsDownSwitch !== undefined, 'Missing stairs down room switch castle_stone_03 -> castle_blue_01.');
expect(stairsUpSwitch !== undefined, 'Missing stairs up room switch castle_blue_01 -> castle_gold_06.');
expect(chainUpSwitch !== undefined, 'Missing chained stairs up room switch castle_gold_06 -> castle_gold_13.');
expect(fallDownSwitch !== undefined, 'Missing fall-through room switch castle_gold_13 -> castle_gold_06.');

if (fallDownSwitch !== undefined) {
	const metricAtSwitch = metrics.find((m) => Number(m.f) === Number(fallDownSwitch.f));
	expect(metricAtSwitch !== undefined, `Missing metric sample at fall-through switch frame ${fallDownSwitch.f}.`);
	if (metricAtSwitch !== undefined) {
		expect(
			metricAtSwitch.st === 'uncontrolled_fall' || metricAtSwitch.st === 'controlled_fall',
			`Expected fall-through switch during fall state, got st=${metricAtSwitch.st} at f=${metricAtSwitch.f}.`,
		);
	}
}

console.log(`PIETIOUS_VERTICAL_ROOM_SWITCH_ANALYSIS log=${logPath}`);
console.log(`events=${events.length} metrics=${metrics.length} room_switches=${roomSwitches.length}`);
if (stairsDownSwitch) {
	console.log(
		`stairs_down f=${stairsDownSwitch.f} from=${stairsDownSwitch.from} to=${stairsDownSwitch.to} x=${stairsDownSwitch.x} y=${stairsDownSwitch.y}`,
	);
}
if (stairsUpSwitch) {
	console.log(
		`stairs_up f=${stairsUpSwitch.f} from=${stairsUpSwitch.from} to=${stairsUpSwitch.to} x=${stairsUpSwitch.x} y=${stairsUpSwitch.y}`,
	);
}
if (chainUpSwitch) {
	console.log(
		`stairs_up_chain f=${chainUpSwitch.f} from=${chainUpSwitch.from} to=${chainUpSwitch.to} x=${chainUpSwitch.x} y=${chainUpSwitch.y}`,
	);
}
if (fallDownSwitch) {
	console.log(
		`fall_down f=${fallDownSwitch.f} from=${fallDownSwitch.from} to=${fallDownSwitch.to} x=${fallDownSwitch.x} y=${fallDownSwitch.y}`,
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
