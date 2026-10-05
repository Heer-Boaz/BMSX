import { editorTextModelService } from '../../model/model_service';
import { createLuaSemanticFrontendFromSnapshot, type LuaSemanticFrontendEnvironment } from './semantic/workspace/index';
import type { LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import { getOrCreateSemanticProject } from './semantic/workspace/state';
import type { TextBuffer } from '../../text/text_buffer';
import { SYSTEM_RESOURCE_DOMAIN, type ResourceDomain, type ResourceIdentity } from '../../../common/resource';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { listLuaBuiltinDescriptors } from '../../../runtime/lua_builtins';
import { PROGRAM_BOOT_GLOBAL_NAMES, type ProgramCompileDomain } from '../../../../toolchain/ts/lua/compiler/system_boot_symbols';

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

const semanticEnvironments = new Map<ProgramCompileDomain, LuaSemanticFrontendEnvironment>();

export function createEditorSemanticFrontend(snapshot: LuaSemanticWorkspaceSnapshot, domain: ResourceDomain): ReturnType<typeof createLuaSemanticFrontendFromSnapshot> {
	const programDomain = domain === SYSTEM_RESOURCE_DOMAIN ? 'system' : 'cart';
	const builtinDescriptors = listLuaBuiltinDescriptors();
	let semanticEnvironment = semanticEnvironments.get(programDomain);
	if (semanticEnvironment === undefined || semanticEnvironment.builtinDescriptors !== builtinDescriptors) {
		semanticEnvironment = { builtinDescriptors, extraGlobalNames: PROGRAM_BOOT_GLOBAL_NAMES[programDomain] };
		semanticEnvironments.set(programDomain, semanticEnvironment);
	}
	return createLuaSemanticFrontendFromSnapshot(snapshot, semanticEnvironment);
}

export function buildEditorSemanticFrontend(
	sources: RuntimeSourceState,
	identity: ResourceIdentity,
	buffer: TextBuffer,
): ReturnType<typeof createLuaSemanticFrontendFromSnapshot> {
	return createEditorSemanticFrontend(buildEditorSemanticSnapshot(sources, identity, buffer), identity.domain);
}
