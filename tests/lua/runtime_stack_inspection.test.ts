import assert from 'node:assert/strict';
import test from 'node:test';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import { registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { recordLuaError } from '../../ide/runtime/fault_state';
import { WorkspaceRuntimeTools } from '../../ide/workbench/services/assistant/runtime_tools';
import { decodeRuntimeToolRequest } from '../../ide/workbench/services/assistant/runtime_tool_protocol';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { compileLuaSource } from './cpu_test_harness';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { createTestRuntime, createTestSystemImageRuntimeSourceState } from '../helpers/runtime_sources';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';
import { StaticDeclarationKind } from '../../toolchain/ts/lua/compiler/declaration_kind';

function fixture(source: string, optLevel: 0 | 3, breakpoint?: number) {
	const compiled = compileLuaSource(source, 'stack_probe', optLevel), image = linkTestSystemBlua32(compiled);
	const runtime = createTestRuntime(image.romBytes);
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: 'stack_probe.lua', projectRootPath: '', can_boot_from_source: true, revision: 0 };
	registerLuaSourceRecord(registry, { resid: 'stack_probe.lua', type: 'lua', src: source, base_src: source,
		source_path: 'stack_probe.lua', normalized_source_path: 'stack_probe.lua', module_path: 'stack_probe',
		update_timestamp: 0, base_update_timestamp: 0, generated: false, program_module: true });
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, registry);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports), cartridgeSlots: [null, null] };
	const f = createRuntimeInspectionFixture(runtime, sources);
	if (breakpoint !== undefined) {
		f.debuggerState.breakpoints.set({ domain: -1, path: 'stack_probe.lua' }, [breakpoint]);
	}
	runtime.machine.cpu.reset();
	assert.equal(runtime.machine.cpu.runUntilDepth(0, 100_000), breakpoint === undefined ? RunResult.Halted : RunResult.ExecutionStopped);
	f.inspection.pause();
	return f;
}

for (const level of [0, 3] as const) test(`O${level}: ordinary and conversation scopes share real static addresses and non-value types`, async t => {
	const source = `bss buffer: word
bss published: word
struct shape
 field: word
end
local run = function(seed, ...)
 data buffer: word = 17
 local inspect<const> = function(value)
  bss seed: word
  rodata frozen: word = 23
  local published = value + 1
  return published + mem[buffer] + mem[frozen] + mem[seed]
 end
 return inspect(seed)
end
return run(7)`;
	const f = fixture(source, level, 12), cpu = f.runtime.machine.cpu;
	const before = [cpu.luaHeap.usedBytes(), cpu.getFrameDepth(), f.runtime.machine.scheduler.currentNowCycles()];
	const registers = cpu.activeThread.frames.map(frame => t.mock.method(frame.registers, 'get'));
	const globals = t.mock.method(f.guest, 'global');
	const inspection = f.inspection.open(); t.after(() => inspection.dispose());
	const frame = inspection.readStack(0, 100).frames.find(frame => frame.functionName === 'inspect')!;
	assert.equal(frame.inlineDepth, level === 3 ? 1 : 0);
	const statics = inspection.frameScopes(frame.reference).scopes.find(scope => scope.kind === 'statics')!;
	const entries = inspection.read(statics.reference!, 0, 100).entries;
	assert.deepEqual(entries.map(entry => entry.key.display).sort(), ['buffer', 'frozen', 'seed', 'shape']);
	assert.ok(entries.every(entry => entry.isConst === true));
	assert.deepEqual(entries.find(entry => entry.key.display === 'shape')!.value, { kind: 'type', display: '<struct shape>' });
	const declarations = f.sources.currentBlua32Media.system!.symbols!.metadata.staticScopes.declarations;
	for (const [name, line] of [['buffer', 7], ['seed', 9], ['frozen', 10]] as const) {
		const entry = entries.find(entry => entry.key.display === name)!;
		const declaration = declarations.find(declaration => declaration.definition.start.line === line)!;
		assert.ok(declaration.kind !== StaticDeclarationKind.Type);
		assert.equal(entry.definition!.start.line, line);
		assert.ok(entry.value.kind === 'address');
		assert.equal(entry.value.address, declaration.address);
		assert.match(entry.value.display, /^0x[0-9a-f]{8}$/);
		assert.equal(Number(entry.value.display), declaration.address, 'display preserves every address bit');
	}
	const lifetime = new AbortController();
	const tools = new WorkspaceRuntimeTools(f.inspection, f.frameNavigation, f.gameCapture, f.terminal, f.debuggerExecution, f.actorExecution, lifetime.signal);
	t.after(() => tools.dispose());
	const opened = await tools.execute('studio_inspect_runtime', { target: f.inspection.target });
	assert.ok('inspection' in opened.data);
	const stack = await tools.execute('studio_read_runtime_stack', { inspection: opened.data.inspection, start: 0, count: 100 });
	assert.ok('frames' in stack.data);
	const selected = stack.data.frames.find(frame => frame.functionName === 'inspect')!;
	const scopes = await tools.execute('studio_read_frame_scopes', { frame: selected.reference });
	assert.ok('frame' in scopes.data);
	const scope = scopes.data.scopes.find(scope => scope.kind === 'statics')!;
	const result = await tools.execute('studio_read_runtime_values', { reference: scope.reference, start: 0, count: 100 });
	assert.ok('entries' in result.data);
	assert.deepEqual(result.data.entries, entries);
	assert.ok(registers.every(read => read.mock.callCount() === 0));
	assert.equal(globals.mock.callCount(), 0, 'static declarations never read same-name runtime globals');
	assert.deepEqual([cpu.luaHeap.usedBytes(), cpu.getFrameDepth(), f.runtime.machine.scheduler.currentNowCycles()], before);
	f.guest.invalidate('heap-replaced');
	assert.throws(() => inspection.read(statics.reference!, 0, 1), /expired/);
	assert.throws(() => tools.execute('studio_read_runtime_values', { reference: scope.reference, start: 0, count: 1 }), /expired|current suspended/);
});

