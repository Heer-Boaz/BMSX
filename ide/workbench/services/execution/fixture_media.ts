import { readWorkspaceLuaSourceText } from '../../../workspace/files';
import { releaseWorkspaceSourceOverrides } from '../../../workspace/cache';
import { forkRuntimeSourceState, type RuntimeSourceState } from '../../../runtime/sources';
import { blua32MediaRequiresRebuild, buildBlua32Media, layoutBlua32MediaInstallation } from '../../../runtime/lua_pipeline';
import { applyAllWorkspaceSourceOverrides, applyLuaTextModelSources } from '../../../workspace/workspace';
import type { LuaTextModelSourceSnapshot } from '../working_copy/lua_sources';
import type { WorkspaceRecord } from '../../../workspace/records';
import type { FixtureMedia } from '../../../testing/fixture_media';
import type { MachineModelSpec } from '../../../../machine/ts/spec/bmsx/model';
import type { ScenarioTestSource } from '../../../../toolchain/ts/rompack/scenario_test';

/** Editable records belong to this build, never to the authoring machine or its debugger. */
export async function buildFixtureMedia(
	authoring: RuntimeSourceState,
	dirtyRecords: ReadonlyMap<string, WorkspaceRecord>,
	programSources: readonly LuaTextModelSourceSnapshot[],
	slot: 0 | 1,
	machineModel: MachineModelSpec,
): Promise<FixtureMedia> {
	const sources = forkRuntimeSourceState(authoring);
	try {
		await applyAllWorkspaceSourceOverrides(sources, new Map(dirtyRecords));
		applyLuaTextModelSources(sources, programSources);
		let systemRom = sources.systemRom.bytes;
		let cartridgeIndex = sources.cartridgeSlots[slot]!.rom.index;
		const cartridgeSlots: [Uint8Array | null, Uint8Array | null] = [
			sources.cartridgeSlots[0] === null ? null : sources.cartridgeSlots[0].rom.bytes,
			sources.cartridgeSlots[1] === null ? null : sources.cartridgeSlots[1].rom.bytes,
		];
		if (blua32MediaRequiresRebuild(sources)) {
			const media = layoutBlua32MediaInstallation(sources, buildBlua32Media(sources,
				machineModel.ramBytes,
				{ system: sources.systemBlua32MediaDirty ? 'workspace' : null,
					cartridgeSlots: [sources.cartridgeBlua32MediaDirty[0] ? 'workspace' : null, sources.cartridgeBlua32MediaDirty[1] ? 'workspace' : null] }, 'boot'));
			if (media.systemLayer !== null) systemRom = media.systemLayer.bytes;
			for (const index of [0, 1] as const) {
				const layer = media.cartridgeLayers[index];
				if (layer !== null) {
					cartridgeSlots[index] = layer.bytes;
					if (index === slot) cartridgeIndex = layer.index;
				}
			}
		}
		const registry = sources.cartridgeSlots[slot]!.luaSources;
		const sourceOnlyModules: ScenarioTestSource[] = [];
		for (const asset of cartridgeIndex.entries) {
			if (asset.type !== 'lua' || asset.program_module) continue;
			const record = registry.path2lua[asset.source_path!];
			sourceOnlyModules.push({ sourcePath: record.source_path, source: readWorkspaceLuaSourceText(registry, record) });
		}
		return { systemRom, cartridgeSlots, sourceOnlyModules, machineModel, optLevel: sources.currentBlua32Media.cartridgeSlots[slot]!.symbols!.metadata.optLevel };
	} finally {
		releaseWorkspaceSourceOverrides(sources.systemLuaSources);
		for (const cartridge of sources.cartridgeSlots) {
			if (cartridge !== null) releaseWorkspaceSourceOverrides(cartridge.luaSources);
		}
	}
}
