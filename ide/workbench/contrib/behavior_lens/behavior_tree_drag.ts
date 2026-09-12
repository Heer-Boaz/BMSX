import { create_rect_bounds, write_rect_bounds } from '../../../../machine/ts/common/rect';
import type { FileSemanticData } from '../../../../toolchain/ts/lua/semantic/model';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { WorkbenchGraphNodeDragFeedback, WorkbenchGraphDragSession } from '../../ui/graph/drag';
import type { WorkbenchGraphViewport } from '../../ui/graph/viewport';
import { behaviorTreeEditTarget, moveBehaviorTreeChild } from './behavior_tree_edit';
import type { BehaviorTreeSourceList } from './behavior_tree_model';
import { BehaviorTreeTransferAnalysis, type BehaviorTreeTransferCheck } from './behavior_tree_transfer';
import type { BehaviorGraphModel, BehaviorGraphNode } from './graph_model';
import type { BehaviorLensViewState } from './view_model';

export type BehaviorTreeTransferDrop = (analysis: BehaviorTreeTransferAnalysis,
	insertion: number, check: Extract<BehaviorTreeTransferCheck, { kind: 'available' }>) => void;

/** Freeze the proven source occurrence only when a physical press becomes a drag. */
export function beginBehaviorTreeDrag(model: EditorTextModel, view: BehaviorLensViewState,
	file: FileSemanticData, transfer: BehaviorTreeTransferDrop): WorkbenchGraphDragSession | undefined {
	if (model.readOnly || !view.source.isCurrent || !view.document.syntaxComplete || view.presentation.kind !== 'graph') return undefined;
	const viewport = view.presentation.viewport;
	const selected = viewport.selection;
	if (selected === null) return undefined;
	const node = selected.kind === 'node' ? selected : selected.child;
	const member = behaviorTreeEditTarget(view);
	if (member === null) return undefined;
	return new BehaviorTreeDrag(model, view, viewport, node, new BehaviorTreeTransferAnalysis(view.document, file, member), transfer);
}

/** Normalize visual sectors to an authored list and insertion rank before editing. */
class BehaviorTreeDrag implements WorkbenchGraphDragSession {
	public readonly feedback: WorkbenchGraphNodeDragFeedback;
	private readonly source: BehaviorLensViewState['source'];
	private readonly ownedLists = new Map<BehaviorGraphNode, BehaviorTreeSourceList>();
	private insertion = 0;
	private check: Extract<BehaviorTreeTransferCheck, { kind: 'available' }> | undefined;

	public constructor(private readonly model: EditorTextModel, private readonly view: BehaviorLensViewState, private readonly viewport: WorkbenchGraphViewport<BehaviorGraphModel>,
		node: BehaviorGraphNode, private readonly analysis: BehaviorTreeTransferAnalysis, private readonly transfer: BehaviorTreeTransferDrop) {
		this.source = view.source;
		this.feedback = { kind: 'node-insertion', source: node, marker: create_rect_bounds(), placement: 'between', offsetX: 0, offsetY: 0, accepted: false };
		for (const use of analysis.listUses) {
			if (use.branch.role !== 'children' && use.branch.role !== 'choices') continue;
			const card = viewport.model.nodesBySource.get(use.owner.rowKey);
			if (card !== undefined) this.ownedLists.set(card, use.branch);
		}
	}

	public isCurrent(): boolean {
		return !this.model.readOnly && this.source === this.view.source && this.source.isCurrent;
	}

	public dragOver(viewportX: number, viewportY: number): void {
		this.feedback.accepted = false;
		const target = this.viewport.hitTest(viewportX, viewportY);
		// Routes can be drag sources, but they do not invent replacement ports.
		if (target === null || target.kind !== 'node') return;
		const x = this.viewport.viewportToGraphX(viewportX);
		const width = target.bounds.right - target.bounds.left;
		const inside = x > target.bounds.left + width / 3 && x < target.bounds.right - width / 3;
		let branch: BehaviorTreeSourceList;
		let insertion: number;
		if (inside) {
			const owned = this.ownedLists.get(target);
			if (owned === undefined) return;
			branch = owned;
			insertion = branch.entries.length;
		} else {
			const member = target.member;
			if (member === null) return;
			branch = member.branch;
			insertion = member.index + (x < target.bounds.left + width / 2 ? 0 : 1);
		}
		const member = this.analysis.member;
		if (branch.source.kind === 'section' && branch.source.table === member.table) {
			if (branch.role !== member.branch.role) return;
			if ((insertion > member.index ? insertion - 1 : insertion) === member.index) return;
			this.check = undefined;
		} else {
			const check = this.analysis.checkTarget(branch);
			if (check.kind !== 'available') return;
			this.check = check;
		}
		this.insertion = insertion;
		this.feedback.placement = inside ? 'inside' : 'between';
		if (inside) write_rect_bounds(this.feedback.marker, target.bounds.left - 2, target.bounds.top - 2,
			target.bounds.right + 2, target.bounds.top + target.headerHeight + 2);
		else {
			const markerX = x < target.bounds.left + width / 2 ? target.bounds.left - 3 : target.bounds.right + 2;
			write_rect_bounds(this.feedback.marker, markerX, target.bounds.top - 2, markerX + 2, target.bounds.top + target.headerHeight + 2);
		}
		this.feedback.accepted = true;
	}

	public drop(): void {
		const member = this.analysis.member;
		if (this.check === undefined) moveBehaviorTreeChild(this.model, member, this.insertion > member.index ? this.insertion - 1 : this.insertion);
		else this.transfer(this.analysis, this.insertion, this.check);
	}
}
