import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CodeTabContext, ResourceDescriptor } from '../../src/bmsx/ide/common/models';
import { splitText } from '../../src/bmsx/common/text_lines';
import { PieceTreeBuffer } from '../../src/bmsx/ide/editor/text/piece_tree_buffer';
import type { ProjectReferenceEnvironment } from '../../src/bmsx/ide/editor/contrib/references/sources';

const semanticFrontendModulePromise = import('../../src/bmsx/lua/semantic/frontend');
const semanticDiagnosticsModulePromise = import('../../src/bmsx/lua/semantic/diagnostics');
const semanticModelModulePromise = import('../../src/bmsx/lua/semantic/model');
const referenceSourcesModulePromise = import('../../src/bmsx/ide/editor/contrib/references/sources');
const workspaceModulePromise = import('../../src/bmsx/ide/editor/contrib/intellisense/semantic/workspace');
const workspaceStateModulePromise = import('../../src/bmsx/ide/editor/contrib/intellisense/semantic/workspace/state');
const referenceNavigationModulePromise = import('../../src/bmsx/ide/editor/contrib/references/lookup');

function runtimeStub(files: Record<string, string> = {}) {
	const path2lua: Record<string, any> = {};
	const module2lua: Record<string, any> = {};
	for (const path in files) {
		const source = files[path];
		const modulePath = path.replace(/\.lua$/, '').replace(/\\/g, '/');
		const record = {
			resid: path,
			type: 'lua',
			src: source,
			base_src: source,
			source_path: path,
			module_path: modulePath,
			update_timestamp: 0,
		};
		path2lua[path] = record;
		module2lua[modulePath] = record;
	}
	return {
		pathSemanticCache: new Map(),
		interpreter: { globalEnvironment: new Map() },
		systemLuaSources: {
			path2lua,
			module2lua,
			entry_path: '',
			namespace: 'tests',
			projectRootPath: '',
			can_boot_from_source: true,
		},
		cartLuaSources: null,
		activeLuaSources: null,
	} as any;
}

