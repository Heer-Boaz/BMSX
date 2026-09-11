import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import { computeSourceLabel } from '../../../common/paths';
import { CaseFoldedText } from '../../../common/search_text';
import { FuzzyScorer } from '../../../common/fuzzy_scorer';
import { appendQuickPickHighlights, appendQuickPickSourceRange } from '../../services/quick_input/highlights';
import { QuickPickHighlightSet } from '../../services/quick_input/highlight_set';
import type { QuickPickHighlight, QuickPickProjection, QuickPickProvider } from '../../services/quick_input/provider';
import type { ResourceQuickPickItem } from './quick_access';

// File identity/name/path priorities from VS Code's file-item scorer.
const PATH_IDENTITY_SCORE = 1 << 18;
const LABEL_PREFIX_SCORE = 1 << 17;
const LABEL_SCORE = 1 << 16;

type FileMatch = {
	readonly item: ResourceQuickPickItem;
	readonly itemIndex: number;
	readonly path: CaseFoldedText;
	readonly name: CaseFoldedText;
	readonly nameStart: number;
	score: number;
	pathIdentity: boolean;
	matchLength: number;
	nameMatchLength: number;
	highlightStart: number;
	highlightEnd: number;
};

/** File names/paths are query data; kind/domain display metadata is not a second path. */
export class FileQuickPickProvider implements QuickPickProvider<ResourceQuickPickItem> {
	private readonly entries: FileMatch[];
	private readonly scorer = new FuzzyScorer();
	private readonly candidateRanges = new QuickPickHighlightSet();
	private readonly projection = { matches: [] as FileMatch[], selectionIndex: -1,
		highlights: new ScratchBuffer<QuickPickHighlight>(() => ({ field: 'label', start: 0, end: 0 })) };

	public constructor(public readonly items: readonly ResourceQuickPickItem[]) {
		this.entries = items.map((item, itemIndex) => {
			const path = new CaseFoldedText(item.label), name = computeSourceLabel(item.label);
			const nameStart = item.label.length - name.length;
			return { item, itemIndex, path, nameStart, name: nameStart === 0 ? path : new CaseFoldedText(name),
				score: 0, pathIdentity: false, matchLength: 0, nameMatchLength: 0, highlightStart: 0, highlightEnd: 0 };
		});
	}

	public getPicks(value: string): QuickPickProjection {
		const query = value.trim(), matches = this.projection.matches, highlights = this.projection.highlights;
		matches.length = 0; highlights.clear();
		if (query.length === 0) {
			for (const entry of this.entries) {
				entry.highlightStart = 0; entry.highlightEnd = 0;
				matches.push(entry);
			}
			this.projection.selectionIndex = matches.length === 0 ? -1 : 0;
			return this.projection;
		}
		const pieces = query.split(/\s+/).map(piece => new CaseFoldedText(piece));
		const queryLower = pieces.length === 1 ? pieces[0].lower : query.toLowerCase();
		const preferNames = !query.includes('/') && !query.includes('\\');
		const candidate = this.candidateRanges.ranges;
		for (const entry of this.entries) {
			entry.highlightStart = highlights.length;
			entry.pathIdentity = queryLower === entry.path.lower;
			if (entry.pathIdentity) {
				entry.score = PATH_IDENTITY_SCORE;
				entry.matchLength = entry.item.label.length; entry.nameMatchLength = entry.name.text.length;
				appendQuickPickSourceRange(highlights, entry.item, 0, entry.item.label.length);
			} else {
				entry.score = 0;
				for (let index = 0; index < pieces.length; index += 1) {
					const piece = pieces[index];
					let score = preferNames ? this.scorer.score(piece, entry.name) : 0;
					if (score !== 0) {
						if (index === 0) candidate.clear();
						if (entry.name.lower.startsWith(piece.lower)) {
							score += LABEL_PREFIX_SCORE + Math.round(piece.lower.length / entry.name.lower.length * 100);
							appendQuickPickSourceRange(candidate, entry.item, entry.nameStart, entry.nameStart + entry.name.sourceEnd(piece.lower.length));
						} else {
							score += LABEL_SCORE;
							appendQuickPickHighlights(candidate, entry.item, entry.name, this.scorer.positions, entry.nameStart);
						}
					} else {
						score = this.scorer.score(piece, entry.path);
						if (score === 0) { entry.score = 0; break; }
						if (index === 0) candidate.clear();
						appendQuickPickHighlights(candidate, entry.item, entry.path, this.scorer.positions);
						// Equal normalized lengths plus a complete ordered match prove
						// full path identity, including alternate path separators.
						if (pieces.length === 1 && piece.lower.length === entry.path.lower.length) entry.pathIdentity = true;
					}
					entry.score += score;
				}
				if (entry.score === 0) continue;

				const ranges = this.candidateRanges.normalize(), end = ranges[ranges.length - 1].end;
				let nameStart = -1;
				for (const range of ranges) {
					const span = highlights.get(highlights.length);
					span.field = range.field; span.start = range.start; span.end = range.end;
					if (range.end > entry.nameStart && nameStart === -1) nameStart = Math.max(range.start, entry.nameStart);
				}
				entry.matchLength = end - ranges[0].start;
				entry.nameMatchLength = nameStart === -1 ? 0 : end - nameStart;
			}
			entry.highlightEnd = highlights.length;
			matches.push(entry);
		}
		matches.sort(compareFiles);
		this.projection.selectionIndex = matches.length === 0 ? -1 : 0;
		return this.projection;
	}
}

function compareFiles(left: FileMatch, right: FileMatch): number {
	if (left.pathIdentity !== right.pathIdentity) return left.pathIdentity ? -1 : 1;
	if (left.score !== right.score) return right.score - left.score;
	if (left.score > LABEL_SCORE) {
		if (left.score < LABEL_PREFIX_SCORE && left.nameMatchLength !== right.nameMatchLength) return left.nameMatchLength - right.nameMatchLength;
		if (left.name.text.length !== right.name.text.length) return left.name.text.length - right.name.text.length;
	}
	if ((left.nameMatchLength === 0) !== (right.nameMatchLength === 0)) return left.nameMatchLength === 0 ? 1 : -1;
	return left.matchLength - right.matchLength || left.name.text.localeCompare(right.name.text)
		|| left.path.text.localeCompare(right.path.text) || left.itemIndex - right.itemIndex;
}
