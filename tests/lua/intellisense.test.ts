import { editorTextModelService } from '../../ide/editor/model/model_service';
import { readActorMethods } from '../../ide/workbench/contrib/actor_lab/methods';
import { ActorTimelineTransport } from '../../ide/workbench/contrib/actor_lab/timeline';
import type { ActorNode } from '../../ide/workbench/contrib/actor_lab/runtime';
import type { RuntimeGuestCall, RuntimeGuestCallObserver } from '../../ide/runtime/guest_call';
import type { Table } from '../../machine/ts/machine/cpu/table';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CodeEditorContext } from '../../ide/editor/ui/code_editor_state';
import { activeCodeEditor, createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { splitText } from '../../machine/ts/common/text_lines';
import { PieceTreeBuffer } from '../../ide/editor/text/piece_tree_buffer';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, readInstructionWord } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { blua32LocalSlotLiveAtPc } from '../../toolchain/ts/rompack/blua32_symbols';
import { blua32FunctionIndexAtAddress } from '../../toolchain/ts/rompack/blua32_image';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import {
	registerLuaSourceRecord,
	type LuaSourceRecord,
	type LuaSourceRegistry,
} from '../../ide/runtime/source_registry';
import { createRuntimeFaultState, recordLuaError } from '../../ide/runtime/fault_state';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { LuaInterpreter } from '../../ide/language/lua/interpreter/interpreter';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import {
	SYSTEM_RESOURCE_DOMAIN,
	type RuntimeResource,
} from '../../ide/common/resource';
import { RuntimeLuaTooling } from '../../ide/runtime/lua_tooling';
import { readRuntimeLuaValue, readRuntimeLuaModuleExport, readRuntimeLuaModuleCapture, runtimeLuaFunctionSource } from '../../ide/runtime/lua_inspection';
import { buildLuaSemanticWorkspaceSnapshot } from '../../toolchain/ts/lua/semantic/model';
import { SuspendedGuestSession, SuspendedGuestValueKind } from '../../ide/runtime/suspended_guest';
import {
	createBlua32SystemSourceImage,
	type RuntimeSourceState,
} from '../../ide/runtime/sources';
import {
	createTestRuntime,
	createTestRuntimeRomPayload,
	createTestSystemImageRuntimeSourceState,
} from '../helpers/runtime_sources';
import { materializeCpuCompletionValues } from './cpu_test_harness';

const semanticFrontendModulePromise = import('../../toolchain/ts/lua/semantic/frontend');
const semanticDiagnosticsModulePromise = import('../../toolchain/ts/lua/semantic/diagnostics');
const referenceSourcesModulePromise = import('../../ide/editor/contrib/references/sources');
const workspaceModulePromise = import('../../ide/editor/contrib/intellisense/semantic/workspace/index');
const workspaceStateModulePromise = import('../../ide/editor/contrib/intellisense/semantic/workspace/state');
const referenceNavigationModulePromise = import('../../ide/editor/contrib/references/lookup');
const intellisenseEngineModulePromise = import('../../ide/editor/contrib/intellisense/engine');
const editorDiagnosticsModulePromise = import('../../ide/workbench/services/diagnostics/lua');

const EMPTY_ROM_PAYLOAD = createTestRuntimeRomPayload();
const EMPTY_TOOLING_RUNTIME = createTestRuntime(EMPTY_ROM_PAYLOAD);

function createSourceState(files: Record<string, string>, systemRom: Uint8Array): RuntimeSourceState {
	const systemLuaSources: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entrySourcePath: '',
		projectRootPath: '',
		can_boot_from_source: true,
		revision: 0,
	};
	for (const path in files) {
		const source = files[path];
		const modulePath = path.replace(/\.lua$/, '').replace(/\\/g, '/');
		const record: LuaSourceRecord = {
			resid: path,
			type: 'lua',
			src: source,
			base_src: source,
			base_update_timestamp: 0,
			source_path: path,
			normalized_source_path: path,
			module_path: modulePath,
			update_timestamp: 0,
			generated: false,
			program_module: true,
		};
		registerLuaSourceRecord(systemLuaSources, record);
	}
	return createTestSystemImageRuntimeSourceState(systemRom, systemLuaSources);
}

function createIntellisenseBridge(files: Record<string, string> = {}): RuntimeLuaTooling {
	const bridge = new RuntimeLuaTooling(
		createSourceState(files, EMPTY_ROM_PAYLOAD),
		new SuspendedGuestSession(EMPTY_TOOLING_RUNTIME),
	);
	bridge.luaInterpreter = new LuaInterpreter(bridge.luaJsBridge);
	return bridge;
}

function testLuaResource(path: string): RuntimeResource {
	return {
		domain: SYSTEM_RESOURCE_DOMAIN,
		path,
		source: {
			resid: path,
			type: 'lua',
			source_path: path,
			generated: false,
		},
	};
}

function codeContext(resource: RuntimeResource, source: string): CodeEditorContext {
	return {
		model: new EditorTextModel(resource, 'lua', source),
		view: createCodeEditorViewState(),
	};
}

function parseLuaChunk(source: string, path: string) {
	const lexer = new LuaLexer(source, path);
	const tokens = lexer.scanTokens();
	const parser = new LuaParser(tokens, path, source);
	return parser.parseChunk();
}

function createIntellisenseRuntime(source: string, optLevel: 0 | 3 = 0, modules: Record<string, string> = {}) {
	const sourcePath = 'cart.lua';
	const modulePath = 'cart';
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, modulePath), Object.entries(modules).map(([path, text]) => ({
		path, source: text, chunk: parseLuaChunk(text, path),
	})), {
		entrySource: source,
		optLevel,
		programDomain: 'system',
	});
	const image = linkTestSystemBlua32(compiled);
	const runtime = createTestRuntime(image.romBytes);
	const record: LuaSourceRecord = {
		resid: sourcePath,
		type: 'lua',
		src: source,
		base_src: source,
		source_path: sourcePath,
		normalized_source_path: sourcePath,
		module_path: modulePath,
		update_timestamp: 0,
		base_update_timestamp: 0,
		generated: false,
		program_module: true,
	};
	const systemLuaSources: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entrySourcePath: sourcePath,
		projectRootPath: '',
		can_boot_from_source: true,
		revision: 0,
	};
	registerLuaSourceRecord(systemLuaSources, record);
	for (const [path, text] of Object.entries(modules)) registerLuaSourceRecord(systemLuaSources, {
		...record, src: text, base_src: text, resid: `${path}.lua`, source_path: `${path}.lua`, normalized_source_path: `${path}.lua`, module_path: path,
	});
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, systemLuaSources);
	sources.currentBlua32Media = {
		system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports),
		cartridgeSlots: [null, null],
	};
	const bridge = new RuntimeLuaTooling(sources, new SuspendedGuestSession(runtime));
	bridge.luaInterpreter = new LuaInterpreter(bridge.luaJsBridge);
	return {
		bridge,
		image,
		runtime,
		sourcePath,
		analysis: buildLuaSemanticWorkspaceSnapshot([{ path: sourcePath, source }]).getFileData(sourcePath)!,
	};
}

