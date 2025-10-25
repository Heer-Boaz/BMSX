import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);

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
		public emitGameplay(eventName: string, emitterId: string, payload?: unknown): void {
			void eventName;
			void emitterId;
			void payload;
		}
		public emitPresentation(eventName: string, emitterId: string | null, payload?: unknown): void {
			void eventName;
			void emitterId;
			void payload;
		}
	},
});

const intellisenseModulePromise = import('../../src/bmsx/console/ide/intellisense.ts');

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
	assert.match(diagnostics[0].message, /add\(\) expects 2 arguments/i);
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
	api.emitGameplay('start')
end
send()
`);
	assert.equal(diagnostics.length, 1);
	assert.match(diagnostics[0].message, /api\.emitGameplay/);
});
