export function quoteCsv(value: string | number | undefined): string {
	const text = value === undefined ? '' : `${value}`;
	if (text.includes('"') || text.includes(',') || text.includes('\n') || text.includes('\r') || text.includes('\t')) {
		return `"${text.replace(/"/g, '""')}"`;
	}
	return text;
}
