import type { RomAsset } from '../../machine/ts/rompack/format';

export const SYSTEM_RESOURCE_DOMAIN = -1;
export const CARTRIDGE_RESOURCE_DOMAINS = [0, 1] as const;

export type ResourceDomain = -1 | 0 | 1;

export type ResourceIdentity = {
	domain: ResourceDomain;
	path: string;
};

export type RuntimeResourceSource = RomAsset & {
	generated?: boolean;
};

export type RuntimeResource = ResourceIdentity & {
	source: RuntimeResourceSource;
};

export type LuaResourceCreationRequest = {
	path: string;
	contents: string;
};

export function resourceIdentityKeyFromParts(domain: ResourceDomain, path: string): string {
	return `${domain}\0${path}`;
}

export function resourceIdentityKey(resource: ResourceIdentity): string {
	return resourceIdentityKeyFromParts(resource.domain, resource.path);
}

export function resourceIdentityEquals(left: ResourceIdentity, right: ResourceIdentity): boolean {
	return left.domain === right.domain && left.path === right.path;
}
