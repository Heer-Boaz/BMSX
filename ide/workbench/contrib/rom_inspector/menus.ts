import type { WorkbenchMenuCommandDefinition } from '../../ui/menu/model';
import type { RomInspectorContentModel } from './content_model';

export const ROM_READER_CONTENT_ACTIONS: readonly WorkbenchMenuCommandDefinition<RomInspectorContentModel>[] = [
	{ type: 'command', command: 'romInspector.content' },
	{ type: 'command', command: 'romInspector.zoom', when: document => document.view === 'preview' },
	{ type: 'command', command: 'romInspector.collision', when: document => document.view === 'preview' && document.hasCollision },
	{ type: 'command', command: 'romInspector.source', icon: 'source' },
];
