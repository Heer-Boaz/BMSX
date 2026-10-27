import { resourceIdentityKey, type ResourceDomain } from '../../../common/resource';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { getTextSnapshot } from '../../../editor/text/source_text';
import { readBlua32CompiledSource } from '../../../../toolchain/ts/rompack/blua32_sources';
import type { Blua32SourceImage, RuntimeSourceState } from '../../../runtime/sources';

export type RuntimeSourceStatus = 'applied' | 'pending' | 'failed' | 'untracked' | 'source_only';
export type RuntimeSourceInstallation = { readonly domain: ResourceDomain; readonly image: Blua32SourceImage | null; readonly rom: Uint8Array; status: RuntimeSourceStatus };
type InstallationStatus = RuntimeSourceInstallation & { installedSource: string | undefined; failed: boolean };
type SourceStatusCache = {
	sources: RuntimeSourceState;
	media: RuntimeSourceState['currentBlua32Media'];
	systemRom: Uint8Array;
	cartridge0Rom: Uint8Array | undefined;
	cartridge1Rom: Uint8Array | undefined;
	systemContextId: string;
	cartridge0ContextId: string | undefined;
	cartridge1ContextId: string | undefined;
	resourceSource: EditorTextModel['resource']['source'];
	resourceKey: string;
	version: number;
	installations: InstallationStatus[];
	status: RuntimeSourceStatus;
};
const statusByModel = new WeakMap<EditorTextModel, SourceStatusCache>();

/** Exact per-domain installations, not an arbitrary reverse context-to-socket lookup. */
export function getTextFileRuntimeSourceInstallations(sources: RuntimeSourceState, model: EditorTextModel): readonly RuntimeSourceInstallation[] {
	return sourceStatus(sources, model).installations;
}

/** Aggregate evidence: applied means every corresponding installation matches the authored text. */
export function getTextFileRuntimeSourceStatus(sources: RuntimeSourceState, model: EditorTextModel): RuntimeSourceStatus {
	return sourceStatus(sources, model).status;
}

function sourceStatus(sources: RuntimeSourceState, model: EditorTextModel): SourceStatusCache {
	let cache = statusByModel.get(model);
	let changed = false;
	if (cache === undefined || cache.sources !== sources || cache.media !== sources.currentBlua32Media || cache.resourceSource !== model.resource.source
		|| cache.systemRom !== sources.systemRom.bytes || cache.cartridge0Rom !== sources.cartridgeSlots[0]?.rom.bytes
		|| cache.cartridge1Rom !== sources.cartridgeSlots[1]?.rom.bytes || cache.systemContextId !== sources.systemContextId
		|| cache.cartridge0ContextId !== sources.cartridgeSlots[0]?.contextId || cache.cartridge1ContextId !== sources.cartridgeSlots[1]?.contextId) {
		const installations: InstallationStatus[] = [];
		const record = model.mode === 'lua' ? sources.catalog.resolveLuaSource(model.resource)!.record : undefined;
		for (const domain of [-1, 0, 1] as const) {
			const attachment = domain === -1 ? null : sources.cartridgeSlots[domain];
			if (domain !== -1 && attachment === null) continue;
			const contextId = domain === -1 ? sources.systemContextId : attachment!.contextId;
			if (contextId !== model.resource.contextId) continue;
			const layer = domain === -1 ? sources.systemRom : attachment!.rom;
			const image = domain === -1 ? sources.currentBlua32Media.system : sources.currentBlua32Media.cartridgeSlots[domain];
			let installedSource: string | undefined;
			let status: RuntimeSourceStatus = 'pending';
			if (record !== undefined) {
				const installed = image?.sources.get(record.module_path);
				if (installed !== undefined) installedSource = readBlua32CompiledSource(installed);
				else if (record.sourceKind === 'source-only' || record.sourceKind === 'library') status = 'source_only';
			} else {
				const asset = layer.index.entries.find(asset => asset.type === model.resource.source.type && asset.resid === model.resource.source.resid);
				installedSource = asset?.sourcemeta?.text;
				if (asset !== undefined && installedSource === undefined) status = 'untracked';
			}
			installations.push({ domain, image, rom: layer.bytes, installedSource, failed: false, status });
		}
		cache = { sources, media: sources.currentBlua32Media, systemRom: sources.systemRom.bytes,
			cartridge0Rom: sources.cartridgeSlots[0]?.rom.bytes, cartridge1Rom: sources.cartridgeSlots[1]?.rom.bytes,
			systemContextId: sources.systemContextId, cartridge0ContextId: sources.cartridgeSlots[0]?.contextId, cartridge1ContextId: sources.cartridgeSlots[1]?.contextId,
			resourceSource: model.resource.source,
			resourceKey: resourceIdentityKey(model.resource), version: -1, installations, status: 'pending' };
		statusByModel.set(model, cache);
		changed = true;
	}
	if (model.mode === 'aem') for (const installation of cache.installations) {
		const application = sources.aemSourceApplications.get(`${installation.domain}\0${cache.resourceKey}`);
		if (application === undefined || application.image !== installation.image || application.rom !== installation.rom) continue;
		if (installation.installedSource !== application.installedSource || installation.failed !== application.failed) {
			installation.installedSource = application.installedSource;
			installation.failed = application.failed;
			changed = true;
		}
	}
	if (!changed && cache.version === model.version) return cache;
	cache.version = model.version;
	let source: string | undefined;
	let failed = false, pending = false, untracked = false, sourceOnly = true, applied = true;
	for (const installation of cache.installations) {
		if (installation.failed) installation.status = 'failed';
		else if (installation.installedSource !== undefined) {
			if (source === undefined) source = getTextSnapshot(model.buffer);
			installation.status = source === installation.installedSource ? 'applied' : 'pending';
		}
		failed ||= installation.status === 'failed';
		pending ||= installation.status === 'pending';
		untracked ||= installation.status === 'untracked';
		sourceOnly &&= installation.status === 'source_only';
		applied &&= installation.status === 'applied';
	}
	if (cache.installations.length === 0) {
		const record = model.mode === 'lua' ? sources.catalog.resolveLuaSource(model.resource)!.record : undefined;
		cache.status = record?.sourceKind === 'source-only' || record?.sourceKind === 'library' ? 'source_only' : 'pending';
	} else cache.status = failed ? 'failed' : pending ? 'pending' : untracked ? 'untracked' : sourceOnly ? 'source_only' : applied ? 'applied' : 'pending';
	return cache;
}
