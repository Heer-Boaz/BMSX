import assert from 'node:assert/strict';
import { createRequire, register } from 'node:module';
import { test } from 'node:test';

import type { CodeTabContext } from '../../src/bmsx/console/ide/types';
import type { ProjectReferenceEnvironment } from '../../src/bmsx/console/ide/reference_sources';
import type { ConsoleResourceDescriptor } from '../../src/bmsx/console/types';

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
registerStubModule(consoleApiPath, {
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
		public emit_presentation(eventName: string, emitterId: string | null, payload?: unknown): void {
			void eventName;
			void emitterId;
			void payload;
		}
	},
});

function registerEmptyModule(relativePath: string): void {
	const fileUrl = new URL(relativePath, import.meta.url);
	registerStubModule(fileUrl.pathname, { default: '' });
	registerStubModule(fileUrl.href, { default: '' });
}

registerEmptyModule('../../src/bmsx/render/2d/shaders/2d.frag.glsl');
registerEmptyModule('../../src/bmsx/render/2d/shaders/2d.vert.glsl');
registerEmptyModule('../../src/bmsx/render/3d/shaders/particle.frag.glsl');
registerEmptyModule('../../src/bmsx/render/3d/shaders/particle.vert.glsl');

const intellisenseModulePromise = import('../../src/bmsx/console/ide/intellisense.ts');
const semanticModelModulePromise = import('../../src/bmsx/console/ide/semantic_model.ts');
const referenceSourcesModulePromise = import('../../src/bmsx/console/ide/reference_sources.ts');
const referenceSearchModulePromise = import('../../src/bmsx/console/ide/reference_symbol_search.ts');

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
	const lines = source.replace(/\r\n/g, '\n').split('\n');
	const targetLine = lines[3];
	const leftZeroBased = targetLine.indexOf('seed');
	const rightZeroBased = targetLine.indexOf('seed', leftZeroBased + 1);
	const leftDefinition = model.lookupIdentifier(4, leftZeroBased + 1, ['seed']);
	const rightDefinition = model.lookupIdentifier(4, rightZeroBased + 1, ['seed']);
	assert.ok(leftDefinition, 'left seed definition');
	assert.ok(rightDefinition, 'right seed definition');
	assert.equal(leftDefinition.kind, 'table_field');
	assert.equal(rightDefinition.kind, 'parameter');
	assert.equal(rightDefinition.definition.start.line, 2);
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
	assert.equal(definition.kind, 'table_field');
	assert.equal(definition.definition.start.line, 3);
	assert.equal(definitionAgain.definition.start.line, definition.definition.start.line);
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
	assert.equal(lookup.references.length, 3);
	const referenceKeys = lookup.references.map(range => `${range.start.line}:${range.start.column}`);
	const expectedKeys = [
		`${2}:${lines[1].indexOf('counter') + 1}`,
		`${2}:${lines[1].indexOf('counter', lines[1].indexOf('counter') + 1) + 1}`,
		`${3}:${lines[2].indexOf('counter') + 1}`,
	];
	assert.deepEqual(referenceKeys, expectedKeys);
	const definitionReferences = model.getDefinitionReferences(lookup.definition!);
	assert.equal(definitionReferences.length, lookup.references.length);
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
	const roundTrip = model.getDefinitionReferences(lookup.definition!);
	assert.equal(roundTrip.length, lookup.references.length);
});

