import type { RgbaImage } from '../../machine/ts/render/image';

export interface Clipboard {
	/** Whether the host offers programmatic Paste. Native user Paste is independent. */
	readonly canRead: boolean;
	read(): Promise<ClipboardContents>;
	/** Explicit, non-destructive access. Rejection never means a private copy succeeded. */
	readText(): Promise<string>;
	writeText(text: string): Promise<void>;
	/** Synchronous user action. Cut may edit only after the platform admits the write. */
	execute(action: 'copy' | 'cut', target: ClipboardTarget): void;
}

export type ClipboardAction = 'copy' | 'cut' | 'paste';

/** The focused control owns selection, text constraints and Undo, never OS access. */
export interface ClipboardTarget {
	readonly readOnly?: boolean;
	/** A read-only query. Null means no selection; do not replace the clipboard. */
	copy?(): string | null;
	/** Called synchronously after copying, never after an asynchronous permission prompt. */
	cut?(): void;
	paste?(contents: ClipboardContents): void;
}

export class ClipboardAccessError extends Error {
	public constructor(public readonly action: ClipboardAction, options?: ErrorOptions) {
		super(`Clipboard ${action} was not allowed.`, options);
	}
}

/** Both browser key events and polled host input use this exact shortcut definition. */
export function clipboardAction(code: string, ctrl: boolean, meta: boolean, shift: boolean, alt: boolean): ClipboardAction | undefined {
	if (alt) return undefined;
	if ((ctrl || meta) && code === 'KeyV') return 'paste';
	if ((ctrl || meta) && !shift) {
		if (code === 'KeyC' || code === 'Insert') return 'copy';
		if (code === 'KeyX') return 'cut';
	}
	if (shift && !ctrl && !meta) {
		if (code === 'Delete') return 'cut';
		if (code === 'Insert') return 'paste';
	}
	return undefined;
}

/** Captured from the system clipboard. Image decoding belongs to the receiving control. */
export type ClipboardContents = {
	text: string;
	images: readonly ClipboardImage[];
};

export type ClipboardImageData = { url: string; preview: RgbaImage };
export interface ClipboardImage { read(): Promise<ClipboardImageData>; }
