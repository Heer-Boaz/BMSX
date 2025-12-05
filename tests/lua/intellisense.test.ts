import assert from 'node:assert/strict';
import { createRequire, register } from 'node:module';
import { test } from 'node:test';

import type { CodeTabContext } from '../../src/bmsx/console/ide/types';
import type { ProjectReferenceEnvironment } from '../../src/bmsx/console/ide/reference_sources';
import type { ConsoleResourceDescriptor } from '../../src/bmsx/console/types';
import type { ConsoleCodeLayout } from '../../src/bmsx/console/ide/code_layout';
import { normalizeEndingsAndSplitLines } from 'bmsx/console/ide/text_utils';

register('./glsl-loader.mjs', import.meta.url);

const require = createRequire(import.meta.url);

require.extensions['.glsl'] = () => {};

function registerStubModule(resolvedPath: string, exports: Record<string, unknown>): void {
	require.cache[resolvedPath] = {
		id: resolvedPath,
		filename: resolvedPath,
		loaded: true,
		exports,
		children: [],
		path: resolvedPath,
		require,
		isPreloading: false,
		parent: null,
		paths: [],
	};
}

const gameserializerPath = require.resolve('../../src/bmsx/serializer/gameserializer.ts');
registerStubModule(gameserializerPath, (() => {
	class SerializerStub {
		public static onSaves: Record<string, ((...args: any[]) => any)[]> = {};
		public static excludedProperties: Record<string, Record<string, boolean>> = {};
		public static excludedObjectTypes: Set<string> = new Set();
		public static propertyIncludeExcludeMap: Map<string, Map<string, boolean>> = new Map();
		public static classExcludeMap: Map<string, boolean> = new Map();
	}

	class ReviverStub {
		public static constructors: Record<string, new () => any> = {};
		public static onLoads: Record<string, ((...args: any[]) => any)[]> = {};
		public static excludedProperties: Record<string, Record<string, boolean>> = {};
	}

	type ConstructorWithSaveGameStub<T = unknown> = new (...args: any[]) => T;

	return {
		Serializer: SerializerStub,
		Reviver: ReviverStub,
		ConstructorWithSaveGame: undefined as unknown as ConstructorWithSaveGameStub,
	};
})());

const consoleApiPath = require.resolve('../../src/bmsx/console/api.ts');
const consoleApiExports = {
	BmsxConsoleApi: class {
		public emit(eventName: string, payload?: unknown, emitterId?: unknown): void {
			void eventName;
			void payload;
			void emitterId;
		}
		public emit_gameplay(eventName: string, emitterId: string, payload?: unknown): void {
			void eventName;
			void emitterId;
			void payload;
		}
	},
};
registerStubModule(consoleApiPath, consoleApiExports);
registerStubModule(consoleApiPath.replace(/\.ts$/, ''), consoleApiExports);
registerStubModule(consoleApiPath.replace(/\.ts$/, '.js'), consoleApiExports);

function registerEmptyModule(relativePath: string): void {
	const fileUrl = new URL(relativePath, import.meta.url);
	registerStubModule(fileUrl.pathname, { default: '' });
	registerStubModule(fileUrl.href, { default: '' });
}

registerEmptyModule('../../src/bmsx/render/2d/shaders/2d.frag.glsl');
registerEmptyModule('../../src/bmsx/render/2d/shaders/2d.vert.glsl');
registerEmptyModule('../../src/bmsx/render/3d/shaders/particle.frag.glsl');
registerEmptyModule('../../src/bmsx/render/3d/shaders/particle.vert.glsl');

const intellisenseModulePromise = import('../../src/bmsx/console/ide/intellisense');
const semanticModelModulePromise = import('../../src/bmsx/console/ide/semantic_model');
const referenceSourcesModulePromise = import('../../src/bmsx/console/ide/reference_sources');
const workspaceModulePromise = import('../../src/bmsx/console/ide/semantic_workspace');
const referenceNavigationModulePromise = import('../../src/bmsx/console/ide/reference_navigation');

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
	const { computeLuaDiagnostics, getApiCompletionData } = await intellisenseModulePromise;
	const apiData = getApiCompletionData();
	return computeLuaDiagnostics({
		source,
		chunkName: 'testchunk',
		localSymbols: [],
		globalSymbols: [],
		builtinDescriptors: [],
		apiSignatures: apiData.signatures,
	});
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

