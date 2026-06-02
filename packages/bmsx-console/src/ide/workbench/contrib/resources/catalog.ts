import type { ResourceDescriptor } from '../../../../rompack/tooling/resource';
import type { Runtime } from '../../../../machine/runtime/runtime';
import { listResources } from '../../../workspace/workspace';
import { listAemResourceDescriptors } from '../../../language/aem/editor';

export function listResourcesStrict(runtime: Runtime): ResourceDescriptor[] {
	const descriptorsByPath = new Map<string, ResourceDescriptor>();
	const luaDescriptors = listResources(runtime);
	for (let index = 0; index < luaDescriptors.length; index += 1) {
		const descriptor = luaDescriptors[index]!;
		descriptorsByPath.set(descriptor.path, descriptor);
	}
	const aemDescriptors = listAemResourceDescriptors(runtime);
	for (let index = 0; index < aemDescriptors.length; index += 1) {
		const descriptor = aemDescriptors[index]!;
		descriptorsByPath.set(descriptor.path, descriptor);
	}
	const descriptors = Array.from(descriptorsByPath.values());
	descriptors.sort((left, right) => left.path.localeCompare(right.path));
	return descriptors;
}
