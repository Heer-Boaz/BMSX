import { defineLintRule } from '../../rule';

export const forbiddenRenderModuleRequirePatternRule = defineLintRule('lua_cart', 'forbidden_render_module_require_pattern');

const FORBIDDEN_RENDER_MODULE_REQUIRES = new Set<string>([
	'vdp_firmware',
	'textflow',
]);

export function isForbiddenRenderModuleRequire(value: string): boolean {
	return FORBIDDEN_RENDER_MODULE_REQUIRES.has(value);
}

export function forbiddenRenderModuleRequireMessage(value: string): string {
	return `require('${value}') is forbidden. The legacy Lua render wrapper modules are removed; submit VDP work through MMIO registers instead.`;
}
