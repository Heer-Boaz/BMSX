export const ROM_ASSET_SYMBOL_MODULE_PATH = 'bmsx/assets';
export const ROM_ASSET_SYMBOL_SOURCE_PATH = `${ROM_ASSET_SYMBOL_MODULE_PATH}.lua`;
export const SYSTEM_ASSET_SYMBOL_MODULE_PATH = 'bmsx/system_assets';
export const SYSTEM_ASSET_SYMBOL_SOURCE_PATH = `${SYSTEM_ASSET_SYMBOL_MODULE_PATH}.lua`;
export const BLUA32_FIRMWARE_MODULE_PATH = 'bmsx/blua32';
export const BLUA32_FIRMWARE_SOURCE_PATH = `${BLUA32_FIRMWARE_MODULE_PATH}.lua`;
export const GX_DISPLAY_PRESET_MODULE_PATH = 'bmsx/gx_display_presets';
export const GX_DISPLAY_PRESET_SOURCE_PATH = `${GX_DISPLAY_PRESET_MODULE_PATH}.lua`;
export const GX_REGISTER_MODULE_PATH = 'bmsx/gx_registers';
export const GX_REGISTER_SOURCE_PATH = `${GX_REGISTER_MODULE_PATH}.lua`;
export const GX_GENERATED_MODULE_BUILD_SOURCE_FILES: ReadonlyArray<string> = [
	'./machine/ts/spec/gx/display_presets.ts',
	'./machine/ts/spec/gx/gp0.ts',
	'./machine/ts/spec/gx/gp1.ts',
	'./machine/ts/spec/gx/pcrtc.ts',
	'./toolchain/ts/rompack/generated_modules.ts',
	'./toolchain/ts/rompack/gx_display_preset_module.ts',
	'./toolchain/ts/rompack/gx_register_module.ts',
];
export const ROM_GENERATED_MODULE_PATHS: ReadonlyArray<string> = [
	ROM_ASSET_SYMBOL_MODULE_PATH,
	SYSTEM_ASSET_SYMBOL_MODULE_PATH,
	BLUA32_FIRMWARE_MODULE_PATH,
	GX_DISPLAY_PRESET_MODULE_PATH,
	GX_REGISTER_MODULE_PATH,
];
