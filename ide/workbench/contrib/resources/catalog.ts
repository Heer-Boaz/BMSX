import { resourceIdentityKey, type ResourceDescriptor } from '../../../common/resource';
import { listResources } from '../../../workspace/workspace';
import { listAemResourceDescriptors } from '../../../language/aem/editor';
import type { RuntimeSourceState } from '../../../runtime/sources';

export function listResourcesStrict(sources: RuntimeSourceState): ResourceDescriptor[] {
	const descriptorsByIdentity = new Map<string, ResourceDescriptor>();
	const luaDescriptors = listResources(sources);
	for (let index = 0; index < luaDescriptors.length; index += 1) {
		const descriptor = luaDescriptors[index]!;
		descriptorsByIdentity.set(resourceIdentityKey(descriptor), descriptor);
	}
	const aemDescriptors = listAemResourceDescriptors(sources);
	for (let index = 0; index < aemDescriptors.length; index += 1) {
		const descriptor = aemDescriptors[index]!;
		descriptorsByIdentity.set(resourceIdentityKey(descriptor), descriptor);
	}
	const descriptors = Array.from(descriptorsByIdentity.values());
	descriptors.sort((left, right) => left.path.localeCompare(right.path) || left.domain - right.domain);
	return descriptors;
}
