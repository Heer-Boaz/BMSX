import type { WorldModule } from 'bmsx';
import { createBmsxConsoleModule } from 'bmsx/console';
import type { ConsoleModuleOptions } from 'bmsx/console';
import { luaDemoCartridge } from './cart';

export function createLuaDemoWorldModule(): WorldModule {
	const options: ConsoleModuleOptions = {
		moduleId: 'bmsx-lua-demo-module',
		playerIndex: 1,
		viewport: { width: 128, height: 128 },
	};
	return createBmsxConsoleModule(luaDemoCartridge, options);
}
