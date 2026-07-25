import { machineManager } from '../../machine/ts/core/machine_manager';
import { Closure } from '../../machine/ts/machine/cpu/cpu';
import { Table } from '../../machine/ts/machine/cpu/table';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import {
	aemDocumentFormat,
	assertValidAemDocument,
	buildAemValidationLookup,
	parseStructuredTextDocument,
} from '../../machine/ts/rompack/tooling/aem';
import type { ResourceDescriptor } from '../../machine/ts/rompack/tooling/resource';
import { callClosureIntoWithScheduler } from './closure_executor';

function buildRuntimeAemValidationLookup() {
	const activePackage = machineManager.sourceState.activePackage;
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
	const results = runtime.luaScratch.values.acquire();
	try {
		const resourceId = runtime.internString('aem');
		const rget = runtime.machine.cpu.getGlobalByKey(runtime.internString('rget')) as Closure;
		callClosureIntoWithScheduler(runtime, rget, [resourceId], results);
		const resource = results[0] as Table;
		const reload = resource.getStringKey(runtime.internString('reload')) as Closure;
		callClosureIntoWithScheduler(runtime, reload, [resource], results);
	} finally {
		runtime.luaScratch.values.release(results);
	}
}

export function applyAemSourceToRuntime(runtime: Runtime, descriptor: ResourceDescriptor, source: string): void {
	const assetId = descriptor.asset_id!;
	const doc = parseStructuredTextDocument(source, aemDocumentFormat(descriptor.path), `AEM file '${descriptor.path}'`);
	assertValidAemDocument(doc, buildRuntimeAemValidationLookup(), descriptor.path);
	machineManager.sourceState.activePackage.audioevents[assetId] = doc as Record<string, unknown>;
	reloadAem(runtime);
}
