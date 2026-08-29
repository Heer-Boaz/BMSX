import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CodeTabContext } from '../../ide/workbench/ui/code_tab/model';
import { splitText } from '../../machine/ts/common/text_lines';
import { PieceTreeBuffer } from '../../ide/editor/text/piece_tree_buffer';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { SYSTEM_EXECUTION_DOMAIN_MASK } from '../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
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
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
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
const editorDiagnosticsModulePromise = import('../../ide/workbench/contrib/code_editor/diagnostics/analysis');

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
			module_path: modulePath,
			update_timestamp: 0,
			generated: false,
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

function codeContext(resource: RuntimeResource, source: string): CodeTabContext {
	return {
		id: resource.source.resid,
		title: resource.path,
		resource,
		mode: 'lua',
		buffer: new PieceTreeBuffer(source),
		cursorRow: 0,
		cursorColumn: 0,
		scrollRow: 0,
		scrollColumn: 0,
		selectionAnchor: null,
		lastSavedSource: source,
		saveGeneration: 0,
		appliedGeneration: 0,
		undoStack: [],
		redoStack: [],
		lastHistoryKey: '',
		lastHistoryTimestamp: 0,
		savePointDepth: 0,
		dirty: false,
		runtimeErrorOverlay: null,
		executionStopRow: null,
		runtimeSyncState: 'synced',
		runtimeSyncMessage: '',
		textVersion: 1,
	};
}

function parseLuaChunk(source: string, path: string) {
	const lexer = new LuaLexer(source, path);
	const tokens = lexer.scanTokens();
	const parser = new LuaParser(tokens, path, source);
	return parser.parseChunk();
}

function createIntellisenseRuntime(source: string, optLevel: 0 | 3 = 0) {
	const sourcePath = 'cart.lua';
	const modulePath = 'cart';
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, modulePath), [], {
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
		module_path: modulePath,
		update_timestamp: 0,
		base_update_timestamp: 0,
		generated: false,
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
	};
}

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
	const { computeAggregatedEditorDiagnostics } = await editorDiagnosticsModulePromise;
	const { getOrCreateSemanticProject, resetSemanticProject } = await workspaceStateModulePromise;
	const readerSource = 'return shared.value';
	const declarationSource = 'shared = { value = 1 }';
	const bridge = createIntellisenseBridge({
		'reader.lua': readerSource,
		'declaration.lua': declarationSource,
	});
	resetSemanticProject(SYSTEM_RESOURCE_DOMAIN);
	const contexts = [
		{
			id: 'reader',
			domain: SYSTEM_RESOURCE_DOMAIN,
			path: 'reader.lua',
			source: readerSource,
			version: 1,
		},
		{
			id: 'declaration',
			domain: SYSTEM_RESOURCE_DOMAIN,
			path: 'declaration.lua',
			source: declarationSource,
			version: 1,
		},
	];

	const initial = computeAggregatedEditorDiagnostics(bridge, contexts);
	assert.ok(!initial.some(diagnostic => diagnostic.message.includes("'shared' is not defined")));
	const project = getOrCreateSemanticProject(SYSTEM_RESOURCE_DOMAIN);
	const initialSnapshot = project.getSnapshot();

	computeAggregatedEditorDiagnostics(bridge, contexts);
	assert.equal(project.getSnapshot(), initialSnapshot, 'unchanged diagnostic pass retains the program snapshot');

	contexts[1] = {
		...contexts[1],
		source: 'replacement = { value = 1 }',
		version: 2,
	};
	const updated = computeAggregatedEditorDiagnostics(bridge, contexts);
	assert.ok(updated.some(diagnostic => diagnostic.message.includes("'shared' is not defined")));
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
	resetSemanticProject(SYSTEM_RESOURCE_DOMAIN);

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
	const { resolveLuaChainValue, resolveLuaDefinitionMetadata } = await intellisenseEngineModulePromise;
	const source = [
		'local counter = 42',
		'halt_until_irq',
		'return counter',
	].join('\n');
	const { bridge, fault, runtime, sourcePath } = runtimeWithPausedCpuLocal(source);
	const counterColumn = source.indexOf('counter') + 1;

	const resolved = resolveLuaChainValue(
		bridge,
		fault,
		runtime,
		['counter'],
		SYSTEM_RESOURCE_DOMAIN,
		sourcePath,
		1,
		counterColumn,
	);
	assert.ok(resolved);
	assert.equal(resolved.kind, 'value');
	if (resolved.kind !== 'value') {
		return;
	}
	assert.equal(resolved.value, 42);

	const definition = resolveLuaDefinitionMetadata(bridge, resolved.definitionRange);
	assert.ok(definition);
	assert.equal(definition.path, sourcePath);
	assert.equal(definition.range.startLine, 1);
	assert.equal(definition.range.startColumn, counterColumn);
});

