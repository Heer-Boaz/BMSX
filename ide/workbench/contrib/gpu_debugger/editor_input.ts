import { create_rect_bounds } from '../../../../machine/ts/common/rect';
import { GpuOperationSnapshot, type RuntimeGpuHistory } from '../../../runtime/gpu_history';
import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import type { EditorGroupView } from '../../services/editor/editor_group';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import type { PropertyInspectorViewState } from '../../ui/property_inspector/model';
import { WorkbenchWindowModel } from '../../ui/window/model';
import { GpuOperationProjection, type GpuDebugView } from './presentation';
import type { GpuDiagramViewState } from './diagram';

export type GpuInspectorPage = 'properties' | 'diagram' | 'words';

/** Retained optional GPU observation, independent of the reusable pane's attachment. */
export class GpuDebuggerInput extends ReadonlyEditorInput<'gpu-debugger', 'gpu_debugger'> {
	public override readonly serializable = false;
	public get resource(): undefined { return undefined; }
	public readonly actions = createWorkbenchActionBar('gpu.title', true, WORKBENCH_MENUS['gpu.context']);
	public readonly projection = new GpuOperationProjection();
	public readonly selected = new GpuOperationSnapshot();
	public readonly list = new WorkbenchScrollViewport();
	public readonly words = new WorkbenchScrollViewport();
	public wordsRowHeight = 0;
	public readonly diagram = new WorkbenchScrollViewport();
	public readonly diagramView: GpuDiagramViewState = { section: 0, textOffset: 0, fraction: 0, atEnd: false };
	public readonly inspectorBounds = create_rect_bounds();
	public readonly inspectorActions = createWorkbenchActionBar('gpu.inspector.content', true);
	public inspectorPage: GpuInspectorPage = 'properties';
	public readonly detailsWindow = new WorkbenchWindowModel(create_rect_bounds(), 0, 0);
	public readonly detailsActions = createWorkbenchActionBar('window.title');
	public detailsPlacementInitialized = false;
	public readonly detailsView: PropertyInspectorViewState = { selectionIndex: 0, selectionVisible: false, anchorIndex: 0, anchorOffset: 0 };
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null };
	public following = true;
	public running = false;
	public filter = '';
	public view: GpuDebugView = 'geometry';
	public selectedPoint = 0;
	public selectedWord = 0;
	public selectionRevision = 0;
	private generation = -1;
	private readonly selectionListeners = new Set<() => void>();
	public constructor(public readonly history: RuntimeGpuHistory) {
		super('gpu-debugger', 'gpu_debugger', 'GPU OPERATIONS', true);
		this.disposables.add(history.observe());
	}
	public select(sequence: number): void { this.following = false; this.copySelection(sequence); }
	/** Attached clients retire attempts and save the old document before its owned words change. */
	public onWillChangeSelection(listener: () => void): () => void {
		this.selectionListeners.add(listener); return () => this.selectionListeners.delete(listener);
	}
	private copySelection(sequence: number): void {
		if (this.selected.sequence === sequence) return;
		for (const listener of this.selectionListeners) listener();
		this.history.copy(sequence, this.selected); this.resetPosition();
	}
	private resetPosition(): void {
		this.selectedPoint = 0; this.selectedWord = 0;
		this.detailsView.selectionIndex = 0; this.detailsView.selectionVisible = false; this.detailsView.anchorIndex = 0; this.detailsView.anchorOffset = 0;
		this.words.scrollbar.setScroll(0); this.diagram.scrollbar.setScroll(0);
		this.diagramView.section = 0; this.diagramView.textOffset = 0; this.diagramView.fraction = 0; this.diagramView.atEnd = false;
		this.selectionRevision++;
	}
	public clear(): void { this.history.clear(); this.following = true; this.clearSelection(); }
	private clearSelection(): void {
		if (this.selected.sequence < 0) return;
		for (const listener of this.selectionListeners) listener();
		this.selected.sequence = -1; this.selected.wordCount = 0; this.resetPosition();
	}
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
	public override dispose(): void { this.selectionListeners.clear(); super.dispose(); }
}

export function openGpuDebugger(group: EditorGroupView, history: RuntimeGpuHistory): void {
	const existing = group.model.findById('gpu-debugger');
	group.openEditor(existing ?? new GpuDebuggerInput(history), { pinned: true });
}
