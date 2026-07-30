import type { Clipboard } from '../common/clipboard';

export class HeadlessClipboard implements Clipboard {
	public text = '';

	public isSupported(): boolean {
		return true;
	}

	public async writeText(text: string): Promise<void> {
		this.text = text;
	}
}