for (const level of [0, 3] as const) test(`O${level}: scopes distinguish recursive frames, live locals and shared upvalues without execution`, t => {
	const f = fixture(`local shared = { answer = 42 }
local function descend(depth)
	local value = depth * 11
	if depth == 0 then
		halt_until_irq
		return shared, value
	end
	local nested = descend(depth - 1)
	return shared, value, nested
end
return descend(2)`, level);
	const cpu = f.runtime.machine.cpu;
	const before = [cpu.getFrameDepth(), cpu.luaHeap.usedBytes(), f.runtime.machine.scheduler.currentNowCycles()];
	const reads = cpu.activeThread.frames.map(frame => t.mock.method(frame.registers, 'get'));
	const inspection = f.inspection.open(); t.after(() => inspection.dispose());
	const first = inspection.readStack(0, 1), rest = inspection.readStack(1, 100);
	assert.equal(first.origin, 'current-cpu'); assert.equal(first.source, 'installed');
	const frames = [...first.frames, ...rest.frames];
	assert.equal(frames.length, first.total);
	assert.equal(inspection.readStack(first.total, 1).frames.length, 0);
	assert.ok(reads.every(read => read.mock.callCount() === 0), 'stack metadata does not read registers');
	const recursive = frames.filter(frame => frame.functionName === 'descend');
	assert.equal(recursive.length, 3);
	assert.equal(new Set(recursive.map(frame => frame.reference)).size, 3);
	const shared: string[] = [];
	for (let index = 0; index < recursive.length; index++) {
		const frame = recursive[index], scopes = inspection.frameScopes(frame.reference).scopes;
		assert.equal(inspection.frameScopes(frame.reference).scopes, scopes, 'scope metadata and references are cached');
		const locals = scopes.find(scope => scope.kind === 'locals')!;
		const values = inspection.read(locals.reference!, 0, locals.count!);
		assert.equal(values.entries.find(entry => entry.key.display === 'value')!.value.display, String(index * 11));
		assert.ok(!values.entries.some(entry => entry.key.display === 'nested'), 'an unfinished initializer has not introduced its binding');
		const upvalues = scopes.find(scope => scope.kind === 'upvalues')!;
		shared.push(inspection.read(upvalues.reference!, 0, upvalues.count!).entries.find(entry => entry.key.display === 'shared')!.value.reference!);
	}
	assert.equal(new Set(shared).size, 1, 'all captures share the same actual table reference');
	assert.equal(inspection.read(shared[0], 0, 100).entries[0].value.display, '42');
	assert.deepEqual([cpu.getFrameDepth(), cpu.luaHeap.usedBytes(), f.runtime.machine.scheduler.currentNowCycles()], before);
});

