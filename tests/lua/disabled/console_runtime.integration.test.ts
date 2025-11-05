import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createLuaInterpreter } from '../../src/bmsx/lua/runtime.ts';
import type { LuaInterpreter } from '../../src/bmsx/lua/runtime.ts';
import type { LuaHandlerFn } from '../../src/bmsx/lua/handler_cache.ts';
import { StateDefinitions, StateDefinitionBuilders, ActiveStateMachines } from '../../src/bmsx/fsm/fsmlibrary';
import { BehaviorTreeDefinitions, behaviorTreeExists, unregisterBehaviorTreeBuilder } from '../../src/bmsx/ai/behaviourtree';
import type { BehaviorTreeDefinition } from '../../src/bmsx/ai/behaviourtree';
import type { BmsxConsoleRuntime } from '../../src/bmsx/console/runtime';

const SKIP_CONSOLE_RUNTIME_INTEGRATION = true;

if (SKIP_CONSOLE_RUNTIME_INTEGRATION) {
	test.skip('console runtime integration suite temporarily disabled', () => {});
} else {

// --- Module stubs ---------------------------------------------------------------------------

const runtimeUrl = new URL('../../src/bmsx/console/runtime.ts', import.meta.url).href;

const gameserializerFactory = () => {
	const Serializer = {
		onSaves: {} as Record<string, Array<(...args: any[]) => any>>,
		excludedProperties: {} as Record<string, Record<string, boolean>>,
		excludedObjectTypes: new Set<string>(),
		propertyIncludeExcludeMap: new Map<string, Map<string, boolean>>(),
		classExcludeMap: new Map<string, boolean>(),
		get_typename(value: unknown): string {
			if (value && typeof value === 'object' && (value as { constructor?: { name?: string } }).constructor) {
				return (value as { constructor?: { name?: string } }).constructor!.name ?? 'Object';
			}
			if (typeof value === 'function') return (value as Function).name;
			return typeof value === 'string' ? value : '';
		},
	};
	const Reviver = {
		constructors: {} as Record<string, new (...args: any[]) => any>,
		excludedProperties: {} as Record<string, Record<string, boolean>>,
		onLoads: {} as Record<string, Array<(...args: any[]) => any>>,
	};
	class Savegame {}
	return { Serializer, Reviver, Savegame };
};

const gameserializerAbsoluteTs = new URL('../serializer/gameserializer.ts', runtimeUrl).href;
const gameserializerAbsoluteJs = gameserializerAbsoluteTs.replace(/\.ts$/, '.js');
mock.module(gameserializerAbsoluteTs, gameserializerFactory);
mock.module(gameserializerAbsoluteJs, gameserializerFactory);
mock.module('../../src/bmsx/serializer/gameserializer.ts', gameserializerFactory);
mock.module('../../src/bmsx/serializer/gameserializer.js', gameserializerFactory);

const serializationFactory = () => ({
	onsave: (value: unknown) => value,
	onload: (value: unknown) => value,
	excludepropfromsavegame: () => undefined,
	excludeclassfromsavegame: () => undefined,
	insavegame: (value: unknown) => value,
});

const serializationAbsoluteTs = new URL('../serializer/serializationhooks.ts', runtimeUrl).href;
const serializationAbsoluteJs = serializationAbsoluteTs.replace(/\.ts$/, '.js');
mock.module(serializationAbsoluteTs, serializationFactory);
mock.module(serializationAbsoluteJs, serializationFactory);
mock.module('../../src/bmsx/serializer/serializationhooks.ts', serializationFactory);
mock.module('../../src/bmsx/serializer/serializationhooks.js', serializationFactory);

const runtimeModulePromise = import('../../src/bmsx/console/runtime.ts');
const gameserializerModulePromise = import('../../src/bmsx/serializer/gameserializer.ts');

// --- Harness --------------------------------------------------------------------------------

type StubApi = {
	register_prepared_fsm(id: string, blueprint: Record<string, unknown>): void;
	rompack(): unknown;
};

type RuntimeHarness = {
	runtime: BmsxConsoleRuntime;
	interpreter: LuaInterpreter;
	api: StubApi;
	warnings: string[];
	registeredFsms: Array<{ id: string; blueprint: Record<string, unknown> }>;
};

function makeLuaHandlerFn(id: string, moduleId: string): LuaHandlerFn {
	const fn = function luaPresetBuilder() { return []; } as LuaHandlerFn & { __hid?: string; __hmod?: string };
	fn.__hid = id;
	fn.__hmod = moduleId;
	return fn;
}

async function createHarness(): Promise<RuntimeHarness> {
	const { BmsxConsoleRuntime } = await runtimeModulePromise;
	const interpreter = createLuaInterpreter();
	const warnings: string[] = [];
	const registeredFsms: Array<{ id: string; blueprint: Record<string, unknown> }> = [];
	const api: StubApi = {
		register_prepared_fsm(id, blueprint) {
			registeredFsms.push({ id, blueprint });
			StateDefinitionBuilders[id] = () => blueprint;
		},
		rompack() {
			return {};
		},
	};
	const runtime = Object.create(BmsxConsoleRuntime.prototype) as BmsxConsoleRuntime;
	const defaults: Partial<Record<keyof BmsxConsoleRuntime, unknown>> = {
		luaInterpreter: interpreter,
		caseInsensitiveLua: false,
		api,
		luaChunkName: null,
		currentLuaAssetContext: null,
		luaFsmMachineIds: new Set<string>(),
		luaFsmsByAsset: new Map<string, Set<string>>(),
		fsmChangeRecordsByAsset: new Map<string, Array<{ machineId: string }>>(),
		componentPresets: new Map<string, unknown>(),
		luaComponentPresetsByAsset: new Map<string, Set<string>>(),
		serviceDefinitions: new Map<string, unknown>(),
		luaServiceDefinitionsByAsset: new Map<string, Set<string>>(),
		worldObjectDefinitions: new Map<string, unknown>(),
		worldObjectDefinitionsByClassRef: new Map<string, unknown>(),
		luaWorldObjectsByAsset: new Map<string, Set<string>>(),
		componentDefinitions: new Map<string, unknown>(),
		luaBehaviorTreeIds: new Set<string>(),
		luaBehaviorTreesByAsset: new Map<string, Set<string>>(),
		behaviorTreeChangesByAsset: new Map<string, Set<string>>(),
		behaviorTreeDiagnostics: new Map<string, unknown[]>(),
		luaServices: new Map<string, unknown>(),
		abilityDefinitions: new Map<string, unknown>(),
		recordLuaWarning: (message: string) => {
			warnings.push(String(message));
		},
		apiFunctionNames: new Set<string>(),
		luaChunkResourceMap: new Map<string, unknown>(),
		luaChunkEnvironmentsByAssetId: new Map<string, unknown>(),
		luaChunkEnvironmentsByChunkName: new Map<string, unknown>(),
		luaGenericAssetsExecuted: new Set<string>(),
		pendingLuaWarnings: [],
	};
	Object.assign(runtime, defaults);
	return { runtime, interpreter, api, warnings, registeredFsms };
}

// --- Tests ----------------------------------------------------------------------------------

test('registerStateMachineDefinition updates definitions and change tracking across hot reload', async () => {
	const machineId = `test_machine_${Date.now()}`;
	const assetId = `asset://${machineId}`;
	const harness = await createHarness();
	const { runtime, warnings, registeredFsms } = harness;
	(runtime as unknown as { currentLuaAssetContext: any }).currentLuaAssetContext = { category: 'fsm', assetId };
	(runtime as unknown as { luaChunkName: string | null }).luaChunkName = '@fsm/test_machine.lua';

	const blueprintA = {
		id: machineId,
		states: {
			['#idle']: {
				tick: () => null,
			},
		},
	};
	runtime.registerStateMachineDefinition(blueprintA);

	assert.ok(StateDefinitions[machineId], 'initial blueprint should be registered');
	assert.equal(registeredFsms.length, 1, 'API should receive prepared FSM on initial registration');
	assert.deepEqual(registeredFsms[0]?.id, machineId);

	const fsmsByAsset = (runtime as unknown as { luaFsmsByAsset: Map<string, Set<string>> }).luaFsmsByAsset.get(assetId);
	assert.ok(fsmsByAsset && fsmsByAsset.has(machineId), 'asset should map to registered FSM id');
	assert.equal(warnings.length, 0, 'initial registration should not produce warnings');

	ActiveStateMachines.set(machineId, []);
	const blueprintB = {
		id: machineId,
		states: {
			['#idle']: {
				tick: () => '../restart',
				tape_data: ['a', 'b'],
			},
		},
	};
	runtime.registerStateMachineDefinition(blueprintB);

	const changeRecords = (runtime as unknown as { fsmChangeRecordsByAsset: Map<string, Array<{ machineId: string }>> }).fsmChangeRecordsByAsset.get(assetId);
	assert.ok(changeRecords && changeRecords.length === 1 && changeRecords[0]?.machineId === machineId, 'hot reload should record change for active machine');
	assert.ok(StateDefinitions[machineId]?.states?.['#idle'], 'definition should be replaced after hot reload');

	ActiveStateMachines.delete(machineId);
	(runtime as unknown as { luaFsmsByAsset: Map<string, Set<string>> }).luaFsmsByAsset.delete(assetId);
	(runtime as unknown as { fsmChangeRecordsByAsset: Map<string, Array<{ machineId: string }>> }).fsmChangeRecordsByAsset.delete(assetId);
	(runtime as unknown as { luaFsmMachineIds: Set<string> }).luaFsmMachineIds.delete(machineId);
	delete StateDefinitions[machineId];
	delete StateDefinitionBuilders[machineId];
});

test('registerBehaviorTreeDefinition refreshes tree definitions and change sets on hot reload', async () => {
	const treeId = `test_behavior_${Date.now()}`;
	const assetId = `asset://${treeId}`;
	const harness = await createHarness();
	const { runtime, warnings } = harness;
	(runtime as unknown as { currentLuaAssetContext: any }).currentLuaAssetContext = { category: 'behavior_tree', assetId };
	(runtime as unknown as { luaChunkName: string | null }).luaChunkName = '@bt/test_tree.lua';

	const definitionA: BehaviorTreeDefinition = {
		root: {
			type: 'Sequence',
			children: [
				{ type: 'Action', action: () => 'SUCCESS' },
			],
		},
	};
	runtime.registerBehaviorTreeDefinition({ id: treeId, definition: definitionA });

	assert.ok(behaviorTreeExists(treeId), 'behavior tree builder should exist after initial registration');
	const assetSet = (runtime as unknown as { luaBehaviorTreesByAsset: Map<string, Set<string>> }).luaBehaviorTreesByAsset.get(assetId);
	assert.ok(assetSet && assetSet.has(treeId), 'asset should track behavior tree id');
	assert.equal(warnings.length, 0, 'valid definition should not warn');

	const definitionB: BehaviorTreeDefinition = {
		root: {
			type: 'Sequence',
			children: [
				{ type: 'Action', action: () => 'SUCCESS' },
				{ type: 'Action', action: () => 'SUCCESS' },
			],
		},
	};
	runtime.registerBehaviorTreeDefinition({ id: treeId, definition: definitionB });

	const changeSet = (runtime as unknown as { behaviorTreeChangesByAsset: Map<string, Set<string>> }).behaviorTreeChangesByAsset.get(assetId);
	assert.ok(changeSet && changeSet.has(treeId), 'hot reload should record changed behavior tree');

	unregisterBehaviorTreeBuilder(treeId);
	delete BehaviorTreeDefinitions[treeId];
	(runtime as unknown as { luaBehaviorTreesByAsset: Map<string, Set<string>> }).luaBehaviorTreesByAsset.delete(assetId);
	(runtime as unknown as { behaviorTreeChangesByAsset: Map<string, Set<string>> }).behaviorTreeChangesByAsset.delete(assetId);
});

test('registerComponentPreset keeps per-asset ownership consistent between hot reloads', async () => {
	const presetId = `componentPreset_${Date.now()}`;
	const assetOne = `${presetId}:asset1`;
	const assetTwo = `${presetId}:asset2`;
	const harness = await createHarness();
	const { runtime } = harness;

	const builderA = makeLuaHandlerFn(`${presetId}::builderA`, 'module/presetA');
	const builderB = makeLuaHandlerFn(`${presetId}::builderB`, 'module/presetB');

	(runtime as unknown as { currentLuaAssetContext: any }).currentLuaAssetContext = { category: 'component_preset', assetId: assetOne };
	runtime.registerComponentPreset({ id: presetId, build: builderA });
	const presets = (runtime as unknown as { componentPresets: Map<string, any> }).componentPresets;
	const presetRecordA = presets.get(presetId);
	assert.ok(presetRecordA && presetRecordA.assetId === assetOne, 'preset should be associated with first asset');

	(runtime as unknown as { currentLuaAssetContext: any }).currentLuaAssetContext = { category: 'component_preset', assetId: assetTwo };
	runtime.registerComponentPreset({ id: presetId, build: builderB });
	const presetRecordB = presets.get(presetId);
	assert.ok(presetRecordB && presetRecordB.assetId === assetTwo, 're-registration should transfer ownership to second asset');

	const assetSetTwo = (runtime as unknown as { luaComponentPresetsByAsset: Map<string, Set<string>> }).luaComponentPresetsByAsset.get(assetTwo);
	assert.ok(assetSetTwo && assetSetTwo.has(presetId), 'second asset should reference preset id');
	const assetSetOne = (runtime as unknown as { luaComponentPresetsByAsset: Map<string, Set<string>> }).luaComponentPresetsByAsset.get(assetOne);
	assert.ok(!assetSetOne || !assetSetOne.has(presetId), 'first asset should release preset after reassignment');

	(runtime as unknown as { componentPresets: Map<string, unknown> }).componentPresets.delete(presetId);
	const presetAssetMap = runtime as unknown as { luaComponentPresetsByAsset: Map<string, Set<string>> };
	presetAssetMap.luaComponentPresetsByAsset.delete(assetOne);
	presetAssetMap.luaComponentPresetsByAsset.delete(assetTwo);
});

test('registerServiceDefinition updates service records and asset bindings', async () => {
	const serviceId = `service_${Date.now()}`;
	const assetOne = `${serviceId}:A`;
	const assetTwo = `${serviceId}:B`;
	const harness = await createHarness();
	const { runtime } = harness;

	const descriptorBase = {
		id: serviceId,
		fsms: [{ id: 'fsm.example', context: 'slot' }],
		behaviorTrees: [{ id: 'bt.example', auto_tick: true }],
		abilities: ['dash'],
		tags: ['utility'],
	};

	(runtime as unknown as { currentLuaAssetContext: any }).currentLuaAssetContext = { category: 'service', assetId: assetOne };
	runtime.registerServiceDefinition({ ...descriptorBase });
	const serviceDefinitions = (runtime as unknown as { serviceDefinitions: Map<string, any> }).serviceDefinitions;
	const recordA = serviceDefinitions.get(serviceId);
	assert.ok(recordA && recordA.assetId === assetOne, 'service should be stored with initial asset id');

	(runtime as unknown as { currentLuaAssetContext: any }).currentLuaAssetContext = { category: 'service', assetId: assetTwo };
	runtime.registerServiceDefinition({ ...descriptorBase, tags: ['utility', 'secondary'] });
	const recordB = serviceDefinitions.get(serviceId);
	assert.ok(recordB && recordB.assetId === assetTwo, 'hot reload should update asset ownership');

	const assetSetTwo = (runtime as unknown as { luaServiceDefinitionsByAsset: Map<string, Set<string>> }).luaServiceDefinitionsByAsset.get(assetTwo);
	assert.ok(assetSetTwo && assetSetTwo.has(serviceId), 'second asset should map to service id');
	const assetSetOne = (runtime as unknown as { luaServiceDefinitionsByAsset: Map<string, Set<string>> }).luaServiceDefinitionsByAsset.get(assetOne);
	assert.ok(!assetSetOne || !assetSetOne.has(serviceId), 'first asset should release service id after reassignment');

	(runtime as unknown as { serviceDefinitions: Map<string, unknown> }).serviceDefinitions.delete(serviceId);
	const serviceAssetMap = runtime as unknown as { luaServiceDefinitionsByAsset: Map<string, Set<string>> };
	serviceAssetMap.luaServiceDefinitionsByAsset.delete(assetOne);
	serviceAssetMap.luaServiceDefinitionsByAsset.delete(assetTwo);
});

test('registerWorldObjectDefinition wires constructors, defaults, and per-asset ownership', async () => {
	const { Reviver } = await gameserializerModulePromise;
	const harness = await createHarness();
	const { runtime, interpreter } = harness;
	const assetId = `asset://worldobject_${Date.now()}`;
	const objectId = `worldobject_${Date.now()}`;
	const className = `LuaTestWorldObject_${Date.now()}`;

	interpreter.execute(`
${className} = {}
function ${className}:create(owner)
	owner.created = true
end
`, `@tests/${className}.lua`);

	(runtime as unknown as { currentLuaAssetContext: any }).currentLuaAssetContext = { category: 'worldobject', assetId };
	(runtime as unknown as { luaChunkName: string | null }).luaChunkName = '@worldobject/test.lua';

	runtime.registerWorldObjectDefinition({
		id: objectId,
		class: className,
		defaults: { hp: 10 },
		components: [{ class: 'SpriteComponent', options: { layer: 'actors' } }],
		fsms: [{ id: 'fsm.machine', context: 'slotA' }],
		behaviorTrees: [{ id: 'bt.tree', auto_tick: true }],
		abilities: ['dash'],
		tags: ['enemy'],
	});

	const definitions = runtime as unknown as { worldObjectDefinitions: Map<string, any>; worldObjectDefinitionsByClassRef: Map<string, any>; luaWorldObjectsByAsset: Map<string, Set<string>> };
	const record = definitions.worldObjectDefinitions.get(objectId);
	assert.ok(record, 'definition should be stored');
	assert.equal(record.assetId, assetId, 'definition should remember asset id');
	const classRecord = definitions.worldObjectDefinitionsByClassRef.get(className);
	assert.ok(classRecord && classRecord.id === objectId, 'class reference should map to definition');
	const assetSet = definitions.luaWorldObjectsByAsset.get(assetId);
	assert.ok(assetSet && assetSet.has(objectId), 'asset should reference world object id');
	assert.equal(Reviver.constructors[objectId], record.constructor, 'Reviver should expose constructor by id');
	assert.equal((globalThis as Record<string, unknown>)[className], record.constructor, 'global scope should expose constructor by class name');

	definitions.worldObjectDefinitions.delete(objectId);
	definitions.worldObjectDefinitionsByClassRef.delete(className);
	const assetSetRef = definitions.luaWorldObjectsByAsset.get(assetId);
	if (assetSetRef) {
		assetSetRef.delete(objectId);
		if (assetSetRef.size === 0) {
			definitions.luaWorldObjectsByAsset.delete(assetId);
		}
	}
delete Reviver.constructors[objectId];
delete (globalThis as Record<string, unknown>)[className];
});
}
