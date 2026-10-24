import { pointerHover, type PointerHoverTarget } from '../../../../input/pointer/hover';
import { clamp } from '../../../../../machine/ts/common/clamp';
import { create_rect_bounds } from '../../../../../machine/ts/common/rect';
import { ScratchBuffer } from '../../../../../machine/ts/common/scratchbuffer';
import type { Scrollbar } from '../../../ui/scrollbar';
import { renderResourcePanel } from '../../../render/resource_panel';
import type { RectBounds } from '../../../../../machine/ts/common/rect';
import { showEditorMessage } from '../../../../common/feedback_state';
import { measureTextRange } from '../../../../editor/common/text/layout';
import {
	CallHierarchyDirection,
	type CallHierarchyModel,
} from '../../../../editor/contrib/call_hierarchy/model';
import { editorViewState } from '../../../../editor/ui/view/state';
import type { EditorFont } from '../../../../editor/ui/view/font';
import type { FontVariant } from '../../../../../machine/ts/render/shared/bmsx_font';
import {
	computeResourcePanelMaxLineWidth,
	findResourcePanelIndexByCallHierarchyNodeId,
	type CallHierarchyPanelItem,
} from './items';
import {
	clampResourcePanelRatio,
	createResourcePanelLayout,
	writeResourcePanelBounds,
	writeResourcePanelLayout,
	type ResourcePanelLayout,
} from './layout';
import {
	clampResourcePanelSelectionIndex,
	collapseSelectedCallHierarchyNode,
	ensureResourcePanelSelectionScroll,
	expandSelectedCallHierarchyNode,
	moveResourcePanelSelectionIndex,
	resourcePanelIndexAtRelativeY,
} from './navigation';
import {
	openSelectedResourcePanelCallHierarchyLocation,
} from './open_actions';
import {
	refreshResourcePanelCallHierarchyState,
} from './refresh';
import type { ResourceIdentity } from '../../../../common/resource';
import type { CartEditor } from '../../../../cart_editor';
import type { RuntimeSourceState } from '../../../../runtime/sources';
import { inputFocus } from '../../../../input/focus';
import { handleResourcePanelKeyboardInput } from './keyboard';
import { ResourceFilesModel, type ResourcePanelFilterMode } from './files_model';
import { WORKBENCH_ICON_SIZE } from '../../../ui/icon';
import { editorChromeState } from '../../../ui/chrome_state';
import { WorkbenchTreeNavigationResult, type WorkbenchTreeNavigation } from '../../../ui/tree_view';

export type ResourcePanelItemMetrics = {
	fontVariant: FontVariant | null;
	line: string;
	contentStartColumn: number;
	indentText: string;
	contentText: string;
	indentWidth: number;
	contentWidth: number;
	markerStartWidth: number;
	markerEndWidth: number;
};

export type ResourcePanelScrollbars = {
	resourceVertical: Scrollbar;
	resourceHorizontal: Scrollbar;
};

function createResourcePanelItemMetrics(): ResourcePanelItemMetrics {
	return {
		fontVariant: null,
		line: null,
		contentStartColumn: -1,
		indentText: '',
		contentText: '',
		indentWidth: 0,
		contentWidth: 0,
		markerStartWidth: 0,
		markerEndWidth: 0,
	};
}

export class ResourcePanelController implements PointerHoverTarget {
	public onPointerLeave(): void { this.hoverIndex = -1; }
	private static readonly EMPTY_ITEMS: CallHierarchyPanelItem[] = [];
	public visible = false;
	public readonly focusTarget = inputFocus.createTarget();
	private widthRatio: number;
	private filterMode: ResourcePanelFilterMode = 'lua_only';
	private mode: 'resources' | 'command' = 'resources';
	private fontLineHeight: number;
	public get lineHeight(): number { return this.mode === 'resources' ? Math.max(this.fontLineHeight, WORKBENCH_ICON_SIZE) + 2 : this.fontLineHeight; }
	private fontVariant: FontVariant | null = null;

