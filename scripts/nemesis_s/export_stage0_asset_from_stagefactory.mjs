#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = process.cwd();
const sourcePath = path.join(
	workspaceRoot,
	'.external/nemesis-s-bdx/UltimateMechSpaceWar/UltimateMechSpaceWar/Models/Stages/StageFactory.cs',
);
const outputPath = path.join(workspaceRoot, 'src/carts/nemesis_s/res/data/nemesis_s_stage.yaml');

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

function toYaml(rows) {
	const width = rows[0].length;
	const out = [];

	out.push('source: nemesis-s-bdx StageFactory.Stage0Map');
	out.push('stage_number: 0');
	out.push('tile_size: 8');
	out.push('tile_columns: 32');
	out.push('draw_z: 16');
	out.push(`tile_rows: ${rows.length}`);
	out.push(`tape_length_tiles: ${width}`);
	out.push('stop_tape_head: 492');
	out.push('scroll_mode_pause: 1');
	out.push('scroll_mode_forced: 2');
	out.push('scroll_mode_gated: 3');
	out.push('scroll_mode_default: 3');
	out.push('scroll_rotator_initial: 1');
	out.push('map_rows:');

	for (let i = 0; i < rows.length; i += 1) {
		const escaped = rows[i].replace(/\\/g, '\\\\').replace(/"/g, '\\"');
		out.push(`  - "${escaped}"`);
	}

	return `${out.join('\n')}\n`;
}

function main() {
	assert(fs.existsSync(sourcePath), `Source file not found: ${sourcePath}`);
	const sourceText = fs.readFileSync(sourcePath, 'utf8');
	const rows = extractStage0Rows(sourceText);
	const yaml = toYaml(rows);
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, yaml, 'utf8');
	console.log(`Exported ${rows.length} stage rows to ${outputPath}`);
}

main();