test('live timeline transport coalesces requests, reads guest results and revokes expired requests', () => {
	const { runtime, bridge } = createIntellisenseRuntime(`
target = { position_ms = 0, program = { duration_ms = 1000 } }
component = {}
function component:scrub_time(key, time)
	target.position_ms = time
	target.sample = time * 2
	return target
end
`);
	const cpu = runtime.machine.cpu, guest = bridge.suspendedGuest;
	cpu.reset(); cpu.runUntilDepth(0, 100_000);
	const target = guest.global('target') as Table, component = guest.global('component') as Table;
	const node: ActorNode = { kind: 'timeline', hashId: target.hashId, label: 'test', name: 'test', prefix: '', children: [],
		value: target, receiver: component, component, key: null, active: false, stateKeys: [] };
	const transport = new ActorTimelineTransport();
	let call: RuntimeGuestCall | undefined, observer: RuntimeGuestCallObserver | undefined;
	const applied: number[] = [];
	let checkpointPending = false;
	const update = () => {
		transport.refresh(node, false, guest, true, call === undefined);
		transport.executePending(node, -1, guest, !checkpointPending && call === undefined, (prepare, finished) => {
			assert.equal(call, undefined, 'one admitted evaluation, not an input queue');
			call = prepare(); observer = finished;
		});
	};
	const complete = (success: boolean) => {
		const values = [];
		if (success) {
			const args = call!.args(); applied.push(args[2] as number);
			guest.invalidate(); cpu.beginCompletionClosureInExecutionDomain(call!.domain, call!.closure, args);
			cpu.runUntilDepth(0, 100_000); cpu.readCompletionValues(values);
		}
		call = undefined; observer!(success, values);
	};
	update(); transport.request(100); update();
	transport.request(200); update(); transport.request(300); update();
	complete(true); checkpointPending = true; update();
	assert.equal(transport.slider.enabled, true, 'background checkpoint must not cancel focus or the drag');
	assert.equal(call, undefined, 'execution still waits for the checkpoint');
	checkpointPending = false; update(); complete(true); update();
	assert.deepEqual(applied, [100, 300]);
	assert.equal(transport.positionLabel, '300 MS');
	assert.equal(transport.slider.value, 300);
	assert.equal(guest.readStringMember(target, 'sample'), 600);
	transport.request(400); update(); transport.request(500); complete(false); update();
	assert.equal(call, undefined, 'fault/discard must not continue a queued scrub');
	transport.request(600); update();
	const expired = observer!;
	transport.clear(); call = undefined; update(); transport.request(700); update();
	expired(false); complete(true); update();
	assert.equal(transport.slider.value, 700, 'an expired call cannot clear a newer target session');
	assert.equal(guest.readStringMember(target, 'sample'), 1400);
	let queued: () => RuntimeGuestCall | undefined;
	transport.request(800);
	transport.executePending(node, -1, guest, true, prepare => { queued = prepare; });
	transport.clear();
	assert.equal(queued!(), undefined, 'replacement before CPU admission revokes the queued evaluation');
	update(); transport.request(900);
	transport.executePending(node, -1, guest, true, prepare => { queued = prepare; });
	node.receiver = null;
	assert.equal(queued!(), undefined, 'an IRQ may have removed the selected component before admission');
	node.receiver = component;
	const previousProgram = guest.readStringMember(target, 'program');
	target.setStringKey(cpu.stringPool.find('program')!, component);
	assert.equal(queued!(), undefined, 'program replacement during IRQ return must not apply an old seek');
	target.setStringKey(cpu.stringPool.find('program')!, previousProgram);
});

function runtimeWithPausedCpuLocal(source: string) {
	const harness = createIntellisenseRuntime(source);
	const cpu = harness.runtime.machine.cpu;
	cpu.reset();
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	return {
		...harness,
		fault: createRuntimeFaultState(),
	};
}

function luaRangeToSearchMatch(range: { start: { line: number; column: number }; end: { line: number; column: number } }, lines: readonly string[]): { row: number; start: number; end: number } {
	const rowIndex = range.start.line - 1;
	if (rowIndex < 0 || rowIndex >= lines.length) {
		return null;
	}
	const line = lines[rowIndex] ?? '';
	const startColumn = Math.max(0, range.start.column - 1);
	const endInclusive = Math.max(startColumn, range.end.column - 1);
	const endExclusive = Math.min(line.length, endInclusive + 1);
	const clampedStart = Math.min(startColumn, line.length);
	const clampedEnd = Math.max(clampedStart, endExclusive);
	if (clampedEnd <= clampedStart) {
		return null;
	}
	return { row: rowIndex, start: clampedStart, end: clampedEnd };
}

async function runDiagnostics(source: string) {
	const { buildLuaSemanticFrontend } = await semanticFrontendModulePromise;
	return buildLuaSemanticFrontend([{ path: 'testpath', source }], { builtinDescriptors: [] }).getFile('testpath').diagnostics;
}

// Diagnostic tests remain unchanged

test('flags undefined identifier', async () => {
	const diagnostics = await runDiagnostics('return missing_value');
	assert.equal(diagnostics.length, 1);
	assert.equal(diagnostics[0].message, `'missing_value' is not defined.`);
	assert.equal(diagnostics[0].severity, 'error');
});

test('detects missing arguments for local functions', async () => {
	const diagnostics = await runDiagnostics(`
local function add(a, b)
	return a + b
end
return add(1)
`);
	assert.equal(diagnostics.length, 1);
	assert.match(diagnostics[0].message, /add(?:\(\))? expects 2 arguments/i);
});

test('detects missing arguments for colon-defined methods', async () => {
	const diagnostics = await runDiagnostics(`
local tracker = { total = 0 }
function tracker:add(value)
	self.total = self.total + value
end
tracker:add()
`);
	assert.equal(diagnostics.length, 1);
	assert.match(diagnostics[0].message, /tracker:add/);
});

test('accounts for Lua implicit receivers independently of parameter naming', async () => {
	const diagnostics = await runDiagnostics(`
local tracker = { total = 0 }
function tracker.add(receiver, value)
	receiver.total = receiver.total + value
end
tracker:add(1)
`);
	assert.equal(diagnostics.length, 0);
});

test('requires an explicit receiver when a colon-defined method is called with dot syntax', async () => {
	const diagnostics = await runDiagnostics(`
local tracker = { total = 0 }
function tracker:add(value)
	self.total = self.total + value
end
tracker.add(1)
`);
	assert.equal(diagnostics.length, 1);
	assert.match(diagnostics[0].message, /tracker\.add expects 2 arguments/i);
});

test('detects missing arguments for string-indexed table functions', async () => {
	const diagnostics = await runDiagnostics(`
local api<const> = {
	run = function(first, second) return first + second end,
}
return api['run'](1)
`);
	assert.equal(diagnostics.length, 1);
	assert.match(diagnostics[0].message, /api\.run expects 2 arguments/i);
});

test('allows omitted trailing optional arguments for local functions', async () => {
	const diagnostics = await runDiagnostics(`
local function add(a, b, c)
	if c then
		return a + b + c
	end
	return a + b
end
return add(1, 2)
`);
	assert.equal(diagnostics.length, 0);
});

test('intellisense rejects host-published machine word globals', async () => {
	const { buildLuaSemanticFrontend } = await semanticFrontendModulePromise;
	const { getDefaultLuaBuiltinDescriptors } = await semanticDiagnosticsModulePromise;
	const diagnostics = buildLuaSemanticFrontend(
		[{ path: 'testpath', source: 'return sys_boot_cart, cart_manifest, sys_vdp_stream_base' }],
		{ builtinDescriptors: getDefaultLuaBuiltinDescriptors() },
	).getFile('testpath').diagnostics;
	assert.equal(diagnostics.length, 3);
	assert.equal(diagnostics[0].message, `'sys_boot_cart' is not defined.`);
	assert.equal(diagnostics[1].message, `'cart_manifest' is not defined.`);
	assert.equal(diagnostics[2].message, `'sys_vdp_stream_base' is not defined.`);
});

