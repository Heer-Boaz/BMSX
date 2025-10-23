import type { BmsxConsoleLuaProgram } from 'bmsx/console';
import { LuaId } from '../resourceids';

export const luaShellProgram: BmsxConsoleLuaProgram = {
	assetId: LuaId.shell_main,
	chunkName: '@lua_shell',
	entry: {
		init: 'init',
		update: 'update',
		draw: 'draw',
	},
};
