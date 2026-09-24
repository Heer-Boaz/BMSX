import { RuntimeTaskKind } from '../../hosts/common/runtime_task_queue';
import assert from 'node:assert/strict';
import test from 'node:test';
import { HostPauseReason } from '../../hosts/common/execution_control';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import type { LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { WorkspaceRuntimeTools } from '../../ide/workbench/services/assistant/runtime_tools';
import { decodeRuntimeToolRequest } from '../../ide/workbench/services/assistant/runtime_tool_protocol';
import { compileLuaSource } from './cpu_test_harness';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { createTestRuntime, createTestSystemImageRuntimeSourceState } from '../helpers/runtime_sources';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';

function fixture() {
	const compiled = compileLuaSource(`
probe = { [1] = 'number key', ['1'] = 'string key', [false] = false, nested = { answer = 42 } }
probe.self = probe
probe[probe] = probe.nested
return probe
`, 'inspection', 0);
	const image = linkTestSystemBlua32(compiled);
	const runtime = createTestRuntime(image.romBytes);
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: '', projectRootPath: '', can_boot_from_source: false, revision: 0 };
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, registry);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports), cartridgeSlots: [null, null] };
	runtime.machine.cpu.reset(); runtime.machine.cpu.runUntilDepth(0, 100_000);
	const f = createRuntimeInspectionFixture(runtime, sources);
	f.inspection.pause();
	return f;
}

test('installed global values, typed table keys, aliases and cycles are inspected without evaluating Lua', t => {
	const f = fixture(), cpu = f.runtime.machine.cpu;
	const before = [f.runtime.machine.scheduler.currentNowCycles(), cpu.getFrameDepth(), cpu.luaHeap.usedBytes()];
	const original = f.guest.visitTableEntries.bind(f.guest);
	let visits = 0;
	t.mock.method(f.guest, 'visitTableEntries', (...args: Parameters<typeof original>) => { visits++; original(...args); });
	const inspection = f.inspection.open(); t.after(() => inspection.dispose());
	const scope = inspection.scopes[0]; assert.equal(scope.status, 'available');
	const globals = inspection.read(scope.reference!, 0, scope.count!);
	assert.ok(globals.entries.every(entry => entry.registerFile === 'ordinary' || entry.registerFile === 'system'));
	const probe = globals.entries.find(entry => entry.key.display === 'probe')!.value;
	assert.equal(probe.kind, 'table'); assert.ok(probe.reference);
	const first = inspection.read(probe.reference, 0, 2);
	const remaining = inspection.read(probe.reference, 2, 100);
	assert.equal(visits, 1, 'paging walks stored entries once');
	const entries = [...first.entries, ...remaining.entries];
	assert.equal(entries.length, first.total);
	assert.equal(entries.find(e => e.key.kind === 'number' && e.key.display === '1')!.value.display, 'number key');
	assert.equal(entries.find(e => e.key.kind === 'string' && e.key.display === '1')!.value.display, 'string key');
	assert.deepEqual(entries.find(e => e.key.kind === 'boolean')!.value, { kind: 'boolean', display: 'false' });
	assert.equal(entries.find(e => e.key.display === 'self')!.value.reference, probe.reference);
	const nested = entries.find(e => e.key.display === 'nested')!.value.reference!;
	assert.equal(entries.find(e => e.key.kind === 'table')!.key.reference, probe.reference);
	assert.equal(entries.find(e => e.key.kind === 'table')!.value.reference, nested);
	assert.equal(inspection.read(nested, 0, 1).entries[0].value.display, '42');
	assert.equal(inspection.read(probe.reference, 100, 1).entries.length, 0);
	assert.deepEqual([f.runtime.machine.scheduler.currentNowCycles(), cpu.getFrameDepth(), cpu.luaHeap.usedBytes()], before);
});

for (const reason of ['execution', 'heap-replaced'] as const) test(`${reason} retires every borrowed table, never refreshes an old handle`, () => {
	const f = fixture(), inspection = f.inspection.open(), reference = inspection.scopes[0].reference!;
	const table = inspection.read(reference, 0, 100).entries.find(e => e.key.display === 'probe')!.value.reference!;
	f.guest.invalidate(reason);
	assert.throws(() => inspection.read(table, 0, 1), /expired/);
	const next = f.inspection.open();
	assert.throws(() => next.read(reference, 0, 1), /does not belong/);
	next.dispose();
});

test('tool admission rejects unknown targets/fields, has prompt-local lifetimes and does not resume the machine on disconnect', async () => {
	const f = fixture(), lifetime = new AbortController();
	const tools = new WorkspaceRuntimeTools(f.inspection, f.frameNavigation, f.gameCapture, f.terminal, f.debuggerExecution, f.actorExecution, f.boots, lifetime.signal);
	assert.throws(() => tools.execute('studio_inspect_runtime', { target: 'test-target' }), /not this Studio/);
	assert.throws(() => tools.execute('studio_read_runtime_values', { reference: 'x', start: 0, count: 1 }), /Open a suspended/);
	const target = f.inspection.target;
	const result = await tools.execute('studio_inspect_runtime', { target });
	assert.ok('scopes' in result.data);
	const reference = result.data.scopes[0].reference!;
	tools.execute('studio_read_runtime_values', { reference, start: 0, count: 100 });
	await tools.execute('studio_inspect_runtime', { target });
	assert.throws(() => tools.execute('studio_read_runtime_values', { reference, start: 0, count: 1 }), /does not belong/);
	lifetime.abort();
	assert.throws(() => tools.execute('studio_runtime_status', {}), /disposed/);
	assert.equal(f.execution.userPaused, true);
	assert.throws(() => decodeRuntimeToolRequest('studio_runtime_status', { target }), /declared fields/);
	for (const count of [0, -1, 1.5, '2']) assert.throws(() => decodeRuntimeToolRequest('studio_read_runtime_values', { reference, start: 0, count }));
});

