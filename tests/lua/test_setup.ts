import Module from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

class TestRegistry {
	static instance = new TestRegistry();
	private readonly ids = new Set<string>();

	public register(entity: { id: string }): void {
		this.ids.add(entity.id);
	}

	public deregister(id: string): void {
		this.ids.delete(id);
	}

	public getRegisteredEntityIds(): string[] {
		return Array.from(this.ids);
	}
}

const extensions = (Module as any)._extensions as Record<string, (module: any, filename: string) => void>;

if (!extensions['.glsl']) {
	extensions['.glsl'] = (module, filename) => {
		const source = readFileSync(filename, 'utf8');
		module._compile(`module.exports = ${JSON.stringify(source)};`, filename);
	};
}

const originalLoad = (Module as any)._load;
const resolveFilename = (Module as any)._resolveFilename;
const registryModulePath = path.resolve(__dirname, '../../src/bmsx/core/registry.ts');
const fsmlibraryModulePath = path.resolve(__dirname, '../../src/bmsx/fsm/fsmlibrary.ts');
const stateModulePath = path.resolve(__dirname, '../../src/bmsx/fsm/state.ts');
const gameModulePath = path.resolve(__dirname, '../../src/bmsx/core/engine.ts');
const worldModulePath = path.resolve(__dirname, '../../src/bmsx/core/world.ts');
const spaceModulePath = path.resolve(__dirname, '../../src/bmsx/core/space.ts');

const worldStub = {
	objToSpaceMap: new Map<string, string>(),
	onObjectSpawned: () => {},
	dispatchWorldLifecycleSlot: () => {},
	depthDirtyBatch: null as Set<string>,
	objects: () => [],
	activeSpaceId: null,
	activeCameras: [],
	activeLights: [],
};

const eventEmitterStub = {
	emit: () => {},
	on: () => {},
	off: () => {},
	removeSubscriber: () => {},
};

const gameStub = {
	registry: TestRegistry.instance,
	world: worldStub,
	platform: { clock: { now: () => 0 } },
	event_emitter: eventEmitterStub,
	emitPresentation: () => {},
	emitGameplay: () => {},
};

const gameExports = { Game: class {}, default: gameStub, $: gameStub };
const worldExports = {
	World: class {},
	WorldConfiguration: class {},
	id2obj: Symbol('id2obj'),
	id2objectType: class {},
	new_vec2: () => ({ x: 0, y: 0 }),
	default: worldStub,
};
const spaceExports = {
	Space: class {},
	id2spaceType: {},
	obj_id2space_id_type: {},
	id_to_space_symbol: Symbol('id_to_space'),
	obj_id_to_space_id_symbol: Symbol('obj_space'),
};

function matchesModulePath(resolved: string, modulePath: string): boolean {
	return resolved === modulePath || resolved === modulePath.slice(0, -3) || resolved === modulePath.replace(/\.ts$/, '.js');
}

const StateDefinitions = Object.create(null) as Record<string, any>;
const ActiveStateMachines = new Map<string, any[]>();

function rebuildStateMachine(machineId: string, blueprint: any): void {
	StateDefinitions[machineId] = blueprint;
}

function applyPreparedStateMachine(machineId: string, blueprint: any): void {
	StateDefinitions[machineId] = blueprint;
	const roots = ActiveStateMachines.get(machineId);
	if (!roots) {
		return;
	}
	const nextData = blueprint.states?.['#idle']?.data;
	for (const root of roots) {
		const idle = root.states?.['#idle'];
		if (idle) {
			idle.definition.data = nextData;
		}
	}
}

const fsmlibraryExports = {
	ActiveStateMachines,
	StateDefinitions,
	applyPreparedStateMachine,
	rebuildStateMachine,
	default: {
		ActiveStateMachines,
		StateDefinitions,
		applyPreparedStateMachine,
		rebuildStateMachine,
	},
};

const stateExports = {
	State: class {
		static create(machineId: string, targetId: string) {
			const blueprint = StateDefinitions[machineId];
			const idleData = blueprint?.states?.['#idle']?.data;
			return {
				id: targetId,
				states: {
					'#idle': {
						definition: {
							data: idleData,
						},
					},
				},
				dispose(): void {
					/* no-op */
				},
			};
		}
	},
	default: {
		State: class {},
	},
};

(Module as any)._load = function (request: string, parent: any, isMain: boolean) {
	if (request.includes('/src/bmsx/core/registry')) {
		return { Registry: TestRegistry, default: TestRegistry };
	}
	if (request.includes('/src/bmsx/fsm/fsmlibrary')) {
		return fsmlibraryExports;
	}
	if (request.includes('/src/bmsx/fsm/state')) {
		return stateExports;
	}
	const resolved = resolveFilename.call(this, request, parent, isMain);
	if (matchesModulePath(resolved, registryModulePath)) {
		return { Registry: TestRegistry, default: TestRegistry };
	}
	if (matchesModulePath(resolved, fsmlibraryModulePath)) {
		return fsmlibraryExports;
	}
	if (matchesModulePath(resolved, stateModulePath)) {
		return stateExports;
	}
	if (matchesModulePath(resolved, gameModulePath)) {
		return gameExports;
	}
	if (matchesModulePath(resolved, worldModulePath)) {
		return worldExports;
	}
	if (matchesModulePath(resolved, spaceModulePath)) {
		return spaceExports;
	}
	return originalLoad.apply(this, arguments as any);
};
