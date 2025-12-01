import type { BmsxCartridge, BmsxCartProgram, BmsxCartMetadata } from './types';

export type LuaConsoleCartridgeOptions = {
	meta: BmsxCartMetadata;
	program: BmsxCartProgram;
};

export function createLuaConsoleCartridge(options: LuaConsoleCartridgeOptions): BmsxCartridge {
	return {
		meta: options.meta,
		init(): void {},
		boot(): void {},
		update(): void {},
		draw(): void {},
		luaProgram: options.program,
	};
}
