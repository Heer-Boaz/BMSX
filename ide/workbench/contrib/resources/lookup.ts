import type { ResourceDescriptor, ResourceIdentity } from '../../../common/resource';
import {
	resolveRuntimeLuaSource,
	resolveRuntimeLuaSourceForContext,
} from '../../../runtime/sources';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { ResourceDomain } from '../../../common/resource';

export function findResourceDescriptorForChunk(
	sources: RuntimeSourceState,
	identity: ResourceIdentity,
): ResourceDescriptor | null {
	const source = resolveRuntimeLuaSource(sources, identity);
	if (!source) {
		return null;
	}
	const asset = source.record;
	return {
		domain: source.domain,
		asset_id: asset.resid,
		path: asset.source_path,
		type: asset.type,
		readOnly: asset.generated,
	};
}

export function resolveResourceDescriptorForContext(
	sources: RuntimeSourceState,
	domain: ResourceDomain,
	path: string,
): ResourceDescriptor {
	const source = resolveRuntimeLuaSourceForContext(sources, domain, path);
	if (!source) {
		throw new Error(`Lua resource '${path}' is not installed for domain '${domain}'.`);
	}
	const asset = source.record;
	return {
		domain: source.domain,
		asset_id: asset.resid,
		path: asset.source_path,
		type: asset.type,
		readOnly: asset.generated,
	};
}