function codeContext(descriptor: ResourceDescriptor, source: string): CodeTabContext {
	return {
		id: descriptor.asset_id ?? descriptor.path,
		title: descriptor.path,
		descriptor,
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

test('intellisense recognizes shared runtime globals without false positives', async () => {
	const { buildLuaSemanticFrontend } = await semanticFrontendModulePromise;
	const { getDefaultLuaBuiltinDescriptors } = await semanticDiagnosticsModulePromise;
	const diagnostics = buildLuaSemanticFrontend(
		[{ path: 'testpath', source: 'return sys_boot_cart, cart_manifest, sys_vdp_stream_base' }],
		{ builtinDescriptors: getDefaultLuaBuiltinDescriptors() },
	).getFile('testpath').diagnostics;
	assert.equal(diagnostics.length, 0);
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

	const usageDescriptor: ResourceDescriptor = { path: 'usage.lua', type: 'lua', asset_id: 'usage' };
	const globalDescriptor: ResourceDescriptor = { path: 'global.lua', type: 'lua', asset_id: 'global' };
	const parameterDescriptor: ResourceDescriptor = { path: 'parameter.lua', type: 'lua', asset_id: 'parameter' };
	const localDescriptor: ResourceDescriptor = { path: 'local.lua', type: 'lua', asset_id: 'local' };

	const usageContext = codeContext(usageDescriptor, usageSource);

	const usageLines = usageSource.split('\n');
	const runtime = runtimeStub();
	const environment: ProjectReferenceEnvironment = {
		runtime,
		activeContext: usageContext,
		activeSource: usageSource,
		activeLines: usageLines,
		codeTabContexts: [usageContext],
		listResources: () => [usageDescriptor, globalDescriptor, parameterDescriptor, localDescriptor],
		loadLuaResource: (asset_id: string) => {
			if (asset_id === 'usage') return usageSource;
			if (asset_id === 'global') return globalSource;
			if (asset_id === 'parameter') return parameterSource;
			if (asset_id === 'local') return localSource;
			throw new Error(`Unexpected asset ${asset_id}`);
		},
	};

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

	const catalog = buildReferenceCatalogForExpression({
		workspace,
		info,
		source: usageSource,
		lines: usageLines,
		path: 'usage.lua',
		environment,
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

	const usageDescriptor: ResourceDescriptor = { path: 'usage.lua', type: 'lua', asset_id: 'usage' };
	const globalDescriptor: ResourceDescriptor = { path: 'global.lua', type: 'lua', asset_id: 'global' };

	const usageContext = codeContext(usageDescriptor, usageSource);

	const usageLines = usageSource.split('\n');

	const runtime = runtimeStub();
	const environment: ProjectReferenceEnvironment = {
		runtime,
		activeContext: usageContext,
		activeSource: usageSource,
		activeLines: usageLines,
		codeTabContexts: [usageContext],
		listResources: () => [usageDescriptor, globalDescriptor],
		loadLuaResource: (asset_id: string) => {
			if (asset_id === 'usage') return usageSource;
			if (asset_id === 'global') return globalSource;
			throw new Error(`Unexpected asset ${asset_id}`);
		},
	};

	const location = resolveDefinitionLocationForExpression({
		expression: 'state',
		environment,
		workspace,
		currentPath: 'usage.lua',
		currentSource: usageSource,
		currentLines: usageLines,
	});

	assert.ok(location, 'global definition location resolved');
	assert.equal(location!.path, 'global.lua');
	assert.equal(location!.asset_id, 'global');
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
	resetSemanticWorkspace();

	const stateRow = usageLines.findIndex(line => line.includes('print(state'));
	assert.ok(stateRow >= 0);
	const stateColumn = usageLines[stateRow]!.indexOf('state');
	assert.ok(stateColumn >= 0);

	const result = resolveReferenceLookup({
		runtime: runtimeStub({ 'global.lua': globalSource }),
		buffer: new PieceTreeBuffer(usageSource),
		textVersion: 1,
		cursorRow: stateRow,
		cursorColumn: stateColumn,
		extractExpression: (row, column) => {
			const line = usageLines[row] ?? '';
			const name = 'state';
			const index = line.indexOf(name);
			if (index === -1 || column < index || column >= index + name.length) {
				return null;
			}
			return { expression: 'state', startColumn: index, endColumn: index + name.length };
		},
		path: 'usage.lua',
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
	resetSemanticWorkspace();

	const helperLineIndex = usageLines.findIndex(line => line.includes('helper'));
	assert.ok(helperLineIndex >= 0);
	const parameterColumn = usageLines[helperLineIndex]!.indexOf('state');

	const parameterResult = resolveReferenceLookup({
		runtime: runtimeStub({ 'global.lua': globalSource }),
		buffer: new PieceTreeBuffer(usageSource),
		textVersion: 1,
		cursorRow: helperLineIndex,
		cursorColumn: parameterColumn,
		extractExpression: (row, column) => {
			const line = usageLines[row] ?? '';
			const name = 'state';
			const index = line.indexOf(name);
			if (index === -1 || column < index || column >= index + name.length) {
				return null;
			}
			return { expression: 'state', startColumn: index, endColumn: index + name.length };
		},
		path: 'usage.lua',
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

	const usageDescriptor: ResourceDescriptor = { path: 'usage.lua', type: 'lua', asset_id: 'usage' };
	const globalDescriptor: ResourceDescriptor = { path: 'global.lua', type: 'lua', asset_id: 'global' };

	const usageContext = codeContext(usageDescriptor, usageSource);

	const usageLines = usageSource.split('\n');

	const runtime = runtimeStub();
	const environment: ProjectReferenceEnvironment = {
		runtime,
		activeContext: usageContext,
		activeSource: usageSource,
		activeLines: usageLines,
		codeTabContexts: [usageContext],
		listResources: () => [usageDescriptor, globalDescriptor],
		loadLuaResource: (asset_id: string) => {
			if (asset_id === 'usage') return usageSource;
			if (asset_id === 'global') return globalSource;
			throw new Error(`Unexpected asset ${asset_id}`);
		},
	};

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

	const catalog = buildReferenceCatalogForExpression({
		workspace,
		info,
		source: usageSource,
		lines: usageLines,
		path: 'usage.lua',
		environment,
	});

	const diagnostics = buildLuaSemanticFrontend(
		[{ path: 'usage.lua', source: usageSource }],
		{ builtinDescriptors: [], externalGlobalSymbols: catalog.map(entry => entry.symbol) },
	).getFile('usage.lua').diagnostics;

	assert.ok(!diagnostics.some(d => /'state' is not defined/.test(d.message)), 'no undefined error for global state');
});
