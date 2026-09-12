import {
	buildLuaSemanticFrontendFromSnapshot,
	type LuaSemanticPositionTarget,
} from '../../toolchain/ts/lua/semantic/frontend';
import { LuaSemanticWorkspace, type FileSemanticData, type LuaSemanticWorkspaceSnapshot } from '../../toolchain/ts/lua/semantic/model';

/** Retain the fixture's binder identities, including recovered syntax, in a real workspace. */
export function semanticSnapshot(...files: readonly FileSemanticData[]): LuaSemanticWorkspaceSnapshot {
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFiles(files);
	return workspace.getSnapshot();
}

const frontends = new WeakMap<
	LuaSemanticWorkspaceSnapshot,
	ReturnType<typeof buildLuaSemanticFrontendFromSnapshot>
>();
const EMPTY_POSITION_TARGETS: readonly LuaSemanticPositionTarget[] = [];

function semanticFrontend(snapshot: LuaSemanticWorkspaceSnapshot): ReturnType<typeof buildLuaSemanticFrontendFromSnapshot> {
	let frontend = frontends.get(snapshot);
	if (!frontend) {
		frontend = buildLuaSemanticFrontendFromSnapshot(snapshot);
		frontends.set(snapshot, frontend);
	}
	return frontend;
}

export function semanticSymbolsAt(
	snapshot: LuaSemanticWorkspaceSnapshot,
	path: string,
	line: number,
	column: number,
): readonly LuaSemanticPositionTarget[] {
	const symbols = semanticFrontend(snapshot).findSymbolsByPosition(path, line, column);
	return symbols ? symbols.targets : EMPTY_POSITION_TARGETS;
}

export function semanticSymbolAt(
	snapshot: LuaSemanticWorkspaceSnapshot,
	path: string,
	line: number,
	column: number,
): LuaSemanticPositionTarget | null {
	const targets = semanticSymbolsAt(snapshot, path, line, column);
	return targets.length === 1 ? targets[0] : null;
}