test('detects missing emitter id for gameplay emit', async () => {
	const diagnostics = await runDiagnostics(`
local function send()
	emit_gameplay('start')
end
send()
`);
	assert.equal(diagnostics.length, 1);
	assert.match(diagnostics[0].message, /emit_gameplay expects 3 arguments/i);
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
	const model = buildLuaSemanticModel(source, 'testchunk');
	const lines = normalizeEndingsAndSplitLines(source);
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
	const model = buildLuaSemanticModel(source, 'testchunk');
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
	const model = buildLuaSemanticModel(source, 'testchunk');
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
	const model = buildLuaSemanticModel(source, 'testchunk');
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

test('project reference catalog resolves globals across chunks', async () => {
	const { buildReferenceCatalogForExpression } = await referenceSourcesModulePromise;
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

	const usageDescriptor: ConsoleResourceDescriptor = { path: 'usage.lua', type: 'lua', asset_id: 'usage' };
	const globalDescriptor: ConsoleResourceDescriptor = { path: 'global.lua', type: 'lua', asset_id: 'global' };
	const parameterDescriptor: ConsoleResourceDescriptor = { path: 'parameter.lua', type: 'lua', asset_id: 'parameter' };
	const localDescriptor: ConsoleResourceDescriptor = { path: 'local.lua', type: 'lua', asset_id: 'local' };

	const usageContext: CodeTabContext = {
		id: 'usage',
		title: 'usage.lua',
		descriptor: usageDescriptor,
		load: () => usageSource,
		save: async () => {},
		snapshot: null,
		lastSavedSource: usageSource,
		saveGeneration: 0,
		appliedGeneration: 0,
		dirty: false,
		runtimeErrorOverlay: null,
		executionStopRow: null,
	};

	const usageLines = usageSource.split('\n');
	const environment: ProjectReferenceEnvironment = {
		activeContext: usageContext,
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

	const symbolInfo = workspace.findReferencesByPosition('usage.lua', stateRow + 1, stateColumn + 1);
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
		lines: usageLines,
		chunkName: 'usage.lua',
		asset_id: 'usage',
		environment,
		sourceLabelPath: 'usage.lua',
	});

	assert.ok(catalog.some(entry => entry.symbol.location.chunkName === 'global.lua'), 'global chunk included in reference catalog');
	const usageEntries = catalog.filter(entry => entry.symbol.location.chunkName === 'usage.lua');
	assert.equal(usageEntries.length, matches.length, 'usage matches retained');
	assert.ok(!catalog.some(entry => entry.symbol.location.chunkName === 'parameter.lua'), 'parameter file excluded from references');
	assert.ok(!catalog.some(entry => entry.symbol.location.chunkName === 'local.lua'), 'local-scoped variable file excluded from references');
});

test('project definition resolver locates global across chunks', async () => {
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

	const usageDescriptor: ConsoleResourceDescriptor = { path: 'usage.lua', type: 'lua', asset_id: 'usage' };
	const globalDescriptor: ConsoleResourceDescriptor = { path: 'global.lua', type: 'lua', asset_id: 'global' };

	const usageContext: CodeTabContext = {
		id: 'usage',
		title: 'usage.lua',
		descriptor: usageDescriptor,
		load: () => usageSource,
		save: async () => {},
		snapshot: null,
		lastSavedSource: usageSource,
		saveGeneration: 0,
		appliedGeneration: 0,
		dirty: false,
		runtimeErrorOverlay: null,
		executionStopRow: null,
	};

	const usageLines = usageSource.split('\n');

	const environment: ProjectReferenceEnvironment = {
		activeContext: usageContext,
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
		currentChunkName: 'usage.lua',
		currentLines: usageLines,
		currentasset_id: 'usage',
		sourceLabelPath: 'usage.lua',
	});

	assert.ok(location, 'global definition location resolved');
	assert.equal(location!.chunkName, 'global.lua');
	assert.equal(location!.asset_id, 'global');
	assert.equal(location!.range.startLine, 1);
	assert.equal(location!.range.startColumn, 1);
});

