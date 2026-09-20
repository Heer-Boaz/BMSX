import { LuaSyntaxKind, type LuaChunk } from './ast';
import { walkLuaAst, type LuaAstNode } from './ast/traversal';
import type { LuaSourceUnit } from './source_layout';
import type { LuaStatementCursor, LuaStatementSequence } from './statement_sequence';

type SequenceFrontier = {
	readonly sequence: LuaStatementSequence;
	readonly start: number;
	readonly end: number;
	readonly cursor: LuaStatementCursor;
};

type UsedParts = { readonly from: number; to: number };

/** Ephemeral old-tree frontier and occurrence ownership for one forward parse. */
export class LuaStatementReuse {
	private readonly frontier: SequenceFrontier[];
	private readonly used = new Map<LuaStatementSequence, UsedParts[]>();

	public constructor(private readonly previous: LuaChunk) {
		const end = previous.locations.offset(previous.span.unit, previous.span.end);
		this.frontier = [{ sequence: previous.body, start: end - previous.body.width,
			end, cursor: previous.body.cursor() }];
	}

	/** The caller proves lexical provenance through oldReadLimit, in old coordinates. */
	public take(oldOffset: number, oldReadLimit: number, context: number): LuaStatementSequence | undefined {
		while (this.frontier.length > 1) {
			const top = this.frontier[this.frontier.length - 1];
			if (oldOffset >= top.start && oldOffset <= top.end) break;
			this.frontier.pop();
		}
		for (;;) {
			const top = this.frontier[this.frontier.length - 1];
			if (oldOffset < top.start || oldOffset > top.end) return undefined;
			const { sequence, start, cursor } = top;
			cursor.seekOffset(oldOffset - start);
			const part = cursor.part;
			if (part === undefined) return undefined;
			if (sequence.context === context && start + cursor.offset === oldOffset) {
				const run = sequence.reusableParts(cursor.partIndex, oldReadLimit - start);
				if (run.partCount > 0) {
					let intervals = this.used.get(sequence);
					if (intervals === undefined) {
						intervals = [];
						this.used.set(sequence, intervals);
					}
					const last = intervals[intervals.length - 1];
					const to = cursor.partIndex + run.partCount;
					if (last !== undefined && last.to === cursor.partIndex) last.to = to;
					else intervals.push({ from: cursor.partIndex, to });
					return run;
				}
			}
			if (part.statement === null) return undefined;
			let child: SequenceFrontier | undefined;
			const locations = this.previous.locations;
			walkLuaAst(part.statement, node => {
				if (child !== undefined) return false;
				if (node.kind === LuaSyntaxKind.Block) {
					const blockStart = locations.offset(node.span.unit, node.startInclusive);
					const blockEnd = locations.offset(node.span.unit, node.endExclusive);
					if (oldOffset >= blockStart && oldOffset <= blockEnd) {
						child = { sequence: node.body, start: blockStart, end: blockEnd, cursor: node.body.cursor() };
					}
					return false;
				}
				if (oldOffset < locations.offset(node.span.unit, node.span.start)
					|| oldOffset > locations.offset(node.span.unit, node.span.end)) return false;
			});
			if (child === undefined) return undefined;
			this.frontier.push(child);
		}
	}

	/** Retained runs own their complete subtrees; only discarded parts are visited. */
	public retire(visit: (unit: LuaSourceUnit) => void): void {
		visit(this.previous.span.unit);
		this.visitUnits(this.previous.body, visit, true);
	}

	/** A reparsed parent failed: its detached reused children become recovery-owned. */
	public collectUnits(sequence: LuaStatementSequence): LuaSourceUnit[] {
		const units: LuaSourceUnit[] = [];
		this.visitUnits(sequence, unit => units.push(unit), false);
		const locations = this.previous.locations;
		units.sort((left, right) => locations.offset(left, 0) - locations.offset(right, 0));
		return units;
	}

	private visitUnits(sequence: LuaStatementSequence, visit: (unit: LuaSourceUnit) => void, skipUsed: boolean): void {
		const intervals = skipUsed ? this.used.get(sequence) : undefined;
		let intervalIndex = 0;
		const visitBlock = (node: LuaAstNode): void | false => {
			if (node.kind === LuaSyntaxKind.Block) {
				this.visitUnits(node.body, visit, skipUsed);
				return false;
			}
		};
		const cursor = sequence.cursor();
		cursor.seekPart(0);
		while (cursor.part !== undefined) {
			const interval = intervals?.[intervalIndex];
			if (interval !== undefined && cursor.partIndex === interval.from) {
				cursor.seekPart(interval.to);
				intervalIndex++;
				continue;
			}
			const part = cursor.part;
			for (const unit of part.units) visit(unit);
			if (part.statement !== null) walkLuaAst(part.statement, visitBlock);
			cursor.advancePart();
		}
	}
}