for (const level of [0, 3] as const) test(`O${level}: lexical scopes retain shadowed declarations without reading dead/folded locations`, t => {
	const f = fixture(`local value = { number = 11 }
local folded = 17
do
	local value = { number = 22 }
	halt_until_irq
	result = value
end
return value, folded`, level);
	const inspection = f.inspection.open(); t.after(() => inspection.dispose());
	const frame = inspection.readStack(0, 1).frames[0];
	const scope = inspection.frameScopes(frame.reference).scopes[0];
	const reads = t.mock.method(f.runtime.machine.cpu.activeThread.frames[frame.physicalFrameIndex].registers, 'get');
	const values = inspection.read(scope.reference!, 0, scope.count!);
	const shadowed = values.entries.filter(entry => entry.key.display === 'value');
	assert.equal(shadowed.length, 2);
	assert.deepEqual(shadowed.map(entry => entry.definition!.start.line), [1, 4]);
	assert.deepEqual(shadowed.map(entry => inspection.read(entry.value.reference!, 0, 1).entries[0].value.display), ['11', '22']);
	const folded = values.entries.find(entry => entry.key.display === 'folded')!.value;
	assert.equal(folded.kind, level === 0 ? 'number' : 'unavailable');
	assert.equal(reads.mock.callCount(), values.entries.filter(entry => entry.value.kind !== 'unavailable').length,
		'unavailable bindings never read a stale register');
});

test('inline frames keep remapped local scope ownership separate from their physical caller', t => {
	const f = fixture(`local inspect<const> = function(value)
	local copy = value + 1
	return copy
end
local run<const> = function(seed, ...)
	local caller_value = seed
	local result = inspect(caller_value)
	return result + seed
end
return run(41)`, 3, 2);
	const inspection = f.inspection.open(); t.after(() => inspection.dispose());
	assert.equal(inspection.state.stop!.reason, 'breakpoint');
	const frames = inspection.readStack(0, 100).frames;
	const callee = frames.find(frame => frame.functionName === 'inspect')!;
	const caller = frames.find(frame => frame.functionName === 'run')!;
	assert.equal(callee.inlineDepth, 1); assert.equal(caller.inlineDepth, 0);
	assert.equal(callee.physicalFrameIndex, caller.physicalFrameIndex);
	assert.notEqual(callee.reference, caller.reference);
	const calleeScopes = inspection.frameScopes(callee.reference).scopes;
	assert.equal(calleeScopes[1].status, 'available');
	assert.equal(calleeScopes[1].count, 1);
	const recursive = inspection.read(calleeScopes[1].reference!, 0, 1).entries[0];
	assert.equal(recursive.key.display, 'inspect');
	assert.equal(recursive.value.kind, 'unavailable');
	const calleeLocals = inspection.read(calleeScopes[0].reference!, 0, 100).entries;
	assert.ok(calleeLocals.every(entry => entry.key.display === 'value' || entry.key.display === 'copy'));
	const callerLocals = inspection.read(inspection.frameScopes(caller.reference).scopes[0].reference!, 0, 100).entries;
	assert.equal(callerLocals.find(entry => entry.key.display === 'seed')!.value.display, '41');
	assert.ok(!callerLocals.some(entry => entry.key.display === 'copy' || entry.key.display === 'value'));
});

test('nil and false locals are real values, not missing bindings', t => {
	const f = fixture('local run = function(a, b)\n halt_until_irq\n return a, b\nend\nreturn run(nil, false)', 0);
	const inspection = f.inspection.open(); t.after(() => inspection.dispose());
	const frame = inspection.readStack(0, 1).frames[0];
	const values = inspection.read(inspection.frameScopes(frame.reference).scopes[0].reference!, 0, 100).entries;
	assert.deepEqual(values.find(entry => entry.key.display === 'a')!.value, { kind: 'nil', display: 'nil' });
	assert.deepEqual(values.find(entry => entry.key.display === 'b')!.value, { kind: 'boolean', display: 'false' });
});

