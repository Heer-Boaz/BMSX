import type { BrowserInputHub } from '../../hosts/browser/input';
import { readClipboardImage } from '../../hosts/browser/image';
import { inputFocus } from '../input/focus';
import type { Clipboard as IdeClipboard, ClipboardImage } from '../../hosts/common/clipboard';

export class BrowserClipboard implements IdeClipboard {
	public text = '';

	/** Native paste works on LAN HTTP too; no async Clipboard API read permission. */
	public bindNativePaste(input: BrowserInputHub, active: () => boolean): () => void {
		input.setNativePasteEnabled(() => active() && inputFocus.target?.paste !== undefined);
		const paste = (event: ClipboardEvent) => {
			const receive = active() ? inputFocus.target?.paste : undefined;
			if (receive === undefined || event.clipboardData === null) return;
			event.preventDefault();
			this.text = event.clipboardData.getData('text/plain');
			const images: ClipboardImage[] = [];
			for (const file of event.clipboardData.files) if (file.type.startsWith('image/')) images.push({ read: () => readClipboardImage(file) });
			receive({ text: this.text, images });
		};
		window.addEventListener('paste', paste);
		return () => { window.removeEventListener('paste', paste); input.setNativePasteEnabled(undefined); };
	}
	isSupported(): boolean {
		return navigator.clipboard !== undefined || document.queryCommandSupported('copy');
	}

	async writeText(text: string): Promise<void> {
		this.text = text;
		if (navigator.clipboard !== undefined) {
			try { await navigator.clipboard.writeText(text); return; }
			catch (error) {
				if (!(error instanceof DOMException) || error.name !== 'NotAllowedError') throw error;
			}
		}
		// The user-gesture DOM copy capability also works without async clipboard
		// access (LAN HTTP or a denied API permission). Like VS Code, write the OS
		// clipboard, not only a private cache that native paste cannot read.
		const previous = document.activeElement;
		const source = document.createElement('textarea');
		source.setAttribute('aria-hidden', 'true');
		source.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
		source.value = text;
		document.body.appendChild(source);
		try {
			source.focus({ preventScroll: true }); source.select();
			if (!document.execCommand('copy')) throw new Error('Browser clipboard copy was denied');
		} finally {
			source.remove();
			if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
		}
	}
}
