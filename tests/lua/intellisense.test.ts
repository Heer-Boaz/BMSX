import assert from 'node:assert/strict';
import { createRequire, register } from 'node:module';
import { test } from 'node:test';

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
