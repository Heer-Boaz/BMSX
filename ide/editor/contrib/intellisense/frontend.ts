import { runtimeWorkbenchState } from '../../../runtime/workbench_state';
import { createLuaSemanticFrontendFromSnapshot } from './semantic/workspace/index';
import type { LuaSemanticWorkspaceSnapshot } from '../../../../machine/ts/lua/semantic/model';
import { prepareRuntimeSemanticWorkspaceForEditorBuffer } from './semantic/workspace/runtime';
import { getLinesSnapshot, getTextSnapshot } from '../../text/source_text';
import type { TextBuffer } from '../../text/text_buffer';
import type { ResourceIdentity } from '../../../common/resource';

export function runtimeSemanticExtraGlobalNames(): string[] {
	return Array.from(runtimeWorkbenchState.ide.nativeBridge.luaInterpreter.globalEnvironment.keys());
}

export function buildEditorSemanticSnapshot(
	identity: ResourceIdentity,
	buffer: TextBuffer,
	textVersion: number,
): LuaSemanticWorkspaceSnapshot {
	const source = getTextSnapshot(buffer);
	return prepareRuntimeSemanticWorkspaceForEditorBuffer(identity.domain, {
		path: identity.path,
		source,
		lines: getLinesSnapshot(buffer),
		version: textVersion,
	});
}

export function createEditorSemanticFrontend(snapshot: LuaSemanticWorkspaceSnapshot): ReturnType<typeof createLuaSemanticFrontendFromSnapshot> {
	return createLuaSemanticFrontendFromSnapshot(snapshot, {
		extraGlobalNames: runtimeSemanticExtraGlobalNames(),
	});
}

export function buildEditorSemanticFrontend(
	identity: ResourceIdentity,
	buffer: TextBuffer,
	textVersion: number,
): ReturnType<typeof createLuaSemanticFrontendFromSnapshot> {
	return createEditorSemanticFrontend(buildEditorSemanticSnapshot(identity, buffer, textVersion));
}
