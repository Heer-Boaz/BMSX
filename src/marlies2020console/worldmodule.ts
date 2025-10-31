import type { WorldModule } from 'bmsx';
import { createBmsxConsoleModule } from 'bmsx/console';
import type { ConsoleModuleOptions } from 'bmsx/console';
import { marlies2020ConsoleCartridge } from './cart';

export function createMarlies2020ConsoleWorldModule(): WorldModule {
	const options: ConsoleModuleOptions = {
		moduleId: 'marlies2020-console-module',
		playerIndex: 1,
		viewport: { width: 256, height: 212 },
	};
	return createBmsxConsoleModule(marlies2020ConsoleCartridge, options);
}
