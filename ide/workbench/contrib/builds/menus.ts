import type { WorkbenchMenuCommandDefinition } from '../../ui/menu/model';
import type { BuildLogInput } from './editor_input';

export const BUILD_LOG_TITLE_ACTIONS: readonly WorkbenchMenuCommandDefinition<BuildLogInput>[] = [
	{ type: 'command', command: 'buildLog.error', when: input => input.error !== undefined },
	{ type: 'command', command: 'buildLog.output', when: input => input.error !== undefined },
	{ type: 'command', command: 'buildLog.refresh', icon: 'refresh' },
	{ type: 'command', command: 'buildLog.copyAll', icon: 'copy' },
];
