import { createLuaConsoleCartridge } from 'bmsx/console';
import { marlies2020Program } from './lua/program';

export const marlies2020ConsoleCartridge = createLuaConsoleCartridge({
	meta: {
		title: 'Marlies 2020 Console',
		version: '0.1.0',
		persistentId: 'marlies2020_console',
	},
	program: marlies2020Program,
});

export default marlies2020ConsoleCartridge;
