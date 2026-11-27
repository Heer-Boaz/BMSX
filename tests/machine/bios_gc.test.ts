import assert from 'node:assert/strict';
import { BASE_FIRMWARE_MODULES } from '../helpers/firmware_modules';
import { valueBool, valueFloat } from '../../machine/ts/machine/cpu/value';
import { test } from 'node:test';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { compileTestSystemWithHeap } from '../helpers/heap_service_system';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { parseLuaChunk, materializeCpuCompletionValues } from '../helpers/cpu_test_harness';
import { runCpuWithinBudget } from '../helpers/cpu_execution';

for (const optLevel of [3] as const) for (const backend of [CpuExecutionBackend.Interpreter]) {
	test(`BIOS GC count, capacity, step and full collection use ordinary resident calls (O${optLevel}, backend ${backend})`, () => {
		const entrySource = `require('base')
local gc = collectgarbage
local before = gc('count')
local capacity = gc('capacity')
local function make_weak_owner()
    local keep = {}
    for i = 1, 400 do keep[i] = { i } end
    local weak = setmetatable({}, { __mode = 'v' })
    weak[1] = keep
    return weak
end
local weak = make_weak_owner()
local after = gc('count')
assert(after > before and after < capacity, 'queries report change in logical usage')
local complete = false
for i = 1, 1000 do
  if gc('step') then complete = true break end
end
assert(complete, 'explicit step reaches an epoch boundary')
assert(gc('collect') == 0 and gc() == 0 and gc(nil) == 0, 'all forms return zero after full collection')
assert(weak[1] == nil, 'fresh full collection clears the weak entry')
local ok = pcall(gc, 'stop')
assert(not ok, 'unsupported control is rejected')
-- The public option dispatcher retains its error function.
error = function() return 'not an error' end
assert(gc('capacity') == capacity, 're-reading the capacity does not collect or change the limit')
assert(not pcall(gc, 'unsupported'), 'diagnostics retain their error function')
return true, capacity`;
		const consoleSource = 'return { write = function() end, end_line = function() end }';
		const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), [
			...BASE_FIRMWARE_MODULES.map(({ path, source }) => ({ path, source, chunk: parseLuaChunk(source, path) })),
			{ path: 'tty/console', source: consoleSource, chunk: parseLuaChunk(consoleSource) },
		], { entrySource, optLevel, programDomain: 'system' });
		const linked = linkTestSystemBlua32(compiled);
		const { cpu } = createTestSystemCpu(linked, backend);
		let result = RunResult.Yielded;
		// BIOS allocation and collection now consume the guest grants. Keep
		// the bounded 2048-cycle pulse size for both build variants.
		for (let i = 0; i < 4096 && result === RunResult.Yielded; ++i) result = runCpuWithinBudget(cpu, 2048);
		assert.equal(result, RunResult.Halted, `fault ${cpu.readLuaFaultReasonWord()}, EPC ${cpu.readEpcWord()}`);
		assert.equal(cpu.readExceptionReturnFrameDepth(), -1, `fault ${cpu.readLuaFaultReasonWord()}, EPC ${cpu.readEpcWord()}, phase ${cpu.gc.phase()}`);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true), valueFloat(cpu.luaHeap.capacity() / 1024)]);
		assert.equal(cpu.gc.fullEpochs(), 0);
	});
}
