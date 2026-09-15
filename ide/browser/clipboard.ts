import type { Clipboard as IdeClipboard } from '../../hosts/common/clipboard';

export class BrowserClipboard implements IdeClipboard {
	public text = '';
	isSupported(): boolean {
		return !!navigator.clipboard;
	}

	async writeText(text: string): Promise<void> {
		this.text = text;
		if (this.isSupported()) {
			await navigator.clipboard.writeText(text);
		}
	}
}
