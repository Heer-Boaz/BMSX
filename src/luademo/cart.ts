import { createLuaConsoleCartridge } from 'bmsx/console';
import { luaDemoProgram } from './lua/program';

export const luaDemoCartridge = createLuaConsoleCartridge({
	meta: {
		title: 'Lua Demo',
		version: '1.0.0',
		persistentId: 'bmsx_lua_demo',
	},
	program: luaDemoProgram,
});

export default luaDemoCartridge;