test('editor diagnostics share one retained project snapshot across open documents', async () => {
	const { computeResourceDiagnostics } = await editorDiagnosticsModulePromise;
	const { getOrCreateSemanticProject, resetSemanticProject } = await workspaceStateModulePromise;
	const readerSource = 'return shared.value';
	const declarationSource = 'shared = { value = 1 }';
	const bridge = createIntellisenseBridge({
		'reader.lua': readerSource,
		'declaration.lua': declarationSource,
	});
	resetSemanticProject(editorTextModelService, SYSTEM_RESOURCE_DOMAIN);
	const contexts = Object.entries({ 'reader.lua': readerSource, 'declaration.lua': declarationSource }).map(([path, source]) =>
		new EditorTextModel({ domain: SYSTEM_RESOURCE_DOMAIN, path, source: { resid: path, type: 'lua' } }, 'lua', source));

	const initial = computeResourceDiagnostics(editorTextModelService, bridge, contexts);
	assert.ok(!initial.some(diagnostic => diagnostic.message.includes("'shared' is not defined")));
	const project = getOrCreateSemanticProject(editorTextModelService, SYSTEM_RESOURCE_DOMAIN);
	const initialSnapshot = project.getSnapshot();

	computeResourceDiagnostics(editorTextModelService, bridge, contexts);
	assert.equal(project.getSnapshot(), initialSnapshot, 'unchanged diagnostic pass retains the program snapshot');

	contexts[1].pushEditOperations([{ offset: 0, deleteLength: contexts[1].buffer.length, text: 'replacement = { value = 1 }' }]);
	const updated = computeResourceDiagnostics(editorTextModelService, bridge, contexts);
	assert.ok(updated.some(diagnostic => diagnostic.message.includes("'shared' is not defined")));
});

test('diagnostics over more than 24 documents parse each generation once, including recovery', async t => {
	const { computeResourceDiagnostics } = await editorDiagnosticsModulePromise;
	const { resetSemanticProject } = await workspaceStateModulePromise;
	const files: Record<string, string> = {};
	const contexts: EditorTextModel[] = [];
	for (let index = 0; index < 40; index++) {
		const path = `document_${index}.lua`;
		const source = `return ${index}`;
		files[path] = source;
		contexts.push(new EditorTextModel({ domain: SYSTEM_RESOURCE_DOMAIN, path, source: { resid: path, type: 'lua' } }, 'lua', source));
	}
	const bridge = createIntellisenseBridge(files);
	const project = resetSemanticProject(editorTextModelService, SYSTEM_RESOURCE_DOMAIN);
	const parse = t.mock.method(LuaParser.prototype, 'parseChunkWithRecovery');
	assert.deepEqual(computeResourceDiagnostics(editorTextModelService, bridge, contexts), []);
	assert.equal(parse.mock.callCount(), contexts.length);
	const old = project.getSnapshot();
	for (let pass = 0; pass < 3; pass++) assert.deepEqual(computeResourceDiagnostics(editorTextModelService, bridge, contexts), []);
	assert.equal(parse.mock.callCount(), contexts.length, 'document lifetime, not cache capacity, determines reuse');
	assert.equal(project.getSnapshot(), old);
	contexts[0].pushEditOperations([{ offset: 0, deleteLength: contexts[0].buffer.length, text: 'local value =' }]);
	const diagnostics = computeResourceDiagnostics(editorTextModelService, bridge, contexts);
	assert.equal(diagnostics.length, 1);
	assert.equal(diagnostics[0].model, contexts[0]);
	assert.equal(parse.mock.callCount(), contexts.length + 1);
	const invalid = project.getFileData(contexts[0].identity.path)!;
	assert.equal(invalid.syntaxError, invalid.chunk.syntaxError);
	assert.equal(invalid.chunk.source, contexts[0].buffer.getText());
	computeResourceDiagnostics(editorTextModelService, bridge, contexts);
	assert.equal(project.getFileData(contexts[0].identity.path)!.chunk, invalid.chunk);
	assert.equal(parse.mock.callCount(), contexts.length + 1, 'incomplete source is retained, not reparsed on each diagnostic read');
	contexts[0].pushEditOperations([{ offset: 0, deleteLength: contexts[0].buffer.length, text: files[contexts[0].identity.path] }]);
	assert.deepEqual(computeResourceDiagnostics(editorTextModelService, bridge, contexts), []);
	assert.equal(parse.mock.callCount(), contexts.length + 2);
	assert.equal(old.getFileData(contexts[0].identity.path)!.chunk.source, contexts[0].buffer.getText());
	assert.equal(old.getFileData(contexts[0].identity.path)!.syntaxError, null);
});

test('static definition lookup preserves one-based source coordinates at an identifier boundary', async () => {
	const { findStaticDefinitionLocation } = await intellisenseEngineModulePromise;
	const { resetSemanticProject } = await workspaceStateModulePromise;
	const source = [
		'local target = 1',
		'return target',
	].join('\n');
	const usageLine = source.split('\n')[1];
	const usageColumn = usageLine.indexOf('target') + 'target'.length;
	resetSemanticProject(editorTextModelService, SYSTEM_RESOURCE_DOMAIN);

	const location = findStaticDefinitionLocation(
		createIntellisenseBridge({ 'main.lua': source }),
		2,
		usageColumn,
		'main.lua',
		codeContext(testLuaResource('other.lua'), ''),
	);

	assert.ok(location);
	assert.equal(location.path, 'main.lua');
	assert.equal(location.range.startLine, 1);
	assert.equal(location.range.startColumn, 7);
});

test('intellisense live locals resolve editor source paths against CPU module paths', async () => {
	const source = [
		'local counter = 42',
		'halt_until_irq',
		'return counter',
	].join('\n');
	const { bridge, fault, runtime, analysis } = runtimeWithPausedCpuLocal(source);
	const counterColumn = source.indexOf('counter') + 1;

	const resolved = readRuntimeLuaValue(
		runtime,
		bridge.sources,
		fault,
		bridge.suspendedGuest,
		analysis,
		SYSTEM_RESOURCE_DOMAIN,
		['counter'],
		1,
		counterColumn,
	);
	assert.ok(resolved);
	assert.equal(resolved.kind, 'value');
	if (resolved.kind !== 'value') {
		return;
	}
	assert.equal(resolved.value, 42);
});

