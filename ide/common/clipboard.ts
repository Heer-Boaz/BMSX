export interface Clipboard {
	isSupported(): boolean;
	writeText(text: string): Promise<void>;
}
