type NativeBridgeRegistryState = {
	nextNativeFunctionBridgeId: number;
	nextNativeObjectBridgeId: number;
	nativeFunctionBridgeIds: Set<number>;
	nativeObjectBridgeIds: Set<number>;
};

const registries = new WeakMap<object, NativeBridgeRegistryState>();

function getRegistry(owner: object): NativeBridgeRegistryState {
	let registry = registries.get(owner);
	if (registry === undefined) {
		registry = {
			nextNativeFunctionBridgeId: 1,
			nextNativeObjectBridgeId: 1,
			nativeFunctionBridgeIds: new Set<number>(),
			nativeObjectBridgeIds: new Set<number>(),
		};
		registries.set(owner, registry);
	}
	return registry;
}

export function allocateNativeFunctionBridge(owner: object): number {
	const registry = getRegistry(owner);
	let bridgeId = registry.nextNativeFunctionBridgeId;
	while (registry.nativeFunctionBridgeIds.has(bridgeId)) {
		bridgeId += 1;
	}
	registry.nativeFunctionBridgeIds.add(bridgeId);
	registry.nextNativeFunctionBridgeId = bridgeId + 1;
	return bridgeId;
}

export function reserveNativeFunctionBridge(owner: object, bridgeId: number): void {
	if (bridgeId === 0) {
		return;
	}
	const registry = getRegistry(owner);
	registry.nativeFunctionBridgeIds.add(bridgeId);
	if (bridgeId >= registry.nextNativeFunctionBridgeId) {
		registry.nextNativeFunctionBridgeId = bridgeId + 1;
	}
}

export function releaseNativeFunctionBridge(owner: object, bridgeId: number): void {
	if (bridgeId === 0) {
		return;
	}
	const registry = registries.get(owner);
	if (registry === undefined) {
		return;
	}
	registry.nativeFunctionBridgeIds.delete(bridgeId);
	if (registry.nativeFunctionBridgeIds.size === 0 && registry.nativeObjectBridgeIds.size === 0) {
		registries.delete(owner);
	}
}

export function allocateNativeObjectBridge(owner: object): number {
	const registry = getRegistry(owner);
	let bridgeId = registry.nextNativeObjectBridgeId;
	while (registry.nativeObjectBridgeIds.has(bridgeId)) {
		bridgeId += 1;
	}
	registry.nativeObjectBridgeIds.add(bridgeId);
	registry.nextNativeObjectBridgeId = bridgeId + 1;
	return bridgeId;
}

export function reserveNativeObjectBridge(owner: object, bridgeId: number): void {
	if (bridgeId === 0) {
		return;
	}
	const registry = getRegistry(owner);
	registry.nativeObjectBridgeIds.add(bridgeId);
	if (bridgeId >= registry.nextNativeObjectBridgeId) {
		registry.nextNativeObjectBridgeId = bridgeId + 1;
	}
}

export function releaseNativeObjectBridge(owner: object, bridgeId: number): void {
	if (bridgeId === 0) {
		return;
	}
	const registry = registries.get(owner);
	if (registry === undefined) {
		return;
	}
	registry.nativeObjectBridgeIds.delete(bridgeId);
	if (registry.nativeFunctionBridgeIds.size === 0 && registry.nativeObjectBridgeIds.size === 0) {
		registries.delete(owner);
	}
}
