export const NEWLINE = '\n';

export function textFromLines(lines: readonly string[]): string {
	return lines.join(NEWLINE);
}

export function splitText(text: string): string[] {
	return text.split(NEWLINE);
}

let cachedLines: readonly string[] | null = null;
let cachedVersion = -1;
let cachedSource = '';

export function joinLinesCached(lines: readonly string[], version: number): string {
	if (cachedLines === lines && cachedVersion === version) {
		return cachedSource;
	}
	cachedLines = lines;
	cachedVersion = version;
	cachedSource = textFromLines(lines);
	return cachedSource;
}
