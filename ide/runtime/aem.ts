import { Closure } from '../../machine/ts/machine/cpu/closure';
import { Table } from '../../machine/ts/machine/cpu/table';
import { StringValue } from '../../machine/ts/machine/cpu/value';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import {
	aemDocumentFormat,
	assertValidAemDocument,
	buildAemValidationLookup,
	parseStructuredTextDocument,
} from '../../toolchain/ts/rompack/aem';
import type { RuntimeResource } from '../common/resource';
import type { RuntimeSourceState } from './sources';

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
	const rget = cpu.getGlobalByKey(StringValue.get(cpu.stringPool.intern('rget'))) as Closure;
	const resource = runtime.callClosure(rget, [resourceId])[0] as Table;
	const reload = resource.getStringKey(StringValue.get(cpu.stringPool.intern('reload'))) as Closure;
	runtime.callClosure(reload, [resource]);
}

export function applyAemSourceToRuntime(
	sources: RuntimeSourceState,
	runtime: Runtime,
	resource: RuntimeResource,
	source: string,
): void {
	const assetId = resource.source.resid;
	const doc = parseStructuredTextDocument(source, aemDocumentFormat(resource.path), `AEM file '${resource.path}'`);
	assertValidAemDocument(doc, buildRuntimeAemValidationLookup(sources), resource.path);
	sources.activePackage.audioevents[assetId] = doc as Record<string, unknown>;
	reloadAem(runtime);
}