	public readonly files = new ResourceFilesModel();
	private callHierarchyItems: CallHierarchyPanelItem[] = ResourcePanelController.EMPTY_ITEMS;
	private callScroll = 0;
	private callHScroll = 0;
	private callSelection = -1;
	private callHover = -1;
	private callMaxWidth = 0;
	private filesMaxWidth = 0;
	private filesWidthRevision = -1;
	private filesWidthFont: FontVariant | null = null;
	public get itemCount(): number { return this.mode === 'resources' ? this.files.tree.rows.length : this.callHierarchyItems.length; }
	public get scroll(): number { return this.mode === 'resources' ? this.files.tree.scroll : this.callScroll; }
	public set scroll(value: number) { if (this.mode === 'resources') this.files.tree.scroll = value; else this.callScroll = value; }
	public get hscroll(): number { return this.mode === 'resources' ? this.files.horizontalScroll : this.callHScroll; }
	public set hscroll(value: number) { if (this.mode === 'resources') this.files.horizontalScroll = value; else this.callHScroll = value; }
	public get selectionIndex(): number { return this.mode === 'resources' ? this.files.tree.selectionIndex : this.callSelection; }
	public set selectionIndex(value: number) { if (this.mode === 'resources') this.files.tree.selectionIndex = value; else this.callSelection = value; }
	public get hoverIndex(): number { return this.mode === 'resources' ? this.files.tree.hoverIndex : this.callHover; }
	public set hoverIndex(value: number) { if (this.mode === 'resources') this.files.tree.hoverIndex = value; else this.callHover = value; }
	public get maxLineWidth(): number { return this.mode === 'resources' ? this.filesMaxWidth : this.callMaxWidth; }
	private callHierarchyModel: CallHierarchyModel = null;
	private callHierarchyDirection = CallHierarchyDirection.CallsTo;
	private pendingSelectionIdentity: ResourceIdentity = null;
	private selectionRevealRevision = -1;
	private readonly callHierarchyExpandedNodeIds = new Set<string>();
	private readonly bounds: RectBounds = create_rect_bounds();
	public readonly layout: ResourcePanelLayout = createResourcePanelLayout(this.bounds);
	private readonly filesMetrics = new ScratchBuffer<ResourcePanelItemMetrics>(createResourcePanelItemMetrics);
	private readonly callMetrics = new ScratchBuffer<ResourcePanelItemMetrics>(createResourcePanelItemMetrics);
	public readonly resourceVertical: Scrollbar;
	public readonly resourceHorizontal: Scrollbar;

	constructor(
		private readonly editor: CartEditor,
		private readonly sources: RuntimeSourceState,
		scrollbars: ResourcePanelScrollbars,
		initialWidthRatio: number,
	) {
		this.fontLineHeight = editorViewState.lineHeight;
		this.widthRatio = initialWidthRatio;
		this.resourceVertical = scrollbars.resourceVertical;
		this.resourceHorizontal = scrollbars.resourceHorizontal;
		this.focusTarget.bindKeyboard(input => handleResourcePanelKeyboardInput(input, this));
	}

	public setFontMetrics(font: EditorFont): void {
		if (this.fontVariant === font.variant) return;
		pointerHover.release(this);
		this.fontVariant = font.variant;
		this.fontLineHeight = font.lineHeight;
		if (this.mode === 'resources') this.updateFilesMetrics();
		else this.callMaxWidth = computeResourcePanelMaxLineWidth(this.callHierarchyItems);
	}

	// === Panel lifecycle ===
	isVisible(): boolean { return this.visible; }
	isFocused(): boolean { return this.focusTarget.hasFocus; }
	setFocused(focused: boolean): void {
		if (focused) {
			this.focusTarget.focus();
		} else if (this.focusTarget.hasFocus) {
			const activePane = this.editor.editorPanes.activePane;
			if (activePane === null) this.focusTarget.release();
			else activePane.focus();
		}
	}
	getFilterMode(): 'lua_only' | 'all' { return this.filterMode; }
	getMode(): 'resources' | 'command' { return this.mode; }

	togglePanel(): void { this.visible ? this.hide() : this.show(); }

