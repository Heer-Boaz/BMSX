export function stripLuaExtension(candidate: string): string {
	const lower = candidate.toLowerCase();
	if (lower.endsWith('.lua')) {
		return candidate.slice(0, candidate.length - 4);
	}
	return candidate;
}

const CART_SOURCE_PREFIX = 'carts/';
const BIOS_RESOURCE_SOURCE_PREFIX = 'machine/bios/res/';
const BIOS_SOURCE_PREFIX = 'machine/bios/';
const RESOURCE_SOURCE_PREFIX = 'res/';
const MODULE_PATH_SOURCE_PREFIXES = [
	BIOS_RESOURCE_SOURCE_PREFIX,
	BIOS_SOURCE_PREFIX,
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

export const buildModuleExportPathKey = (path: ReadonlyArray<string>): string =>
	path.join('.');

export const appendModuleExportPathKey = (base: string, key: string): string =>
	base.length === 0 ? key : `${base}.${key}`;

const sanitizeModuleSlotSegment = (value: string): string =>
	value.replace(/[^A-Za-z0-9_]/g, '_');

export function buildModuleExportSlotName(
	modulePath: string,
	exportPath: ReadonlyArray<string>,
): string {
	const compactPath = toLuaModulePath(modulePath);
	const parts = compactPath.split('/');
	let out = '';
	for (let index = 0; index < parts.length; index += 1) {
		const part = parts[index];
		if (part.length > 0) {
			out += out.length === 0
				? sanitizeModuleSlotSegment(part)
				: `__${sanitizeModuleSlotSegment(part)}`;
		}
	}
	if (out.length === 0) {
		out = sanitizeModuleSlotSegment(compactPath);
	}
	for (let index = 0; index < exportPath.length; index += 1) {
		out += `__${sanitizeModuleSlotSegment(exportPath[index])}`;
	}
	return out;
}
