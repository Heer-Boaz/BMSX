import type { Clipboard } from '../../../../hosts/common/clipboard';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import { setFieldText } from '../../../editor/ui/inline/text_field';
import { writeClipboard } from '../../../input/clipboard';
import { getActiveTab } from '../../ui/tabs';
import type { AssistantInput } from './editor_input';

const COMMANDS = [
	{ label: '/history', description: 'Open a saved conversation', detail: 'No model request' },
	{ label: '/new', description: 'Start a new conversation', detail: 'Keep previous history' },
	{ label: '/queue', description: 'Inspect, edit or remove queued messages', detail: 'Native Codex queue' },
	{ label: '/continue', description: 'Continue the stopped queue', detail: 'Explicit execution' },
	{ label: '/stop', description: 'Stop work and pause the queue', detail: 'Keep waiting messages' },
	{ label: '/older', description: 'Load older messages', detail: 'Current conversation' },
	{ label: '/login', description: 'Sign in to Codex', detail: 'Opens a browser; /login device for a code' },
	{ label: '/logout', description: 'Sign out of Codex', detail: 'Keep conversation history' },
	{ label: '/open', description: 'Open the sign-in page', detail: 'During sign-in' },
	{ label: '/copy-code', description: 'Copy the sign-in code', detail: 'During /login device' },
	{ label: '/cancel', description: 'Cancel sign-in or queue editing', detail: 'No model request' },
	{ label: '/help', description: 'Message and command help', detail: '' },
];

/** Chat commands and explicit picker navigation, independent of rendering and provider RPC. */
/**
 * A draft that submit() dispatches as a command rather than as a prompt. The composer
 * uses it to run commands on plain Enter, the way a conversation UI does, so the rule
 * lives here with the dispatch instead of being restated at the keyboard.
 */
export function isAssistantCommand(input: AssistantInput): boolean {
	return input.editingQueuedId === undefined ? input.draft.text.startsWith('/') : input.draft.text === '/cancel';
}

export class AssistantChatCommands {
	public constructor(private readonly quickInput: QuickInputController, private readonly clipboard: Clipboard) {}

	public commands(input: AssistantInput): void {
		this.quickInput.pick('Codex commands', 'Choose a command', () => new TextQuickPickProvider(COMMANDS), item => {
			setFieldText(input.draft, item.label, true); input.draft.focusTarget.focus();
		});
	}

	public async history(input: AssistantInput, cursor?: string, search?: string): Promise<void> {
		if (input.commandPending || !input.conversation.canBrowse) return;
		input.commandPending = true;
		try {
			const page = await input.conversation.listHistory(cursor, search);
			if (input.lifetime.signal.aborted || getActiveTab() !== input) return;
			const items = page.threads.map(thread => ({ label: thread.title, description: new Date(thread.updatedAt * 1000).toLocaleString(), detail: '',
				id: thread.id, cursor: undefined as string | undefined }));
			if (page.nextCursor !== null) items.push({ label: 'Older conversations...', description: 'Load the next page', detail: '', id: '', cursor: page.nextCursor });
			this.quickInput.pick('Codex history', 'Filter this page; /history text searches saved titles', () => new TextQuickPickProvider(items), item => {
				if (item.cursor !== undefined) void this.history(input, item.cursor, search);
				else void input.conversation.openConversation(item.id);
			});
		} catch (error) { if (!input.lifetime.signal.aborted) input.conversation.notice(`History unavailable: ${String(error)}`); }
		finally { input.commandPending = false; }
	}

	public async queue(input: AssistantInput): Promise<void> {
		if (input.commandPending) return;
		const model = input.conversation;
		input.commandPending = true;
		await model.connect();
		input.commandPending = false;
		if (input.lifetime.signal.aborted || getActiveTab() !== input || model.state === 'disconnected') return;
		const items = model.queued.map((message, index) => ({ label: message.text, description: `Queued ${index + 1}`, detail: 'Edit or remove', message }));
		this.quickInput.pick('Codex queue', model.queuePaused ? 'Paused; /continue resumes work' : 'Waiting for the active turn', () => new TextQuickPickProvider(items), item => {
			this.quickInput.pick('Queued message', item.message.text, () => new TextQuickPickProvider([
				{ label: 'Edit message', description: 'Change text in the composer', detail: '', edit: true },
				{ label: 'Remove message', description: 'Do not send it', detail: '', edit: false },
			]), action => {
				if (action.edit) {
					input.editingQueuedId = item.message.id;
					setFieldText(input.draft, item.message.text, true); input.draft.focusTarget.focus();
				} else void model.changeQueued({ type: 'queue-delete', id: item.message.id });
			});
		});
	}

	public async submit(input: AssistantInput, direct = false): Promise<void> {
		const text = input.draft.text, model = input.conversation;
		if (input.commandPending || text.trim().length === 0) return;
		let accepted = true;
		if (input.editingQueuedId !== undefined && text === '/cancel') {
			input.editingQueuedId = undefined;
		} else if (input.editingQueuedId !== undefined) {
			accepted = await model.changeQueued({ type: 'queue-update', id: input.editingQueuedId, prompt: text });
			if (accepted) input.editingQueuedId = undefined;
		} else if (!direct && isAssistantCommand(input)) {
			const end = text.search(/\s/), command = end === -1 ? text : text.slice(0, end), argument = end === -1 ? undefined : text.slice(end).trim();
			switch (command) {
				case '/': this.commands(input); break;
				case '/history': await this.history(input, undefined, argument); break;
				case '/new': await model.newConversation(); break;
				case '/older': await model.loadOlder(); break;
				case '/queue': await this.queue(input); break;
				case '/continue': await model.continueQueue(); break;
				case '/stop': await model.interrupt(); break;
				case '/login':
					await model.connect();
					await model.startLogin({ type: argument === 'device' ? 'device-code' : 'loopback' });
					break;
				case '/logout': await model.signOut(); break;
				case '/open': model.openLoginPage(); break;
				case '/copy-code': if (model.loginCode !== undefined) await writeClipboard(this.clipboard, model.loginCode, 'Copied sign-in code'); break;
				case '/cancel': input.editingQueuedId = undefined; await model.cancelLogin(); break;
				case '/help': model.notice('Enter runs a command. Ctrl+Enter sends a message, or queues it while Codex works. Ctrl+Shift+Enter / Direct steers the active turn. Stop pauses the queue without deleting it.\n/history, /new, /older, /queue, /continue, /stop, /login, /logout, /open, /copy-code, /cancel\nClick a message and press Ctrl+C to copy it, including the sign-in address.\n/login signs in through your browser; /login device shows a code instead, for a browser on another machine.\nQueued messages capture fresh Studio source context when their turn starts. Direct messages keep the active turn context.'); break;
				default: model.notice(`Unknown command: ${command}. Use / for commands.`); accepted = false;
			}
		} else accepted = await model.sendPrompt(text, direct);
		// Never erase a draft that changed while a transport command was in flight.
		if (accepted && !input.lifetime.signal.aborted && input.draft.text === text) setFieldText(input.draft, '', false);
	}
}