for (const level of [0, 3] as const) test(`O${level}: installed declarations distinguish const bindings, folded locations and mutable table fields`, t => {
	const f = fixture(`local captured<const> = { answer = 42 }
local function run(parameter)
	local value<const> = { answer = 11 }
	local folded = 17
	do
		local value = { answer = 22 }
		halt_until_irq
		result = value
	end
	return value, folded, captured, parameter
end
return run(false)`, level);
	// Editing the declaration cannot alter the installed scope's meaning.
	f.sources.systemLuaSources.records[0].src = f.sources.systemLuaSources.records[0].src.replaceAll('<const>', '');
	const cpu = f.runtime.machine.cpu;
	const before = [cpu.luaHeap.usedBytes(), f.runtime.machine.scheduler.currentNowCycles()];
	const inspection = f.inspection.open(); t.after(() => inspection.dispose());
	const frame = inspection.readStack(0, 100).frames.find(frame => frame.functionName === 'run')!;
	const scopes = inspection.frameScopes(frame.reference).scopes;
	const reads = t.mock.method(cpu.activeThread.frames[frame.physicalFrameIndex].registers, 'get');
	const locals = inspection.read(scopes[0].reference!, 0, 100).entries;
	const shadowed = locals.filter(entry => entry.key.display === 'value');
	assert.deepEqual(shadowed.map(entry => entry.isConst), [true, false]);
	assert.deepEqual(shadowed.map(entry => entry.definition!.start.line), [3, 6]);
	const folded = locals.find(entry => entry.key.display === 'folded')!;
	assert.equal(folded.isConst, false, 'constant propagation is not a const declaration');
	assert.equal(folded.value.kind, level === 0 ? 'number' : 'unavailable');
	assert.equal(locals.find(entry => entry.key.display === 'parameter')!.isConst, false);
	assert.equal(reads.mock.callCount(), locals.filter(entry => entry.value.kind !== 'unavailable').length);
	const capture = inspection.read(scopes[1].reference!, 0, 100).entries.find(entry => entry.key.display === 'captured')!;
	assert.equal(capture.isConst, true);
	const field = inspection.read(capture.value.reference!, 0, 1).entries[0];
	assert.equal(field.value.display, '42');
	assert.equal(Object.hasOwn(field, 'isConst'), false, 'fields do not inherit declaration attributes');
	assert.deepEqual([cpu.luaHeap.usedBytes(), f.runtime.machine.scheduler.currentNowCycles()], before);
});

test('inlining preserves declaration constness at the remapped local location', t => {
	const f = fixture(`local inspect<const> = function(value)
	local copy<const> = value + 1
	return copy + value
end
local run<const> = function(seed, ...)
	local result = inspect(seed)
	return result + seed
end
return run(41)`, 3, 3);
	const inspection = f.inspection.open(); t.after(() => inspection.dispose());
	const frame = inspection.readStack(0, 100).frames.find(frame => frame.functionName === 'inspect')!;
	assert.equal(frame.inlineDepth, 1);
	const scope = inspection.frameScopes(frame.reference).scopes[0];
	const locals = inspection.read(scope.reference!, 0, 100).entries;
	assert.equal(locals.find(entry => entry.key.display === 'value')!.isConst, false);
	assert.equal(locals.find(entry => entry.key.display === 'copy')!.isConst, true);
	assert.equal(locals.find(entry => entry.key.display === 'copy')!.value.display, '42');
});

for (const level of [0, 3] as const) test(`O${level}: an in-flight assignment never exposes its call target as the local value`, t => {
	const f = fixture(`local function park()
	halt_until_irq
	return 99
end
local run = function(seed, ...)
	local x = seed
	x = park()
	return x
end
return run(42)`, level);
	const inspection = f.inspection.open(); t.after(() => inspection.dispose());
	const frame = inspection.readStack(0, 100).frames.find(frame => frame.functionName === 'run')!;
	const scope = inspection.frameScopes(frame.reference).scopes[0];
	const value = inspection.read(scope.reference!, 0, 100).entries.find(entry => entry.key.display === 'x')!.value;
	assert.ok(value.kind === 'unavailable' || value.kind === 'number', JSON.stringify(value));
	if (value.kind === 'number') assert.equal(value.display, '42');
});

