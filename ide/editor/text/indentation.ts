/** Leading editor indentation is spaces/tabs, not arbitrary token whitespace. */
export function countLeadingIndent(line: string): number {
	let count = 0;
	while (count < line.length) {
		const ch = line.charCodeAt(count);
		if (ch !== 9 && ch !== 32) break;
		count += 1;
	}
	return count;
}

export function extractIndentation(line: string): string {
	return line.slice(0, countLeadingIndent(line));
}