test('inline debugger exposes virtual frames and physical caller locals', async () => {
	const source = [
		'local inspect<const> = function(value)',
		'\tlocal copy<const> = value + 1',
		'\treturn copy',
		'end',
		'local run<const> = function(seed, ...)',
		'\tlocal caller_value = seed',
		'\tlocal result = inspect(caller_value)',
		'\treturn result + seed',
		'end',
		'return run(41)',
	].join('\n');
	const { bridge, image, runtime, analysis } = createIntellisenseRuntime(source, 3);
	const runFunctionIndex = image.symbols.metadata.functionIds.findIndex(id => id.endsWith('/local:run'));
	const runPoints = image.symbols.metadata.statementPointsByFunction[runFunctionIndex];
	const inlinePoint = runPoints.find(point => point.inlineCallSites.length === 1)!;
	const pointAfterInline = runPoints.find(point =>
		point.wordOffset > inlinePoint.wordOffset
		&& point.inlineCallSites.length === 0
	)!;
	const stopPc = image.image.functions[runFunctionIndex].codeAddress
		+ pointAfterInline.wordOffset * INSTRUCTION_BYTES;
	runtime.machine.cpu.setExecutionHook(
		(_executionDomainId, pc) => pc === stopPc,
		SYSTEM_EXECUTION_DOMAIN_MASK,
		0,
	);
	runtime.machine.cpu.reset();
	assert.equal(runtime.machine.cpu.runUntilDepth(0, 100), RunResult.ExecutionStopped);
	const fault = createRuntimeFaultState();
	recordLuaError(fault, bridge.sources, runtime, new Error('inline stop'));
	assert.equal(fault.lastLuaCallStack[0].functionName, 'inspect');
	assert.equal(fault.lastLuaCallStack[0].kind, 'source');
	assert.equal(fault.lastLuaCallStack[0].line, 2);
	assert.equal(fault.lastLuaCallStack[1].functionName, 'run');
	assert.equal(fault.lastLuaCallStack[1].kind, 'source');
	assert.equal(fault.lastLuaCallStack[1].line, 7);

	const callerLine = source.split('\n')[7];
	const resolved = readRuntimeLuaValue(
		runtime,
		bridge.sources,
		fault,
		bridge.suspendedGuest,
		analysis,
		SYSTEM_RESOURCE_DOMAIN,
		['seed'],
		8,
		callerLine.indexOf('seed') + 1,
	);
	assert.ok(resolved);
	assert.equal(resolved.kind, 'value');
	if (resolved.kind === 'value') {
		assert.equal(resolved.value, 41);
	}
});

test('intellisense resolves captured fault upvalues after the CPU stack is replaced', async () => {
	const source = [
		'local captured = { value = 42 }',
		'return function()',
		'\thalt_until_irq',
		'\treturn captured',
		'end',
	].join('\n');
	const { bridge, runtime, analysis } = createIntellisenseRuntime(source);
	const cpu = runtime.machine.cpu;
	cpu.reset();
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(cpu.getFrameDepth(), 0);
	const closure = materializeCpuCompletionValues(cpu)[0] as Closure;
	runtime.callClosure(closure);
	assert.equal(cpu.getFrameDepth(), 1);

	const fault = createRuntimeFaultState();
	recordLuaError(fault, bridge.sources, runtime, new Error('fault snapshot'));
	assert.equal(fault.lastCpuFaultSnapshot.length, 1);
	assert.equal(fault.lastCpuFaultSnapshot[0].upvalues.length, 1);

	cpu.reset();
	assert.equal(cpu.runUntilDepth(0, 100), RunResult.Halted);
	assert.equal(cpu.getFrameDepth(), 0);

	const usageColumn = source.split('\n')[3].indexOf('captured') + 1;
	const resolved = readRuntimeLuaValue(
		runtime,
		bridge.sources,
		fault,
		bridge.suspendedGuest,
		analysis,
		SYSTEM_RESOURCE_DOMAIN,
		['captured', 'value'],
		4,
		usageColumn,
	);
	assert.ok(resolved);
	assert.equal(resolved.kind, 'value');
	if (resolved.kind === 'value') {
		assert.equal(resolved.value, 42);
	}
});

test('intellisense preserves shadowed local bindings during workspace retargeting', async () => {
	const diagnostics = await runDiagnostics(`
local outer<const> = 1
local function read_shadow()
	local outer = 2
	outer = outer + 1
	return outer
end
return read_shadow()
`);
	assert.equal(diagnostics.length, 0);
});