	show(): void {
		const desiredRatio = this.widthRatio;
		const clamped = clampResourcePanelRatio(desiredRatio);
		if (!writeResourcePanelBounds(this.bounds, clamped)) {
			showEditorMessage('Viewport too small for resource panel.', 'warning', 3.0);
			return;
		}
		pointerHover.release(this);
		this.files.tree.hoverIndex = -1;
		this.widthRatio = clamped;
		this.mode = 'resources';
		this.visible = true;
		this.focusTarget.focus();
		this.refresh();
	}

	showCallHierarchy(model: CallHierarchyModel): void {
		const desiredRatio = this.widthRatio;
		const clamped = clampResourcePanelRatio(desiredRatio);
		if (!writeResourcePanelBounds(this.bounds, clamped)) {
			showEditorMessage('Viewport too small for call hierarchy panel.', 'warning', 3.0);
			return;
		}
		pointerHover.release(this);
		this.widthRatio = clamped;
		this.mode = 'command';
		this.visible = true;
		this.focusTarget.focus();
		this.callHierarchyModel = model;
		this.callHierarchyDirection = CallHierarchyDirection.CallsTo;
		this.callScroll = this.callHScroll = 0;
		this.callSelection = this.callHover = -1;
		this.callHierarchyExpandedNodeIds.clear();
		if (model.roots.length === 1) {
			const root = model.roots[0];
			this.callHierarchyExpandedNodeIds.add(root.id);
		}
		this.refreshCallHierarchyContents();
	}

	toggleCallHierarchyDirection(): void {
		this.callHierarchyDirection = this.callHierarchyDirection === CallHierarchyDirection.CallsTo
			? CallHierarchyDirection.CallsFrom
			: CallHierarchyDirection.CallsTo;
		this.callHierarchyExpandedNodeIds.clear();
		if (this.callHierarchyModel.roots.length === 1) {
			this.callHierarchyExpandedNodeIds.add(this.callHierarchyModel.roots[0].id);
		}
		this.scroll = 0;
		this.hscroll = 0;
		this.refreshCallHierarchyContents();
		showEditorMessage(
			this.callHierarchyDirection === CallHierarchyDirection.CallsTo ? 'Incoming calls' : 'Outgoing calls',
			'info',
			1.8,
		);
	}

	hide(): void {
		pointerHover.release(this);
		this.visible = false;
		editorChromeState.resourcePanelResizing = false;
		this.setFocused(false);
		this.resetCallHierarchyState();
		this.mode = 'resources';
		this.callHierarchyModel = null;
		this.callHierarchyExpandedNodeIds.clear();
		this.publishCodeAreaLeft();
	}

	toggleFilterMode(): void {
		if (this.mode !== 'resources') {
			showEditorMessage('Filter is unavailable in call hierarchy view.', 'warning', 2.4);
			return;
		}
		this.filterMode = this.filterMode === 'lua_only' ? 'all' : 'lua_only';
		if (this.visible) this.refresh();
		const modeLabel = this.filterMode === 'lua_only' ? 'Lua resources' : 'all resources';
		showEditorMessage(`Files panel: showing ${modeLabel}`, 'info', 2.5);
	}

	// === Rendering ===
	draw(): void {
		if (!this.visible) return;
		renderResourcePanel(this);
	}

	// === Public helpers used by editor pointer logic ===
	indexAtPosition(x: number, y: number): number {
		const layout = this.prepareLayout();
		if (!layout) {
			return -1;
		}
		if (x < layout.contentLeft || x >= layout.contentRight || y < layout.contentTop || y >= layout.effectiveBottom) return -1;
		return resourcePanelIndexAtRelativeY(this.scroll, y - layout.contentTop, this.lineHeight, this.itemCount);
	}

	setSelectionIndex(index: number): void {
		const next = clampResourcePanelSelectionIndex(index, this.itemCount);
		if (next === this.selectionIndex) return;
		this.selectionIndex = next;
		this.hoverIndex = -1;
		this.ensureSelectionVisible();
	}

