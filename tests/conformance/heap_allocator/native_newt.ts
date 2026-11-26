import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { HeapServiceRecordKind, HeapServiceRecordStage } from '../../../machine/ts/spec/bmsx/heap_service';
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
		writeFileSync(rom, image.romBytes);
		for (const [opcode, name, kind, entry, tail] of [
			['C', 'CLOSURE', HeapServiceRecordKind.CanonicalClosure, HeapServiceRecordStage.Direct, 'J 65536 1\nJ 65536 1\n'],
			['N', 'NEWT', HeapServiceRecordKind.Table, HeapServiceRecordStage.Scheduled, ''],
		] as const) {
			// Each case boots a fresh core. The entry wrapper creates its ROM
			// Closure before the guest function reaches NEWT. K independently
			// proves the named generated exit and its exact parked instruction.
			const trace = join(directory, `trace-O${optLevel}-${name}.txt`);
			writeFileSync(trace, `K ${opcode}\nJ 65536 1\n${tail}J 65536 1\nC\n`);
			const lines = execFileSync(runner, [rom, trace, join(directory, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n');
			assert.equal(lines.length, opcode === 'C' ? 6 : 4);
			assert.deepEqual(lines[0].split(' ').map(Number), [1, entry, kind]);
			const [serviceResult, spent, active, stage] = lines[1].split(' ').map(Number);
			assert.equal(serviceResult, RunResult.Yielded);
			assert.ok(spent > 0);
			assert.equal(active, 0);
			assert.equal(stage, HeapServiceRecordStage.Idle);
			assert.equal(Number(lines[lines.length - 2].split(' ', 1)[0]), RunResult.Halted);
			assert.equal(lines[lines.length - 1], '183');
			console.log(`BIOS-${name}-NATIVE-GATE:PASS O${optLevel} (one generated allocation exit, ${spent} firmware cycles)`);
		}
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
