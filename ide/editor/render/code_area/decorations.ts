import { CodeTextDecoration, type CodeLineView, type SearchMatch } from '../../../common/models';
import { computeSelectionSlices } from '../../common/text/layout';
import { editorViewState } from '../../ui/view/state';

/** One retained, visible glyph-span mask; source caches remain semantic rather than presentation state. */
export class CodeRowDecorations {
	public readonly roles: CodeTextDecoration[] = [];
	public startDisplay = 0;
	public hasDecorations = false;
	private endDisplay = 0;

	public prepare(row: number, line: CodeLineView, startDisplay: number, endDisplay: number,
		references: readonly SearchMatch[], referenceActiveIndex: number, searches: readonly SearchMatch[], searchActiveIndex: number,
		searchesVisible: boolean, focused: boolean): void {
		this.startDisplay = startDisplay;
		this.endDisplay = endDisplay;
		this.hasDecorations = false;
		this.applyMatches(row, line, references, referenceActiveIndex, CodeTextDecoration.Reference, CodeTextDecoration.ActiveReference);
		if (searchesVisible) this.applyMatches(row, line, searches, searchActiveIndex, CodeTextDecoration.Search, CodeTextDecoration.ActiveSearch);
		const selection = computeSelectionSlices(row, line, startDisplay, endDisplay);
		const role = focused ? CodeTextDecoration.Selection : CodeTextDecoration.InactiveSelection;
		for (const range of selection) this.applyDisplayRange(range.startDisplay, range.endDisplay, role);
	}

	private applyMatches(row: number, line: CodeLineView, matches: readonly SearchMatch[], activeIndex: number,
		role: CodeTextDecoration, activeRole: CodeTextDecoration): void {
		let low = 0, high = matches.length;
		while (low < high) {
			const mid = (low + high) >>> 1;
			if (matches[mid].row < row) low = mid + 1; else high = mid;
		}
		for (let index = low; index < matches.length && matches[index].row === row; index++) {
			const match = matches[index];
			const ranges = editorViewState.layout.projectSourceRange(line, match.start, match.end);
			for (const range of ranges) this.applyDisplayRange(range.startDisplay, range.endDisplay, index === activeIndex ? activeRole : role);
		}
	}

	private applyDisplayRange(startDisplay: number, endDisplay: number, role: CodeTextDecoration): void {
		const start = Math.max(0, startDisplay - this.startDisplay);
		const end = Math.min(this.endDisplay, endDisplay) - this.startDisplay;
		if (end <= start) return;
		if (!this.hasDecorations) {
			this.roles.length = this.endDisplay - this.startDisplay;
			this.roles.fill(CodeTextDecoration.None);
			this.hasDecorations = true;
		}
		for (let index = start; index < end; index++) if (role > this.roles[index]) this.roles[index] = role;
	}
}
