import { Runtime } from '../../../../machine/runtime/runtime';
import { createLuaSemanticFrontendFromSnapshot } from './semantic/workspace';
import type { LuaSemanticWorkspaceSnapshot } from '../../../../lua/semantic/model';
import { prepareRuntimeSemanticWorkspaceForEditorBuffer } from './semantic/workspace/runtime';
import { getLinesSnapshot, getTextSnapshot } from '../../text/source_text';
import type { TextBuffer } from '../../text/text_buffer';

export function runtimeSemanticExtraGlobalNames(): string[] {
	return Array.from(Runtime.instance.interpreter.globalEnvironment.keys());
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
