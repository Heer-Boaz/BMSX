import { buildLuaSemanticFrontendFromSnapshot, type LuaSemanticFrontend } from '../../../../../../toolchain/ts/lua/semantic/frontend';
import type { LuaBuiltinDescriptor, LuaSymbolEntry } from '../../../../../../toolchain/ts/lua/semantic_contracts';
import type { LuaSemanticWorkspaceSnapshot } from '../../../../../../toolchain/ts/lua/semantic/model';

export { LuaSemanticWorkspace } from '../../../../../../toolchain/ts/lua/semantic/model';

export type LuaSemanticFrontendEnvironment = {
	readonly builtinDescriptors?: readonly LuaBuiltinDescriptor[];
	readonly extraGlobalNames?: readonly string[];
	readonly externalGlobalSymbols?: readonly LuaSymbolEntry[];
};

const DEFAULT_FRONTEND_ENVIRONMENT: LuaSemanticFrontendEnvironment = Object.freeze({});

const workspaceSnapshotCache = new WeakMap<
	LuaSemanticWorkspaceSnapshot,
	WeakMap<LuaSemanticFrontendEnvironment, LuaSemanticFrontend>
>();

export function createLuaSemanticFrontendFromSnapshot(
	snapshot: LuaSemanticWorkspaceSnapshot,
	environment: LuaSemanticFrontendEnvironment = DEFAULT_FRONTEND_ENVIRONMENT,
): LuaSemanticFrontend {
	let frontends = workspaceSnapshotCache.get(snapshot);
	if (!frontends) {
		frontends = new WeakMap();
		workspaceSnapshotCache.set(snapshot, frontends);
	}
	const cached = frontends.get(environment);
	if (cached) {
		return cached;
	}
	const frontend = buildLuaSemanticFrontendFromSnapshot(snapshot, {
		builtinDescriptors: environment.builtinDescriptors,
		extraGlobalNames: environment.extraGlobalNames,
		externalGlobalSymbols: environment.externalGlobalSymbols,
	});
	frontends.set(environment, frontend);
	return frontend;
}
