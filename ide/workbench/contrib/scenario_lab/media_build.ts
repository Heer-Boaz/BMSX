import { readWorkspaceLuaSourceText } from '../../../workspace/files';
import { releaseWorkspaceSourceOverrides } from '../../../workspace/cache';
import { LuaInterpreter } from '../../../language/lua/interpreter/interpreter';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import { forkRuntimeSourceState, type RuntimeSourceState } from '../../../runtime/sources';
import { blua32MediaRequiresRebuild, buildBlua32Media, layoutBlua32MediaInstallation } from '../../../runtime/lua_pipeline';
import { applyAllWorkspaceSourceOverrides, applyLuaTextModelSources } from '../../../workspace/workspace';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import type { LuaTextModelSourceSnapshot } from '../../services/working_copy/lua_sources';
import { workspaceDirtyRecords } from '../../workspace/state';
import type { TestRunMedia } from '../../../testing/run';
import type { MachineModelSpec } from '../../../../machine/ts/spec/bmsx/model';

/** Editable records belong to this build, never to the authoring machine or its debugger. */
export async function buildTestRunMedia(
	authoring: RuntimeSourceState,
	tooling: RuntimeLuaTooling,
	storage: KeyValueStorage,
	programSources: readonly LuaTextModelSourceSnapshot[],
	slot: 0 | 1,
	machineModel: MachineModelSpec,
): Promise<TestRunMedia> {
	const sources = forkRuntimeSourceState(authoring);
	try {
		await applyAllWorkspaceSourceOverrides(storage, sources, new Map(workspaceDirtyRecords));
		applyLuaTextModelSources(sources, programSources);
		let systemRom = sources.systemRom.bytes;
		const cartridgeSlots: [Uint8Array | null, Uint8Array | null] = [
			sources.cartridgeSlots[0] === null ? null : sources.cartridgeSlots[0].rom.bytes,
			sources.cartridgeSlots[1] === null ? null : sources.cartridgeSlots[1].rom.bytes,
		];
		if (blua32MediaRequiresRebuild(sources)) {
			const media = layoutBlua32MediaInstallation(sources, buildBlua32Media(sources,
				new LuaInterpreter(tooling.luaJsBridge), machineModel.ramBytes,
				sources.systemBlua32MediaDirty, sources.cartridgeBlua32MediaDirty, 'boot'));
			if (media.systemLayer !== null) systemRom = media.systemLayer.bytes;
			for (const index of [0, 1] as const) {
				if (media.cartridgeLayers[index] !== null) cartridgeSlots[index] = media.cartridgeLayers[index]!.bytes;
			}
		}
		const sourceOnlyModules = sources.cartridgeSlots[slot]!.luaSources.records
			.filter(record => !record.program_module && !record.generated)
			.map(record => ({ sourcePath: record.source_path,
				source: readWorkspaceLuaSourceText(sources.cartridgeSlots[slot]!.luaSources, record) }));
		return { systemRom, cartridgeSlots, sourceOnlyModules, machineModel, optLevel: sources.realtimeCompileOptLevel };
	} finally {
		releaseWorkspaceSourceOverrides(sources.systemLuaSources);
		for (const cartridge of sources.cartridgeSlots) {
			if (cartridge !== null) releaseWorkspaceSourceOverrides(cartridge.luaSources);
		}
	}
}
