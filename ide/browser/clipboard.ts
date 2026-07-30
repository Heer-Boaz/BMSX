import type { Clipboard as IdeClipboard } from '../common/clipboard';

export class BrowserClipboard implements IdeClipboard {
	isSupported(): boolean {
		return !!navigator.clipboard;
	}

	async writeText(text: string): Promise<void> {
		await navigator.clipboard.writeText(text);
	}
}
