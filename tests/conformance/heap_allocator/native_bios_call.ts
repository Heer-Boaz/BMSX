import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { CpuSuspendedRunResult } from '../../../machine/ts/machine/runtime/cpu_executor';
import { HeapServiceBiosCallKind } from '../../../machine/ts/spec/bmsx/heap_service';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join(process.cwd(), 'tmp', 'bmsx-generated-heap-gates-'));
try {
	const runner = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
		buildDirectory: 'tmp/build-native-bioscall', parallel: '4',
		configure: ['-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON', '-DBMSX_NATIVE_GATE_PROFILE=ON'],
	});
	for (const optLevel of [0, 3] as const) {
		// Force a hot captureless Closure instruction before the miss.
		// Keep the resulting closure reachable through O3.
		const image = linkTestSystemBlua32(compileHeapServiceSystem(`
local f
for i = 1, 128 do f = function() return 183 end end
return f(), f
`, optLevel));
		const rom = join(directory, `generated-closure-O${optLevel}.rom`);
		writeFileSync(rom, image.romBytes);
		const trace = join(directory, `trace-O${optLevel}-CLOSURE.txt`);
		writeFileSync(trace, `K C\nJ 65536 1\nD 1000000\nC\n`);
		const lines = execFileSync(runner, [rom, trace, join(directory, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n');
		assert.equal(lines.length, 4);
		assert.equal(lines[0], '1');
		const [closureResult, closureSpent, closureActive, closureStage] = lines[1].split(' ').map(Number);
		assert.equal(closureResult, RunResult.Yielded);
		assert.ok(closureSpent > 0);
		assert.equal(closureActive, 0);
		assert.equal(closureStage, 0, 'no Closure destination is pending');
		const [completion, , pending, destination] = lines[2].split(' ').map(Number);
		assert.deepEqual([completion, pending, destination], [CpuSuspendedRunResult.Completed, 0, 0]);
		assert.equal(lines[3], '183');
		console.log(`BIOS-CLOSURE-NATIVE-GATE:PASS O${optLevel} (one generated allocation exit, ${closureSpent} firmware cycles)`);
		const constructor = linkTestSystemBlua32(compileHeapServiceSystem(`
local last
for i = 1, 128 do last = {120, x = 63} end
return last[1] + last.x, last
`, optLevel));
		const constructorRom = join(directory, `generated-table-constructor-O${optLevel}.rom`);
		const constructorTrace = join(directory, `trace-O${optLevel}-Table.txt`);
		writeFileSync(constructorRom, constructor.romBytes);
		writeFileSync(constructorTrace, 'D 1000000\nn\nC\n');
		const constructorLines = execFileSync(runner, [constructorRom, constructorTrace, join(directory, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n');
		const [constructorStatus] = constructorLines[0].split(' ').map(Number);
		assert.equal(constructorStatus, CpuSuspendedRunResult.Completed);
		const [profile, nativeEntries, nativeCycles, , , checkedWrites] = constructorLines[1].split(' ');
		assert.equal(profile, 'native-firmware');
		assert.ok(+nativeEntries > 0 && +nativeCycles > 0 && +checkedWrites > 128,
			`constructor BIOS entered native code with checked writes: ${constructorLines[1]}`);
		assert.equal(constructorLines[2], '183');
		console.log(`BIOS-TABLE-CONSTRUCTOR-NATIVE:PASS O${optLevel} (${nativeEntries} native firmware entries)`);
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
		const growthLines = execFileSync(runner, [growthRom, growthTrace, join(directory, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n');
		assert.equal(growthLines.length, 4);
		const [entries, completionKind, physicalBefore, logicalBefore] = growthLines[0].split(' ').map(Number);
		assert.deepEqual([entries, completionKind], [1, HeapServiceBiosCallKind.Discard]);
		const [serviceResult, spent, active, , physicalAfter, logicalAfter] = growthLines[1].split(' ').map(Number);
		assert.equal(serviceResult, RunResult.Yielded);
		assert.ok(spent > 0);
		assert.equal(active, 0);
		assert.ok(physicalAfter > physicalBefore && logicalAfter > logicalBefore, 'the isolated BIOS grant reserved and charged backing');
		const [overwriteResult, , overwriteActive, , physicalOverwrite, logicalOverwrite] = growthLines[2].split(' ').map(Number);
		assert.deepEqual([overwriteResult, overwriteActive, physicalOverwrite, logicalOverwrite],
			[RunResult.Halted, 0, physicalAfter, logicalAfter], 'the overwrite needs no new backing or service grant');
		assert.equal(growthLines[3], '197');
		console.log(`BIOS-SETFIELD-NATIVE-GATE:PASS O${optLevel} (one generated growth exit, ${spent} firmware cycles, no allocation on overwrite)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
