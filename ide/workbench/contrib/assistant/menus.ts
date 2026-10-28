import type { WorkbenchMenuCommandDefinition } from '../../ui/menu/model';
import type { AssistantInput } from './editor_input';

const queuedDraft = (input: AssistantInput): boolean => (input.conversation.state === 'running' || input.conversation.queued.length > 0)
	&& !input.draft.text.startsWith('/') && input.editingQueuedId === undefined;

export const ASSISTANT_TURN_ACTIONS: readonly WorkbenchMenuCommandDefinition<AssistantInput>[] = [
	{ type: 'command', command: 'assistant.send', when: input => !queuedDraft(input) },
	{ type: 'command', command: 'assistant.stop', when: input => input.conversation.state === 'running'
		|| input.conversation.state === 'starting' || input.conversation.state === 'stopping' },
	{ type: 'command', command: 'assistant.queue', when: queuedDraft },
	{ type: 'command', command: 'assistant.direct', when: input => queuedDraft(input) && input.conversation.state === 'running' },
	{ type: 'command', command: 'assistant.review', when: input => input.selection.proposal !== undefined },
];
