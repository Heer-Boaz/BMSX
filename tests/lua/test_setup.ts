import Module from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Registry } from '../../src/bmsx/core/registry';

const extensions = (Module as any)._extensions as Record<string, (module: any, filename: string) => void>;

if (!extensions['.glsl']) {
	extensions['.glsl'] = (module, filename) => {
		const source = readFileSync(filename, 'utf8');
		module._compile(`module.exports = ${JSON.stringify(source)};`, filename);
	};
}

const originalLoad = (Module as any)._load;
const resolveFilename = (Module as any)._resolveFilename;
const gameModulePath = path.resolve(__dirname, '../../src/bmsx/core/game.ts');
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
	registry: Registry.instance,
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

(Module as any)._load = function (request: string, parent: any, isMain: boolean) {
	const resolved = resolveFilename.call(this, request, parent, isMain);
	if (resolved === gameModulePath) {
		return gameExports;
	}
	if (resolved === worldModulePath) {
		return worldExports;
	}
	if (resolved === spaceModulePath) {
		return spaceExports;
	}
	return originalLoad.apply(this, arguments as any);
};
