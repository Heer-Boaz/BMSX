import type { RgbaImage } from '../../machine/ts/render/image';

export interface Clipboard {
	/** Internal clipboard shared by every input control, independent of OS access. */
	readonly text: string;
	isSupported(): boolean;
	writeText(text: string): Promise<void>;
}

/** Captured during a native paste event. File reads belong to the receiving control. */
export type ClipboardContents = {
	text: string;
	images: readonly ClipboardImage[];
};

export type ClipboardImageData = { url: string; preview: RgbaImage };
export interface ClipboardImage { read(): Promise<ClipboardImageData>; }