test('installed symbols own stack/scopes despite source edits; fault diagnostics do not substitute the captured fault stack', t => {
	const f = fixture('local x = 42\nhalt_until_irq\nreturn x', 0);
	f.sources.systemLuaSources.records[0].src = '-- a dirty first line\nlocal x = 99\nhalt_until_irq\nreturn x';
	recordLuaError(f.fault, f.sources, f.runtime, new Error('retained diagnostic'));
	const captured = f.fault.lastCpuFaultSnapshot;
	f.runtime.machine.cpu.reset();
	const inspection = f.inspection.open(); t.after(() => inspection.dispose());
	assert.equal(inspection.state.fault!.message, 'retained diagnostic');
	const frame = inspection.readStack(0, 1).frames[0];
	assert.notEqual(frame.pc, captured[captured.length - 1].tracePc, 'stack is the current CPU, not the retained diagnostic');
	assert.equal(inspection.readStack(0, 1).source, 'installed');
});

test('missing symbols are explicit and execution invalidates frame, scope and value handles together', t => {
	const f = fixture('local x = {}\nhalt_until_irq\nreturn x', 0);
	let inspection = f.inspection.open();
	const frame = inspection.readStack(0, 1).frames[0];
	const scopes = inspection.frameScopes(frame.reference).scopes;
	const table = inspection.read(scopes[0].reference!, 0, 100).entries[0].value.reference!;
	f.guest.invalidate();
	assert.throws(() => inspection.readStack(0, 1), /expired/);
	assert.throws(() => inspection.frameScopes(frame.reference), /expired/);
	assert.throws(() => inspection.read(scopes[0].reference!, 0, 1), /expired/);
	assert.throws(() => inspection.read(table, 0, 1), /expired/);
	const image = f.sources.currentBlua32Media.system!;
	f.sources.currentBlua32Media = { system: { ...image, symbols: null }, cartridgeSlots: [null, null] };
	inspection = f.inspection.open(); t.after(() => inspection.dispose());
	assert.throws(() => inspection.frameScopes(frame.reference), /does not belong/);
	const unlabelled = inspection.readStack(0, 1).frames[0];
	assert.equal(unlabelled.kind, 'instruction');
	assert.deepEqual(inspection.frameScopes(unlabelled.reference).scopes, [
		{ kind: 'locals', status: 'symbols-unavailable' }, { kind: 'upvalues', status: 'symbols-unavailable' },
		{ kind: 'statics', status: 'symbols-unavailable' },
	]);
});

test('tool stack/frame handles are prompt-local and external paging arguments are decoded only at the tool boundary', async t => {
	const f = fixture('local x = 42\nhalt_until_irq\nreturn x', 0);
	const lifetime = new AbortController(), tools = new WorkspaceRuntimeTools(f.inspection, f.frameNavigation, f.gameCapture, f.terminal, f.debuggerExecution, f.actorExecution, lifetime.signal);
	t.after(() => tools.dispose());
	const opened = await tools.execute('studio_inspect_runtime', { target: f.inspection.target });
	assert.ok('inspection' in opened.data);
	const inspectionId = opened.data.inspection;
	const stack = await tools.execute('studio_read_runtime_stack', { inspection: inspectionId, start: 0, count: 1 });
	assert.ok('frames' in stack.data);
	const frame = stack.data.frames[0].reference;
	const scopes = await tools.execute('studio_read_frame_scopes', { frame }); assert.ok('frame' in scopes.data);
	assert.equal(scopes.data.frame, frame);
	assert.throws(() => tools.execute('studio_read_runtime_stack', { inspection: 'another-inspection', start: 0, count: 1 }), /current suspended/);
	for (const count of [0, -1, 1.5, '2']) assert.throws(() => decodeRuntimeToolRequest('studio_read_runtime_stack', { inspection: inspectionId, start: 0, count }));
	assert.throws(() => decodeRuntimeToolRequest('studio_read_frame_scopes', { frame: 1 }));
	assert.throws(() => decodeRuntimeToolRequest('studio_read_frame_scopes', { frame, extra: true }));
	await tools.execute('studio_inspect_runtime', { target: f.inspection.target });
	assert.throws(() => tools.execute('studio_read_frame_scopes', { frame }), /does not belong/);
	lifetime.abort();
	assert.throws(() => tools.execute('studio_read_frame_scopes', { frame }), /disposed/);
});

