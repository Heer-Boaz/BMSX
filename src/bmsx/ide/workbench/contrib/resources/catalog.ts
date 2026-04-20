import type { ResourceDescriptor } from '../../../../rompack/resource';
import { listResources } from '../../../workspace/workspace';
import { listAemResourceDescriptors } from '../../../language/aem/editor';

export function listResourcesStrict(): ResourceDescriptor[] {
	const descriptorsByPath = new Map<string, ResourceDescriptor>();
	const luaDescriptors = listResources();
	for (let index = 0; index < luaDescriptors.length; index += 1) {
		const descriptor = luaDescriptors[index]!;
		descriptorsByPath.set(descriptor.path, descriptor);
	}
	const aemDescriptors = listAemResourceDescriptors();
	for (let index = 0; index < aemDescriptors.length; index += 1) {
		const descriptor = aemDescriptors[index]!;
		descriptorsByPath.set(descriptor.path, descriptor);
	}
	const descriptors = Array.from(descriptorsByPath.values());
	descriptors.sort((left, right) => left.path.localeCompare(right.path));
	return descriptors;
}
