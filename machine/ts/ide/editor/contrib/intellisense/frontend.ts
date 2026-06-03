import { createLuaSemanticFrontendFromSnapshot } from './semantic/workspace';
import type { LuaSemanticWorkspaceSnapshot } from '../../../../lua/semantic/model';
import { prepareRuntimeSemanticWorkspaceForEditorBuffer } from './semantic/workspace/runtime';
import { getLinesSnapshot, getTextSnapshot } from '../../text/source_text';
import type { TextBuffer } from '../../text/text_buffer';
import type { Runtime } from '../../../../machine/runtime/runtime';

export function runtimeSemanticExtraGlobalNames(runtime: Runtime): string[] {
	return Array.from(runtime.interpreter.globalEnvironment.keys());
}

export function buildEditorSemanticSnapshot(runtime: Runtime, path: string, buffer: TextBuffer, textVersion: number): LuaSemanticWorkspaceSnapshot {
	const source = getTextSnapshot(buffer);
	return prepareRuntimeSemanticWorkspaceForEditorBuffer(runtime, {
		path,
		source,
		lines: getLinesSnapshot(buffer),
		version: textVersion,
	});
}

export function createEditorSemanticFrontend(runtime: Runtime, snapshot: LuaSemanticWorkspaceSnapshot): ReturnType<typeof createLuaSemanticFrontendFromSnapshot> {
	return createLuaSemanticFrontendFromSnapshot(snapshot, {
		extraGlobalNames: runtimeSemanticExtraGlobalNames(runtime),
	});
}

export function buildEditorSemanticFrontend(runtime: Runtime, path: string, buffer: TextBuffer, textVersion: number): ReturnType<typeof createLuaSemanticFrontendFromSnapshot> {
	return createEditorSemanticFrontend(runtime, buildEditorSemanticSnapshot(runtime, path, buffer, textVersion));
}