for (const optLevel of [0, 3] as const) {
	for (const closed of [false, true]) test(`module capture inspection reads ${closed ? 'closed' : 'open'} cells without execution at O${optLevel}`, () => {
		const source = `local registry = { value = 17 }
local absent
read_module = function() return registry, absent end
local function factory()
	local registry = { value = 99 }
	return function() return registry end
end
read_shadow = factory()
${closed ? '' : 'halt_until_irq'}
return {}`;
		const { runtime, bridge } = createIntellisenseRuntime("require('captured')\nhalt_until_irq", optLevel, { captured: source });
		const cpu = runtime.machine.cpu, guest = bridge.suspendedGuest;
		cpu.reset();
		assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
		const before = cpu.captureRuntimeState();
		const result = readRuntimeLuaModuleCapture(bridge.sources, guest, SYSTEM_RESOURCE_DOMAIN, 'captured', guest.global('read_module'), 'registry');
		assert.equal(result.kind, 'value');
		if (result.kind !== 'value') throw new Error('actual module capture is required');
		assert.equal(guest.readStringMember(result.value, 'value'), 17);
		assert.deepEqual(readRuntimeLuaModuleCapture(bridge.sources, guest, SYSTEM_RESOURCE_DOMAIN, 'captured', guest.global('read_module'), 'absent'),
			{ kind: 'value', value: null }, 'nil is a captured value, not a missing debug location');
		for (const [domain, path, closure, name] of [
			[SYSTEM_RESOURCE_DOMAIN, 'captured', guest.global('read_shadow'), 'registry'],
			[SYSTEM_RESOURCE_DOMAIN, 'captured', guest.global('read_module'), 'unknown'],
			[0, 'captured', guest.global('read_module'), 'registry'],
			[SYSTEM_RESOURCE_DOMAIN, 'captured', null, 'registry'],
		] as const) assert.deepEqual(readRuntimeLuaModuleCapture(bridge.sources, guest, domain, path, closure, name),
			{ kind: 'unavailable', reason: 'not_in_scope' }, 'a shadowed binding, wrong bus or missing capture is not a module registry');
		assert.deepEqual(cpu.captureRuntimeState(), before, 'readback changes no register, cell, heap or CPU state');
	});

	test(`suspended inspection reads stored key kinds and actual callback source at O${optLevel}`, () => {
		const source = `callback = function() return 7 end
entries = { [1] = 'numeric', ['1'] = 'string', [true] = 'boolean', [callback] = 'function' }
halt_until_irq`;
		const { runtime, bridge } = createIntellisenseRuntime(source, optLevel);
		const cpu = runtime.machine.cpu, guest = bridge.suspendedGuest;
		cpu.reset();
		assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
		const bytes = cpu.luaHeap.usedBytes(), depth = cpu.getFrameDepth(), pc = cpu.readFramePc(depth - 1);
		const callback = guest.global('callback');
		const location = runtimeLuaFunctionSource(bridge.sources, guest, callback)!;
		assert.deepEqual(location.resource, { domain: SYSTEM_RESOURCE_DOMAIN, path: 'cart.lua' });
		assert.deepEqual(location.range.start, { line: 1, column: 12 });
		assert.equal(location.installedSource, source);
		const entries = new Map<SuspendedGuestValueKind, string>();
		guest.visitTableEntries(guest.global('entries'), (key, value) => {
			entries.set(guest.kind(key), guest.formatValue(value));
		});
		assert.deepEqual(entries, new Map([
			[SuspendedGuestValueKind.Number, 'numeric'], [SuspendedGuestValueKind.String, 'string'],
			[SuspendedGuestValueKind.Boolean, 'boolean'], [SuspendedGuestValueKind.Function, 'function'],
		]));
		assert.equal(runtimeLuaFunctionSource(bridge.sources, guest, guest.global('entries')), undefined);
		assert.equal(runtimeLuaFunctionSource(bridge.sources, guest, null), undefined);
		assert.deepEqual(readRuntimeLuaModuleExport(bridge.sources, guest, SYSTEM_RESOURCE_DOMAIN, 'not_loaded'),
			{ kind: 'unavailable', reason: 'not_loaded' });
		assert.deepEqual(readRuntimeLuaModuleExport(bridge.sources, guest, 1, 'not_loaded'),
			{ kind: 'unavailable', reason: 'not_loaded' });
		assert.equal(cpu.luaHeap.usedBytes(), bytes);
		assert.equal(cpu.getFrameDepth(), depth);
		assert.equal(cpu.readFramePc(depth - 1), pc);
	});

	test(`actor method choices follow Lua shadowing without evaluating guest code at O${optLevel}`, () => {
		const source = `require('test_boot')
ancestor = {}
function ancestor:inherited(value) self.value = self.value + value; return self.value end
function ancestor:overridden() return 1 end
function ancestor:masked() return 2 end
local derived = setmetatable({}, { __index = ancestor })
function derived:overridden() return 3 end
subject = setmetatable({ value = 10, masked = false, native = setmetatable }, { __index = derived })
function subject:own() return self.value end
index_calls = 0
dynamic = setmetatable({}, { __index = function() index_calls = index_calls + 1; return ancestor.inherited end })
halt_until_irq`;
		const { runtime, bridge } = createIntellisenseRuntime(source, optLevel, { test_boot: 'setmetatable = __bmsx_setmetatable' });
		const cpu = runtime.machine.cpu, guest = bridge.suspendedGuest;
		cpu.reset();
		cpu.installBootPrimitives();
		assert.equal(cpu.runUntilDepth(0, 100000), RunResult.Halted);
		const subject = guest.global('subject') as Table;
		const bytes = cpu.luaHeap.usedBytes(), depth = cpu.getFrameDepth(), pc = cpu.readFramePc(depth - 1);
		const methods = readActorMethods(bridge.sources, guest, subject);
		assert.deepEqual(methods.map(method => method.label), ['inherited', 'overridden', 'own']);
		assert.equal(methods[1].detail, 'cart.lua:7');
		assert.deepEqual(readActorMethods(bridge.sources, guest, guest.global('dynamic') as Table), []);
		assert.equal(guest.global('index_calls'), 0);
		assert.equal(cpu.luaHeap.usedBytes(), bytes);
		assert.equal(cpu.readFramePc(depth - 1), pc);
		cpu.beginCompletionCall(guest.readStringMember(subject, 'inherited') as Closure, [subject, 5]);
		assert.equal(cpu.runUntilDepth(depth, 1000), RunResult.Halted);
		assert.equal(guest.readStringMember(subject, 'value'), 15, 'the receiver is the instance, not its prototype');
	});

	test(`suspended inspection distinguishes a nil member from an unreadable path at O${optLevel}`, () => {
		const source = 'input_value = {}\nlocal target = input_value\nhalt_until_irq\nreturn target.missing.value';
		const { runtime, bridge, analysis } = createIntellisenseRuntime(source, optLevel);
		runtime.machine.cpu.reset();
		assert.equal(runtime.machine.cpu.runUntilDepth(0, 100), RunResult.Halted);
		const fault = createRuntimeFaultState();
		assert.deepEqual(readRuntimeLuaValue(runtime, bridge.sources, fault, bridge.suspendedGuest,
			analysis, SYSTEM_RESOURCE_DOMAIN, ['target', 'missing'], 4, 8), { kind: 'value', value: null });
		assert.deepEqual(readRuntimeLuaValue(runtime, bridge.sources, fault, bridge.suspendedGuest,
			analysis, SYSTEM_RESOURCE_DOMAIN, ['target', 'missing', 'value'], 4, 8), { kind: 'unavailable', reason: 'not_a_table' });
	});

	test(`suspended inspection consumes final word locations across WIDE instructions at O${optLevel}`, () => {
		const declarations = Array.from({ length: 260 }, (_, index) => `local unused_${index} = 0`);
		const source = ['input_value = 42', ...declarations, 'local target = input_value', 'halt_until_irq', 'return target'].join('\n');
		const { runtime, bridge, analysis, image } = createIntellisenseRuntime(source, optLevel);
		const cpu = runtime.machine.cpu;
		cpu.reset();
		assert.equal(cpu.runUntilDepth(0, 10000), RunResult.Halted);
		const frameIndex = cpu.getFrameDepth() - 1;
		const pc = cpu.readFramePc(frameIndex);
		const layout = image.image;
		const functionIndex = blua32FunctionIndexAtAddress(layout, cpu.readFrameFunctionAddress(frameIndex));
		const codeAddress = layout.functions[functionIndex].codeAddress;
		const slot = image.symbols.metadata.localSlotsByFunction[functionIndex].find(local => local.name === 'target')!;
		assert.equal((readInstructionWord(layout.textBytes, (pc - layout.header.textAddress) / INSTRUCTION_BYTES) >>> 18) & 0x3f, OpCode.WIDE);
		assert.equal(blua32LocalSlotLiveAtPc(slot, codeAddress, pc), true);
		assert.equal(blua32LocalSlotLiveAtPc(slot, codeAddress, pc + INSTRUCTION_BYTES), true, 'prefix and following opcode describe the same live-in value');
		for (const range of slot.liveWordRanges) {
			assert.equal(blua32LocalSlotLiveAtPc(slot, codeAddress, codeAddress + range.start * INSTRUCTION_BYTES), true);
			assert.equal(blua32LocalSlotLiveAtPc(slot, codeAddress, codeAddress + range.end * INSTRUCTION_BYTES), false, 'interval end is exclusive');
		}
		const result = readRuntimeLuaValue(runtime, bridge.sources, createRuntimeFaultState(), bridge.suspendedGuest,
			analysis, SYSTEM_RESOURCE_DOMAIN, ['target'], declarations.length + 4, 8);
		assert.equal(result.kind, 'value');
		if (result.kind === 'value') assert.equal(result.value, 42);
	});

	test(`suspended inspection does not invent a location for a folded local at O${optLevel}`, () => {
		const source = 'local value = 11\nhalt_until_irq\nreturn value';
		const { runtime, bridge, analysis } = createIntellisenseRuntime(source, optLevel);
		runtime.machine.cpu.reset();
		assert.equal(runtime.machine.cpu.runUntilDepth(0, 100), RunResult.Halted);
		const result = readRuntimeLuaValue(runtime, bridge.sources, createRuntimeFaultState(), bridge.suspendedGuest,
			analysis, SYSTEM_RESOURCE_DOMAIN, ['value'], 3, 8);
		if (optLevel === 0) {
			assert.equal(result.kind, 'value');
			if (result.kind === 'value') assert.equal(result.value, 11);
		} else assert.deepEqual(result, { kind: 'unavailable', reason: 'not_in_scope' });
	});

	for (const scenario of [
		{
			name: 'dead location', line: 8, expected: { kind: 'unavailable', reason: 'not_in_scope' },
			source: `local function descend(depth)
	local value = depth * 11
	if depth == 0 then
		halt_until_irq
		return 0
	end
	local nested = descend(depth - 1)
	return value + nested
end
return descend(1)`,
		},
		{
			name: 'pending initialization', line: 8, expected: { kind: 'unavailable', reason: 'not_in_scope' },
			source: `local function descend(depth)
	if depth == 0 then
		halt_until_irq
		return 0
	end
	local value = depth * 11
	local nested = descend(depth - 1)
	return value + nested
end
return descend(1)`,
		},
		{
			name: 'inactive block', line: 5, expected: { kind: 'unavailable', reason: 'not_in_scope' },
			source: `local function descend(depth)
	if depth > 0 then
		local value = depth * 11
		local nested = descend(depth - 1)
		return value + nested
	end
	halt_until_irq
	return 0
end
return descend(1)`,
		},
		{
			name: 'live inner location', line: 8, expected: { kind: 'value', value: 0 },
			source: `local function descend(depth)
	local value = depth * 11
	if depth == 0 then
		halt_until_irq
		return value
	end
	local nested = descend(depth - 1)
	return value + nested
end
return descend(1)`,
		},
	]) {
		test(`suspended inspection keeps the inner recursive invocation with ${scenario.name} at O${optLevel}`, () => {
			const { runtime, bridge, analysis } = createIntellisenseRuntime(scenario.source, optLevel);
			const cpu = runtime.machine.cpu;
			cpu.reset();
			assert.equal(cpu.runUntilDepth(0, 1000), RunResult.Halted);
			const fault = createRuntimeFaultState();
			const column = scenario.source.split('\n')[scenario.line - 1].indexOf('value') + 1;
			assert.deepEqual(readRuntimeLuaValue(runtime, bridge.sources, fault, bridge.suspendedGuest,
				analysis, SYSTEM_RESOURCE_DOMAIN, ['value'], scenario.line, column), scenario.expected);

			recordLuaError(fault, bridge.sources, runtime, new Error('recursive stop'));
			cpu.reset();
			assert.deepEqual(readRuntimeLuaValue(runtime, bridge.sources, fault, bridge.suspendedGuest,
				analysis, SYSTEM_RESOURCE_DOMAIN, ['value'], scenario.line, column), scenario.expected,
				'captured fault frames retain the same invocation after the physical stack is replaced');
		});
	}

	test(`suspended inspection does not replace an inactive local with a same-named global at O${optLevel}`, () => {
		const source = `target = { value = 999 }
local function dormant()
	local target = { value = 17 }
	return target.value
end
halt_until_irq
return dormant
`;
		const { runtime, bridge, analysis } = createIntellisenseRuntime(source, optLevel);
		runtime.machine.cpu.reset();
		assert.equal(runtime.machine.cpu.runUntilDepth(0, 1000), RunResult.Halted);
		const result = readRuntimeLuaValue(runtime, bridge.sources, createRuntimeFaultState(), bridge.suspendedGuest,
			analysis, SYSTEM_RESOURCE_DOMAIN, ['target', 'value'], 4, 9);
		assert.deepEqual(result, { kind: 'unavailable', reason: 'not_in_scope' });
	});

	test(`suspended inspection distinguishes a nil local from interpreter state at O${optLevel}`, () => {
		const source = `input_value = nil
local table = input_value
halt_until_irq
return table
`;
		const { runtime, bridge, analysis } = createIntellisenseRuntime(source, optLevel);
		bridge.luaInterpreter.globalEnvironment.set('table', 99);
		runtime.machine.cpu.reset();
		assert.equal(runtime.machine.cpu.runUntilDepth(0, 1000), RunResult.Halted);
		const result = readRuntimeLuaValue(runtime, bridge.sources, createRuntimeFaultState(), bridge.suspendedGuest,
			analysis, SYSTEM_RESOURCE_DOMAIN, ['table'], 4, 8);
		assert.equal(result.kind, 'value');
		if (result.kind === 'value') assert.equal(result.value, null);
	});

	test(`suspended inspection selects the written local rather than the innermost same name at O${optLevel}`, () => {
		const source = `local value = { number = 11 }
do
	local value = { number = 22 }
	halt_until_irq
	output = value
end
return value
`;
		const { runtime, bridge, analysis } = createIntellisenseRuntime(source, optLevel);
		runtime.machine.cpu.reset();
		assert.equal(runtime.machine.cpu.runUntilDepth(0, 1000), RunResult.Halted);
		const fault = createRuntimeFaultState();
		for (const [line, column, expected] of [[7, 8, 11], [5, 11, 22]]) {
			const result = readRuntimeLuaValue(runtime, bridge.sources, fault, bridge.suspendedGuest,
				analysis, SYSTEM_RESOURCE_DOMAIN, ['value', 'number'], line, column);
			assert.equal(result.kind, 'value');
			if (result.kind === 'value') assert.equal(result.value, expected);
		}
	});

	test(`suspended inspection resolves the method receiver without a global self at O${optLevel}`, () => {
		const source = `self = { value = 999 }
local actor = { value = 42 }
function actor:run()
	halt_until_irq
	return self.value
end
return actor:run()
`;
		const { runtime, bridge, analysis } = createIntellisenseRuntime(source, optLevel);
		runtime.machine.cpu.reset();
		assert.equal(runtime.machine.cpu.runUntilDepth(0, 1000), RunResult.Halted);
		const result = readRuntimeLuaValue(runtime, bridge.sources, createRuntimeFaultState(), bridge.suspendedGuest,
			analysis, SYSTEM_RESOURCE_DOMAIN, ['self', 'value'], 5, 9);
		assert.equal(result.kind, 'value');
		if (result.kind === 'value') assert.equal(result.value, 42);
	});

	test(`suspended inspection does not read a caller local before its initializer returns at O${optLevel}`, () => {
		const source = `local function make()
	halt_until_irq
	return 42
end
local pending = make()
return pending
`;
		const { runtime, bridge, analysis } = createIntellisenseRuntime(source, optLevel);
		runtime.machine.cpu.reset();
		assert.equal(runtime.machine.cpu.runUntilDepth(0, 1000), RunResult.Halted);
		const result = readRuntimeLuaValue(runtime, bridge.sources, createRuntimeFaultState(), bridge.suspendedGuest,
			analysis, SYSTEM_RESOURCE_DOMAIN, ['pending'], 6, 8);
		assert.deepEqual(result, { kind: 'unavailable', reason: 'not_in_scope' });
	});
}

