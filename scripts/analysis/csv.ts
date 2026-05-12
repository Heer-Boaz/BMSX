export function quoteCsv(value: string | number | undefined): string {
	const text = value === undefined ? '' : `${value}`;
	if (text.includes('"') || text.includes(',') || text.includes('\n') || text.includes('\r') || text.includes('\t')) {
		return `"${text.replace(/"/g, '""')}"`;
	}
	return text;
}

export function parseCsvRecord(line: string): string[] {
	const cells: string[] = [];
	let cell = '';
	let quoted = false;
	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		if (quoted) {
			if (char === '"' && line[index + 1] === '"') {
				cell += '"';
				index += 1;
			} else if (char === '"') {
				quoted = false;
			} else {
				cell += char;
			}
		} else if (char === ',') {
			cells.push(cell);
			cell = '';
		} else if (char === '"') {
			quoted = true;
		} else {
			cell += char;
		}
	}
	cells.push(cell);
	return cells;
}
