import type { WorldModule } from 'bmsx';
import { createBmsxConsoleModule } from 'bmsx/console';
import type { ConsoleModuleOptions } from 'bmsx/console';
import { luaShellCartridge } from './cart';

export function createLuaShellWorldModule(): WorldModule {
	const options: ConsoleModuleOptions = {
		moduleId: 'bmsx-lua-shell-module',
		playerIndex: 1,
		viewport: { width: 128, height: 128 },
	};
	return createBmsxConsoleModule(luaShellCartridge, options);
}
