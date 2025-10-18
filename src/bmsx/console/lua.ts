import type { BmsxConsoleCartridge, BmsxConsoleLuaProgram, BmsxConsoleMetadata } from './types';

export type LuaConsoleCartridgeOptions = {
	meta: BmsxConsoleMetadata;
	program: BmsxConsoleLuaProgram;
};

export function createLuaConsoleCartridge(options: LuaConsoleCartridgeOptions): BmsxConsoleCartridge {
	return {
		meta: options.meta,
		init(): void {},
		update(): void {},
		draw(): void {},
		luaProgram: options.program,
	};
}
