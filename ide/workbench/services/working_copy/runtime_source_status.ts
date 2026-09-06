import { SYSTEM_RESOURCE_DOMAIN, resourceIdentityKey, type RuntimeResource } from '../../../common/resource';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { getTextSnapshot } from '../../../editor/text/source_text';
import type { LuaSourceRecord } from '../../../runtime/source_registry';
import { resolveRuntimeLuaSource, type RuntimeSourceState } from '../../../runtime/sources';

export type RuntimeSourceStatus = 'applied' | 'pending' | 'failed' | 'untracked' | 'source_only';

type SourceStatusCache = {
	sources: RuntimeSourceState;
	resource: RuntimeResource;
	resourceSource: RuntimeResource['source'];
	resourceKey: string;
	programSource: LuaSourceRecord | null;
	version: number;
	installedSource: string | undefined;
	failed: boolean;
	status: RuntimeSourceStatus;
};

const statusByModel = new WeakMap<EditorTextModel, SourceStatusCache>();

/** Compares authored text with the actual installation, never an editor acknowledgement. */
export function getTextFileRuntimeSourceStatus(sources: RuntimeSourceState, model: EditorTextModel): RuntimeSourceStatus {
	let cache = statusByModel.get(model);
	if (cache === undefined || cache.sources !== sources || cache.resource !== model.resource || cache.resourceSource !== model.resource.source) {
		cache = {
			sources,
			resource: model.resource,
			resourceSource: model.resource.source,
			resourceKey: resourceIdentityKey(model.resource),
			programSource: model.mode === 'lua' ? resolveRuntimeLuaSource(sources, model.resource)!.record : null,
			version: 0,
			installedSource: undefined,
			failed: false,
			status: 'untracked',
		};
		statusByModel.set(model, cache);
	}
	let installedSource: string | undefined;
	let failed = false;
	switch (model.mode) {
		case 'lua': {
			if (!cache.programSource.program_module) {
				return 'source_only';
			}
			const installedSources = model.resource.domain === SYSTEM_RESOURCE_DOMAIN
				? sources.systemInstalledBlua32Sources
				: sources.cartridgeSlots[model.resource.domain]!.installedBlua32Sources;
			installedSource = installedSources.get(cache.programSource.module_path);
			break;
		}
		case 'aem': {
			const application = sources.aemSourceApplications.get(cache.resourceKey);
			if (application === undefined) {
				return 'untracked';
			}
			installedSource = application.installedSource;
			failed = application.failed;
			break;
		}
	}
	if (cache.version !== model.version || cache.installedSource !== installedSource || cache.failed !== failed) {
		cache.version = model.version;
		cache.installedSource = installedSource;
		cache.failed = failed;
		cache.status = failed ? 'failed' : getTextSnapshot(model.buffer) === installedSource ? 'applied' : 'pending';
	}
	return cache.status;
}
