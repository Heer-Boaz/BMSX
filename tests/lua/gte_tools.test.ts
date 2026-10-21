import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { IO_GX_GTE_COMMAND } from '../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE, DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { BLUA32_FUNCTION_CODE_ADDRESS_OFFSET } from '../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../machine/ts/spec/blua32/memory_access_kind';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { WorkspaceRuntimeTools } from '../../ide/workbench/services/assistant/runtime_tools';
import { decodeGteToolRequest, STUDIO_GTE_TOOLS } from '../../ide/workbench/services/assistant/gte_tool_protocol';
import { STUDIO_RUNTIME_TOOL_NAMES, STUDIO_TOOL_NAMES } from '../../ide/workbench/services/assistant/tool_catalog';
import { createCartlibProgramHarness } from '../helpers/cartlib_cpu';
import { eventHistoryRuntime } from '../helpers/event_history';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';

const BUDGET = 10_000_000;
const PROGRAM = `
local data<const>: *word = 0x08010244
local control<const>: *word = 0x080102c4
local command<const>: *word = 0x08010344
control[0] = 4096
control[2] = 4096
control[4] = 4096
control[24] = 128 << 16
control[25] = 96 << 16
control[26] = 256
function issue(count)
 for index = 1, count do
  data[0] = index * 16
  data[1] = 512
  *command = 0x00080001
 end
end
return true`;

function fixture(t: TestContext, program = PROGRAM) {
	const { images } = createCartlibProgramHarness(program);
	const { runtime, sources, cpu } = eventHistoryRuntime(images);
	assert.equal(runtime.machine.scheduler.runCpuSlice(0, BUDGET), RunResult.Halted);
	const f = createRuntimeInspectionFixture(runtime, sources), lifetime = new AbortController();
	const tools = new WorkspaceRuntimeTools(f.inspection, f.frameNavigation, f.gameCapture, f.luaEvaluation,
		f.debuggerExecution, f.actorExecution, f.boots, f.hotResumes, f.events, f.gteHistory, lifetime.signal);
	const issue = cpu.getGlobalByKey(cpu.stringPool.find('issue')!) as Closure;
	t.after(() => { lifetime.abort(); f.events.dispose(); f.gteHistory.dispose(); f.presenter.dispose(); });
	return { ...f, tools, lifetime, cpu, issue, target: f.inspection.target };
}

test('GTE tool leases are explicit, idempotent and prompt-local without stopping another observer', async t => {
	const f = fixture(t), { tools, target, gteHistory } = f;
	const status = await tools.execute('studio_gte_history', { target, action: 'status' });
	assert.ok('observing' in status.data);
	assert.equal(status.data.observing, false);
	assert.equal(status.data.observingInContext, false);
	assert.throws(() => tools.execute('studio_gte_history', { target: 'foreign', action: 'start' }), /authoring target/);
	assert.throws(() => tools.execute('studio_gte_history', { target, action: 'start' }, AbortSignal.abort()), { name: 'AbortError' });
	assert.equal(gteHistory.observing, false);
	await tools.execute('studio_gte_history', { target, action: 'start' });
	const generation = gteHistory.generation;
	await tools.execute('studio_gte_history', { target, action: 'start' });
	assert.equal(gteHistory.generation, generation, 'repeated start does not acquire or reset again');
	const secondLifetime = new AbortController();
	const second = new WorkspaceRuntimeTools(f.inspection, f.frameNavigation, f.gameCapture, f.luaEvaluation,
		f.debuggerExecution, f.actorExecution, f.boots, f.hotResumes, f.events, gteHistory, secondLifetime.signal);
	t.after(() => secondLifetime.abort());
	await second.execute('studio_gte_history', { target, action: 'start' });
	assert.equal(gteHistory.generation, generation, 'another context joins the same active session');
	const paneLease = gteHistory.observe();
	await tools.execute('studio_gte_history', { target, action: 'stop' });
	await tools.execute('studio_gte_history', { target, action: 'stop' });
	const stopped = await tools.execute('studio_gte_history', { target, action: 'status' });
	assert.ok('observing' in stopped.data);
	assert.equal(stopped.data.observing, true);
	assert.equal(stopped.data.observingInContext, false);
	secondLifetime.abort();
	assert.equal(gteHistory.observing, true, 'context disposal cannot stop the retained pane lease');
	paneLease.dispose();
	assert.equal(gteHistory.observing, false, 'the final lease restores ordinary command dispatch');
	await tools.execute('studio_gte_history', { target, action: 'start' });
	assert.equal(gteHistory.generation, generation + 1, 'a new observation session invalidates the unobserved gap');
	f.lifetime.abort();
	assert.equal(gteHistory.observing, false);
	tools.dispose();
	assert.throws(() => tools.execute('studio_gte_history', { target, action: 'status' }), /disposed/);
});

