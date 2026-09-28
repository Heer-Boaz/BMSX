import type { MarkdownBlock, MarkdownTable } from './model';
import { MarkdownLineLayout, type MarkdownRow, type StyledMeasure } from './line_layout';
import { MarkdownTableLayout } from './table_layout';
export type { MarkdownRow, MarkdownRun, StyledMeasure } from './line_layout';

type BlockLayout = { revision: number; rows: MarkdownRow[] };

/** Layout lifetime is independent of source parsing: a resize remeasures, it does not reparse. */
export class MarkdownLayout {
	private readonly blocks = new WeakMap<MarkdownBlock, BlockLayout>();
	private readonly tables = new WeakMap<MarkdownTable, MarkdownTableLayout>();
	private readonly lines: MarkdownLineLayout;
	public constructor(private readonly width: number, private readonly measure: StyledMeasure) {
		this.lines = new MarkdownLineLayout(width, measure);
	}
	public layout(block: MarkdownBlock): readonly MarkdownRow[] {
		let cached = this.blocks.get(block);
		if (cached) {
			if (cached.revision === block.revision) return cached.rows;
			cached.rows.length = block.separated ? 1 : 0;
		} else {
			cached = { revision: block.revision, rows: [] };
			if (block.separated) cached.rows.push({ text: '', runs: [], offset: 0, inset: 0, code: false });
			this.blocks.set(block, cached);
		}
		const rows = cached.rows;
		for (const line of block.lines) {
			if (line.kind === 'text') { for (const row of this.lines.layout(line)) rows.push(row); }
			else {
				let table = this.tables.get(line);
				if (!table) { table = new MarkdownTableLayout(this.width, this.measure); this.tables.set(line, table); }
				for (const row of table.layout(line)) rows.push(row);
			}
		}
		cached.revision = block.revision;
		return rows;
	}
}
