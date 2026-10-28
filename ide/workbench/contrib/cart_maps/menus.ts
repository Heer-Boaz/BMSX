import type { WorkbenchMenuCommandDefinition } from '../../ui/menu/model';
import type { CartMapInput } from './editor_input';

export const CART_MAP_TITLE_ACTIONS: readonly WorkbenchMenuCommandDefinition<CartMapInput>[] = [
	{ type: 'command', command: 'cartMap.map', icon: 'grid', when: input => input.layout.mode === 'outline' },
	{ type: 'command', command: 'cartMap.outline', icon: 'back', when: input => input.layout.mode === 'map' },
	{ type: 'command', command: 'editor.source', icon: 'source' },
];