test('GTE tools return detached actual raw words and source descriptors without serializing media or executing', async t => {
	const f = fixture(t), { tools, target, cpu, runtime, gteHistory } = f;
	await tools.execute('studio_gte_history', { target, action: 'start' });
	runtime.machine.scheduler.setNowCycles(0x100000000 + 43);
	cpu.beginCompletionCall(f.issue, [3]);
	assert.equal(runtime.machine.scheduler.runCpuSlice(0, BUDGET), RunResult.Halted);
	const request = { target, generation: gteHistory.generation, sequence: gteHistory.firstSequence, count: 2 };
	const beforeCpu = cpu.captureRuntimeState(), beforeCycles = runtime.machine.scheduler.currentNowCycles();
	const page = await tools.execute('studio_read_gte_commands', request);
	assert.ok('commands' in page.data);
	assert.equal(page.data.commands.length, 2);
	const first = page.data.commands[0], captured = gteHistory.snapshot(request.sequence);
	assert.equal(first.sequence, captured.sequence);
	assert.equal(first.commandWord, 0x00080001);
	assert.equal(first.nominalCycles, 15);
	assert.ok(first.cycles > 0x100000000);
	assert.deepEqual(first.beforeData, Array.from(captured.beforeData));
	assert.deepEqual(first.beforeControl, Array.from(captured.beforeControl));
	assert.deepEqual(first.afterData, Array.from(captured.afterData));
	assert.deepEqual(first.afterControl, Array.from(captured.afterControl));
	assert.equal(first.beforeData[0], 16);
	assert.equal(first.afterData[14], 0x00600088);
	assert.equal(first.afterData[15], 0, 'raw alias backing slot is not normalized to port readback');
	assert.equal(first.source!.origin, 'installed');
	assert.equal(first.source!.domain, captured.domain);
	assert.equal(first.source!.pc, captured.pc);
	assert.equal(first.source!.symbols, true);
	assert.ok(first.source!.location!.path.length > 0);
	assert.equal(Object.hasOwn(first, 'image'), false);
	assert.equal(Object.hasOwn(first.source!, 'layout'), false);
	assert.equal(JSON.stringify(first).includes('textBytes'), false);
	assert.deepEqual(cpu.captureRuntimeState(), beforeCpu);
	assert.equal(runtime.machine.scheduler.currentNowCycles(), beforeCycles);
	const end = await tools.execute('studio_read_gte_commands', { ...request, sequence: gteHistory.endSequence, count: Number.MAX_SAFE_INTEGER });
	assert.ok('commands' in end.data);
	assert.deepEqual(end.data.commands, []);
	assert.throws(() => tools.execute('studio_read_gte_commands', { ...request, target: 'foreign' }), /authoring target/);
	assert.throws(() => tools.execute('studio_read_gte_commands', request, AbortSignal.abort()), { name: 'AbortError' });
	assert.throws(() => tools.execute('studio_read_gte_commands', { ...request, sequence: gteHistory.endSequence + 1 }), /beyond/);
	for (let index = 0; index < gteHistory.capacity; index++) runtime.machine.memory.writeMappedU32LE(IO_GX_GTE_COMMAND, 0);
	assert.deepEqual(first.beforeData, Array.from(captured.beforeData), 'wire evidence survives ring slot reuse');
	const hostWrites = await tools.execute('studio_read_gte_commands', { ...request, sequence: gteHistory.firstSequence, count: 1 });
	assert.ok('commands' in hostWrites.data);
	assert.equal(hostWrites.data.commands[0].source, undefined, 'host writes do not inherit the previous CPU source');
	assert.equal(hostWrites.data.commands[0].nominalCycles, 0);
	assert.throws(() => tools.execute('studio_read_gte_commands', request), /expired/);
	assert.throws(() => tools.execute('studio_seek_gte_command', { target, generation: request.generation, sequence: request.sequence }), /expired/);
	await tools.execute('studio_gte_history', { target, action: 'clear' });
	assert.equal(gteHistory.observing, true, 'clear retains the context observation lease');
	assert.throws(() => tools.execute('studio_read_gte_commands', request), /generation changed/);
});

