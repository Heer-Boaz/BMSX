export interface Clipboard {
	/** Internal clipboard shared by every input control, independent of OS access. */
	readonly text: string;
	isSupported(): boolean;
	writeText(text: string): Promise<void>;
}