test('suspended inspection borrowers release on invalidation and before an explicit guest call', () => {
	const { runtime, bridge } = createIntellisenseRuntime('callback = function() return 7 end\nhalt_until_irq');
	runtime.machine.cpu.reset();
	assert.equal(runtime.machine.cpu.runUntilDepth(0, 100), RunResult.Halted);
	const guest = bridge.suspendedGuest, events: string[] = [];
	const releaseFirst = guest.onDidInvalidate(() => { events.push('first'); releaseFirst(); });
	const releaseSecond = guest.onDidInvalidate(() => { events.push('second'); releaseSecond(); });
	guest.invalidate(); guest.invalidate();
	assert.deepEqual(events, ['first', 'second']);
	const releaseThird = guest.onDidInvalidate(() => { events.push('call'); releaseThird(); });
	guest.callClosure(guest.global('callback'));
	assert.deepEqual(events, ['first', 'second', 'call']);
});

test('suspended inspection requires installed source correspondence, and regains it after Undo', async () => {
	const source = 'local target = 42\nhalt_until_irq\nreturn target';
	const { runtime, bridge, analysis, sourcePath } = createIntellisenseRuntime(source);
	runtime.machine.cpu.reset();
	assert.equal(runtime.machine.cpu.runUntilDepth(0, 100), RunResult.Halted);
	const fault = createRuntimeFaultState();
	const changed = buildLuaSemanticWorkspaceSnapshot([{ path: sourcePath, source: source.replace('target', 'edited') }]).getFileData(sourcePath)!;
	assert.deepEqual(readRuntimeLuaValue(runtime, bridge.sources, fault, bridge.suspendedGuest,
		changed, SYSTEM_RESOURCE_DOMAIN, ['target'], 3, 8), { kind: 'unavailable', reason: 'source_changed' });
	const result = readRuntimeLuaValue(runtime, bridge.sources, fault, bridge.suspendedGuest, analysis, SYSTEM_RESOURCE_DOMAIN, ['target'], 3, 8);
	assert.equal(result.kind, 'value');
	if (result.kind === 'value') assert.equal(result.value, 42);
	const { inspectLuaRuntimeExpression } = await intellisenseEngineModulePromise;
	assert.equal(inspectLuaRuntimeExpression(bridge, fault, runtime, 'target()', SYSTEM_RESOURCE_DOMAIN, analysis, 3, 8), null,
		'only read-only identifier paths enter runtime inspection');
});

