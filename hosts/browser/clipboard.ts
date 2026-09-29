import { ClipboardAccessError, type Clipboard, type ClipboardContents, type ClipboardImage, type ClipboardTarget } from '../common/clipboard';
import type { BrowserInputHub } from './input';
import { readClipboardImage } from './image';

/** OS clipboard access. There is no browser-private text clipboard. */
export class BrowserClipboard implements Clipboard {
	public get canRead(): boolean { return navigator.clipboard?.read !== undefined; }

	/** Native events retain user activation and work on LAN HTTP without API permissions. */
	public bindInput(input: BrowserInputHub, resolveTarget: () => ClipboardTarget | undefined,
		reportFailure: (error: ClipboardAccessError) => void): () => void {
		input.setNativeClipboardEnabled(action => resolveTarget()?.[action] !== undefined);
		const copy = (event: ClipboardEvent) => {
			if (!event.isTrusted || event.defaultPrevented || event.clipboardData === null) return;
			const target = resolveTarget();
			if (target?.copy === undefined) return;
			const action = event.type as 'copy' | 'cut';
			// Read-only controls never copy or remove text for Cut.
			if (action === 'cut' && (target.cut === undefined || target.readOnly)) return;
			const text = target.copy();
			if (text === null) return;
			try { event.clipboardData.setData('text/plain', text); }
			catch (cause) { reportFailure(new ClipboardAccessError(action, { cause })); return; }
			event.preventDefault();
			if (action === 'cut') target.cut!();
		};
		const paste = (event: ClipboardEvent) => {
			if (!event.isTrusted || event.defaultPrevented || event.clipboardData === null) return;
			const target = resolveTarget();
			if (target?.paste === undefined) return;
			event.preventDefault();
			if (target.readOnly) return;
			target.paste(this.readEvent(event.clipboardData));
		};
		window.addEventListener('copy', copy);
		window.addEventListener('cut', copy);
		window.addEventListener('paste', paste);
		return () => {
			window.removeEventListener('copy', copy); window.removeEventListener('cut', copy); window.removeEventListener('paste', paste);
			input.setNativeClipboardEnabled(undefined);
		};
	}

	/** Menus use the permission-controlled API, never the unsupported execCommand('paste'). */
	public async read(): Promise<ClipboardContents> {
		if (!this.canRead) throw new ClipboardAccessError('paste');
		try {
			const items = await navigator.clipboard.read();
			// An item's MIME types are alternative representations, not separate attachments.
			// Acquire every chosen blob now; decoding may happen later in the draft owner.
			const contents = await Promise.all(items.map(async item => {
				const imageType = item.types.includes('image/png') ? 'image/png' : item.types.find(type => type.startsWith('image/'));
				const [text, image] = await Promise.all([
					item.types.includes('text/plain') ? item.getType('text/plain').then(blob => blob.text()) : '',
					imageType === undefined ? undefined : item.getType(imageType),
				]);
				return { text, image };
			}));
			const text: string[] = [], images: ClipboardImage[] = [];
			for (const item of contents) {
				if (item.text.length > 0) text.push(item.text);
				if (item.image !== undefined) {
					const blob = item.image;
					images.push({ read: () => readClipboardImage(blob) });
				}
			}
			return { text: text.join('\n'), images };
		} catch (cause) { throw new ClipboardAccessError('paste', { cause }); }
	}

	public async readText(): Promise<string> {
		if (navigator.clipboard === undefined) throw new ClipboardAccessError('paste');
		try { return await navigator.clipboard.readText(); }
		catch (cause) { throw new ClipboardAccessError('paste', { cause }); }
	}

	public async writeText(text: string): Promise<void> {
		if (navigator.clipboard === undefined) {
			// Explicit Copy on HTTP uses the browser's synchronous command capability.
			this.execute('copy', { copy: () => text });
			return;
		}
		try { await navigator.clipboard.writeText(text); }
		catch (cause) { throw new ClipboardAccessError('copy', { cause }); }
	}

	/** Menus/commands must observe execCommand's result before editing. Never await Cut. */
	public execute(action: 'copy' | 'cut', target: ClipboardTarget): void {
		const text = target.copy!();
		if (text === null) return;
		let handled = false;
		let failure: ClipboardAccessError | undefined;
		const receive = (event: ClipboardEvent) => {
			if (!event.isTrusted || event.clipboardData === null) return;
			event.preventDefault(); event.stopImmediatePropagation();
			try {
				event.clipboardData.setData('text/plain', text);
				handled = true;
			} catch (cause) { failure = new ClipboardAccessError(action, { cause }); }
		};
		document.addEventListener(action, receive, true);
		let accepted: boolean;
		try { accepted = document.execCommand(action); }
		catch (cause) { throw new ClipboardAccessError(action, { cause }); }
		finally { document.removeEventListener(action, receive, true); }
		if (failure !== undefined) throw failure;
		if (!accepted || !handled) throw new ClipboardAccessError(action);
		if (action === 'cut') target.cut!();
	}

	private readEvent(data: DataTransfer): ClipboardContents {
		const images: ClipboardImage[] = [];
		for (const file of data.files) if (file.type.startsWith('image/')) images.push({ read: () => readClipboardImage(file) });
		return { text: data.getData('text/plain'), images };
	}
}
