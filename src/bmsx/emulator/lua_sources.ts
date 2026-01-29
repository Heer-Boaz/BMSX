import type { RomLuaAsset } from '../rompack/rompack';

export type LuaSourceRecord = RomLuaAsset & { base_src: string };

export type LuaSourceRegistry = {
	path2lua: Record<string, LuaSourceRecord>;
	entry_path: string;
	namespace: string;
};
