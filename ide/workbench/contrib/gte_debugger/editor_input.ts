import { create_rect_bounds } from '../../../../machine/ts/common/rect';
import { GteCommandSnapshot, type RuntimeGteHistory } from '../../../runtime/gte_history';
import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import type { EditorPanes } from '../../services/editor/editor_panes';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import { editorTabGroup } from '../../ui/tab/group_model';
import { openEditorTab } from '../../ui/tabs';
import { GteCommandProjection, type GteDebugPlane, type GteDebugView } from './presentation';

/** A retained observation session. Source navigation detaches its pane, not its lease. */
export class GteDebuggerInput extends ReadonlyEditorInput<'gte-debugger', 'gte_debugger'> {
	public override readonly serializable = false;
	public get resource(): undefined { return undefined; }
	public readonly actions = createWorkbenchActionBar('gte.title');
	public readonly list = new WorkbenchScrollViewport();
	public readonly projection = new GteCommandProjection();
	public readonly selected = new GteCommandSnapshot();
	public readonly visualBounds = create_rect_bounds();
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null };
	public following = true;
	public running = false;
	public filter = '';
	public view: GteDebugView = 'auto';
	public plane: GteDebugPlane = 'xy';
	public selectedPoint = 0;
	public selectionRevision = 0;
	private generation = -1;
	public constructor(public readonly history: RuntimeGteHistory) {
		super('gte-debugger', 'gte_debugger', 'GTE', true);
		this.disposables.add(history.observe());
	}
	public select(sequence: number): void {
		this.following = false;
		this.copySelection(sequence);
	}
	private copySelection(sequence: number): void {
		if (sequence === this.selected.sequence) return;
		this.history.copy(sequence, this.selected);
		this.selectedPoint = 0;
		this.selectionRevision++;
	}
	public clear(): void {
		this.history.clear(); this.following = true; this.clearSelection();
	}
	private clearSelection(): void {
		this.selected.sequence = -1; this.selected.image = null; this.selectedPoint = 0; this.selectionRevision++;
	}
	public update(): boolean {
		if (this.generation !== this.history.generation) {
			this.generation = this.history.generation;
			if (this.following) this.clearSelection();
		}
		const changed = this.projection.update(this.history, this.filter);
		if (this.following && this.projection.rows.length > 0) this.copySelection(this.projection.rows[this.projection.rows.length - 1]);
		return changed;
	}
}

export function openGteDebugger(panes: EditorPanes, history: RuntimeGteHistory): void {
	const existing = editorTabGroup.findById('gte-debugger');
	openEditorTab(panes, existing ?? new GteDebuggerInput(history), { pinned: true });
}
