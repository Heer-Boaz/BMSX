import type { Clipboard, ClipboardAction, ClipboardTarget } from '../../common/clipboard';

export class HeadlessClipboard implements Clipboard {
	public text = '';

	public async readText(): Promise<string> { return this.text; }

	public async writeText(text: string): Promise<void> {
		this.text = text;
	}

	public execute(action: ClipboardAction, target: ClipboardTarget): void {
		if (action === 'paste') {
			target.paste!({ text: this.text, images: [] });
			return;
		}
		const text = target.copy!();
		if (text === null) return;
		this.text = text;
		if (action === 'cut') target.cut!();
	}
}
