#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const sourcePath = path.join(
	workspaceRoot,
	'.external/nemesis-s-bdx/UltimateMechSpaceWar/UltimateMechSpaceWar/Models/Stages/StageFactory.cs',
);
const stageSourcePath = path.join(
	workspaceRoot,
	'.external/nemesis-s-bdx/UltimateMechSpaceWar/UltimateMechSpaceWar/Models/Stages/Stage.cs',
);
const outputPath = path.join(workspaceRoot, 'carts/nemesis_s/res/data/nemesis_s_stage.yaml');
const musicCueBySourceName = {
	StageIntro: {
		event: 'stage.music.intro',
		restartEvent: 'stage.music.restart.intro',
	},
	Stage: {
		event: 'stage.music.main',
		restartEvent: 'stage.music.restart.main',
	},
	Boss: {
		event: 'stage.music.boss',
		restartEvent: 'stage.music.restart.boss',
	},
};

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function extractStage0Rows(sourceText) {
	const start = sourceText.indexOf('public static string[] Stage0Map = {');
	assert(start >= 0, 'Could not find Stage0Map declaration in StageFactory.cs');

	const end = sourceText.indexOf('};', start);
	assert(end >= 0, 'Could not find Stage0Map terminator in StageFactory.cs');

	const body = sourceText.slice(start, end);
	const rows = [];
	for (const match of body.matchAll(/@\"([\s\S]*?)\"\s*,?/g)) {
		rows.push(match[1]);
	}
	assert(rows.length > 0, 'No Stage0Map rows found in StageFactory.cs');

	const width = rows[0].length;
	for (let i = 0; i < rows.length; i += 1) {
		assert(rows[i].length === width, `Stage0Map row ${i + 1} has width ${rows[i].length}; expected ${width}.`);
	}

	return rows;
}

function extractStage0Events(sourceText) {
	const start = sourceText.indexOf('public static StageEvent[] Stage0Events = {');
	assert(start >= 0, 'Could not find Stage0Events declaration in StageFactory.cs');

	const end = sourceText.indexOf('};', start);
	assert(end >= 0, 'Could not find Stage0Events terminator in StageFactory.cs');

	const body = sourceText.slice(start, end);
	const musicCues = [];
	for (const match of body.matchAll(/new ChangeMusicStageEvent\((\d+), SoundContent\.Music\.([A-Za-z0-9_]+)\)/g)) {
		const cue = musicCueBySourceName[match[2]];
		assert(cue !== undefined, `Unsupported Stage0 music cue '${match[2]}'.`);
		musicCues.push({
			column: Number(match[1]),
			event: cue.event,
			restartEvent: cue.restartEvent,
		});
	}

	const scrollStops = [];
	for (const match of body.matchAll(/new StageStopScrollEvent\((\d+)\)/g)) {
		scrollStops.push(Number(match[1]));
	}

	assert(musicCues.length > 0, 'No Stage0 music cues found in StageFactory.cs');
	assert(scrollStops.length > 0, 'No Stage0 scroll stops found in StageFactory.cs');
	return { musicCues, scrollStops };
}

function extractRestartPoints(sourceText) {
	const propertyStart = sourceText.indexOf('public int RestartLocation');
	assert(propertyStart >= 0, 'Could not find Stage.RestartLocation');
	const propertyEnd = sourceText.indexOf('public S.Music MusicBeforeGameOver', propertyStart);
	assert(propertyEnd >= 0, 'Could not find the end of Stage.RestartLocation');
	const body = sourceText.slice(propertyStart, propertyEnd);
	const branches = [...body.matchAll(/(?:if|else if) \(this\.TapeHead (<|<=) (\d+)\)\s*return (\d+);/g)];
	const finalBranch = body.match(/else return (\d+);/);
	assert(branches.length > 0 && finalBranch !== null, 'Could not decode Stage.RestartLocation branches');

	const points = [{ triggerColumn: 0, startColumn: Number(branches[0][3]) }];
	let triggerColumn = Number(branches[0][2]) + (branches[0][1] === '<=' ? 1 : 0);
	for (let index = 1; index < branches.length; index += 1) {
		const branch = branches[index];
		points.push({ triggerColumn, startColumn: Number(branch[3]) });
		triggerColumn = Number(branch[2]) + (branch[1] === '<=' ? 1 : 0);
	}
	points.push({ triggerColumn, startColumn: Number(finalBranch[1]) });
	return points;
}

function toYaml(rows, events, restartPoints) {
	const width = rows[0].length;
	const out = [];

	out.push('source: nemesis-s-bdx StageFactory.Stage0Map');
	out.push('stage_number: 0');
	out.push('tile_size: 8');
	out.push('tile_columns: 32');
	out.push('draw_z: 16');
	out.push(`tile_rows: ${rows.length}`);
	out.push(`tape_length_tiles: ${width}`);
	out.push(`scroll_stop_columns: [${events.scrollStops.join(', ')}]`);
	out.push('music_cues:');
	for (let i = 0; i < events.musicCues.length; i += 1) {
		const cue = events.musicCues[i];
		out.push(`  - { column: ${cue.column}, event: ${cue.event}, restart_event: ${cue.restartEvent} }`);
	}
	out.push('restart_points:');
	for (let i = 0; i < restartPoints.length; i += 1) {
		const point = restartPoints[i];
		out.push(`  - { trigger_column: ${point.triggerColumn}, start_column: ${point.startColumn} }`);
	}
	out.push('map_rows:');

	for (let i = 0; i < rows.length; i += 1) {
		const escaped = rows[i].replace(/\\/g, '\\\\').replace(/"/g, '\\"');
		out.push(`  - "${escaped}"`);
	}

	return `${out.join('\n')}\n`;
}

function main() {
	assert(fs.existsSync(sourcePath), `Source file not found: ${sourcePath}`);
	assert(fs.existsSync(stageSourcePath), `Source file not found: ${stageSourcePath}`);
	const sourceText = fs.readFileSync(sourcePath, 'utf8');
	const stageSourceText = fs.readFileSync(stageSourcePath, 'utf8');
	const rows = extractStage0Rows(sourceText);
	const events = extractStage0Events(sourceText);
	const restartPoints = extractRestartPoints(stageSourceText);
	const yaml = toYaml(rows, events, restartPoints);
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, yaml, 'utf8');
	console.log(`Exported ${rows.length} stage rows to ${outputPath}`);
}

main();
