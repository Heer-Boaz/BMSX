import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { encodeBinary } from '../../machine/ts/common/serializer/binencoder';
import { buildModuleExportSlotName } from '../../toolchain/ts/lua/module_path';
import {
	aemDocumentFormat,
	assertValidAemDocument,
	buildAemValidationLookup,
	parseStructuredTextDocument,
} from '../../toolchain/ts/rompack/aem';
import {
	SYSTEM_RESOURCE_DOMAIN,
	type RuntimeResource,
} from '../common/resource';
import type { CartEditor } from '../cart_editor';
import type { RuntimeSourceState } from './sources';
import type { RuntimeLuaTooling } from './lua_tooling';
import { buildBlua32Revision, installBlua32Revision } from './hot_resume';

function buildRuntimeAemValidationLookup(sources: RuntimeSourceState) {
	const activePackage = sources.activePackage;
	const dataRecordNames = Object.keys(activePackage.data);
	const dataRecords: Array<{ name: string; value: unknown }> = new Array(dataRecordNames.length);
	for (let index = 0; index < dataRecordNames.length; index += 1) {
		const name = dataRecordNames[index]!;
		dataRecords[index] = { name, value: activePackage.data[name] };
	}
	return buildAemValidationLookup({
		audioIds: Object.keys(activePackage.audio),
		dataRecords,
	});
}

export function applyAemSourceToRuntime(
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
	editor: CartEditor,
	runtime: Runtime,
	resource: RuntimeResource,
	source: string,
): void {
	const assetId = resource.source.resid;
	const doc = parseStructuredTextDocument(source, aemDocumentFormat(resource.path), `AEM file '${resource.path}'`);
	assertValidAemDocument(doc, buildRuntimeAemValidationLookup(sources), resource.path);
	const revision = buildBlua32Revision(
		sources,
		luaTooling,
		runtime,
		resource.domain === SYSTEM_RESOURCE_DOMAIN,
		[resource.domain === 0, resource.domain === 1],
		[resource.domain, ['aem', assetId, encodeBinary(doc)]],
	);
	installBlua32Revision(sources, editor, runtime, revision);
	const runtimePackage = resource.domain === SYSTEM_RESOURCE_DOMAIN
		? sources.systemPackage
		: sources.cartridgeSlots[resource.domain]!.package;
	runtimePackage.audioevents[assetId] = doc as Record<string, unknown>;
	const suspendedGuest = luaTooling.suspendedGuest;
	const aemResource = suspendedGuest.global(
		buildModuleExportSlotName('cartlib/aem', []),
	);
	suspendedGuest.callClosure(
		suspendedGuest.readStringMember(aemResource, 'reload_from_rom'),
	);
}
