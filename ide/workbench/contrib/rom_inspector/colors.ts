import type { AssetType } from '../../../../machine/ts/rompack/toc';
import { BLUA32_SYMBOLS_IMAGE_ID } from '../../../../toolchain/ts/rompack/blua32_symbols';
import type { RomInspectionSection } from '../../../../toolchain/ts/rompack/inspection';
import * as palette from '../../../theme/tokens';

const ASSET_COLORS: Record<AssetType, number> = {
	image: palette.THEME_TOKEN_ASSET_IMAGE,
	texture: palette.THEME_TOKEN_ASSET_TEXTURE,
	audio: palette.THEME_TOKEN_ASSET_AUDIO,
	data: palette.THEME_TOKEN_ASSET_DATA,
	bin: palette.THEME_TOKEN_ASSET_BINARY,
	collision_shape: palette.THEME_TOKEN_ASSET_COLLISION,
	romlabel: palette.THEME_TOKEN_ASSET_ROMLABEL,
	model: palette.THEME_TOKEN_ASSET_MODEL,
	aem: palette.THEME_TOKEN_ASSET_AEM,
	lua: palette.THEME_TOKEN_ASSET_LUA,
	code: palette.THEME_TOKEN_ASSET_CODE,
};

const SECTION_COLORS: Record<Exclude<RomInspectionSection['kind'], 'asset'>, number> = {
	header: palette.THEME_TOKEN_ROM_HEADER,
	manifest: palette.THEME_TOKEN_ROM_MANIFEST,
	toc: palette.THEME_TOKEN_ROM_TOC,
	metadata: palette.THEME_TOKEN_ROM_METADATA,
	blua32: palette.THEME_TOKEN_ROM_BLUA32,
	unreferenced: palette.THEME_TOKEN_ROM_UNREFERENCED,
};

/** Physical payload identity, not logical metadata attribution or transient UI state. */
export function romInspectionSectionColor(section: RomInspectionSection): number {
	if (section.kind !== 'asset') return SECTION_COLORS[section.kind];
	if (section.buffer === 'model-texture') return ASSET_COLORS.texture;
	if (section.buffer === 'collision') return ASSET_COLORS.collision_shape;
	const asset = section.asset!;
	return asset.resid === BLUA32_SYMBOLS_IMAGE_ID ? palette.THEME_TOKEN_ROM_SYMBOLS : ASSET_COLORS[asset.type];
}
