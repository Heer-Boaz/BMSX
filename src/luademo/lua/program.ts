import type { BmsxConsoleLuaProgram } from 'bmsx/console';
import { LuaId } from '../resourceids';

export const luaDemoProgram: BmsxConsoleLuaProgram = {
	assetId: LuaId.demo,
	chunkName: LuaId.demo,
	entry: {
		init: 'init',
		update: 'update',
		draw: 'draw',
	},
};
