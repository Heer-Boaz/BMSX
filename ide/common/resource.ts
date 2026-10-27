import type { RomAsset } from '../../toolchain/ts/rompack/assets';

export const SYSTEM_RESOURCE_DOMAIN = -1;
export const CARTRIDGE_RESOURCE_DOMAINS = [0, 1] as const;

export type ResourceDomain = -1 | 0 | 1;

export type ResourceIdentity = {
	contextId: string;
	path: string;
};

export type RuntimeResourceSource = RomAsset & {
	generated?: boolean;
};

/** Authoring topology is independent of the physical execution context. */
export type RuntimeResourceLocation =
	| { readonly kind: 'project'; readonly projectRootPath: string; readonly path: string }
	| { readonly kind: 'workspace'; readonly path: string }
	| { readonly kind: 'generated'; readonly path: string };

export type RuntimeResource = ResourceIdentity & {
	readonly contextLabel: string;
	source: RuntimeResourceSource;
	location: RuntimeResourceLocation;
	/** Admitted WorkspaceRecordProvider address; generated resources have no source file. */
	sourceFilePath: string | undefined;
};

export type TextResourceCreationRequest = {
	contextId: string;
	relativePath: string;
	contents: string;
};

export function resourceIdentityKeyFromParts(contextId: string, path: string): string {
	return `${contextId}\0${path}`;
}

export function resourceIdentityKey(resource: ResourceIdentity): string {
	return resourceIdentityKeyFromParts(resource.contextId, resource.path);
}

export function resourceIdentityEquals(left: ResourceIdentity, right: ResourceIdentity): boolean {
	return left.contextId === right.contextId && left.path === right.path;
}

export function resourceLocationEquals(left: RuntimeResourceLocation, right: RuntimeResourceLocation): boolean {
	if (left === right) return true;
	if (left.kind !== right.kind || left.path !== right.path) return false;
	return left.kind !== 'project' || right.kind === 'project' && left.projectRootPath === right.projectRootPath;
}