	isCallHierarchyMarkerHit(index: number, viewportX: number): boolean {
		const item = this.callHierarchyItems[index];
		if (!item || !item.callHierarchyExpandable) {
			return false;
		}
		const layout = this.prepareLayout();
		if (!layout) {
			return false;
		}
		const metrics = this.getItemMetrics(index);
		const markerLeft = layout.contentLeft - this.hscroll + metrics.markerStartWidth;
		const markerRight = layout.contentLeft - this.hscroll + metrics.markerEndWidth;
		return viewportX >= markerLeft && viewportX < markerRight;
	}

	setScroll(scroll: number): void {
		const layout = this.prepareLayout();
		this.scroll = clamp(scroll, 0, layout ? layout.maxVerticalScroll : 0);
	}

	setHScroll(scroll: number): void {
		const layout = this.prepareLayout();
		this.hscroll = clamp(scroll, 0, layout ? layout.maxHorizontalScroll : 0);
	}

	scrollBy(amount: number): void {
		const layout = this.prepareLayout();
		this.scroll = clamp(this.scroll + amount, 0, layout ? layout.maxVerticalScroll : 0);
		this.clampHScroll();
	}

	openSelected(): void {
		if (this.mode === 'command') {
			this.activateSelectedCallHierarchy();
			return;
		}
		const selected = this.files.selectedNode;
		if (selected === null) return;
		if (selected.element.kind === 'file') void this.editor.navigation.openResource(selected.element.resource);
		else if (this.files.toggle(this.selectionIndex)) { this.updateFilesMetrics(); this.ensureSelectionVisible(); }
	}

	openSelectedCallHierarchyLocation(): void {
		if (this.mode !== 'command') {
			return;
		}
		openSelectedResourcePanelCallHierarchyLocation(
			this.editor,
			this.callHierarchyItems,
			this.selectionIndex,
		);
	}

	setRatioFromViewportX(viewportX: number, viewportWidth: number): boolean {
		const requestedRatio = viewportX / viewportWidth;
		const clampedRatio = clampResourcePanelRatio(requestedRatio);
		if (!writeResourcePanelBounds(this.bounds, clampedRatio)) {
			this.hide();
			return false;
		}
		this.widthRatio = clampedRatio;
		this.visible = true;
		this.focusTarget.focus();
		this.publishCodeAreaLeft();
		this.clampHScroll();
		this.setScroll(this.scroll);
		return true;
	}

	// === Internals ===
	private resetCallHierarchyState(): void {
		this.callHierarchyItems = ResourcePanelController.EMPTY_ITEMS;
		this.callScroll = this.callHScroll = this.callMaxWidth = 0;
		this.callSelection = this.callHover = -1;
	}

	/** Publish the active view and its layout; Call Hierarchy changes only on explicit tree commands. */
	public refresh(): void {
		if (!this.visible) return;
		let reveal = false;
		if (this.mode === 'resources') {
			const changed = this.files.sync(this.sources, this.filterMode);
			if (this.pendingSelectionIdentity !== null && this.selectionRevealRevision !== this.files.revision) {
				this.selectionRevealRevision = this.files.revision;
				reveal = this.files.reveal(this.pendingSelectionIdentity);
				if (reveal) this.pendingSelectionIdentity = null;
			}
			this.updateFilesMetrics();
			if (changed || reveal) pointerHover.release(this);
		}
		if (this.prepareLayout() === null) this.hide();
		else if (reveal) this.ensureSelectionVisible();
	}

	public navigateFiles(command: WorkbenchTreeNavigation): void {
		this.prepareLayout();
		const result = this.files.navigate(command);
		if (result === WorkbenchTreeNavigationResult.Collapse) this.updateFilesMetrics();
		if (result !== WorkbenchTreeNavigationResult.None) this.ensureSelectionVisible();
	}

	private updateFilesMetrics(): void {
		if (this.filesWidthRevision === this.files.revision && this.filesWidthFont === this.fontVariant) return;
		this.filesWidthRevision = this.files.revision; this.filesWidthFont = this.fontVariant;
		let maximum = 0;
		for (let index = 0; index < this.files.tree.rows.length; index++) {
			const metrics = this.getItemMetrics(index);
			const width = metrics.indentWidth + metrics.contentWidth;
			if (width > maximum) maximum = width;
		}
		this.filesMaxWidth = maximum;
	}

