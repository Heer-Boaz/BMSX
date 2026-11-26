import assert from 'node:assert/strict';
import { BASE_FIRMWARE_MODULES } from '../helpers/firmware_modules';
import { valueBool, valueFloat } from '../../machine/ts/machine/cpu/value';
import { test } from 'node:test';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GcDiagnostics } from '../../machine/ts/machine/cpu/gc_diagnostics';
import { compileTestSystemWithHeap } from '../helpers/heap_service_system';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { parseLuaChunk, materializeCpuCompletionValues } from '../helpers/cpu_test_harness';
import { runCpuWithinBudget } from '../helpers/cpu_execution';

for (const optLevel of [3] as const) for (const backend of [CpuExecutionBackend.Interpreter]) {
	test(`BIOS GC count, capacity, step and full collection use the real primitive (O${optLevel}, backend ${backend})`, () => {
		const entrySource = `require('base')
local gc = collectgarbage
local before = gc('count')
local capacity = gc('capacity')
local keep = {}
for i = 1, 400 do keep[i] = { i } end
local after = gc('count')
assert(after > before and after < capacity)
local weak = setmetatable({}, { __mode = 'v' })
weak[1] = keep
keep = nil
local complete = false
for i = 1, 1000 do
  if gc('step') then complete = true break end
end
assert(complete)
assert(gc('collect') == 0 and gc() == 0 and gc(nil) == 0)
local ok = pcall(gc, 'stop')
assert(not ok)
-- The service retains its collection/error primitives after installation.
__bmsx_collect_garbage = function() error('replaced') end
error = function() return 'not an error' end
assert(gc('capacity') == capacity)
assert(not pcall(gc, 'unsupported'))
return true, capacity`;
		const consoleSource = 'return { write = function() end, end_line = function() end }';
		const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), [
			...BASE_FIRMWARE_MODULES.map(({ path, source }) => ({ path, source, chunk: parseLuaChunk(source, path) })),
			{ path: 'tty/console', source: consoleSource, chunk: parseLuaChunk(consoleSource) },
		], { entrySource, optLevel, programDomain: 'system' });
		const { cpu } = createTestSystemCpu(linkTestSystemBlua32(compiled), backend);
		cpu.installBootPrimitives();
		const profile = cpu.gc.diagnostics = new GcDiagnostics();
		let result = RunResult.Yielded;
		// BIOS allocation and collection now consume the guest grants. This
		// workload uses about 2.20M cycles; keep the 2048-cycle pulse size.
		for (let i = 0; i < 1200 && result === RunResult.Yielded; ++i) result = runCpuWithinBudget(cpu, 2048);
		assert.equal(result, RunResult.Halted, `fault ${cpu.readLuaFaultReasonWord()}, EPC ${cpu.readEpcWord()}`);
		assert.equal(cpu.readExceptionReturnFrameDepth(), -1, `fault ${cpu.readLuaFaultReasonWord()}, EPC ${cpu.readEpcWord()}, phase ${cpu.gc.phase()}`);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true), valueFloat(cpu.luaHeap.capacity() / 1024)]);
		assert.equal(profile.fullCollections, 3);
		assert.ok(profile.steps > profile.collections);
	});
}