test('GTE commands issued by an actual loaded RAM closure retain instruction identity without installed-source attribution', async t => {
	const f = fixture(t, `ram_issue = assert(load('return function(address, value) return address + value end'))(); return true`);
	const { tools, target, cpu, runtime, gteHistory } = f;
	await tools.execute('studio_gte_history', { target, action: 'start' });
	const chunk = cpu.getGlobalByKey(cpu.stringPool.find('ram_issue')!) as Closure;
	// Firmware load accepts Lua syntax. Its genuine writable RAM closure can also
	// execute raw memory instructions supplied through the central instruction ABI.
	const codeAddress = cpu.memory.readMappedU32LE(chunk.functionAddress + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET);
	const code = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(code, 0, OpCode.STORE_MEM_D, 1, 0, MemoryAccessKind.U32LE);
	writeInstruction(code, 1, OpCode.RET, 0, 0, 0);
	cpu.memory.writeBytes(codeAddress, code);
	cpu.beginCompletionCall(chunk, [IO_GX_GTE_COMMAND, 0x00080001]);
	assert.equal(runtime.machine.scheduler.runCpuSlice(0, BUDGET), RunResult.Halted);
	assert.equal(gteHistory.count, 1);
	const record = gteHistory.at(gteHistory.firstSequence);
	assert.equal(record.domain, 0);
	assert.equal(record.pc, codeAddress);
	assert.ok(record.pc! >= DYNAMIC_RAM_BASE && record.pc! < CART_ROM_BASE);
	assert.equal(record.image, null, 'RAM execution does not borrow the installed cartridge image');
	const reply = await tools.execute('studio_read_gte_commands', { target, generation: gteHistory.generation,
		sequence: record.sequence, count: 1 });
	assert.ok('commands' in reply.data);
	assert.deepEqual(reply.data.commands[0].source, { origin: 'instruction', domain: record.domain, pc: record.pc,
		symbols: false, location: undefined });
	assert.equal(reply.data.commands[0].commandWord, 0x00080001);
});