	private refreshCallHierarchyContents(): void {
		const bounds = this.getBounds();
		if (!bounds) {
			return;
		}
		this.hoverIndex = -1;
		const previousNodeId = this.selectionIndex >= 0 && this.selectionIndex < this.itemCount
			? this.callHierarchyItems[this.selectionIndex].callHierarchyNodeId
			: null;
		this.applyRefreshResult(refreshResourcePanelCallHierarchyState({
			model: this.callHierarchyModel,
			direction: this.callHierarchyDirection,
			expandedNodeIds: this.callHierarchyExpandedNodeIds,
			bounds,
			lineHeight: this.lineHeight,
			previousNodeId,
			previousScroll: this.scroll,
		}));
	}

	queuePendingSelection(identity: ResourceIdentity): void {
		this.pendingSelectionIdentity = identity;
		this.selectionRevealRevision = -1;
	}

	applyPendingSelection(): void {
		if (!this.visible || this.mode !== 'resources' || this.pendingSelectionIdentity === null) return;
		this.selectionRevealRevision = this.files.revision;
		if (!this.files.reveal(this.pendingSelectionIdentity)) return;
		this.pendingSelectionIdentity = null;
		this.updateFilesMetrics(); this.ensureSelectionVisible();
	}

	public moveSelectionBy(delta: number): void {
		const next = moveResourcePanelSelectionIndex(this.selectionIndex, this.itemCount, delta);
		if (next === this.selectionIndex) return;
		this.selectionIndex = next;
		this.hoverIndex = -1;
		this.ensureSelectionVisible();
	}
	public ensureSelectionVisible(): void {
		const layout = this.prepareLayout();
		const capacity = layout ? layout.capacity : 1;
		this.scroll = ensureResourcePanelSelectionScroll(this.selectionIndex, this.scroll, capacity, this.itemCount);
		this.clampHScroll();
	}

	public lineCapacity(): number {
		const layout = this.prepareLayout();
		return layout ? layout.capacity : 1;
	}

	public getBounds(): RectBounds {
		if (!this.visible) {
			this.publishCodeAreaLeft();
			return null;
		}
		if (!writeResourcePanelBounds(this.bounds, this.widthRatio)) {
			editorViewState.codeAreaLeft = 0;
			return null;
		}
		this.publishCodeAreaLeft();
		return this.bounds;
	}

	public prepareLayout(): ResourcePanelLayout {
		const bounds = this.getBounds();
		if (!bounds) return null;
		const layout = writeResourcePanelLayout(this.layout, this.itemCount, this.maxLineWidth, this.lineHeight);
		this.resourceVertical.layout(layout.verticalTrack, this.itemCount, layout.capacity, this.scroll);
		this.scroll = this.resourceVertical.getScroll();
		this.resourceHorizontal.layout(layout.horizontalTrack, Math.max(this.maxLineWidth, layout.availableWidth), layout.availableWidth, this.hscroll);
		this.hscroll = this.resourceHorizontal.getScroll();
		if (this.mode === 'resources') {
			const tree = this.files.tree.layout;
			tree.contentLeft = layout.contentLeft; tree.contentTop = layout.contentTop;
			tree.contentRight = layout.contentRight; tree.contentBottom = layout.effectiveBottom;
			tree.rowHeight = this.lineHeight; tree.visibleRowCount = layout.capacity;
			tree.indentWidth = tree.twistieWidth = editorViewState.spaceAdvance * 2;
		}
		return layout;
	}