test('reference lookup resolves global definition across chunks', async () => {
	const { resolveReferenceLookup } = await referenceNavigationModulePromise;
	const { LuaSemanticWorkspace } = await workspaceModulePromise;

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
	const { buildLuaSemanticModel } = await semanticModelModulePromise;
	const model = buildLuaSemanticModel(usageSource, 'usage.lua');
	const layout = {
		getSemanticModel: () => model,
	} as unknown as ConsoleCodeLayout;

	const stateRow = usageLines.findIndex(line => line.includes('print(state'));
	assert.ok(stateRow >= 0);
	const stateColumn = usageLines[stateRow]!.indexOf('state');
	assert.ok(stateColumn >= 0);

	const result = resolveReferenceLookup({
		layout,
		workspace,
		lines: usageLines,
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
		chunkName: 'usage.lua',
	});

	assert.equal(result.kind, 'success', 'reference lookup succeeded');
	if (result.kind === 'success') {
		assert.ok(result.info.matches.length > 0, 'matches found');
		const symbolInfo = workspace.findReferencesByPosition('usage.lua', stateRow + 1, stateColumn + 1);
		assert.ok(symbolInfo);
		if (symbolInfo) {
			assert.equal(result.info.definitionKey, symbolInfo.id);
		}
	}
});

test('reference lookup prefers local parameter over global', async () => {
	const { resolveReferenceLookup } = await referenceNavigationModulePromise;
	const { LuaSemanticWorkspace } = await workspaceModulePromise;
	const { buildLuaSemanticModel } = await semanticModelModulePromise;

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
	const model = buildLuaSemanticModel(usageSource, 'usage.lua');
	const layout = {
		getSemanticModel: () => model,
	} as unknown as ConsoleCodeLayout;

	const helperLineIndex = usageLines.findIndex(line => line.includes('helper'));
	assert.ok(helperLineIndex >= 0);
	const parameterColumn = usageLines[helperLineIndex]!.indexOf('state');

	const parameterResult = resolveReferenceLookup({
		layout,
		workspace,
		lines: usageLines,
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
		chunkName: 'usage.lua',
	});

	assert.equal(parameterResult.kind, 'success', 'parameter lookup succeeds');
	if (parameterResult.kind === 'success') {
		const workspaceGlobal = workspace.findReferencesByPosition('global.lua', 1, 1);
		if (workspaceGlobal) {
			assert.notEqual(parameterResult.info.definitionKey, workspaceGlobal.id, 'parameter is not resolved as global');
		}
	}
});

test('intellisense recognizes global variable from another file', async () => {
	const { computeLuaDiagnostics, getApiCompletionData } = await intellisenseModulePromise;
	const { buildReferenceCatalogForExpression } = await referenceSourcesModulePromise;
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

	const usageDescriptor: ConsoleResourceDescriptor = { path: 'usage.lua', type: 'lua', asset_id: 'usage' };
	const globalDescriptor: ConsoleResourceDescriptor = { path: 'global.lua', type: 'lua', asset_id: 'global' };

	const usageContext: CodeTabContext = {
		id: 'usage',
		title: 'usage.lua',
		descriptor: usageDescriptor,
		load: () => usageSource,
		save: async () => {},
		snapshot: null,
		lastSavedSource: usageSource,
		saveGeneration: 0,
		appliedGeneration: 0,
		dirty: false,
		runtimeErrorOverlay: null,
		executionStopRow: null,
	};

	const usageLines = usageSource.split('\n');

	const environment: ProjectReferenceEnvironment = {
		activeContext: usageContext,
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
	const symbolInfo = workspace.findReferencesByPosition('usage.lua', stateRow + 1, stateColumn + 1);
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
		lines: usageLines,
		chunkName: 'usage.lua',
		asset_id: 'usage',
		environment,
		sourceLabelPath: 'usage.lua',
	});

	const apiData = getApiCompletionData();
	const diagnostics = computeLuaDiagnostics({
		source: usageSource,
		chunkName: 'usage.lua',
		localSymbols: [],
		globalSymbols: catalog.map(entry => entry.symbol),
		builtinDescriptors: [],
		apiSignatures: apiData.signatures,
	});

	assert.ok(!diagnostics.some(d => /'state' is not defined/.test(d.message)), 'no undefined error for global state');
});
