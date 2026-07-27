import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';

const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bmsx-system-print-'));
const timelinePath = path.join(outputRoot, 'timeline.json');
const captureFrame = 48;
const modifiers = { ctrl: false, shift: false, alt: false, meta: false };
fs.writeFileSync(timelinePath, `${JSON.stringify([
	{ frame: 38, description: 'cart frame before BIOS monitor entry', capture: true },
	{
		frame: 40,
		description: 'enter BIOS monitor',
		event: { type: 'button', deviceId: 'keyboard:0', code: 'F2', down: true, value: 1, timestamp: 800, pressId: 1, modifiers },
	},
	{
		frame: 42,
		description: 'release BIOS monitor key',
		event: { type: 'button', deviceId: 'keyboard:0', code: 'F2', down: false, value: 0, timestamp: 840, pressId: 1, modifiers },
	},
	{ frame: captureFrame, description: 'captured print history', capture: true },
])}\n`);

const result = spawnSync(process.execPath, [
	'dist/host_headless_tooling.debug.js',
	'--system-rom', 'dist/bmsx-bios.debug.rom',
	'--input-timeline', timelinePath,
	'system_print_test',
], { cwd: process.cwd(), encoding: 'utf8' });

try {
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /(?:^|\n)CART PRINT(?:\n|$)/);

	const framePath = path.join(outputRoot, 'screenshots', `frame_${String(captureFrame).padStart(5, '0')}.png`);
	const basePath = path.join(outputRoot, 'screenshots', 'frame_00038.png');
	const frame = PNG.sync.read(fs.readFileSync(framePath));
	const base = PNG.sync.read(fs.readFileSync(basePath));
	let printChanges = 0;
	let printTailChanges = 0;
	let exceptionTailChanges = 0;
	for (let y = 6; y < 24; y += 1) {
		for (let x = 0; x < frame.width; x += 1) {
			const offset = (y * frame.width + x) * 4;
			if (frame.data[offset] !== base.data[offset]
				|| frame.data[offset + 1] !== base.data[offset + 1]
				|| frame.data[offset + 2] !== base.data[offset + 2]) {
				if (y < 12) {
					if (x < 80) printChanges += 1;
					else printTailChanges += 1;
				} else if (y >= 18 && x >= 80) {
					exceptionTailChanges += 1;
				}
			}
		}
	}
	assert.ok(printChanges > 0, 'BIOS terminal renders retained cart output on its first output row');
	assert.equal(printTailChanges, 0, 'retained CART PRINT line occupies its first output row');
	assert.ok(exceptionTailChanges > 0, 'monitor exception output follows the retained cart line');
} finally {
	fs.rmSync(outputRoot, { recursive: true });
}
