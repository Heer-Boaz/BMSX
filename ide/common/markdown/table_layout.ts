import { MarkdownLineLayout, type MarkdownRow, type MarkdownRun, type StyledMeasure } from './line_layout';
import { TextStyle, type MarkdownTable, type MarkdownTextLine } from './model';

type CellMetrics = { revision: number; natural: number; word: number };

/** Content-sized columns; narrow surfaces keep each header beside its value as records.
 * Cells retain both measured metrics and wrapped lines while streamed column widths stay fixed.
 */
export class MarkdownTableLayout {
	private revision = -1;
	private rows: MarkdownRow[] = [];
	private readonly metrics = new WeakMap<MarkdownTextLine, CellMetrics>();
	private columns: MarkdownLineLayout[] = [];
	private records: MarkdownLineLayout | undefined;
	private header: MarkdownTextLine[] | undefined;
	private rendered = new WeakMap<MarkdownTextLine[], MarkdownRow[]>();
	public constructor(private readonly width: number, private readonly measure: StyledMeasure) {}

	public layout(table: MarkdownTable): readonly MarkdownRow[] {
		if (table.revision === this.revision) return this.rows;
		const prefixes = table.prefixes.map(prefix => ({ ...prefix, width: this.measure(prefix.text, 0, prefix.text.length, TextStyle.Plain) }));
		const inset = prefixes.reduce((sum, prefix) => sum + prefix.width, 0);
		const available = this.width - inset, gap = this.measure(' | ', 0, 3, TextStyle.Muted);
		const space = this.measure(' ', 0, 1, TextStyle.Plain);
		const natural = table.alignments.map(() => space), widths = natural.slice();
		for (const row of table.rows) for (let column = 0; column < row.length; column++) {
			const cell = row[column], metrics = this.cellMetrics(cell);
			natural[column] = Math.max(natural[column], metrics.natural);
			widths[column] = Math.max(widths[column], metrics.word);
		}
		let room = available - (widths.length - 1) * gap - widths.reduce((sum, width) => sum + width, 0);
		const records = room < 0;
		if (records) {
			if (!this.records) { this.records = new MarkdownLineLayout(available, this.measure); this.rendered = new WeakMap(); }
			// Record labels come from the header, so a streamed header change invalidates
			// every labelled row, even when the values themselves did not change.
			if (table.rows[0] !== this.header) this.rendered = new WeakMap();
		} else {
			// Water-fill the remaining room toward natural widths. Small columns stop
			// growing early, leaving space for prose; words do not split across columns.
			let growing = widths.filter((width, index) => width < natural[index]).length;
			while (room > 0 && growing > 0) {
				// disable-next-line redundant_numeric_sanitization_pattern -- Pixel allocation, not value validation: distribute whole pixels and consume the final remainder even when fewer pixels than columns remain.
				const share = Math.max(1, Math.trunc(room / growing));
				growing = 0;
				for (let column = 0; column < widths.length; column++) {
					const extra = Math.min(share, room, natural[column] - widths[column]);
					widths[column] += extra; room -= extra;
					if (widths[column] < natural[column]) growing++;
				}
			}
			if (this.records || widths.some((width, index) => this.columns[index]?.width !== width)) {
				this.columns = widths.map(width => new MarkdownLineLayout(width, this.measure));
				this.records = undefined; this.rendered = new WeakMap();
			}
		}
		this.header = table.rows[0];
		const rows: MarkdownRow[] = [];
		for (let index = records && table.rows.length > 1 ? 1 : 0; index < table.rows.length; index++) {
			const cells = table.rows[index];
			let rendered = this.rendered.get(cells);
			if (!rendered) {
				rendered = records ? this.renderRecord(cells, this.header, index > 0) : this.renderColumns(cells, table.alignments, gap);
				this.rendered.set(cells, rendered);
			}
			if (records && rows.length) rows.push({ text: '', runs: [], offset: 0, inset: 0, code: false });
			for (const row of rendered) rows.push(row);
			if (!records && index === 0) {
				const dash = this.measure('-', 0, 1, TextStyle.Muted), runs: MarkdownRun[] = [];
				let x = 0;
				for (const width of widths) {
					const text = '-'.repeat(Math.trunc(width / dash));
					runs.push({ text, x, width: text.length * dash, style: TextStyle.Muted }); x += width + gap;
				}
				rows.push({ text: runs.map(run => run.text).join('   '), runs, offset: 0, inset: 0, code: false });
			}
		}
		if (prefixes.length) for (let index = 0; index < rows.length; index++) {
			const row = rows[index], runs: MarkdownRun[] = [];
			let x = 0;
			for (const prefix of prefixes) {
				if (prefix.repeat || index === 0 && prefix.first) runs.push({ text: prefix.text, x, width: prefix.width, style: TextStyle.Plain });
				x += prefix.width;
			}
			for (const run of row.runs) runs.push({ ...run, x: run.x + inset });
			rows[index] = { ...row, inset, runs };
		}
		this.revision = table.revision; this.rows = rows;
		return rows;
	}
	private cellMetrics(cell: MarkdownTextLine): CellMetrics {
		const cached = this.metrics.get(cell);
		if (cached?.revision === cell.revision) return cached;
		let natural = 0, longest = 0, word = 0;
		for (const span of cell.spans) for (let index = 0; index < span.text.length;) {
			const end = index + (span.text.codePointAt(index)! > 0xffff ? 2 : 1);
			const width = this.measure(span.text, index, end, span.style);
			natural += width;
			if (span.text[index] === ' ' || span.text[index] === '\t' || span.text[index] === '\n') { longest = Math.max(longest, word); word = 0; }
			else word += width;
			index = end;
		}
		const metrics = { revision: cell.revision, natural, word: Math.max(longest, word) };
		this.metrics.set(cell, metrics); return metrics;
	}

	private renderColumns(cells: MarkdownTextLine[], alignments: MarkdownTable['alignments'], gap: number): MarkdownRow[] {
		const wrapped = cells.map((cell, index) => this.columns[index].layout(cell));
		const height = wrapped.reduce((height, rows) => Math.max(height, rows.length), 1), rows: MarkdownRow[] = [];
		for (let index = 0; index < height; index++) {
			const runs: MarkdownRun[] = [], text: string[] = [];
			let x = 0;
			for (let column = 0; column < wrapped.length; column++) {
				if (column > 0) { runs.push({ text: ' | ', x: x - gap, width: gap, style: TextStyle.Muted }); }
				const row = wrapped[column][index], width = this.columns[column].width;
				text.push(row ? row.text : '');
				if (row) {
					const used = row.runs.reduce((sum, run) => sum + run.width, 0);
					const offset = alignments[column] === 'right' ? width - used : alignments[column] === 'center' ? Math.trunc((width - used) / 2) : 0;
					for (const run of row.runs) runs.push({ ...run, x: x + offset + run.x });
				}
				x += width + gap;
			}
			rows.push({ text: text.join(' | '), runs, offset: 0, inset: 0, code: false });
		}
		return rows;
	}

	private renderRecord(cells: MarkdownTextLine[], header: MarkdownTextLine[], hasValues: boolean): MarkdownRow[] {
		const rows: MarkdownRow[] = [];
		for (let column = 0; column < cells.length; column++) {
			const spans = hasValues ? [...header[column].spans, { text: ': ', style: TextStyle.Bold }, ...cells[column].spans] : cells[column].spans;
			for (const row of this.records!.layout({ kind: 'text', revision: 0, prefixes: [], code: false, spans })) rows.push(row);
		}
		return rows;
	}
}
