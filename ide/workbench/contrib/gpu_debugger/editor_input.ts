import { create_rect_bounds } from '../../../../machine/ts/common/rect';
import { GpuOperationSnapshot, type RuntimeGpuHistory } from '../../../runtime/gpu_history';
import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import type { EditorPanes } from '../../services/editor/editor_panes';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import { WorkbenchWindowModel } from '../../ui/window/model';
import { editorTabGroup } from '../../ui/tab/group_model';
import { openEditorTab } from '../../ui/tabs';
import { GpuOperationProjection, type GpuDebugView } from './presentation';

/** Retained optional GPU observation, independent of the reusable pane's attachment. */
export class GpuDebuggerInput extends ReadonlyEditorInput<'gpu-debugger', 'gpu_debugger'> {
	public override readonly serializable = false;
	public get resource(): undefined { return undefined; }
	public readonly actions = createWorkbenchActionBar('gpu.title');
	public readonly projection = new GpuOperationProjection();
	public readonly selected = new GpuOperationSnapshot();
	public readonly list = new WorkbenchScrollViewport();
	public readonly words = new WorkbenchScrollViewport();
	public readonly visualBounds = create_rect_bounds();
	public readonly detailsWindow = new WorkbenchWindowModel(create_rect_bounds(), 0, 0);
	public readonly detailsActions = createWorkbenchActionBar('window.title');
	public detailsPlacementInitialized = false;
	public detailsScroll = 0;
	public detailsRow = 0;
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null };
	public following = true;
	public running = false;
	public filter = '';
	public view: GpuDebugView = 'geometry';
	public selectedPoint = 0;
	public selectedWord = 0;
	public selectionRevision = 0;
	private generation = -1;
	public constructor(public readonly history: RuntimeGpuHistory) {
		super('gpu-debugger', 'gpu_debugger', 'GPU OPERATIONS', true);
		this.disposables.add(history.observe());
	}
	public select(sequence: number): void { this.following = false; this.copySelection(sequence); }
	private copySelection(sequence: number): void {
		if (this.selected.sequence === sequence) return;
		this.history.copy(sequence, this.selected); this.resetPosition();
	}
	private resetPosition(): void {
		this.selectedPoint = 0; this.selectedWord = 0;
		this.detailsScroll = 0; this.detailsRow = 0;
		this.words.scrollbar.setScroll(0); this.selectionRevision++;
	}
	public clear(): void { this.history.clear(); this.following = true; this.clearSelection(); }
	private clearSelection(): void { this.selected.sequence = -1; this.selected.wordCount = 0; this.resetPosition(); }
	public update(): boolean {
		if (this.generation !== this.history.generation) {
			this.generation = this.history.generation;
			if (this.following) this.clearSelection();
		}
		const changed = this.projection.update(this.history, this.filter);
		const rows = this.projection.rows;
		if (this.following) {
			if (rows.length > 0) this.copySelection(rows[rows.length - 1]);
			else if (this.selected.sequence >= 0) this.clearSelection();
		}
		return changed;
	}
}

export function openGpuDebugger(panes: EditorPanes, history: RuntimeGpuHistory): void {
	const existing = editorTabGroup.findById('gpu-debugger');
	openEditorTab(panes, existing ?? new GpuDebuggerInput(history), { pinned: true });
}