// Semantic workspace behavior tests

test('semantic workspace distinguishes table field and parameter', async () => {
	const { buildLuaSemanticFrontend } = await semanticFrontendModulePromise;
	const source = `
local function create_ball(seed)
	return {
		seed = seed,
	}
end
`;
	const frontend = buildLuaSemanticFrontend([{ path: 'testpath', source }]);
	const lines = splitText(source);
	const targetLine = lines[3];
	const leftZeroBased = targetLine.indexOf('seed');
	const rightZeroBased = targetLine.indexOf('seed', leftZeroBased + 1);
	const leftDefinition = frontend.findSymbolsByPosition('testpath', 4, leftZeroBased + 1)?.targets[0].declaration;
	const rightDefinition = frontend.findSymbolsByPosition('testpath', 4, rightZeroBased + 1)?.targets[0].declaration;
	assert.ok(leftDefinition, 'left seed definition');
	assert.ok(rightDefinition, 'right seed definition');
	assert.equal(leftDefinition!.kind, 'property');
	assert.equal(rightDefinition!.kind, 'parameter');
	assert.equal(frontend.getFile(rightDefinition!.file).locations.range(rightDefinition!.span).start.line, 2);
});

test('semantic workspace resolves table property access', async () => {
	const { buildLuaSemanticFrontend } = await semanticFrontendModulePromise;
	const source = `
local state = {
	count = 0,
}
state.count = state.count + 1
`;
	const frontend = buildLuaSemanticFrontend([{ path: 'testpath', source }]);
	const lines = source.replace(/\r\n/g, '\n').split('\n');
	const assignmentLine = lines[4];
	const firstZeroBased = assignmentLine.indexOf('count');
	const secondZeroBased = assignmentLine.indexOf('count', firstZeroBased + 1);
	const definition = frontend.findSymbolsByPosition('testpath', 5, firstZeroBased + 1)?.targets[0].declaration;
	const definitionAgain = frontend.findSymbolsByPosition('testpath', 5, secondZeroBased + 1)?.targets[0].declaration;
	assert.ok(definition, 'property definition found');
	assert.ok(definitionAgain, 'property definition found for rhs');
	assert.equal(definition!.kind, 'property');
	assert.equal(frontend.getFile(definition!.file).locations.range(definition!.span).start.line, 5,
		'the assignment owns its written definition, not the constructor field');
	assert.equal(frontend.getFile(definitionAgain!.file).locations.range(definitionAgain!.span).start.line, 3);
	assert.deepEqual(frontend.findSymbolsByPosition('testpath', 5, secondZeroBased + 1)!.targets.map(target => target.range.start.line), [3, 5]);
});

test('semantic workspace reports references for locals', async () => {
	const { buildLuaSemanticFrontend } = await semanticFrontendModulePromise;
	const source = [
		'local counter = 0',
		'counter = counter + 1',
		'return counter',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'testpath', source }]);
	const lines = source.split('\n');
	const definitionColumn = lines[0].indexOf('counter') + 1;
	const lookup = frontend.findReferencesByPosition('testpath', 1, definitionColumn);
	assert.ok(lookup, 'definition present');
	const referenceKeys = lookup.references.map(reference => {
		const range = frontend.getFile(reference.file).locations.range(reference.span);
		return `${range.start.line}:${range.start.column}`;
	});
	const secondLine = lines[1];
	const firstValueColumn = secondLine.indexOf('counter') + 1;
	const secondValueColumn = secondLine.indexOf('counter', secondLine.indexOf('counter') + 1) + 1;
	const thirdLineColumn = lines[2].indexOf('counter') + 1;
	const expectedKeys = [
		`${2}:${firstValueColumn}`,
		`${2}:${secondValueColumn}`,
		`${3}:${thirdLineColumn}`,
	];
	assert.deepEqual(referenceKeys, expectedKeys);
});

test('semantic workspace reports references for table fields', async () => {
	const { buildLuaSemanticFrontend } = await semanticFrontendModulePromise;
	const source = [
		'local state = { value = 0 }',
		'state.value = state.value + 1',
		'return state.value',
	].join('\n');
	const frontend = buildLuaSemanticFrontend([{ path: 'testpath', source }]);
	const lines = source.split('\n');
	const definitionColumn = lines[0].indexOf('value') + 1;
	const lookup = frontend.findReferencesByPosition('testpath', 1, definitionColumn);
	assert.ok(lookup);
	const referenceKeys = lookup.references.map(reference => {
		const range = frontend.getFile(reference.file).locations.range(reference.span);
		return `${range.start.line}:${range.start.column}`;
	});
	const secondLine = lines[1];
	const firstValueColumn = secondLine.indexOf('value') + 1;
	const secondValueColumn = secondLine.indexOf('value', secondLine.indexOf('value') + 1) + 1;
	const thirdLineColumn = lines[2].indexOf('value') + 1;
	const expectedKeys = [
		`${2}:${firstValueColumn}`,
		`${2}:${secondValueColumn}`,
		`${3}:${thirdLineColumn}`,
	];
	assert.deepEqual(referenceKeys, expectedKeys);
});

// Workspace-driven reference catalog test

test('project reference catalog resolves globals across paths', async () => {
	const { buildReferenceSources } = await referenceSourcesModulePromise;
	const { LuaSemanticWorkspace, createLuaSemanticFrontendFromSnapshot } = await workspaceModulePromise;
	const usageSource = [
		'function dummy_handler()',
		'\tprint(state, 10)',
		'end',
	].join('\n');
	const globalSource = [
		'state = {',
		'\tvalue = 1',
		'}',
		'print(state.value)',
	].join('\n');
	const parameterSource = [
		'local function handler(self, state, payload)',
		'\tprint(state)',
		'end',
	].join('\n');
	const localSource = [
		'local state = {',
		'\tmode = "local"',
		'}',
		'return state',
	].join('\n');

	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('usage.lua', usageSource);
	workspace.updateFile('global.lua', globalSource);
	workspace.updateFile('parameter.lua', parameterSource);
	workspace.updateFile('local.lua', localSource);

	const usageLines = usageSource.split('\n');
	const stateRow = usageLines.findIndex(line => line.includes('print(state'));
	assert.ok(stateRow >= 0);
	const stateColumn = usageLines[stateRow]!.indexOf('state');
	assert.ok(stateColumn >= 0);

	const snapshot = workspace.getSnapshot();
	const symbolInfo = createLuaSemanticFrontendFromSnapshot(snapshot).findReferencesByPosition('usage.lua', stateRow + 1, stateColumn + 1);
	assert.ok(symbolInfo);
	if (!symbolInfo) {
		return;
	}

	const matches = symbolInfo.references
		.filter(ref => ref.file === 'usage.lua')
		.map(ref => luaRangeToSearchMatch(snapshot.getFileData(ref.file)!.chunk.locations.range(ref.span), usageLines))
		.filter((match): match is { row: number; start: number; end: number } => match !== null);

	const info = {
		matches,
		expression: 'state',
		query: symbolInfo,
		snapshot,
	};

	const catalog = buildReferenceSources(info);

	assert.ok(catalog.some(entry => entry.range.path === 'global.lua'), 'global path included in reference catalog');
	const usageEntries = catalog.filter(entry => entry.range.path === 'usage.lua');
	assert.equal(usageEntries.length, matches.length, 'usage matches retained');
	assert.ok(!catalog.some(entry => entry.range.path === 'parameter.lua'), 'parameter file excluded from references');
	assert.ok(!catalog.some(entry => entry.range.path === 'local.lua'), 'local-scoped variable file excluded from references');
});

