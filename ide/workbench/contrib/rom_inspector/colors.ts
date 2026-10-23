import type { AssetType } from '../../../../machine/ts/rompack/toc';
import type { RomAsset } from '../../../../toolchain/ts/rompack/assets';
import { BLUA32_SYMBOLS_IMAGE_ID } from '../../../../toolchain/ts/rompack/blua32_symbols';
import type { RomInspectionSection } from '../../../../toolchain/ts/rompack/inspection';
import * as palette from '../../../theme/tokens';

export type RomInspectionCategoryId = AssetType | Exclude<RomInspectionSection['kind'], 'asset'> | 'symbols';
export type RomInspectionCategory = {
	readonly id: RomInspectionCategoryId;
	readonly label: string;
	readonly color: number;
};

/** Shared retained identities for the physical map, table and byte-accounting key. */
export const ROM_CATEGORIES: Readonly<Record<RomInspectionCategoryId, RomInspectionCategory>> = {
	image: { id: 'image', label: 'Image', color: palette.THEME_TOKEN_ASSET_IMAGE },
	texture: { id: 'texture', label: 'Texture', color: palette.THEME_TOKEN_ASSET_TEXTURE },
	audio: { id: 'audio', label: 'Audio', color: palette.THEME_TOKEN_ASSET_AUDIO },
	data: { id: 'data', label: 'Data', color: palette.THEME_TOKEN_ASSET_DATA },
	bin: { id: 'bin', label: 'Binary', color: palette.THEME_TOKEN_ASSET_BINARY },
	collision_shape: { id: 'collision_shape', label: 'Collision', color: palette.THEME_TOKEN_ASSET_COLLISION },
	romlabel: { id: 'romlabel', label: 'ROM label', color: palette.THEME_TOKEN_ASSET_ROMLABEL },
	model: { id: 'model', label: 'Model', color: palette.THEME_TOKEN_ASSET_MODEL },
	aem: { id: 'aem', label: 'Event map', color: palette.THEME_TOKEN_ASSET_AEM },
	lua: { id: 'lua', label: 'Lua', color: palette.THEME_TOKEN_ASSET_LUA },
	code: { id: 'code', label: 'Code', color: palette.THEME_TOKEN_ASSET_CODE },
	header: { id: 'header', label: 'Header', color: palette.THEME_TOKEN_ROM_HEADER },
	manifest: { id: 'manifest', label: 'Manifest', color: palette.THEME_TOKEN_ROM_MANIFEST },
	toc: { id: 'toc', label: 'TOC', color: palette.THEME_TOKEN_ROM_TOC },
	metadata: { id: 'metadata', label: 'Metadata', color: palette.THEME_TOKEN_ROM_METADATA },
	blua32: { id: 'blua32', label: 'BLua32', color: palette.THEME_TOKEN_ROM_BLUA32 },
	unreferenced: { id: 'unreferenced', label: 'Unreferenced', color: palette.THEME_TOKEN_ROM_UNREFERENCED },
	symbols: { id: 'symbols', label: 'Symbols', color: palette.THEME_TOKEN_ROM_SYMBOLS },
};

export function romAssetCategory(asset: RomAsset): RomInspectionCategory {
	return ROM_CATEGORIES[asset.resid === BLUA32_SYMBOLS_IMAGE_ID ? 'symbols' : asset.type];
}

/** Physical buffer roles take precedence over the owning asset's logical type. */
export function romInspectionSectionCategory(section: RomInspectionSection): RomInspectionCategory {
	if (section.kind !== 'asset') return ROM_CATEGORIES[section.kind];
	if (section.buffer === 'model-texture') return ROM_CATEGORIES.texture;
	if (section.buffer === 'collision') return ROM_CATEGORIES.collision_shape;
	return romAssetCategory(section.asset!);
}
