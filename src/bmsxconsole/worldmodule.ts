import type { WorldModule } from 'bmsx';
import { createBmsxConsoleModule } from 'bmsx/console';
import type { ConsoleModuleOptions } from 'bmsx/console';
import { consoleCartridge } from './cart';

export function createConsoleWorldModule(): WorldModule {
	const options: ConsoleModuleOptions = {
		moduleId: 'bmsx-console-module',
		playerIndex: 1,
		viewport: { width: 128, height: 128 },
	};
	return createBmsxConsoleModule(consoleCartridge, options);
}