for (const cancellation of ['request', 'prompt'] as const) test(`GTE navigation retains command identity across ring reuse/clear and ${cancellation} cancellation`, async t => {
	const f = fixture(t), { tools, target, cpu, runtime, gteHistory } = f;
	await tools.execute('studio_gte_history', { target, action: 'start' });
	const physical = runtime.history;
	physical.start({ checkpointCapacity: 2, inputCapacity: 8, checkpointIntervalCycles: 1000000 });
	physical.captureCheckpoint();
	cpu.beginCompletionCall(f.issue, [1]);
	assert.equal(runtime.machine.scheduler.runCpuSlice(0, BUDGET), RunResult.Halted);
	const record = gteHistory.at(gteHistory.firstSequence), cycles = record.cycles, sequence = record.sequence;
	const request = { target, generation: gteHistory.generation, sequence };
	assert.throws(() => tools.execute('studio_seek_gte_command', request), /retained physical recording/);
	runtime.machine.scheduler.advanceTo(BUDGET - cpu.instructionBudgetRemaining);
	physical.recordInputBoundary(true);
	assert.equal(gteHistory.canSeek(record), true);
	assert.throws(() => tools.execute('studio_seek_gte_command', { ...request, target: 'foreign' }), /authoring target/);
	assert.throws(() => tools.execute('studio_seek_gte_command', { ...request, sequence: gteHistory.endSequence }), /beyond/);
	const abort = new AbortController();
	const reply = tools.execute('studio_seek_gte_command', request, abort.signal);
	assert.deepEqual(f.frameNavigation.active!.request, { kind: 'seek', cycles });
	for (let index = 0; index < gteHistory.capacity; index++) runtime.machine.memory.writeMappedU32LE(IO_GX_GTE_COMMAND, 0);
	assert.notEqual(record.sequence, sequence, 'the borrowed ring slot is reused before navigation completes');
	await tools.execute('studio_gte_history', { target, action: 'clear' });
	if (cancellation === 'request') abort.abort(); else f.lifetime.abort();
	f.frameNavigation.afterHostFrame();
	const receipt = await reply;
	assert.ok('requestedCommandCycles' in receipt.data && 'sequence' in receipt.data
		&& 'generation' in receipt.data && 'status' in receipt.data);
	assert.equal(receipt.data.sequence, sequence);
	assert.equal(receipt.data.generation, request.generation);
	assert.equal(receipt.data.requestedCommandCycles, cycles);
	assert.equal(receipt.data.status, 'interrupted');
	assert.equal(f.execution.userPaused, true);
	assert.equal(gteHistory.observing, cancellation === 'request', 'request cancellation does not release the prompt observation lease');
	if (cancellation === 'request') {
		runtime.machine.memory.writeMappedU32LE(IO_GX_GTE_COMMAND, 0);
		const retained = { target, generation: gteHistory.generation, sequence: gteHistory.firstSequence };
		physical.stop();
		physical.start({ checkpointCapacity: 2, inputCapacity: 8, checkpointIntervalCycles: 1000000 });
		physical.captureCheckpoint();
		assert.throws(() => tools.execute('studio_seek_gte_command', retained), /retained physical recording/);
	}
});

test('GTE protocols validate only external arguments and join the shared embedded/MCP catalog', () => {
	for (const tool of STUDIO_GTE_TOOLS) {
		assert.equal(STUDIO_TOOL_NAMES.has(tool.name), true);
		assert.equal(STUDIO_RUNTIME_TOOL_NAMES.has(tool.name), true);
	}
	const request = { target: 'runtime', generation: 0, sequence: 0, count: 1 };
	for (const field of ['generation', 'sequence', 'count']) for (const value of [-1, 0.5, '1', Infinity]) {
		assert.throws(() => decodeGteToolRequest('studio_read_gte_commands', { ...request, [field]: value }));
	}
	assert.throws(() => decodeGteToolRequest('studio_read_gte_commands', { ...request, count: 0 }));
	assert.throws(() => decodeGteToolRequest('studio_gte_history', { target: 'runtime', action: 'resume' }));
	assert.throws(() => decodeGteToolRequest('studio_gte_history', { target: 'runtime', action: 'start', arbitrary: true }));
	const seek = { target: 'runtime', generation: 0, sequence: 0 };
	assert.deepEqual(decodeGteToolRequest('studio_seek_gte_command', seek), { name: 'studio_seek_gte_command', ...seek });
	assert.throws(() => decodeGteToolRequest('studio_seek_gte_command', { ...seek, cycles: 10 }));
	assert.throws(() => decodeGteToolRequest('studio_seek_gte_command', { ...seek, sequence: Number.MAX_SAFE_INTEGER + 1 }));
});
