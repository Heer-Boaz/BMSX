export type RuntimeObjectHandle = {
	objectId: number;
	objectAddr: number;
};

type RuntimeObjectRegistryState = {
	objectIds: WeakMap<object, number>;
	objectsById: Map<number, object>;
};

const registries = new WeakMap<object, RuntimeObjectRegistryState>();

function getRegistry(owner: object): RuntimeObjectRegistryState {
	let registry = registries.get(owner);
	if (registry === undefined) {
		registry = {
			objectIds: new WeakMap<object, number>(),
			objectsById: new Map<number, object>(),
		};
		registries.set(owner, registry);
	}
	return registry;
}

export function registerRuntimeObject(owner: object, value: object, id: number): void {
	const registry = getRegistry(owner);
	registry.objectIds.set(value, id);
	registry.objectsById.set(id, value);
}

export function getRegisteredRuntimeObjectId(owner: object, value: object): number | undefined {
	return getRegistry(owner).objectIds.get(value);
}

export function unregisterRuntimeObject(owner: object, value: object): void {
	const registry = getRegistry(owner);
	const id = registry.objectIds.get(value);
	if (id === undefined) {
		return;
	}
	registry.objectIds.delete(value);
	if (registry.objectsById.get(id) === value) {
		registry.objectsById.delete(id);
	}
}

export function unregisterRuntimeObjectId(owner: object, id: number): void {
	const registry = getRegistry(owner);
	const value = registry.objectsById.get(id);
	if (!value) {
		return;
	}
	registry.objectsById.delete(id);
	registry.objectIds.delete(value);
}

export function resolveRuntimeObjectId<T extends object>(owner: object, id: number): T {
	const value = getRegistry(owner).objectsById.get(id);
	if (!value) {
		throw new Error(`[RuntimeObjectRegistry] Unknown object id ${id}.`);
	}
	return value as T;
}

export function forEachRegisteredRuntimeObject(owner: object, fn: (id: number, value: object) => void): void {
	for (const [id, value] of getRegistry(owner).objectsById.entries()) {
		fn(id, value);
	}
}
