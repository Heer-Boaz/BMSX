import { createLuaSemanticFrontendFromSnapshot } from './semantic/workspace/index';
import type { LuaSemanticWorkspaceSnapshot } from '../../../../machine/ts/lua/semantic/model';
import { prepareRuntimeSemanticWorkspaceForEditorBuffer } from './semantic/workspace/runtime';
import { getLinesSnapshot, getTextSnapshot } from '../../text/source_text';
import type { TextBuffer } from '../../text/text_buffer';
import type { ResourceIdentity } from '../../../common/resource';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';

export function runtimeSemanticExtraGlobalNames(bridge: RuntimeLuaTooling): string[] {
	return Array.from(bridge.luaInterpreter.globalEnvironment.keys());
}

export function buildEditorSemanticSnapshot(
	bridge: RuntimeLuaTooling,
	identity: ResourceIdentity,
	buffer: TextBuffer,
	textVersion: number,
): LuaSemanticWorkspaceSnapshot {
	const source = getTextSnapshot(buffer);
	return prepareRuntimeSemanticWorkspaceForEditorBuffer(bridge.sources, identity.domain, {
		path: identity.path,
		source,
		lines: getLinesSnapshot(buffer),
		version: textVersion,
	});
}

export function createEditorSemanticFrontend(bridge: RuntimeLuaTooling, snapshot: LuaSemanticWorkspaceSnapshot): ReturnType<typeof createLuaSemanticFrontendFromSnapshot> {
	return createLuaSemanticFrontendFromSnapshot(snapshot, {
		extraGlobalNames: runtimeSemanticExtraGlobalNames(bridge),
	});
}

export function buildEditorSemanticFrontend(
	bridge: RuntimeLuaTooling,
	identity: ResourceIdentity,
	buffer: TextBuffer,
	textVersion: number,
): ReturnType<typeof createLuaSemanticFrontendFromSnapshot> {
	return createEditorSemanticFrontend(bridge, buildEditorSemanticSnapshot(bridge, identity, buffer, textVersion));
}
