import type { ResourceIdentity } from '../../../common/resource';
import type { RuntimeResource } from '../../../common/models';

export function computeResourceTabTitle(resource: RuntimeResource): string {
	const parts = resource.path.split('/').filter(part => part.length > 0);
	if (parts.length > 0) {
		return parts[parts.length - 1];
	}
	return resource.source.type.toUpperCase();
}

/** Source identity for disambiguating tabs; never part of their input identity. */
export function sourceTabDescription(resource: ResourceIdentity, line?: number): string {
	return `${resource.domain === -1 ? 'BIOS' : `CART ${resource.domain}`}${line === undefined ? '' : `:${line}`} / ${resource.path}`;
}
