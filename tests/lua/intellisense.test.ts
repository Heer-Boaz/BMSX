import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CodeTabContext } from '../../ide/common/models';
import { splitText } from '../../machine/ts/common/text_lines';
import { PieceTreeBuffer } from '../../ide/editor/text/piece_tree_buffer';
import { LuaLexer } from '../../machine/ts/lua/syntax/lexer';
import { LuaParser } from '../../machine/ts/lua/syntax/parser';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { compileLuaChunkToProgram } from '../../machine/ts/lua/compiler';
import {
	registerLuaSourceRecord,
	type LuaSourceRecord,
	type LuaSourceRegistry,
} from '../../machine/ts/lua/source_registry';
import { createRuntimeFaultState, recordLuaError } from '../../ide/runtime/fault_state';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { LuaInterpreter } from '../../ide/language/lua/interpreter/interpreter';
import { valueIsClosure } from '../../machine/ts/machine/cpu/value';
import {
	SYSTEM_RESOURCE_DOMAIN,
	type RuntimeResource,
} from '../../ide/common/resource';
import { RuntimeNativeBridge } from '../../ide/runtime/native_bridge';
import type { RuntimeSourceState } from '../../ide/runtime/sources';
import {
	createTestRuntime,
	createTestRuntimeRomPayload,
	createTestSystemImageRuntimeSourceState,
} from '../helpers/runtime_sources';

const semanticFrontendModulePromise = import('../../machine/ts/lua/semantic/frontend');
const semanticDiagnosticsModulePromise = import('../../machine/ts/lua/semantic/diagnostics');
const semanticModelModulePromise = import('../../machine/ts/lua/semantic/model');
const referenceSourcesModulePromise = import('../../ide/editor/contrib/references/sources');
const workspaceModulePromise = import('../../ide/editor/contrib/intellisense/semantic/workspace/index');
const workspaceStateModulePromise = import('../../ide/editor/contrib/intellisense/semantic/workspace/state');
const referenceNavigationModulePromise = import('../../ide/editor/contrib/references/lookup');
const intellisenseEngineModulePromise = import('../../ide/editor/contrib/intellisense/engine');

const EMPTY_ROM_PAYLOAD = createTestRuntimeRomPayload();

function createSourceState(files: Record<string, string>, systemRom: Uint8Array): RuntimeSourceState {
	const systemLuaSources: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entry_path: '',
		namespace: 'tests',
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

function createIntellisenseBridge(files: Record<string, string> = {}): RuntimeNativeBridge {
	const runtime = createTestRuntime(EMPTY_ROM_PAYLOAD);
	const bridge = new RuntimeNativeBridge(runtime, createSourceState(files, EMPTY_ROM_PAYLOAD));
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
	const parser = new LuaParser(tokens, path, splitText(source));
	return parser.parseChunk();
}

function createIntellisenseRuntime(source: string) {
	const sourcePath = 'cart.lua';
	const modulePath = 'cart';
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, modulePath), [], {
		entrySource: source,
		optLevel: 0,
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
		entry_path: sourcePath,
		namespace: 'tests',
		projectRootPath: '',
		can_boot_from_source: true,
		revision: 0,
	};
	registerLuaSourceRecord(systemLuaSources, record);
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, systemLuaSources);
	sources.currentBlua32Media = {
		system: { layout: image.image, symbols: image.symbols },
		cartridgeSlots: [null, null],
	};
	const bridge = new RuntimeNativeBridge(runtime, sources);
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

