import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { HeapServiceNewtStage } from '../../../machine/ts/spec/bmsx/heap_service';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join(process.cwd(), 'tmp', 'bmsx-generated-newt-'));
try {
	const runner = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
		buildDirectory: 'tmp/build-native-newt', parallel: '4',
		configure: ['-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON', '-DBMSX_NATIVE_GATE_PROFILE=ON'],
	});
	for (const optLevel of [0, 3] as const) {
		// Keep the actual table live through O3, not just its folded scalar.
		const image = linkTestSystemBlua32(compileHeapServiceSystem('local t = {120, x = 63}\nreturn t[1] + t.x, t', optLevel));
		const rom = join(directory, `generated-newt-O${optLevel}.rom`);
		const trace = join(directory, 'trace.txt');
		writeFileSync(rom, image.romBytes);
		// K requires an actual AllocateTable exit counter increment and a
		// stopped NEWT frontier with independent firmware work still pending.
		writeFileSync(trace, 'K\nJ 65536 1\nJ 65536 1\nC\n');
		const lines = execFileSync(runner, [rom, trace, join(directory, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n');
		assert.equal(lines.length, 4);
		assert.equal(lines[0], '1');
		const [serviceResult, spent, active, stage] = lines[1].split(' ').map(Number);
		assert.equal(serviceResult, RunResult.Yielded);
		assert.ok(spent > 0);
		assert.equal(active, 0);
		assert.equal(stage, HeapServiceNewtStage.Idle);
		assert.equal(Number(lines[2].split(' ', 1)[0]), RunResult.Halted);
		assert.equal(lines[3], '183');
		console.log(`BIOS-NEWT-NATIVE-GATE:PASS O${optLevel} (one generated allocation exit, ${spent} firmware cycles)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
