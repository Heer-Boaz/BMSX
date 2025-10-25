import type { BmsxConsoleLuaProgram } from 'bmsx/console';
import { LuaId } from '../resourceids';
import '../lua_demo_actor';

export const luaDemoProgram: BmsxConsoleLuaProgram = {
	assetId: LuaId.demo,
	chunkName: LuaId.demo,
	entry: {
		init: 'init',
		update: 'update',
		draw: 'draw',
	},
};
