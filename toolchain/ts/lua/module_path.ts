export function stripLuaExtension(candidate: string): string {
	const lower = candidate.toLowerCase();
	if (lower.endsWith('.lua')) {
		return candidate.slice(0, candidate.length - 4);
	}
	return candidate;
}

const CART_SOURCE_PREFIX = 'carts/';
const FIRMWARE_RESOURCE_SOURCE_PREFIX = 'machine/firmware/res/';
const FIRMWARE_SOURCE_PREFIX = 'machine/firmware/';
const RESOURCE_SOURCE_PREFIX = 'res/';
const MODULE_PATH_SOURCE_PREFIXES = [
	FIRMWARE_RESOURCE_SOURCE_PREFIX,
	FIRMWARE_SOURCE_PREFIX,
	RESOURCE_SOURCE_PREFIX,
];

export function toLuaModulePath(sourcePath: string): string {
	const path = stripLuaExtension(sourcePath.includes('\\') ? sourcePath.replace(/\\/g, '/') : sourcePath);
	if (path.startsWith(CART_SOURCE_PREFIX)) {
		const cartRelative = path.substring(CART_SOURCE_PREFIX.length);
		const cartNameEnd = cartRelative.indexOf('/');
		return cartNameEnd >= 0 ? cartRelative.substring(cartNameEnd + 1) : cartRelative;
	}
	for (let index = 0; index < MODULE_PATH_SOURCE_PREFIXES.length; index += 1) {
		const prefix = MODULE_PATH_SOURCE_PREFIXES[index];
		if (path.startsWith(prefix)) {
			return path.substring(prefix.length);
		}
	}
	return path;
}
