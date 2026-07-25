import type { ResourceDescriptor, ResourceIdentity } from '../../../common/resource';
import { machineManager } from '../../../../machine/ts/core/machine_manager';
import {
	resolveRuntimeLuaSource,
	resolveRuntimeLuaSourceForContext,
} from '../../../runtime/sources';
import type { ResourceDomain } from '../../../common/resource';

export function findResourceDescriptorForChunk(identity: ResourceIdentity): ResourceDescriptor | null {
	const source = resolveRuntimeLuaSource(machineManager.sourceState, identity);
	if (source === null) {
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

export function findResourceDescriptorForContext(
	domain: ResourceDomain,
	path: string,
): ResourceDescriptor | null {
	const source = resolveRuntimeLuaSourceForContext(machineManager.sourceState, domain, path);
	if (source === null) {
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