test('project reference catalog resolves globals across chunks', async () => {
	const { buildReferenceCatalogForExpression, resolveDefinitionKeyForExpression } = await referenceSourcesModulePromise;
	const { findExpressionMatches } = await referenceSearchModulePromise;
	const usageSource = [
		'function dummy_handler()'
		,	'\tprint(state, 10)'
		,	'end',
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
	const usageDescriptor: ConsoleResourceDescriptor = { path: 'usage.lua', type: 'lua', assetId: 'usage' };
	const globalDescriptor: ConsoleResourceDescriptor = { path: 'global.lua', type: 'lua', assetId: 'global' };
	const parameterDescriptor: ConsoleResourceDescriptor = { path: 'parameter.lua', type: 'lua', assetId: 'parameter' };
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
		listResources: () => [usageDescriptor, globalDescriptor, parameterDescriptor],
		loadLuaResource: (assetId: string) => {
			if (assetId === 'usage') {
				return usageSource;
			}
			if (assetId === 'global') {
				return globalSource;
			}
			if (assetId === 'parameter') {
				return parameterSource;
			}
			throw new Error(`Unexpected asset ${assetId}`);
		},
	};
	const definitionKey = resolveDefinitionKeyForExpression({
		expression: 'state',
		environment,
		currentChunkName: 'usage.lua',
		currentPath: 'usage.lua',
	});
	assert.ok(definitionKey, 'definition key resolved for global state');
	const matches = findExpressionMatches('state', usageLines);
	assert.ok(matches.length > 0, 'usage matches found');
	const info = {
		matches,
		expression: 'state',
		definitionKey: definitionKey!,
		documentVersion: 1,
	};
	const catalog = buildReferenceCatalogForExpression({
		info,
		lines: usageLines,
		normalizedPath: 'usage.lua',
		chunkName: 'usage.lua',
		assetId: 'usage',
		environment,
		sourceLabelPath: 'usage.lua',
	});
	assert.ok(catalog.some(entry => entry.symbol.location.chunkName === 'global.lua'), 'global chunk included in reference catalog');
	const usageEntries = catalog.filter(entry => entry.symbol.location.chunkName === 'usage.lua');
	assert.equal(usageEntries.length, matches.length, 'usage matches retained');
	assert.ok(!catalog.some(entry => entry.symbol.location.chunkName === 'parameter.lua'), 'local parameter file excluded from references');
});

test('intellisense recognizes global variable from another file', async () => {
	const { computeLuaDiagnostics, getApiCompletionData } = await intellisenseModulePromise;
	const { buildReferenceCatalogForExpression, resolveDefinitionKeyForExpression } = await referenceSourcesModulePromise;
	const { findExpressionMatches } = await referenceSearchModulePromise;

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

	const usageDescriptor: ConsoleResourceDescriptor = { path: 'usage.lua', type: 'lua', assetId: 'usage' };
	const globalDescriptor: ConsoleResourceDescriptor = { path: 'global.lua', type: 'lua', assetId: 'global' };

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
		loadLuaResource: (assetId: string) => {
			if (assetId === 'usage') return usageSource;
			if (assetId === 'global') return globalSource;
			throw new Error(`Unexpected asset ${assetId}`);
		},
	};

	// Resolve the definition key for 'state' (global)
	const definitionKey = resolveDefinitionKeyForExpression({
		expression: 'state',
		environment,
		currentChunkName: 'usage.lua',
		currentPath: 'usage.lua',
	});
	assert.ok(definitionKey, 'definition key resolved for global state');

	// Find matches for 'state' inside the usage lines
	const matches = findExpressionMatches('state', usageLines);
	assert.ok(matches.length > 0, 'usage matches found');

	const info = {
		matches,
		expression: 'state',
		definitionKey: definitionKey!,
		documentVersion: 1,
	};

	// Build a reference catalog for the expression; this should include the global.lua entry
	const catalog = buildReferenceCatalogForExpression({
		info,
		lines: usageLines,
		normalizedPath: 'usage.lua',
		chunkName: 'usage.lua',
		assetId: 'usage',
		environment,
		sourceLabelPath: 'usage.lua',
	});

	// Extract symbol entries that correspond to the global chunk (global.lua)
	const globalSymbols = catalog
		.filter(entry => entry.symbol.location && entry.symbol.location.chunkName === 'global.lua')
		.map(entry => entry.symbol);

	// Ensure we have at least one global symbol to provide to the intellisense diagnostics
	assert.ok(globalSymbols.length > 0, 'global symbol(s) found in catalog');

	// Run diagnostics for the usage source while providing the discovered globalSymbols
	const apiData = getApiCompletionData();
	const diagnostics = computeLuaDiagnostics({
		source: usageSource,
		chunkName: 'usage.lua',
		localSymbols: [],
		globalSymbols,
		builtinDescriptors: [],
		apiSignatures: apiData.signatures,
	});

	// Expect no "undefined" errors for 'state' because it is defined in another file and provided as a global symbol
	assert.ok(!diagnostics.some(d => /'state' is not defined/.test(d.message)), 'no "undefined" error for global "state"');
});
