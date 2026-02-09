import fs from 'node:fs';

const SUBPIXELS_PER_PIXEL = 256;

function profileStep(absDiff, profileId) {
	if (profileId === 0) {
		return Math.floor(absDiff / 8);
	}
	if (profileId === 1) {
		return Math.floor(absDiff / 16);
	}
	if (profileId === 2) {
		return Math.floor(absDiff / 32);
	}
	if (profileId === 3) {
		return Math.floor(absDiff / 64);
	}
	if (profileId === 4) {
		return Math.floor(absDiff / 128);
	}
	if (profileId === 5) {
		return Math.floor(absDiff / 256);
	}
	if (profileId === 6) {
		return Math.floor(absDiff / 4);
	}
	if (profileId === 7) {
		return Math.floor(absDiff / 2);
	}
	if (profileId === 8) {
		return Math.floor(absDiff / 32) + Math.floor(absDiff / 64);
	}
	return 0;
}

function approachSubpx(current, target, profileId) {
	if (current === target) {
		return target;
	}
	const delta = target - current;
	const absDelta = Math.abs(delta);
	const step = profileStep(absDelta, profileId);
	if (step === 0) {
		return target;
	}
	const signedStep = delta < 0 ? -step : step;
	const value = current + signedStep;
	if (delta > 0 && value > target) {
		return target;
	}
	if (delta < 0 && value < target) {
		return target;
	}
	return value;
}

function csvEscape(value) {
	const text = String(value);
	if (text.includes(',') || text.includes('"') || text.includes('\n')) {
		return `"${text.replaceAll('"', '""')}"`;
	}
	return text;
}

function runCase(config) {
	const rows = [];
	let speedSubpx = config.startSpeedSubpx;
	let accumSubpx = 0;
	let frame = 0;

	while (speedSubpx !== config.targetSpeedSubpx) {
		frame += 1;
		speedSubpx = approachSubpx(speedSubpx, config.targetSpeedSubpx, config.profileId);
		const prevAccumPx = Math.floor(accumSubpx / SUBPIXELS_PER_PIXEL);
		accumSubpx += speedSubpx;
		const accumPx = Math.floor(accumSubpx / SUBPIXELS_PER_PIXEL);
		rows.push({
			case: config.caseId,
			condition: config.condition,
			frame,
			profile_id: config.profileId,
			start_speed_subpx: config.startSpeedSubpx,
			target_speed_subpx: config.targetSpeedSubpx,
			speed_subpx: speedSubpx,
			speed_px_per_frame: (speedSubpx / SUBPIXELS_PER_PIXEL).toFixed(6),
			delta_px_this_frame: accumPx - prevAccumPx,
			accum_subpx: accumSubpx,
			accum_px: accumPx,
		});
	}

	return rows;
}

function summarizeCase(rows) {
	const deltaCounts = new Map();
	let firstDelta1 = null;
	let firstDelta2 = null;
	let firstDelta3 = null;
	let firstNegative = null;
	for (let i = 0; i < rows.length; i += 1) {
		const row = rows[i];
		const delta = row.delta_px_this_frame;
		deltaCounts.set(delta, (deltaCounts.get(delta) ?? 0) + 1);
		if (firstDelta1 === null && delta === 1) {
			firstDelta1 = row.frame;
		}
		if (firstDelta2 === null && delta === 2) {
			firstDelta2 = row.frame;
		}
		if (firstDelta3 === null && delta === 3) {
			firstDelta3 = row.frame;
		}
		if (firstNegative === null && delta < 0) {
			firstNegative = row.frame;
		}
	}
	return {
		framesToTarget: rows.length,
		finalSpeedSubpx: rows[rows.length - 1].speed_subpx,
		finalSpeedPx: rows[rows.length - 1].speed_px_per_frame,
		firstDelta1,
		firstDelta2,
		firstDelta3,
		firstNegative,
		deltaCounts,
	};
}

const scenarios = [
	{
		caseId: 'ground_walk_accel',
		condition: 'grounded, dpad held, run not held',
		profileId: 3,
		startSpeedSubpx: 0x0000,
		targetSpeedSubpx: 0x0200,
	},
	{
		caseId: 'ground_run_accel',
		condition: 'grounded, dpad held, run held',
		profileId: 8,
		startSpeedSubpx: 0x0000,
		targetSpeedSubpx: 0x0300,
	},
	{
		caseId: 'ground_release_decel',
		condition: 'grounded, dpad released from run speed',
		profileId: 2,
		startSpeedSubpx: 0x0300,
		targetSpeedSubpx: 0x0000,
	},
	{
		caseId: 'ground_turn_right_to_left',
		condition: 'grounded, direction opposite current speed',
		profileId: 1,
		startSpeedSubpx: 0x0300,
		targetSpeedSubpx: -0x0200,
	},
	{
		caseId: 'air_control_accel',
		condition: 'airborne, dpad held, run ignored',
		profileId: 4,
		startSpeedSubpx: 0x0000,
		targetSpeedSubpx: 0x0200,
	},
	{
		caseId: 'roll_decay_4px_to_2px',
		condition: 'roll state speed decays toward floor speed',
		profileId: 1,
		startSpeedSubpx: 0x0400,
		targetSpeedSubpx: 0x0200,
	},
];