for (const level of [0, 3] as const) test(`O${level}: capture scopes follow register and closure locations through nested inlining`, t => {
	const f = fixture(`local closed<const> = { answer = 42 }
local run = function(seed, ...)
	local register = seed
	local outer<const> = function(value)
		local middle_value<const> = value + seed
		local inner<const> = function(bonus)
			register = register + bonus
			return register + closed.answer + middle_value
		end
		return inner(value)
	end
	local result = outer(2)
	return result + outer(3)
end
return run(40)`, level, 8);
	const cpu = f.runtime.machine.cpu;
	const before = [cpu.luaHeap.usedBytes(), cpu.getFrameDepth(), f.runtime.machine.scheduler.currentNowCycles()];
	const registers = cpu.activeThread.frames.map(frame => t.mock.method(frame.registers, 'get'));
	const inspection = f.inspection.open(); t.after(() => inspection.dispose());
	const frames = inspection.readStack(0, 100).frames;
	const inner = frames.find(frame => frame.functionName === 'inner')!;
	const outer = frames.find(frame => frame.functionName === 'outer')!;
	assert.equal(inner.inlineDepth, level === 0 ? 0 : 2);
	assert.equal(outer.inlineDepth, level === 0 ? 0 : 1);
	const scopes = inspection.frameScopes(inner.reference).scopes;
	assert.ok(registers.every(read => read.mock.callCount() === 0), 'listing metadata does not read guest locations');
	const captures = inspection.read(scopes[1].reference!, 0, 100).entries;
	assert.deepEqual(captures.map(entry => entry.key.display), ['inner', 'middle_value', 'value', 'outer', 'register', 'seed', 'closed']);
	const live = ['register', 'closed', 'middle_value'].map(name => captures.find(entry => entry.key.display === name)!);
	assert.deepEqual(live.map(entry => entry.isConst), [false, true, true]);
	assert.equal(live[0].value.display, '42');
	assert.equal(inspection.read(live[1].value.reference!, 0, 10).entries[0].value.display, '42');
	assert.equal(live[2].value.display, '42');
	assert.deepEqual(live.map(entry => entry.definition!.start.line), [3, 1, 5]);
	for (const name of ['inner', 'value', 'outer', 'seed']) {
		assert.deepEqual(captures.find(entry => entry.key.display === name)!.value,
			{ kind: 'unavailable', reason: 'no-live-location', display: '<no live location>' });
	}
	const outerCaptures = inspection.read(inspection.frameScopes(outer.reference).scopes[1].reference!, 0, 100).entries;
	assert.ok(!outerCaptures.some(entry => entry.key.display === 'middle_value'), 'inner bindings never leak into their caller');
	assert.deepEqual([cpu.luaHeap.usedBytes(), cpu.getFrameDepth(), f.runtime.machine.scheduler.currentNowCycles()], before);
});

test('eliminated captures stay explicitly unavailable instead of using a same-name global or reading a stale cell', t => {
	const f = fixture(`identity = 999
local identity<const> = function(value) return value end
local retained = 42
local outer<const> = function()
	local answer = identity(2)
	halt_until_irq
	return retained + answer
end
return outer()`, 3);
	const cpu = f.runtime.machine.cpu;
	const inspection = f.inspection.open(); t.after(() => inspection.dispose());
	const frame = inspection.readStack(0, 100).frames.find(frame => frame.functionName === 'outer')!;
	const physical = cpu.activeThread.frames[frame.physicalFrameIndex];
	const reads = t.mock.method(physical.registers, 'get');
	const captures = inspection.read(inspection.frameScopes(frame.reference).scopes[1].reference!, 0, 100).entries;
	const identity = captures.find(entry => entry.key.display === 'identity')!;
	assert.equal(identity.isConst, true);
	assert.equal(identity.definition!.start.line, 2);
	assert.deepEqual(identity.value, { kind: 'unavailable', reason: 'no-live-location', display: '<no live location>' });
	assert.equal(captures.find(entry => entry.key.display === 'retained')!.value.display, '42');
	assert.equal(reads.mock.callCount(), 0, 'eliminated captures do not read the selected frame registers');
	assert.equal(physical.closure.upvalues.length, 1, 'debugging does not keep the eliminated closure cell alive');
});

