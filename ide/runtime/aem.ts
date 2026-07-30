import { Closure } from '../../machine/ts/machine/cpu/closure';
import { Table } from '../../machine/ts/machine/cpu/table';
import { EMPTY_CALL_ARGS, StringValue } from '../../machine/ts/machine/cpu/value';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { encodeBinary } from '../../machine/ts/common/serializer/binencoder';
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
import { applyBlua32Revision } from './hot_resume';

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

function reloadAem(runtime: Runtime): void {
	const cpu = runtime.machine.cpu;
	const resourceId = StringValue.get(cpu.stringPool.intern('aem'));
	const rget = cpu.getGlobalByKey(cpu.stringPool.intern('rget')) as Closure;
	const resource = runtime.callClosure(rget, [resourceId])[0] as Table;
	const reload = resource.getStringKey(StringValue.get(cpu.stringPool.intern('reload_from_rom'))) as Closure;
	runtime.callClosure(reload, EMPTY_CALL_ARGS);
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
	applyBlua32Revision(
		sources,
		luaTooling,
		editor,
		runtime,
		resource.domain === SYSTEM_RESOURCE_DOMAIN,
		[resource.domain === 0, resource.domain === 1],
		[resource.domain, ['aem', assetId, encodeBinary(doc)]],
	);
	const runtimePackage = resource.domain === SYSTEM_RESOURCE_DOMAIN
		? sources.systemPackage
		: sources.cartridgeSlots[resource.domain]!.package;
	runtimePackage.audioevents[assetId] = doc as Record<string, unknown>;
	reloadAem(runtime);
}
