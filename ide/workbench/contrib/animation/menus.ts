import type { WorkbenchMenuCommandDefinition, WorkbenchMenuDefinition } from '../../ui/menu/model';
import type { AnimationEditorInput } from './editor_input';

export const ANIMATION_TITLE_ACTIONS: readonly WorkbenchMenuCommandDefinition<AnimationEditorInput>[] = [
	{ type: 'command', command: 'animation.addKey', when: input => input.document?.family === 'timeline' },
	{ type: 'command', command: 'animation.addTrack', when: input => input.document?.family === 'timeline' },
	{ type: 'command', command: 'animation.addFrame', when: input => input.document?.family === 'sprite' },
];

export const ANIMATION_CONTEXT_ACTIONS: WorkbenchMenuDefinition<AnimationEditorInput> = [
	{ type: 'command', command: 'animation.duplicate' },
	{ type: 'command', command: 'animation.earlier' },
	{ type: 'command', command: 'animation.later' },
	{ type: 'command', command: 'animation.addClip', when: input => input.document?.family === 'timeline' },
	{ type: 'command', command: 'animation.addFrame' },
	{ type: 'command', command: 'animation.addProperty' },
	{ type: 'command', command: 'animation.openClip' },
	{ type: 'separator' },
	{ type: 'command', command: 'animation.fit' },
	{ type: 'command', command: 'animation.snap' },
	{ type: 'command', command: 'animation.edit' },
	{ type: 'command', command: 'animation.remove' },
	{ type: 'command', command: 'editor.source' },
	{ type: 'command', command: 'editor.sourceToSide' },
	{ type: 'command', command: 'animation.producerSource' },
	{ type: 'command', command: 'animation.producerSourceToSide' },
];
