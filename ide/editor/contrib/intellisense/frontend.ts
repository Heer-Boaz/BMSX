import { editorTextModelService } from '../../model/model_service';
import { createLuaSemanticFrontendFromSnapshot, type LuaSemanticFrontendEnvironment } from './semantic/workspace/index';
import type { LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import { getOrCreateSemanticProject } from './semantic/workspace/state';
import type { TextBuffer } from '../../text/text_buffer';
import type { ResourceIdentity } from '../../../common/resource';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { listLuaBuiltinDescriptors } from '../../../runtime/lua_builtins';
import { SYSTEM_ROM_BOOT_SYMBOL_NAMES } from '../../../../toolchain/ts/lua/compiler/system_boot_symbols';

export function buildEditorSemanticSnapshot(
	sources: RuntimeSourceState,
	identity: ResourceIdentity,
	buffer: TextBuffer,
): LuaSemanticWorkspaceSnapshot {
	const project = getOrCreateSemanticProject(editorTextModelService, identity.domain);
	project.synchronizeRuntimeSources(sources);
	project.analyzeDocument(identity.path, buffer);
	return project.getSnapshot();
}

let semanticEnvironment: LuaSemanticFrontendEnvironment;

export function createEditorSemanticFrontend(snapshot: LuaSemanticWorkspaceSnapshot): ReturnType<typeof createLuaSemanticFrontendFromSnapshot> {
	const builtinDescriptors = listLuaBuiltinDescriptors();
	if (semanticEnvironment === undefined || semanticEnvironment.builtinDescriptors !== builtinDescriptors) {
		semanticEnvironment = { builtinDescriptors, extraGlobalNames: SYSTEM_ROM_BOOT_SYMBOL_NAMES };
	}
	return createLuaSemanticFrontendFromSnapshot(snapshot, semanticEnvironment);
}

export function buildEditorSemanticFrontend(
	sources: RuntimeSourceState,
	identity: ResourceIdentity,
	buffer: TextBuffer,
): ReturnType<typeof createLuaSemanticFrontendFromSnapshot> {
	return createEditorSemanticFrontend(buildEditorSemanticSnapshot(sources, identity, buffer));
}
