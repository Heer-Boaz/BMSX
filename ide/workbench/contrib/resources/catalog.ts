import { resourceIdentityKey, type ResourceDescriptor } from '../../../common/resource';
import { listResources } from '../../../workspace/workspace';
import { listAemResourceDescriptors } from '../../../language/aem/editor';

export function listResourcesStrict(): ResourceDescriptor[] {
	const descriptorsByIdentity = new Map<string, ResourceDescriptor>();
	const luaDescriptors = listResources();
	for (let index = 0; index < luaDescriptors.length; index += 1) {
		const descriptor = luaDescriptors[index]!;
		descriptorsByIdentity.set(resourceIdentityKey(descriptor), descriptor);
	}
	const aemDescriptors = listAemResourceDescriptors();
	for (let index = 0; index < aemDescriptors.length; index += 1) {
		const descriptor = aemDescriptors[index]!;
		descriptorsByIdentity.set(resourceIdentityKey(descriptor), descriptor);
	}
	const descriptors = Array.from(descriptorsByIdentity.values());
	descriptors.sort((left, right) => left.path.localeCompare(right.path) || left.domain - right.domain);
	return descriptors;
}
