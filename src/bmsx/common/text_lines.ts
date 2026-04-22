export function splitText(text: string): string[] {
	const lines: string[] = [];
	appendTextLines(lines, text);
	return lines;
}

export function writeTextLines(out: string[], text: string): void {
	out.length = 0;
	appendTextLines(out, text);
}

export function appendTextLines(out: string[], text: string): void {
	let lineStart = 0;
	for (let index = 0; index <= text.length; index += 1) {
		if (index !== text.length && text.charCodeAt(index) !== 10) {
			continue;
		}
		let lineEnd = index;
		if (lineEnd > lineStart && text.charCodeAt(lineEnd - 1) === 13) {
			lineEnd -= 1;
		}
		out.push(text.slice(lineStart, lineEnd));
		lineStart = index + 1;
	}
}
