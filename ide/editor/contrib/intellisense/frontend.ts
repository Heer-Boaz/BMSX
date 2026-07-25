import { machineManager } from '../../../../machine/ts/core/machine_manager';
import { createLuaSemanticFrontendFromSnapshot } from './semantic/workspace/index';
import type { LuaSemanticWorkspaceSnapshot } from '../../../../machine/ts/lua/semantic/model';
import { prepareRuntimeSemanticWorkspaceForEditorBuffer } from './semantic/workspace/runtime';
import { getLinesSnapshot, getTextSnapshot } from '../../text/source_text';
import type { TextBuffer } from '../../text/text_buffer';

export function runtimeSemanticExtraGlobalNames(): string[] {
	return Array.from(machineManager.ideState.nativeBridge.luaInterpreter.globalEnvironment.keys());
}

export function buildEditorSemanticSnapshot(path: string, buffer: TextBuffer, textVersion: number): LuaSemanticWorkspaceSnapshot {
	const source = getTextSnapshot(buffer);
	return prepareRuntimeSemanticWorkspaceForEditorBuffer({
		path,
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

export function buildEditorSemanticFrontend(path: string, buffer: TextBuffer, textVersion: number): ReturnType<typeof createLuaSemanticFrontendFromSnapshot> {
	return createEditorSemanticFrontend(buildEditorSemanticSnapshot(path, buffer, textVersion));
}
