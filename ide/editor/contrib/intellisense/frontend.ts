import { editorTextModelService } from '../../model/model_service';
import { createLuaSemanticFrontendFromSnapshot, type LuaSemanticFrontendEnvironment } from './semantic/workspace/index';
import type { LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import { getOrCreateSemanticProject } from './semantic/workspace/state';
import type { TextBuffer } from '../../text/text_buffer';
import type { ResourceIdentity } from '../../../common/resource';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { listLuaBuiltinDescriptors } from '../../../runtime/lua_builtins';
import { PROGRAM_BOOT_GLOBAL_NAMES, type ProgramCompileDomain } from '../../../../toolchain/ts/lua/compiler/system_boot_symbols';

export function buildEditorSemanticSnapshot(
	catalog: WorkspaceSourceCatalog,
	identity: ResourceIdentity,
	buffer: TextBuffer,
): LuaSemanticWorkspaceSnapshot {
	const project = getOrCreateSemanticProject(editorTextModelService, identity.contextId);
	project.synchronizeSources(catalog);
	project.analyzeDocument(identity, buffer);
	return project.getSnapshot();
}

const semanticEnvironments = new Map<ProgramCompileDomain, LuaSemanticFrontendEnvironment>();

export function createEditorSemanticFrontend(snapshot: LuaSemanticWorkspaceSnapshot, programDomain: ProgramCompileDomain): ReturnType<typeof createLuaSemanticFrontendFromSnapshot> {
	const builtinDescriptors = listLuaBuiltinDescriptors();
	let semanticEnvironment = semanticEnvironments.get(programDomain);
	if (semanticEnvironment === undefined || semanticEnvironment.builtinDescriptors !== builtinDescriptors) {
		semanticEnvironment = { builtinDescriptors, extraGlobalNames: PROGRAM_BOOT_GLOBAL_NAMES[programDomain] };
		semanticEnvironments.set(programDomain, semanticEnvironment);
	}
	return createLuaSemanticFrontendFromSnapshot(snapshot, semanticEnvironment);
}

export function buildEditorSemanticFrontend(
	catalog: WorkspaceSourceCatalog,
	identity: ResourceIdentity,
	buffer: TextBuffer,
): ReturnType<typeof createLuaSemanticFrontendFromSnapshot> {
	return createEditorSemanticFrontend(buildEditorSemanticSnapshot(catalog, identity, buffer), catalog.getContext(identity.contextId).programDomain);
}
