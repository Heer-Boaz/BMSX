import { createLuaConsoleCartridge } from 'bmsx/console';
import { luaShellProgram } from './lua/program';

export const luaShellCartridge = createLuaConsoleCartridge({
	meta: {
		title: 'BMSX Lua Shell',
		version: '0.1.0',
		persistentId: 'bmsx_lua_shell',
	},
	program: luaShellProgram,
});

export default luaShellCartridge;
