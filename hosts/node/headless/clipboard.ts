import type { Clipboard, ClipboardContents, ClipboardTarget } from '../../common/clipboard';

export class HeadlessClipboard implements Clipboard {
	public readonly canRead = true;
	public text = '';

	public async read(): Promise<ClipboardContents> { return { text: this.text, images: [] }; }

	public async readText(): Promise<string> { return this.text; }

	public async writeText(text: string): Promise<void> {
		this.text = text;
	}

	public execute(action: 'copy' | 'cut', target: ClipboardTarget): void {
		const text = target.copy!();
		if (text === null) return;
		this.text = text;
		if (action === 'cut') target.cut!();
	}
}
