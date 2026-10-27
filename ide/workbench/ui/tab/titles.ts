import type { RuntimeResource } from '../../../common/models';

export function computeResourceTabTitle(resource: RuntimeResource): string {
	const parts = resource.path.split('/').filter(part => part.length > 0);
	if (parts.length > 0) {
		return parts[parts.length - 1];
	}
	return resource.source.type.toUpperCase();
}

/** Source identity for disambiguating tabs; never part of their input identity. */
export function sourceTabDescription(resource: Pick<RuntimeResource, 'contextLabel' | 'path'>, line?: number): string {
	return `${resource.contextLabel}${line === undefined ? '' : `:${line}`} / ${resource.path}`;
}