test('reference lookup resolves global definition across paths', async () => {
	const { resolveReferenceLookup } = await referenceNavigationModulePromise;
	const { LuaSemanticWorkspace, createLuaSemanticFrontendFromSnapshot } = await workspaceModulePromise;
	const { resetSemanticProject } = await workspaceStateModulePromise;

	const usageSource = [
		'function dummy_handler(self)',
		'\tprint(state, 10, 10, 5)',
		'end',
		'',
		'local function helper(self, state)',
		'\treturn state',
		'end',
	].join('\n');

	const globalSource = [
		'state = {',
		'\tvalue = 42',
		'}',
	].join('\n');

	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('usage.lua', usageSource);
	workspace.updateFile('global.lua', globalSource);

	const usageLines = usageSource.split('\n');
	resetSemanticProject(editorTextModelService, SYSTEM_RESOURCE_DOMAIN);

	const stateRow = usageLines.findIndex(line => line.includes('print(state'));
	assert.ok(stateRow >= 0);
	const stateColumn = usageLines[stateRow]!.indexOf('state');
	assert.ok(stateColumn >= 0);

	const result = resolveReferenceLookup(createIntellisenseBridge({ 'global.lua': globalSource }), {
		buffer: new PieceTreeBuffer(usageSource),
		cursorRow: stateRow,
		cursorColumn: stateColumn,
		identity: { domain: SYSTEM_RESOURCE_DOMAIN, path: 'usage.lua' },
	});

	assert.equal(result.kind, 'success', 'reference lookup succeeded');
	if (result.kind === 'success') {
		assert.ok(result.info.matches.length > 0, 'matches found');
		assert.equal(result.info.expression, 'state');
		const symbolInfo = createLuaSemanticFrontendFromSnapshot(workspace.getSnapshot()).findReferencesByPosition('usage.lua', stateRow + 1, stateColumn + 1);
		assert.ok(symbolInfo);
		if (symbolInfo) {
			assert.deepEqual(
				result.info.query.targets.map(target => target.range),
				symbolInfo.targets.map(target => target.range),
			);
		}
	}
});

test('reference lookup retains all definitions of a value alternative', async () => {
	const { resolveReferenceLookup } = await referenceNavigationModulePromise;
	const { resetSemanticProject } = await workspaceStateModulePromise;
	const source = [
		'local left<const> = {}',
		'function left:run() end',
		'local right<const> = {}',
		'function right:run() end',
		'local selected<const> = left or right',
		'left:run()',
		'right:run()',
		'selected:run()',
	].join('\n');
	const lines = source.split('\n');
	const cursorRow = 7;
	const cursorColumn = lines[cursorRow]!.indexOf('run');
	resetSemanticProject(editorTextModelService, SYSTEM_RESOURCE_DOMAIN);

	const result = resolveReferenceLookup(createIntellisenseBridge(), {
		buffer: new PieceTreeBuffer(source),
		cursorRow,
		cursorColumn,
		identity: { domain: SYSTEM_RESOURCE_DOMAIN, path: 'alternatives.lua' },
	});

	assert.equal(result.kind, 'success');
	if (result.kind === 'success') {
		assert.equal(result.info.expression, 'selected:run');
		assert.deepEqual(
			result.info.query.targets.map(target => target.range.start.line),
			[2, 4],
		);
		assert.deepEqual(result.info.matches.map(match => match.row + 1), [2, 4, 6, 7, 8]);
	}
});

test('reference lookup prefers local parameter over global', async () => {
	const { resolveReferenceLookup } = await referenceNavigationModulePromise;
	const { LuaSemanticWorkspace, createLuaSemanticFrontendFromSnapshot } = await workspaceModulePromise;
	const { resetSemanticProject } = await workspaceStateModulePromise;

	const globalSource = 'state = {}';
	const usageSource = [
		'local function helper(self, state)',
		'\treturn state',
		'end',
		'',
		'print(state)',
	].join('\n');

	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('usage.lua', usageSource);
	workspace.updateFile('global.lua', globalSource);

	const usageLines = usageSource.split('\n');
	resetSemanticProject(editorTextModelService, SYSTEM_RESOURCE_DOMAIN);

	const helperLineIndex = usageLines.findIndex(line => line.includes('helper'));
	assert.ok(helperLineIndex >= 0);
	const parameterColumn = usageLines[helperLineIndex]!.indexOf('state');

	const parameterResult = resolveReferenceLookup(createIntellisenseBridge({ 'global.lua': globalSource }), {
		buffer: new PieceTreeBuffer(usageSource),
		cursorRow: helperLineIndex,
		cursorColumn: parameterColumn,
		identity: { domain: SYSTEM_RESOURCE_DOMAIN, path: 'usage.lua' },
	});

	assert.equal(parameterResult.kind, 'success', 'parameter lookup succeeds');
	if (parameterResult.kind === 'success') {
		const workspaceGlobal = createLuaSemanticFrontendFromSnapshot(workspace.getSnapshot()).findReferencesByPosition('global.lua', 1, 1);
		if (workspaceGlobal) {
			assert.notDeepEqual(
				parameterResult.info.query.targets[0].range,
				workspaceGlobal.targets[0].range,
				'parameter is not resolved as global',
			);
		}
	}
});

test('intellisense recognizes global variable from another file', async () => {
	const { buildLuaSemanticFrontend } = await semanticFrontendModulePromise;
	const frontend = buildLuaSemanticFrontend([
		{ path: 'usage.lua', source: 'function handler() print(state.value) end' },
		{ path: 'global.lua', source: 'state = { value = 1 }' },
	], { builtinDescriptors: [], externalGlobalSymbols: [] });
	assert.ok(!frontend.getFile('usage.lua').diagnostics.some(d => /'state' is not defined/.test(d.message)),
		'workspace global declarations, not UI reference rows, supply name binding');
});


test('context tokens ignore retained comment trivia and resolve declaration names across inline comments', async context => {
	const { resolveContextMenuToken } = await intellisenseEngineModulePromise;
	const { resetSemanticProject } = await workspaceStateModulePromise;
	const source = 'local --[[decoy_name]] actual_name = 7 -- trailing_name\nreturn actual_name';
	const path = 'comment_context.lua';
	const model = new EditorTextModel({ domain: SYSTEM_RESOURCE_DOMAIN, path,
		source: { resid: path, type: 'lua', source_path: path, generated: false } }, 'lua', source);
	resetSemanticProject(editorTextModelService, SYSTEM_RESOURCE_DOMAIN);
	activeCodeEditor.attach(model, createCodeEditorViewState());
	context.after(() => { activeCodeEditor.detach(); model.dispose(); });
	assert.equal(resolveContextMenuToken(0, 0, path)?.text, 'actual_name');
	assert.equal(resolveContextMenuToken(0, source.indexOf('decoy_name') + 1, path), null);
	assert.equal(resolveContextMenuToken(0, source.indexOf('trailing_name') + 1, path), null);
	assert.equal(resolveContextMenuToken(0, source.indexOf('actual_name') + 1, path)?.text, 'actual_name');
});
