import { toLuaModulePath } from '../../../machine/program/loader';

export const buildModuleExportPathKey = (path: ReadonlyArray<string>): string =>
	path.join('.');

export const appendModuleExportPathKey = (base: string, key: string): string =>
	base.length === 0 ? key : `${base}.${key}`;

const sanitizeModuleSlotSegment = (value: string): string =>
	value.replace(/[^A-Za-z0-9_]/g, '_');

const buildModuleSlotPrefix = (modulePath: string): string => {
	const compactPath = toLuaModulePath(modulePath);
	const parts = compactPath.split('/');
	let out = '';
	for (let index = 0; index < parts.length; index += 1) {
		const part = parts[index];
		if (part.length === 0) {
			continue;
		}
		out += out.length === 0 ? sanitizeModuleSlotSegment(part) : `__${sanitizeModuleSlotSegment(part)}`;
	}
	return out.length > 0 ? out : sanitizeModuleSlotSegment(compactPath);
};

export const buildModuleExportSlotName = (
	modulePath: string,
	exportPath: ReadonlyArray<string>,
): string => {
	let out = buildModuleSlotPrefix(modulePath);
	for (let index = 0; index < exportPath.length; index += 1) {
		out += `__${sanitizeModuleSlotSegment(exportPath[index])}`;
	}
	return out;
};

export const buildModuleRootFieldSlotName = (modulePath: string, key: string): string =>
	`${buildModuleSlotPrefix(modulePath)}__${sanitizeModuleSlotSegment(key)}`;