for (const abortRequest of [false, true]) test(`Reboot tool retires queued installation on ${abortRequest ? 'request' : 'prompt'} cancellation`, async t => {
	const f = fixture(), lifetime = new AbortController(), request = new AbortController(), gate = Promise.withResolvers<void>();
	const tools = new WorkspaceRuntimeTools(f.inspection, f.frameNavigation, f.gameCapture, f.terminal, f.debuggerExecution, f.actorExecution, f.boots, lifetime.signal);
	t.after(async () => { gate.resolve(); tools.dispose(); await f.boots.shutdown(); f.presenter.dispose(); });
	const before = f.runtime.machine.scheduler.currentNowCycles(), media = f.sources.currentBlua32Media;
	assert.throws(() => tools.execute('studio_reboot_runtime', { target: 'foreign' }), /authoring target/);
	assert.throws(() => tools.execute('studio_reboot_runtime', { target: f.inspection.target, save: true }), /declared fields/);
	assert.throws(() => tools.execute('studio_reboot_runtime', { target: f.inspection.target }, AbortSignal.abort()), { name: 'AbortError' });
	assert.equal(f.boots.latestOperation, null);
	void f.tasks.schedule(() => gate.promise, assert.ifError);
	const reply = tools.execute('studio_reboot_runtime', { target: f.inspection.target }, request.signal);
	const operation = f.boots.latestOperation!;
	assert.equal(operation.status, 'queued');
	if (abortRequest) request.abort(); else lifetime.abort();
	const result = await reply;
	assert.ok('result' in result.data);
	assert.deepEqual(result.data.result, { status: 'cancelled', reason: 'interrupted', installed: false, reset: false });
	assert.equal(f.boots.latestOperation, operation);
	gate.resolve(); await f.tasks.join();
	assert.equal(f.sources.currentBlua32Media, media); assert.equal(f.runtime.machine.scheduler.currentNowCycles(), before);
	assert.equal(f.execution.userPaused, true);
});

test('inspection distinguishes running, pending step, machine mutation, independent pause and missing symbols', async () => {
	const f = fixture();
	f.execution.requestExecution(true);
	assert.throws(() => f.inspection.open(), /paused, idle/);
	f.execution.setPauseReason(HostPauseReason.Workbench, true);
	f.inspection.pause();
	f.execution.setPauseReason(HostPauseReason.Workbench, false);
	assert.equal(f.inspection.canInspect, true);
	f.execution.requestFrameStep();
	assert.equal(f.inspection.canInspect, false); assert.throws(() => f.inspection.pause(), /active machine operation/);
	f.execution.finishFrameStep();
	const pending = f.tasks.schedule(() => {}, assert.fail);
	assert.equal(f.inspection.canInspect, false); assert.throws(() => f.inspection.pause(), /active machine operation/);
	await pending;
	const image = f.sources.currentBlua32Media.system!;
	f.sources.currentBlua32Media = { system: { ...image, symbols: null }, cartridgeSlots: [null, null] };
	const inspection = f.inspection.open();
	assert.deepEqual(inspection.scopes, [{ domain: -1, status: 'symbols-unavailable' }]);
	inspection.dispose();
});

for (const cancelled of [false, true]) test(`explicit inspection awaits admitted history work without polling, cancelled=${cancelled}`, async () => {
	const f = fixture(), pending = Promise.withResolvers<void>(), lifetime = new AbortController();
	const task = f.tasks.schedule(() => pending.promise, assert.fail, RuntimeTaskKind.History);
	const tools = new WorkspaceRuntimeTools(f.inspection, f.frameNavigation, f.gameCapture, f.terminal, f.debuggerExecution, f.actorExecution, f.boots, lifetime.signal);
	let settled = false;
	const opened = Promise.resolve(tools.execute('studio_inspect_runtime', { target: f.inspection.target }));
	void opened.then(() => { settled = true; }, () => { settled = true; });
	await Promise.resolve(); await Promise.resolve();
	assert.equal(settled, false); assert.equal(f.tasks.ready, false);
	if (cancelled) lifetime.abort();
	pending.resolve(); await task;
	if (cancelled) await assert.rejects(opened, { name: 'AbortError' });
	else { const result = await opened; assert.ok('inspection' in result.data); }
	assert.equal(f.execution.userPaused, true);
	tools.dispose(); f.presenter.dispose();
});

test('disconnect between inspection acquisition and publication releases the new borrow', async t => {
	const f = fixture(), lifetime = new AbortController();
	const tools = new WorkspaceRuntimeTools(f.inspection, f.frameNavigation, f.gameCapture, f.terminal, f.debuggerExecution, f.actorExecution, f.boots, lifetime.signal);
	const open = f.inspection.openAfterTasks.bind(f.inspection);
	let acquired: Awaited<ReturnType<typeof open>>;
	t.mock.method(f.inspection, 'openAfterTasks', async signal => {
		acquired = await open(signal);
		queueMicrotask(() => lifetime.abort());
		return acquired;
	});
	t.after(() => { acquired?.dispose(); tools.dispose(); f.presenter.dispose(); });
	await assert.rejects(Promise.resolve(tools.execute('studio_inspect_runtime', { target: f.inspection.target })), { name: 'AbortError' });
	assert.equal(acquired!.lifetime.isDisposed, true);
});
