import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { CpuSuspendedRunResult } from '../../../machine/ts/machine/runtime/cpu_executor';
import { HeapServiceTableGrowthStage } from '../../../machine/ts/spec/bmsx/heap_service';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join(process.cwd(), 'tmp', 'bmsx-generated-bioscall-'));
try {
	const runner = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
		buildDirectory: 'tmp/build-native-bioscall', parallel: '4',
		configure: ['-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON', '-DBMSX_NATIVE_GATE_PROFILE=ON'],
	});
	for (const optLevel of [0, 3] as const) {
		// Force a hot constructor without requiring cold boot to precompile
		// a particular address. Keep the last table live through O3.
		const image = linkTestSystemBlua32(compileHeapServiceSystem(`
local t
for i = 1, 128 do t = {120, x = 63} end
return t[1] + t.x, t
`, optLevel));
		const rom = join(directory, `generated-bioscall-O${optLevel}.rom`);
		writeFileSync(rom, image.romBytes);
		for (const [opcode, name] of [
			['C', 'CLOSURE'],
			['B', 'BIOSCALL'],
		] as const) {
			// Each case boots a fresh core. The entry wrapper creates its ROM
			// Closure before the guest function reaches BIOSCALL. K independently
			// proves the named generated exit and its exact parked instruction.
			const trace = join(directory, `trace-O${optLevel}-${name}.txt`);
			writeFileSync(trace, `K ${opcode}\nJ 65536 1\nD 1000000\nC\n`);
			const lines = execFileSync(runner, [rom, trace, join(directory, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n');
			assert.equal(lines.length, 4);
			assert.equal(lines[0], '1');
			const [serviceResult, spent, active, stage] = lines[1].split(' ').map(Number);
			assert.equal(serviceResult, RunResult.Yielded);
			assert.ok(spent > 0);
			assert.equal(active, 0);
			assert.equal(stage, 0, 'no Closure destination is pending');
			const [completion, , pending, destination] = lines[2].split(' ').map(Number);
			assert.deepEqual([completion, pending, destination], [CpuSuspendedRunResult.Completed, 0, 0]);
			assert.equal(lines[3], '183');
			console.log(`BIOS-${name}-NATIVE-GATE:PASS O${optLevel} (one generated allocation exit, ${spent} firmware cycles)`);
		}
		// Warm one ordinary SETFIELD PC with overwrites before making the
		// same instruction insert into an empty Table.
		const growth = linkTestSystemBlua32(compileHeapServiceSystem(`
native_growth_fixture = { grow = 1 }
local empty<const> = {}
for i = 1, 129 do
 if i == 129 then native_growth_fixture = empty end
 native_growth_fixture.grow = 183
end
local first = native_growth_fixture.grow
native_growth_fixture.grow = 14
return first + native_growth_fixture.grow, native_growth_fixture
`, optLevel));
		const growthRom = join(directory, `generated-setfield-O${optLevel}.rom`);
		const growthTrace = join(directory, `trace-O${optLevel}-SETFIELD.txt`);
		writeFileSync(growthRom, growth.romBytes);
		writeFileSync(growthTrace, 'K F\nJ 65536 1\nJ 65536 1\nC\n');
		const lines = execFileSync(runner, [growthRom, growthTrace, join(directory, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n');
		assert.equal(lines.length, 4);
		const [entries, stage, immediate, physicalBefore, logicalBefore] = lines[0].split(' ').map(Number);
		assert.deepEqual([entries, stage, immediate], [1, HeapServiceTableGrowthStage.Scheduled, 1]);
		const [serviceResult, spent, active, , physicalAfter, logicalAfter] = lines[1].split(' ').map(Number);
		assert.equal(serviceResult, RunResult.Yielded);
		assert.ok(spent > 0);
		assert.equal(active, 0);
		assert.ok(physicalAfter > physicalBefore && logicalAfter > logicalBefore, 'the isolated BIOS grant reserved and charged backing');
		const [overwriteResult, , overwriteActive, , physicalOverwrite, logicalOverwrite] = lines[2].split(' ').map(Number);
		assert.deepEqual([overwriteResult, overwriteActive, physicalOverwrite, logicalOverwrite],
			[RunResult.Halted, 0, physicalAfter, logicalAfter], 'the overwrite needs no new backing or service grant');
		assert.equal(lines[3], '197');
		console.log(`BIOS-SETFIELD-NATIVE-GATE:PASS O${optLevel} (one generated growth exit, ${spent} firmware cycles, no allocation on overwrite)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