test('inline debugger exposes virtual frames and physical caller locals', async () => {
	const { resolveLuaChainValue } = await intellisenseEngineModulePromise;
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
	const { bridge, image, runtime, sourcePath } = createIntellisenseRuntime(source, 3);
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
	const resolved = resolveLuaChainValue(
		bridge,
		fault,
		runtime,
		['seed'],
		SYSTEM_RESOURCE_DOMAIN,
		sourcePath,
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
	const { resolveLuaChainValue } = await intellisenseEngineModulePromise;
	const source = [
		'local captured = { value = 42 }',
		'return function()',
		'\thalt_until_irq',
		'\treturn captured',
		'end',
	].join('\n');
	const { bridge, runtime, sourcePath } = createIntellisenseRuntime(source);
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
	const resolved = resolveLuaChainValue(
		bridge,
		fault,
		runtime,
		['captured', 'value'],
		SYSTEM_RESOURCE_DOMAIN,
		sourcePath,
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
	assert.equal(rightDefinition!.range.start.line, 2);
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
	assert.equal(definition!.range.start.line, 3);
	assert.equal(definitionAgain!.range.start.line, definition!.range.start.line);
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
	const referenceKeys = lookup.references.map(reference => `${reference.range.start.line}:${reference.range.start.column}`);
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
	const referenceKeys = lookup.references.map(reference => `${reference.range.start.line}:${reference.range.start.column}`);
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
	const { buildReferenceCatalog } = await referenceSourcesModulePromise;
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
		.map(ref => luaRangeToSearchMatch(ref.range, usageLines))
		.filter((match): match is { row: number; start: number; end: number } => match !== null);

	const info = {
		matches,
		expression: 'state',
		query: symbolInfo,
		snapshot,
	};

	const catalog = buildReferenceCatalog({
		info,
		lines: usageLines,
		path: 'usage.lua',
	});

	assert.ok(catalog.some(entry => entry.symbol.location.path === 'global.lua'), 'global path included in reference catalog');
	const usageEntries = catalog.filter(entry => entry.symbol.location.path === 'usage.lua');
	assert.equal(usageEntries.length, matches.length, 'usage matches retained');
	assert.ok(!catalog.some(entry => entry.symbol.location.path === 'parameter.lua'), 'parameter file excluded from references');
	assert.ok(!catalog.some(entry => entry.symbol.location.path === 'local.lua'), 'local-scoped variable file excluded from references');
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
	resetSemanticProject(SYSTEM_RESOURCE_DOMAIN);

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
				result.info.query.targets.map(target => target.declaration.range),
				symbolInfo.targets.map(target => target.declaration.range),
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
	resetSemanticProject(SYSTEM_RESOURCE_DOMAIN);

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
			result.info.query.targets.map(target => target.declaration.range.start.line),
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
	resetSemanticProject(SYSTEM_RESOURCE_DOMAIN);

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
				parameterResult.info.query.targets[0].declaration.range,
				workspaceGlobal.targets[0].declaration.range,
				'parameter is not resolved as global',
			);
		}
	}
});

test('intellisense recognizes global variable from another file', async () => {
	const { buildLuaSemanticFrontend } = await semanticFrontendModulePromise;
	const { buildReferenceCatalog } = await referenceSourcesModulePromise;
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

	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('usage.lua', usageSource);
	workspace.updateFile('global.lua', globalSource);

	const usageLines = usageSource.split('\n');

	const stateRow = usageLines.findIndex(line => line.includes('print(state'));
	const stateColumn = usageLines[stateRow]!.indexOf('state');
	const snapshot = workspace.getSnapshot();
	const symbolInfo = createLuaSemanticFrontendFromSnapshot(snapshot).findReferencesByPosition('usage.lua', stateRow + 1, stateColumn + 1);
	assert.ok(symbolInfo);
	if (!symbolInfo) {
		return;
	}

	const matches = symbolInfo.references
		.filter(ref => ref.file === 'usage.lua')
		.map(ref => luaRangeToSearchMatch(ref.range, usageLines))
		.filter((match): match is { row: number; start: number; end: number } => match !== null);

	const info = {
		matches,
		expression: 'state',
		query: symbolInfo,
		snapshot,
	};

	const catalog = buildReferenceCatalog({
		info,
		lines: usageLines,
		path: 'usage.lua',
	});

	const diagnostics = buildLuaSemanticFrontend(
		[{ path: 'usage.lua', source: usageSource }],
		{ builtinDescriptors: [], externalGlobalSymbols: catalog.map(entry => entry.symbol) },
	).getFile('usage.lua').diagnostics;

	assert.ok(!diagnostics.some(d => /'state' is not defined/.test(d.message)), 'no undefined error for global state');
});
