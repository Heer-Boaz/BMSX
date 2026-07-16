import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildBiosMonitorTimeline } from './bios_monitor_timeline.mjs';

const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bmsx-bios-monitor-'));
const timelinePath = path.join(outputRoot, 'bios_monitor.json');
const screenshotDir = path.join(outputRoot, 'screenshots');
fs.writeFileSync(timelinePath, `${JSON.stringify(buildBiosMonitorTimeline().entries)}\n`);

function run(command, args) {
	const result = spawnSync(command, args, { cwd: process.cwd(), stdio: 'inherit' });
	if (result.status !== 0) {
		console.error(`BIOS monitor artifacts retained at ${outputRoot}`);
		process.exit(result.status || 1);
	}
}

run(process.execPath, [
	'dist/host_headless.debug.js',
	'--machine-runtime', 'dist/libbmsx.debug.js',
	'--system-rom', 'dist/bmsx-bios.debug.rom',
	'--input-timeline', timelinePath,
	'renderhwtest',
]);
run(process.execPath, ['tests/carts/renderhwtest/analyze_bios_monitor.mjs', screenshotDir]);
fs.rmSync(outputRoot, { recursive: true });
