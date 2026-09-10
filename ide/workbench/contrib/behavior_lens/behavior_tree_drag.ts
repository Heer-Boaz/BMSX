import { create_rect_bounds, write_rect_bounds } from '../../../../machine/ts/common/rect';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { WorkbenchGraphDragFeedback, WorkbenchGraphDragSession } from '../../ui/graph/drag';
import type { WorkbenchGraphViewport } from '../../ui/graph/viewport';
import { moveBehaviorTreeChild } from './behavior_tree_edit';
import type { BehaviorTreeSourceMember } from './behavior_tree_model';
import type { BehaviorGraphModel, BehaviorGraphNode } from './graph_model';
import type { BehaviorLensViewState } from './view_model';

/** Freeze the proven source occurrence only when a physical press becomes a drag. */
export function beginBehaviorTreeDrag(model: EditorTextModel, view: BehaviorLensViewState): WorkbenchGraphDragSession | undefined {
	if (model.readOnly || model.version !== view.sourceVersion || !view.document.syntaxComplete || view.presentation.kind !== 'graph') return undefined;
	const viewport = view.presentation.viewport;
	const selected = viewport.selection;
	if (selected === null) return undefined;
	const node = selected.kind === 'node' ? selected : selected.child;
	if (node.member === null || node.member.branch.entries.length < 2) return undefined;
	return new BehaviorTreeDrag(model, viewport, node, node.member);
}

/** Same-list insertion, not a layout edit or inferred reparent/reconnect operation. */
class BehaviorTreeDrag implements WorkbenchGraphDragSession {
	public readonly feedback: WorkbenchGraphDragFeedback;
	private readonly sourceVersion: number;
	private destination = -1;

	public constructor(private readonly model: EditorTextModel, private readonly viewport: WorkbenchGraphViewport<BehaviorGraphModel>,
		private readonly node: BehaviorGraphNode, private readonly member: BehaviorTreeSourceMember) {
		this.sourceVersion = model.version;
		this.feedback = { source: node, marker: create_rect_bounds(), offsetX: 0, offsetY: 0, accepted: false };
	}

	public isCurrent(): boolean {
		return !this.model.readOnly && this.model.version === this.sourceVersion;
	}

	public dragOver(viewportX: number, viewportY: number): void {
		this.feedback.accepted = false;
		const target = this.viewport.hitTest(viewportX, viewportY);
		// Cards expose left/right insertion sectors; routes are drag sources, not guessed drop ports.
		if (target === null || target.kind !== 'node' || target.parent !== this.node.parent || target.member === null
			|| target.member.table !== this.member.table) return;
		const x = viewportX - this.viewport.bounds.left + this.viewport.scrollX;
		const before = x < (target.bounds.left + target.bounds.right) / 2;
		const insertion = target.member.index + (before ? 0 : 1);
		const destination = insertion > this.member.index ? insertion - 1 : insertion;
		if (destination === this.member.index) return;
		this.destination = destination;
		const markerX = before ? target.bounds.left - 3 : target.bounds.right + 2;
		write_rect_bounds(this.feedback.marker, markerX, target.bounds.top - 2, markerX + 2, target.bounds.top + target.headerHeight + 2);
		this.feedback.accepted = true;
	}

	public drop(): void {
		moveBehaviorTreeChild(this.model, this.member, this.destination);
	}
}
