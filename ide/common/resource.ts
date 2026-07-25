import type { asset_id } from '../../machine/ts/rompack/format';

export const SYSTEM_RESOURCE_DOMAIN = -1;
export const CARTRIDGE_RESOURCE_DOMAINS = [0, 1] as const;

export type ResourceDomain = -1 | 0 | 1;

export type ResourceIdentity = {
	domain: ResourceDomain;
	path: string;
};

export type ResourceDescriptor = ResourceIdentity & {
	type: string;
	asset_id?: asset_id;
	readOnly?: boolean;
};

export type LuaResourceCreationRequest = {
	path: string;
	contents: string;
};

export function resourceIdentityKey(resource: ResourceIdentity): string {
	return `${resource.domain}\0${resource.path}`;
}

export function resourceIdentityEquals(left: ResourceIdentity, right: ResourceIdentity): boolean {
	return left.domain === right.domain && left.path === right.path;
}
