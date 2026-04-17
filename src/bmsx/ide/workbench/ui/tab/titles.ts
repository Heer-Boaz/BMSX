import type { ResourceDescriptor } from '../../../common/models';

export function computeResourceTabTitle(descriptor: ResourceDescriptor): string {
	const parts = descriptor.path.split('/').filter(part => part.length > 0);
	if (parts.length > 0) {
		return parts[parts.length - 1];
	}
	return descriptor.type.toUpperCase();
}
