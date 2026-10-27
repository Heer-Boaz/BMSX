import { InputInteraction } from '../../../input/interaction';
import { create_rect_bounds } from '../../../../machine/ts/common/rect';
import { GteCommandSnapshot, type RuntimeGteHistory } from '../../../runtime/gte_history';
import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import type { EditorGroupView } from '../../services/editor/editor_group';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import type { PropertyInspectorViewState } from '../../ui/property_inspector/model';
import { WorkbenchWindowModel } from '../../ui/window/model';
import { GteCommandProjection, type GteDebugPlane, type GteDebugView } from './presentation';
import type { GteDiagramAnchor } from './diagram';
import type { GteDebuggerTabId } from '../../ui/tab/id';

let nextInputId = 0;

/** A retained observation session. Source navigation detaches its pane, not its lease. */
export class GteDebuggerInput extends ReadonlyEditorInput<GteDebuggerTabId, 'gte_debugger'> {
	public override canMove(): boolean { return true; }
	public override readonly serializable = false;
	public get resource(): undefined { return undefined; }
	public readonly actions = createWorkbenchActionBar('gte.title', true, WORKBENCH_MENUS['gte.context']);
	public readonly detailsWindow = new WorkbenchWindowModel(create_rect_bounds(), 0, 0);
	public readonly detailsActions = createWorkbenchActionBar('gte.details.title');
	public detailsPlacementInitialized = false;
	public readonly detailsView: PropertyInspectorViewState = { selectionIndex: 0, selectionVisible: false, anchorIndex: 0, anchorOffset: 0 };
	public readonly list = new WorkbenchScrollViewport();
	public readonly projection = new GteCommandProjection();
	public readonly selected = new GteCommandSnapshot();
	public readonly inspectorActions = createWorkbenchActionBar('gte.inspector.content', true);
	public readonly inspectorBounds = create_rect_bounds();
	public readonly diagram = new WorkbenchScrollViewport();
	public readonly diagramAnchor: GteDiagramAnchor = { section: 'origin', offset: 0, fraction: 0, end: false, projectedScroll: undefined };
	public inspectorPage: 'properties' | 'diagram' = 'properties';
	private readonly selectionListeners = new Set<() => void>();
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null };
	public following = true;
	public readonly interaction = new InputInteraction();
	public filter = '';
	public view: GteDebugView = 'auto';
	public plane: GteDebugPlane = 'xy';
	public selectedPoint = 0;
	public selectionRevision = 0;
	private generation = -1;
	public constructor(public readonly history: RuntimeGteHistory) {
		const sequence = nextInputId++;
		super(`gte-debugger:${sequence}`, 'gte_debugger', 'GTE', true);
		this.setLabel(this.title, `Observation view ${sequence}`, `#${sequence}`);
		this.disposables.add(history.observe());
	}
	public onWillChangeSelection(listener: () => void): () => void {
		this.selectionListeners.add(listener);
		return () => this.selectionListeners.delete(listener);
	}
	public select(sequence: number): void {
		this.following = false;
		this.copySelection(sequence);
	}
	private copySelection(sequence: number): void {
		if (sequence === this.selected.sequence) return;
		for (const listener of this.selectionListeners) listener();
		this.history.copy(sequence, this.selected);
		this.diagram.scrollbar.setScroll(0);
		this.diagramAnchor.section = 'origin'; this.diagramAnchor.offset = 0; this.diagramAnchor.fraction = 0; this.diagramAnchor.end = false; this.diagramAnchor.projectedScroll = undefined;
		this.selectedPoint = 0; this.detailsView.selectionIndex = 0; this.detailsView.selectionVisible = false; this.detailsView.anchorIndex = 0; this.detailsView.anchorOffset = 0;
		this.selectionRevision++;
	}
	public clear(): void {
		this.history.clear(); this.following = true; this.clearSelection();
	}
	private clearSelection(): void {
		if (this.selected.sequence < 0) return;
		for (const listener of this.selectionListeners) listener();
		this.diagram.scrollbar.setScroll(0);
		this.diagramAnchor.section = 'origin'; this.diagramAnchor.offset = 0; this.diagramAnchor.fraction = 0; this.diagramAnchor.end = false; this.diagramAnchor.projectedScroll = undefined;
		this.selected.sequence = -1; this.selected.image = null; this.selectedPoint = 0;
		this.detailsView.selectionIndex = 0; this.detailsView.selectionVisible = false; this.detailsView.anchorIndex = 0; this.detailsView.anchorOffset = 0; this.selectionRevision++;
	}
	public update(): boolean {
		if (this.generation !== this.history.generation) {
			this.generation = this.history.generation;
			if (this.following) this.clearSelection();
		}
		const changed = this.projection.update(this.history, this.filter);
		if (this.following) {
			const rows = this.projection.rows;
			if (rows.length > 0) this.copySelection(rows[rows.length - 1]);
			else if (this.selected.sequence >= 0) this.clearSelection();
		}
		return changed;
	}
}

export function openGteDebugger(group: EditorGroupView, history: RuntimeGteHistory): void {
	const active = group.model.activeTab;
	const existing = active?.kind === 'gte_debugger' && active.history === history ? active
		: group.model.tabs.find(input => input.kind === 'gte_debugger' && input.history === history);
	group.openEditor(existing ?? new GteDebuggerInput(history), { pinned: true });
}