const allRows = [];
const summaries = [];
for (let i = 0; i < scenarios.length; i += 1) {
	const rows = runCase(scenarios[i]);
	allRows.push(...rows);
	summaries.push({
		caseId: scenarios[i].caseId,
		condition: scenarios[i].condition,
		profileId: scenarios[i].profileId,
		startSpeedSubpx: scenarios[i].startSpeedSubpx,
		targetSpeedSubpx: scenarios[i].targetSpeedSubpx,
		stats: summarizeCase(rows),
	});
}

const header = [
	'case',
	'condition',
	'frame',
	'profile_id',
	'start_speed_subpx',
	'target_speed_subpx',
	'speed_subpx',
	'speed_px_per_frame',
	'delta_px_this_frame',
	'accum_subpx',
	'accum_px',
];

const csvLines = [header.join(',')];
for (let i = 0; i < allRows.length; i += 1) {
	const row = allRows[i];
	csvLines.push(
		[
			row.case,
			row.condition,
			row.frame,
			row.profile_id,
			row.start_speed_subpx,
			row.target_speed_subpx,
			row.speed_subpx,
			row.speed_px_per_frame,
			row.delta_px_this_frame,
			row.accum_subpx,
			row.accum_px,
		]
			.map(csvEscape)
			.join(',')
	);
}

const notes = [];
notes.push('# DKC Movement Frame Notes');
notes.push('');
notes.push('Primary disassembly anchors (as documented in this repo history):');
notes.push('- `Yoshifanatic1/Donkey-Kong-Country-1-Disassembly`');
notes.push('- commit: `c2080f40469c716923f550706509a0d354229841`');
notes.push('- file: `Routine_Macros_DKC1.asm`');
notes.push('- routines: `CODE_BFB538`, `CODE_BFB573`, `CODE_BFB159`, `DATA_BFB255`, `CODE_BFBD4F`, `CODE_BFBDA9`, `CODE_BFBDE7`');
notes.push('');
notes.push('Local source snapshots used:');
notes.push('- `src/carts/esther/constants.lua` at commit `1c4122d5`');
notes.push('- `src/carts/esther/player.lua` at commit `1c4122d5`');
notes.push('');
notes.push('Rules used for the frame tables:');
notes.push('- Speeds are in subpixels/frame (`0x0100 = 256 = 1 px/frame`).');
notes.push('- Position update per frame: `pos_subpx += speed_subpx`.');
notes.push('- Pixel movement per frame: `delta_px = floor(pos_subpx/256)_new - floor(pos_subpx/256)_old`.');
notes.push('- Horizontal approach uses `DATA_BFB255` profile divisors:');
notes.push('  - `0=/8`, `1=/16`, `2=/32`, `3=/64`, `4=/128`, `5=/256`, `6=/4`, `7=/2`, `8=/32 + /64`.');
notes.push('- Every case is simulated until `speed_subpx == target_speed_subpx`.');
notes.push('');
notes.push('Generated frame-by-frame output:');
notes.push('- `src/carts/esther/test/dkc_motion_frame_table.csv`');
notes.push('');
notes.push('Case summaries:');
for (let i = 0; i < summaries.length; i += 1) {
	const entry = summaries[i];
	const stats = entry.stats;
	const deltaPairs = [...stats.deltaCounts.entries()]
		.sort((a, b) => Number(a[0]) - Number(b[0]))
		.map(([delta, count]) => `${delta}:${count}`)
		.join(', ');
	notes.push(
		`- \`${entry.caseId}\` profile=${entry.profileId}, start=${entry.startSpeedSubpx}, target=${entry.targetSpeedSubpx}, frames_to_target=${stats.framesToTarget}, final_speed=${stats.finalSpeedSubpx} (${stats.finalSpeedPx} px/f), first_delta1=${stats.firstDelta1}, first_delta2=${stats.firstDelta2}, first_delta3=${stats.firstDelta3}, first_negative_delta=${stats.firstNegative}, delta_counts={${deltaPairs}}`
	);
}

fs.writeFileSync('src/carts/esther/test/dkc_motion_frame_table.csv', `${csvLines.join('\n')}\n`);
fs.writeFileSync('src/carts/esther/test/dkc_motion_notes.md', `${notes.join('\n')}\n`);

console.log(
	`generated rows=${allRows.length} csv=src/carts/esther/test/dkc_motion_frame_table.csv notes=src/carts/esther/test/dkc_motion_notes.md`
);
