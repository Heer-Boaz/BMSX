import { createLuaConsoleCartridge } from 'bmsx/console';

export const marlies2020ConsoleCartridge = createLuaConsoleCartridge({
	meta: {
		title: 'Marlies 2020 Console',
		version: '0.1.0',
		persistentId: 'marlies2020_console',
	},
	program: {
		assetId: 'marlies2020',
		chunkName: 'marlies2020',
		entry: {
			init: 'init',
			update: 'update',
			draw: 'draw',
		},
	},
});

export default marlies2020ConsoleCartridge;
