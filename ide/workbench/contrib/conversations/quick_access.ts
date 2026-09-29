import type { EditorPanes } from '../../services/editor/editor_panes';
import type { ObservedConversation } from '../../services/assistant/observed_conversation';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import { editorTabGroup } from '../../ui/tab/group_model';
import { openEditorTab } from '../../ui/tabs';
import { ConversationObserverInput } from './editor_input';

type Choice = { label: string; description: string; detail: string } & ({ kind: 'thread'; id: string } | { kind: 'page'; cursor: string } | { kind: 'search' });

export async function chooseObservedConversation(input: ConversationObserverInput, quickInput: QuickInputController, cursor?: string, search?: string): Promise<void> {
	if (input.conversation.pending) return;
	const page = await input.conversation.history(cursor, search);
	if (page === undefined || input.lifetime.signal.aborted || editorTabGroup.activeTab !== input) return;
	const choices: Choice[] = page.threads.map(thread => ({ kind: 'thread', id: thread.id, label: thread.title,
		description: new Date(thread.updatedAt * 1000).toLocaleString(), detail: thread.id }));
	if (page.nextCursor !== null) choices.push({ kind: 'page', cursor: page.nextCursor, label: 'Older conversations...', description: 'Next page', detail: '' });
	choices.push({ kind: 'search', label: 'Search all conversations...', description: 'Search saved titles', detail: '' });
	quickInput.pick('Codex CLI conversations', 'Read only - continue writing in the CLI', () => new TextQuickPickProvider(choices), choice => {
		if (choice.kind === 'page') void chooseObservedConversation(input, quickInput, choice.cursor, search);
		else if (choice.kind === 'search') quickInput.input('Search Codex conversations', 'Title contains...', search ?? '', async value => value,
			value => { void chooseObservedConversation(input, quickInput, undefined, value); });
		else void input.conversation.select(choice.id);
	});
}

export function openObservedConversation(panes: EditorPanes, conversation: ObservedConversation, quickInput: QuickInputController): void {
	const existing = editorTabGroup.tabs.find(input => input.kind === 'conversation_observer');
	const input = existing ?? new ConversationObserverInput(conversation);
	openEditorTab(panes, input);
	void chooseObservedConversation(input, quickInput);
}
