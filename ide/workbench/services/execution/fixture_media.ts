import { readWorkspaceLuaSourceText } from '../../../workspace/files';
import { releaseWorkspaceSourceOverrides } from '../../../workspace/cache';
import { createRuntimeSourceState, type RuntimeSourceState } from '../../../runtime/sources';
import { blua32MediaRequiresRebuild, prepareBlua32SourceBuildRequest, buildBlua32Media, layoutBlua32MediaInstallation } from '../../../runtime/lua_pipeline';
import { applyAllWorkspaceSourceOverrides, applyLuaTextModelSources } from '../../../workspace/workspace';
import type { LuaTextModelSourceSnapshot } from '../working_copy/lua_sources';
import type { WorkspaceRecord } from '../../../workspace/records';
import type { FixtureMedia } from '../../../testing/fixture_media';
import type { MachineModelSpec } from '../../../../machine/ts/spec/bmsx/model';
import type { TestCartridgeSourceInput } from '../../../../toolchain/ts/rompack/test_cartridge';
import { loadBlua32ToolingImage } from '../../../../toolchain/ts/rompack/blua32_media';
import { CART_ROM_BASE } from '../../../../machine/ts/spec/bmsx/memory_map';

/** Capture an authored compiler namespace separately from its packaged asset bytes. */
export async function buildFixtureMedia(
	authoring: RuntimeSourceState,
	dirtyRecords: ReadonlyMap<string, WorkspaceRecord>,
	programSources: readonly LuaTextModelSourceSnapshot[],
	contextId: string,
	machineModel: MachineModelSpec,
	companionContextId: string | null,
): Promise<FixtureMedia> {
	const context = authoring.catalog.getContext(contextId);
	if (context.previewRom === null) throw new Error(`Source context '${contextId}' has no admitted cartridge build inputs.`);
	if (context.systemContextId === null) throw new Error(`Source context '${contextId}' has no BIOS build binding.`);
	const system = authoring.catalog.getContext(context.systemContextId);
	if (system.previewRom === null) throw new Error(`BIOS context '${system.id}' has no admitted build inputs.`);
	const companion = companionContextId === null ? null : authoring.catalog.getContext(companionContextId);
	if (companion !== null && companion.previewRom === null) throw new Error(`Companion context '${companion.id}' has no admitted cartridge build inputs.`);
	const primaryRom = context.previewRom.bytes;
	const primaryImage = loadBlua32ToolingImage(context.previewRom, CART_ROM_BASE)!;
	// The primary image is compiled once, below, with the selected fixture. Only
	// BIOS and an explicitly requested companion participate in dependency builds.
	const sources = createRuntimeSourceState({ ...system.previewRom, id: 'system' },
		[null, companion === null ? null : { ...companion.previewRom!, id: 'cart' }],
		{ catalog: authoring.catalog.fork(), systemContextId: system.id, cartridgeContextIds: [null, companionContextId] });
	try {
		await applyAllWorkspaceSourceOverrides(sources.catalog, new Map(dirtyRecords));
		applyLuaTextModelSources(sources.catalog, programSources);
		let systemRom = sources.systemRom.bytes;
		let companionRom = sources.cartridgeSlots[1] === null ? null : sources.cartridgeSlots[1].rom.bytes;
		if (blua32MediaRequiresRebuild(sources)) {
			const media = layoutBlua32MediaInstallation(sources, buildBlua32Media(sources,
				machineModel.ramBytes, prepareBlua32SourceBuildRequest(sources), 'boot'));
			if (media.systemLayer !== null) systemRom = media.systemLayer.bytes;
			if (media.cartridgeLayers[1] !== null) companionRom = media.cartridgeLayers[1].bytes;
		}
		const registry = sources.catalog.getContext(contextId).luaSources;
		const modules = new Map<string, TestCartridgeSourceInput>();
		for (const record of registry.records) if (!record.generated) modules.set(record.module_path, {
			assetId: record.resid, sourceFilePath: record.normalized_source_path, updateTimestamp: record.update_timestamp,
			displayPath: record.source_path, content: { kind: 'text', text: readWorkspaceLuaSourceText(registry, record) },
		});
		const entry = registry.path2lua[registry.entrySourcePath];
		return { systemRom, cartridgeSlots: [primaryRom, companionRom], sourceContexts: [system.id, contextId, companionContextId],
			sourceSelection: { kind: 'authored', entryModulePath: entry?.module_path, modules },
			machineModel, optLevel: primaryImage.symbols!.metadata.optLevel };
	} finally {
		for (const context of sources.catalog.contexts.values()) releaseWorkspaceSourceOverrides(context.luaSources);
		sources.catalog.dispose();
	}
}