test('intellisense live locals resolve editor source paths against CPU module paths', async () => {
	const { resolveLuaChainValue, resolveLuaDefinitionMetadata } = await intellisenseEngineModulePromise;
	const source = [
		'local counter = 42',
		'halt_until_irq',
		'return counter',
	].join('\n');
	const { bridge, fault, runtime, sourcePath } = runtimeWithPausedCpuLocal(source);
	const counterColumn = source.indexOf('counter') + 1;

	const resolved = resolveLuaChainValue(bridge, fault, runtime, ['counter'], sourcePath, 1, counterColumn);
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
	const closure = cpu.completionValues[0];
	assert.ok(valueIsClosure(closure));
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

// Semantic model behavior tests

test('semantic model distinguishes table field and parameter', async () => {
	const { buildLuaSemanticModel } = await semanticModelModulePromise;
	const source = `
local function create_ball(seed)
	return {
		seed = seed,
	}
end
`;
	const model = buildLuaSemanticModel(source, 'testpath');
	const lines = splitText(source);
	const targetLine = lines[3];
	const leftZeroBased = targetLine.indexOf('seed');
	const rightZeroBased = targetLine.indexOf('seed', leftZeroBased + 1);
	const leftDefinition = model.lookupIdentifier(4, leftZeroBased + 1, ['seed']);
	const rightDefinition = model.lookupIdentifier(4, rightZeroBased + 1, ['seed']);
	assert.ok(leftDefinition, 'left seed definition');
	assert.ok(rightDefinition, 'right seed definition');
	assert.equal(leftDefinition!.kind, 'table_field');
	assert.equal(rightDefinition!.kind, 'parameter');
	assert.equal(rightDefinition!.definition.start.line, 2);
});

test('semantic model resolves table property access', async () => {
	const { buildLuaSemanticModel } = await semanticModelModulePromise;
	const source = `
local state = {
	count = 0,
}
state.count = state.count + 1
`;
	const model = buildLuaSemanticModel(source, 'testpath');
	const lines = source.replace(/\r\n/g, '\n').split('\n');
	const assignmentLine = lines[4];
	const firstZeroBased = assignmentLine.indexOf('count');
	const secondZeroBased = assignmentLine.indexOf('count', firstZeroBased + 1);
	const definition = model.lookupIdentifier(5, firstZeroBased + 1, ['state', 'count']);
	const definitionAgain = model.lookupIdentifier(5, secondZeroBased + 1, ['state', 'count']);
	assert.ok(definition, 'property definition found');
	assert.ok(definitionAgain, 'property definition found for rhs');
	assert.equal(definition!.kind, 'table_field');
	assert.equal(definition!.definition.start.line, 3);
	assert.equal(definitionAgain!.definition.start.line, definition!.definition.start.line);
});

test('semantic model reports references for locals', async () => {
	const { buildLuaSemanticModel } = await semanticModelModulePromise;
	const source = [
		'local counter = 0',
		'counter = counter + 1',
		'return counter',
	].join('\n');
	const model = buildLuaSemanticModel(source, 'testpath');
	const lines = source.split('\n');
	const definitionColumn = lines[0].indexOf('counter') + 1;
	const lookup = model.lookupReferences(1, definitionColumn, ['counter']);
	assert.ok(lookup.definition, 'definition present');
	const referenceKeys = lookup.references.map(range => `${range.start.line}:${range.start.column}`);
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

test('semantic model reports references for table fields', async () => {
	const { buildLuaSemanticModel } = await semanticModelModulePromise;
	const source = [
		'local state = { value = 0 }',
		'state.value = state.value + 1',
		'return state.value',
	].join('\n');
	const model = buildLuaSemanticModel(source, 'testpath');
	const lines = source.split('\n');
	const definitionColumn = lines[0].indexOf('value') + 1;
	const lookup = model.lookupReferences(1, definitionColumn, ['state', 'value']);
	assert.ok(lookup.definition);
	const referenceKeys = lookup.references.map(range => `${range.start.line}:${range.start.column}`);
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
	const { buildReferenceCatalogForExpression } = await referenceSourcesModulePromise;
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

	const usageResource = testLuaResource('usage.lua');

	const usageContext = codeContext(usageResource, usageSource);

	const usageLines = usageSource.split('\n');
	const bridge = createIntellisenseBridge({
		'global.lua': globalSource,
		'parameter.lua': parameterSource,
		'local.lua': localSource,
	});
	const stateRow = usageLines.findIndex(line => line.includes('print(state'));
	assert.ok(stateRow >= 0);
	const stateColumn = usageLines[stateRow]!.indexOf('state');
	assert.ok(stateColumn >= 0);

	const symbolInfo = createLuaSemanticFrontendFromSnapshot(workspace.getSnapshot()).findReferencesByPosition('usage.lua', stateRow + 1, stateColumn + 1);
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
		definitionKey: symbolInfo.id,
		documentVersion: 1,
	};

	const catalog = buildReferenceCatalogForExpression(bridge, {
		workspace,
		info,
		source: usageSource,
		lines: usageLines,
		path: 'usage.lua',
		activeContext: usageContext,
		codeTabContexts: [usageContext],
	});

	assert.ok(catalog.some(entry => entry.symbol.location.path === 'global.lua'), 'global path included in reference catalog');
	const usageEntries = catalog.filter(entry => entry.symbol.location.path === 'usage.lua');
	assert.equal(usageEntries.length, matches.length, 'usage matches retained');
	assert.ok(!catalog.some(entry => entry.symbol.location.path === 'parameter.lua'), 'parameter file excluded from references');
	assert.ok(!catalog.some(entry => entry.symbol.location.path === 'local.lua'), 'local-scoped variable file excluded from references');
});

test('project definition resolver locates global across paths', async () => {
	const { resolveDefinitionLocationForExpression } = await referenceSourcesModulePromise;
	const { LuaSemanticWorkspace } = await workspaceModulePromise;

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

	const usageResource = testLuaResource('usage.lua');

	const usageContext = codeContext(usageResource, usageSource);

	const usageLines = usageSource.split('\n');

	const bridge = createIntellisenseBridge({ 'global.lua': globalSource });
	const location = resolveDefinitionLocationForExpression(bridge, {
		expression: 'state',
		activeContext: usageContext,
		codeTabContexts: [usageContext],
		workspace,
		currentPath: usageResource.path,
		currentSource: usageSource,
		currentLines: usageLines,
	});

	assert.ok(location, 'global definition location resolved');
	assert.equal(location!.path, 'global.lua');
	assert.equal(location!.range.startLine, 1);
	assert.equal(location!.range.startColumn, 1);
});

test('reference lookup resolves global definition across paths', async () => {
	const { resolveReferenceLookup } = await referenceNavigationModulePromise;
	const { LuaSemanticWorkspace, createLuaSemanticFrontendFromSnapshot } = await workspaceModulePromise;
	const { resetSemanticWorkspace } = await workspaceStateModulePromise;

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
	resetSemanticWorkspace(SYSTEM_RESOURCE_DOMAIN);

	const stateRow = usageLines.findIndex(line => line.includes('print(state'));
	assert.ok(stateRow >= 0);
	const stateColumn = usageLines[stateRow]!.indexOf('state');
	assert.ok(stateColumn >= 0);

	const result = resolveReferenceLookup(createIntellisenseBridge({ 'global.lua': globalSource }), {
		buffer: new PieceTreeBuffer(usageSource),
		textVersion: 1,
		cursorRow: stateRow,
		cursorColumn: stateColumn,
		identity: { domain: SYSTEM_RESOURCE_DOMAIN, path: 'usage.lua' },
	});

	assert.equal(result.kind, 'success', 'reference lookup succeeded');
	if (result.kind === 'success') {
		assert.ok(result.info.matches.length > 0, 'matches found');
		const symbolInfo = createLuaSemanticFrontendFromSnapshot(workspace.getSnapshot()).findReferencesByPosition('usage.lua', stateRow + 1, stateColumn + 1);
		assert.ok(symbolInfo);
		if (symbolInfo) {
			assert.equal(result.info.definitionKey, symbolInfo.id);
		}
	}
});

test('reference lookup prefers local parameter over global', async () => {
	const { resolveReferenceLookup } = await referenceNavigationModulePromise;
	const { LuaSemanticWorkspace, createLuaSemanticFrontendFromSnapshot } = await workspaceModulePromise;
	const { resetSemanticWorkspace } = await workspaceStateModulePromise;

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
	resetSemanticWorkspace(SYSTEM_RESOURCE_DOMAIN);

	const helperLineIndex = usageLines.findIndex(line => line.includes('helper'));
	assert.ok(helperLineIndex >= 0);
	const parameterColumn = usageLines[helperLineIndex]!.indexOf('state');

	const parameterResult = resolveReferenceLookup(createIntellisenseBridge({ 'global.lua': globalSource }), {
		buffer: new PieceTreeBuffer(usageSource),
		textVersion: 1,
		cursorRow: helperLineIndex,
		cursorColumn: parameterColumn,
		identity: { domain: SYSTEM_RESOURCE_DOMAIN, path: 'usage.lua' },
	});

	assert.equal(parameterResult.kind, 'success', 'parameter lookup succeeds');
	if (parameterResult.kind === 'success') {
		const workspaceGlobal = createLuaSemanticFrontendFromSnapshot(workspace.getSnapshot()).findReferencesByPosition('global.lua', 1, 1);
		if (workspaceGlobal) {
			assert.notEqual(parameterResult.info.definitionKey, workspaceGlobal.id, 'parameter is not resolved as global');
		}
	}
});

test('intellisense recognizes global variable from another file', async () => {
	const { buildLuaSemanticFrontend } = await semanticFrontendModulePromise;
	const { buildReferenceCatalogForExpression } = await referenceSourcesModulePromise;
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

	const usageResource = testLuaResource('usage.lua');

	const usageContext = codeContext(usageResource, usageSource);

	const usageLines = usageSource.split('\n');

	const bridge = createIntellisenseBridge({ 'global.lua': globalSource });
	const stateRow = usageLines.findIndex(line => line.includes('print(state'));
	const stateColumn = usageLines[stateRow]!.indexOf('state');
	const symbolInfo = createLuaSemanticFrontendFromSnapshot(workspace.getSnapshot()).findReferencesByPosition('usage.lua', stateRow + 1, stateColumn + 1);
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
		definitionKey: symbolInfo.id,
		documentVersion: 1,
	};

	const catalog = buildReferenceCatalogForExpression(bridge, {
		workspace,
		info,
		source: usageSource,
		lines: usageLines,
		path: 'usage.lua',
		activeContext: usageContext,
		codeTabContexts: [usageContext],
	});

	const diagnostics = buildLuaSemanticFrontend(
		[{ path: 'usage.lua', source: usageSource }],
		{ builtinDescriptors: [], externalGlobalSymbols: catalog.map(entry => entry.symbol) },
	).getFile('usage.lua').diagnostics;

	assert.ok(!diagnostics.some(d => /'state' is not defined/.test(d.message)), 'no undefined error for global state');
});
