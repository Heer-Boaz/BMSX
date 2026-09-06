import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { encodeBinary } from '../../machine/ts/common/serializer/binencoder';
import { buildModuleExportSlotName } from '../../toolchain/ts/lua/module_path';
import {
	aemDocumentFormat,
	assertValidAemDocument,
	buildAemEventMap,
	buildAemValidationLookup,
	parseStructuredTextDocument,
} from '../../toolchain/ts/rompack/aem';
import type { RomAssetEdit } from '../../toolchain/ts/rompack/blua32_tail';
import {
	SYSTEM_RESOURCE_DOMAIN,
	resourceIdentityKey,
	type ResourceDomain,
	type RuntimeResource,
} from '../common/resource';
import type { CartEditor } from '../cart_editor';
import type { RuntimeSourceState } from './sources';
import type { RuntimeLuaTooling } from './lua_tooling';
import {
	buildBlua32Revision,
	installBlua32Revision,
	type BuiltBlua32Revision,
} from './hot_resume';
import { buildHotResumeRelocation } from './hot_resume_relocation';

export type BuiltAemSourceRevision = {
	resource: RuntimeResource;
	source: string;
	eventMap: Record<string, unknown>;
	revision: BuiltBlua32Revision;
	relocation: Uint32Array;
};

function buildRuntimeAemValidationLookup(sources: RuntimeSourceState, domain: ResourceDomain) {
	const resourcePackage = domain === SYSTEM_RESOURCE_DOMAIN ? sources.systemPackage : sources.cartridgeSlots[domain]!.package;
	const dataRecordNames = Object.keys(resourcePackage.data);
	const dataRecords: Array<{ name: string; value: unknown }> = new Array(dataRecordNames.length);
	for (let index = 0; index < dataRecordNames.length; index += 1) {
		const name = dataRecordNames[index]!;
		dataRecords[index] = { name, value: resourcePackage.data[name] };
	}
	return buildAemValidationLookup({
		audioIds: Object.keys(resourcePackage.audio),
		dataRecords,
	});
}

export function buildAemSourceRevision(
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
	runtime: Runtime,
	resource: RuntimeResource,
	source: string,
): BuiltAemSourceRevision {
	const assetId = resource.source.resid;
	const doc = parseStructuredTextDocument(source, aemDocumentFormat(resource.path), `AEM file '${resource.path}'`);
	const lookup = buildRuntimeAemValidationLookup(sources, resource.domain);
	assertValidAemDocument(doc, lookup, resource.path);
	const eventMap = buildAemEventMap(doc, lookup);
	const assetEdits: [RomAssetEdit[], RomAssetEdit[], RomAssetEdit[]] = [[], [], []];
	assetEdits[resource.domain + 1].push(['aem', assetId, encodeBinary(eventMap)]);
	const revision = buildBlua32Revision(
		sources,
		luaTooling,
		runtime,
		resource.domain === SYSTEM_RESOURCE_DOMAIN,
		[resource.domain === 0, resource.domain === 1],
		assetEdits,
	);
	const relocation = buildHotResumeRelocation(
		runtime.machine.cpu,
		revision.revisions,
		runtime.machine.cpu.getFrameDepth(),
	);
	return { resource, source, eventMap, revision, relocation };
}

export function installAemSourceRevision(
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
	editor: CartEditor,
	runtime: Runtime,
	built: BuiltAemSourceRevision,
): void {
	const { resource, source, eventMap } = built;
	const assetId = resource.source.resid;
	installBlua32Revision(sources, editor, runtime, built.revision, built.relocation);
	const runtimePackage = resource.domain === SYSTEM_RESOURCE_DOMAIN
		? sources.systemPackage
		: sources.cartridgeSlots[resource.domain]!.package;
	runtimePackage.audioevents[assetId] = eventMap;
	sources.aemSourceApplications.set(resourceIdentityKey(resource), {
		installedSource: source,
		failed: false,
	});
	const suspendedGuest = luaTooling.suspendedGuest;
	const aemResource = suspendedGuest.global(
		buildModuleExportSlotName('cartlib/aem', []),
	);
	suspendedGuest.callClosure(
		suspendedGuest.readStringMember(aemResource, 'reload_from_rom'),
	);
}

export function recordAemSourceApplyFailure(sources: RuntimeSourceState, resource: RuntimeResource): void {
	const key = resourceIdentityKey(resource);
	const application = sources.aemSourceApplications.get(key);
	if (application === undefined) {
		sources.aemSourceApplications.set(key, { installedSource: undefined, failed: true });
	} else {
		application.failed = true;
	}
}