test('conversation frame scopes expose an inlined capture through the same stopped inspection owner', async t => {
	const f = fixture(`local captured<const> = { answer = 42 }
local run = function(seed, ...)
	local inspect<const> = function(value)
		return captured.answer + value
	end
	return inspect(seed)
end
return run(1)`, 3, 4);
	const lifetime = new AbortController();
	const tools = new WorkspaceRuntimeTools(f.inspection, f.frameNavigation, f.gameCapture, f.terminal, f.debuggerExecution, f.actorExecution, lifetime.signal);
	t.after(() => tools.dispose());
	const before = [f.runtime.machine.cpu.luaHeap.usedBytes(), f.runtime.machine.scheduler.currentNowCycles()];
	const opened = await tools.execute('studio_inspect_runtime', { target: f.inspection.target });
	assert.ok('inspection' in opened.data);
	const stack = await tools.execute('studio_read_runtime_stack', { inspection: opened.data.inspection, start: 0, count: 100 });
	assert.ok('frames' in stack.data);
	const frame = stack.data.frames.find(frame => frame.functionName === 'inspect')!;
	assert.equal(frame.inlineDepth, 1);
	const scopes = await tools.execute('studio_read_frame_scopes', { frame: frame.reference });
	assert.ok('frame' in scopes.data);
	const scope = scopes.data.scopes.find(scope => scope.kind === 'upvalues')!;
	assert.equal(scope.status, 'available');
	const captures = await tools.execute('studio_read_runtime_values', { reference: scope.reference, start: 0, count: 100 });
	assert.ok('entries' in captures.data && 'inspection' in captures.data);
	assert.deepEqual(captures.data.entries.map(entry => entry.key.display), ['inspect', 'seed', 'captured']);
	const capture = captures.data.entries[2];
	assert.ok(captures.data.entries.slice(0, 2).every(entry => entry.value.kind === 'unavailable'));
	assert.equal(capture.key.display, 'captured');
	assert.equal(capture.isConst, true);
	assert.equal(capture.value.kind, 'table');
	const fields = await tools.execute('studio_read_runtime_values', { reference: capture.value.reference, start: 0, count: 100 });
	assert.ok('entries' in fields.data);
	assert.equal(fields.data.entries[0].value.display, '42');
	assert.deepEqual([f.runtime.machine.cpu.luaHeap.usedBytes(), f.runtime.machine.scheduler.currentNowCycles()], before);
});

test('manual frame contexts retain only installed source identity and expire across real stop generations', t => {
	const f = fixture('local x = 42\nreturn x', 0, 2), source = f.debuggerState.source, cpu = f.runtime.machine.cpu;
	t.after(() => f.presenter.dispose());
	const inspection = f.inspection.open();
	const frame = inspection.readStack(0, 1).frames[0], context = f.terminal.frameContext(frame);
	assert.deepEqual(Object.keys(context).sort(), ['frame', 'kind', 'stopId'], 'manual selection must not root an old guest heap or tooling image');
	assert.equal(f.terminal.contextAvailable(context), true);
	const stop = source.suspendStopForCall();
	assert.equal(f.terminal.contextAvailable(context), false);
	source.returnToStop(stop);
	assert.equal(f.terminal.contextAvailable(context), true, 'return to the same source stop retains the selection');
	f.sources.currentBlua32Media = { ...f.sources.currentBlua32Media };
	assert.equal(f.terminal.contextAvailable(context), false, 'a source installation expires selection even before breakpoint rebinding');
	assert.throws(() => f.terminal.frameContext(frame), /current debugger stop/);
	source.install(f.sources.currentBlua32Media, f.debuggerState.breakpoints.bindings.pcs);
	assert.equal(source.stop, undefined);
	assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.ExecutionStopped);
	assert.notEqual(source.stop!.id, context.stopId);
	const next = f.terminal.frameContext(frame);
	source.reset();
	assert.equal(f.terminal.contextAvailable(next), false);
	assert.equal(cpu.runUntilDepth(0, 100_000), RunResult.ExecutionStopped);
	assert.notEqual(source.stop!.id, next.stopId, 'reset cannot recycle source-stop identities');
	inspection.dispose();
});
