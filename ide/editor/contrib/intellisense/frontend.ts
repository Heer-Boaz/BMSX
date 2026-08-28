import {
	createLuaSemanticFrontendFromSnapshot,
	type LuaSemanticFrontendEnvironment,
} from './semantic/workspace/index';
import type { LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import { getOrCreateSemanticProject } from './semantic/workspace/state';
import { getTextSnapshot } from '../../text/source_text';
import type { TextBuffer } from '../../text/text_buffer';
import type { ResourceIdentity } from '../../../common/resource';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import type { LuaInterpreter } from '../../../language/lua/interpreter/interpreter';
import { listLuaBuiltinDescriptors } from '../../../runtime/lua_builtins';
import type { LuaBuiltinDescriptor } from '../../../../toolchain/ts/lua/semantic_contracts';

type RetainedSemanticEnvironment = {
	readonly builtinDescriptors: readonly LuaBuiltinDescriptor[];
	readonly environment: LuaSemanticFrontendEnvironment;
};

const semanticEnvironmentByInterpreter = new WeakMap<LuaInterpreter, RetainedSemanticEnvironment>();

export function buildEditorSemanticSnapshot(
	bridge: RuntimeLuaTooling,
	identity: ResourceIdentity,
	buffer: TextBuffer,
): LuaSemanticWorkspaceSnapshot {
	const source = getTextSnapshot(buffer);
	const project = getOrCreateSemanticProject(identity.domain);
	project.synchronizeRuntimeSources(bridge.sources);
	project.updateDocument(identity.path, source);
	return project.getSnapshot();
}

export function createEditorSemanticFrontend(bridge: RuntimeLuaTooling, snapshot: LuaSemanticWorkspaceSnapshot): ReturnType<typeof createLuaSemanticFrontendFromSnapshot> {
	const builtinDescriptors = listLuaBuiltinDescriptors();
	const interpreter = bridge.luaInterpreter;
	let environment = semanticEnvironmentByInterpreter.get(interpreter);
	if (!environment || environment.builtinDescriptors !== builtinDescriptors) {
		environment = {
			builtinDescriptors,
			environment: {
				builtinDescriptors,
				extraGlobalNames: Array.from(interpreter.globalEnvironment.keys()),
			},
		};
		semanticEnvironmentByInterpreter.set(interpreter, environment);
	}
	return createLuaSemanticFrontendFromSnapshot(snapshot, environment.environment);
}

export function buildEditorSemanticFrontend(
	bridge: RuntimeLuaTooling,
	identity: ResourceIdentity,
	buffer: TextBuffer,
): ReturnType<typeof createLuaSemanticFrontendFromSnapshot> {
	return createEditorSemanticFrontend(bridge, buildEditorSemanticSnapshot(bridge, identity, buffer));
}
