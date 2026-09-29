import type { CartEditor } from '../../../cart_editor';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';

/** Status is inspectable from the persistent icon and the keyboard command palette. */
export function showServerConnection(editor: CartEditor): void {
	const choices = [{ label: `Workspace server: ${editor.serverConnectionState}`, description: '',
		detail: editor.serverConnectionDetail, retry: false }];
	if (editor.serverConnectionState === 'disconnected' || editor.serverConnectionState === 'reconnecting') {
		choices.push({ label: 'Retry connection', description: 'Register this window again', detail: 'No previous commands or tool calls will be replayed.', retry: true });
	}
	editor.quickInput.pick('Studio server', 'Connection details', () => new TextQuickPickProvider(choices), choice => {
		if (choice.retry) editor.retryServerConnection!();
	});
}