	public getItemMetrics(index: number): ResourcePanelItemMetrics {
		const item = this.mode === 'resources' ? this.files.tree.rows[index].element : this.callHierarchyItems[index];
		const metrics = (this.mode === 'resources' ? this.filesMetrics : this.callMetrics).get(index);
		if (
			metrics.line === item.line
			&& metrics.contentStartColumn === item.contentStartColumn
		) {
			if (metrics.fontVariant === this.fontVariant) return metrics;
		} else {
			metrics.line = item.line;
			metrics.contentStartColumn = item.contentStartColumn;
			metrics.indentText = this.mode === 'resources' ? '' : item.line.slice(0, item.contentStartColumn);
			metrics.contentText = this.mode === 'resources' ? this.files.tree.rows[index].element.label : item.line.slice(item.contentStartColumn);
		}
		const line = item.line;
		const contentStartColumn = item.contentStartColumn;
		const markerStartColumn = this.mode === 'command' && this.callHierarchyItems[index].callHierarchyExpandable ? contentStartColumn - 2 : contentStartColumn;
		metrics.fontVariant = this.fontVariant;
		metrics.indentWidth = this.mode === 'resources' ? contentStartColumn * editorViewState.spaceAdvance : measureTextRange(line, 0, contentStartColumn);
		metrics.contentWidth = measureTextRange(metrics.contentText, 0, metrics.contentText.length);
		metrics.markerStartWidth = this.mode === 'resources' ? metrics.indentWidth - editorViewState.spaceAdvance * 2 : measureTextRange(line, 0, markerStartColumn);
		metrics.markerEndWidth = metrics.indentWidth;
		return metrics;
	}

	public computeMaxHScroll(): number {
		const layout = this.prepareLayout();
		return layout ? layout.maxHorizontalScroll : 0;
	}

	public clampHScroll(): void {
		const maxScroll = this.computeMaxHScroll();
		const current = this.hscroll;
		this.hscroll = clamp(current, 0, maxScroll);
	}

	public expandSelectedCallHierarchyNode(): void {
		const expandedNodeId = expandSelectedCallHierarchyNode(
			this.callHierarchyItems,
			this.selectionIndex,
			this.callHierarchyExpandedNodeIds,
		);
		if (!expandedNodeId) return;
		this.refreshCallHierarchyContents();
		this.restoreCallHierarchySelection(expandedNodeId);
	}

	public collapseSelectedCallHierarchyNode(): void {
		const collapsedNodeId = collapseSelectedCallHierarchyNode(
			this.callHierarchyItems,
			this.selectionIndex,
			this.callHierarchyExpandedNodeIds,
		);
		if (!collapsedNodeId) return;
		this.refreshCallHierarchyContents();
		this.restoreCallHierarchySelection(collapsedNodeId);
	}

	private activateSelectedCallHierarchy(): void {
		const selected = this.callHierarchyItems[this.selectionIndex];
		if (!selected?.callHierarchyExpandable) {
			openSelectedResourcePanelCallHierarchyLocation(
				this.editor,
				this.callHierarchyItems,
				this.selectionIndex,
			);
			return;
		}
		const nodeId = selected.callHierarchyNodeId;
		if (this.callHierarchyExpandedNodeIds.has(nodeId)) {
			this.callHierarchyExpandedNodeIds.delete(nodeId);
		} else {
			this.callHierarchyExpandedNodeIds.add(nodeId);
		}
		this.refreshCallHierarchyContents();
		this.restoreCallHierarchySelection(nodeId);
	}

	private restoreCallHierarchySelection(nodeId: string): void {
		const index = findResourcePanelIndexByCallHierarchyNodeId(this.callHierarchyItems, nodeId);
		if (index >= 0) this.selectionIndex = index;
	}

	private applyRefreshResult(refreshed: {
		items: CallHierarchyPanelItem[];
		maxLineWidth: number;
		selectionIndex: number;
		scroll: number;
	}): void {
		this.callHierarchyItems = refreshed.items;
		this.callMetrics.clear();
		this.callMaxWidth = refreshed.maxLineWidth;
		this.selectionIndex = refreshed.selectionIndex;
		this.scroll = refreshed.scroll;
		this.clampHScroll();
	}

	private publishCodeAreaLeft(): void {
		editorViewState.codeAreaLeft = this.visible
			? Math.max(0, this.bounds.right - this.bounds.left)
			: 0;
	}
}
