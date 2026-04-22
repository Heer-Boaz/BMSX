import * as constants from '../../../../common/constants';
import { clamp } from '../../../../../common/clamp';
import { create_rect_bounds } from '../../../../../common/rect';
import { ScratchBuffer } from '../../../../../common/scratchbuffer';
import { Scrollbar } from '../../../../editor/ui/scrollbar';
import { renderResourcePanel } from '../../../render/resource_panel';
import type { ResourceBrowserItem } from '../../../../common/models';
import type { RectBounds } from '../../../../../rompack/format';
import { showEditorMessage } from '../../../../common/feedback_state';
import { measureTextRange } from '../../../../editor/common/text/layout';
import type { CallHierarchyView } from '../../../../editor/contrib/call_hierarchy/view';
import { editorViewState } from '../../../../editor/ui/view/state';
import {
	findResourcePanelIndexByAssetId,
	findResourcePanelIndexByCallHierarchyNodeId,
	type ResourcePanelFilterMode,
} from './items';
import {
	clampResourcePanelRatio,
	createResourcePanelLayout,
	writeResourcePanelBounds,
	defaultResourcePanelRatio,
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
	scrollResourcePanelHorizontalOffset,
} from './navigation';
import {
	activateSelectedCallHierarchyItem,
	openSelectedResourcePanelCallHierarchyLocation,
	openSelectedResourcePanelItem,
} from './open_actions';
import {
	refreshResourcePanelCallHierarchyState,
	refreshResourcePanelResourceState,
} from './refresh';
import { handleResourcePanelKeyboardInput } from './keyboard';

export interface ResourcePanelScrollbars {
	resourceVertical: Scrollbar;
	resourceHorizontal: Scrollbar;
}

export type ResourcePanelItemMetrics = {
	item: ResourceBrowserItem;
	line: string;
	contentStartColumn: number;
	indentText: string;
	contentText: string;
	indentWidth: number;
	contentWidth: number;
	markerStartWidth: number;
	markerEndWidth: number;
};

function createResourcePanelItemMetrics(): ResourcePanelItemMetrics {
	return {
		item: null,
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

export class ResourcePanelController {
	private static readonly EMPTY_ITEMS: ResourceBrowserItem[] = [];
	public visible = false;
	public focused = false;
	private widthRatio: number;
	private filterMode: ResourcePanelFilterMode = 'lua_only';
	private mode: 'resources' | 'command' = 'resources';
	public lineHeight: number;
	private charAdvance: number;

	// Browser state
	public items: ResourceBrowserItem[] = ResourcePanelController.EMPTY_ITEMS;
	public scroll = 0;
	public hscroll = 0;
	public selectionIndex = -1;
	public hoverIndex = -1;
	public maxLineWidth = 0;
	private callHierarchyView: CallHierarchyView = null;
	private pendingSelectionAssetId: string = null;
	private readonly callHierarchyExpandedNodeIds = new Set<string>();
	private readonly bounds: RectBounds = create_rect_bounds();
	private readonly layout: ResourcePanelLayout = createResourcePanelLayout(this.bounds);
	private readonly itemMetrics = new ScratchBuffer<ResourcePanelItemMetrics>(createResourcePanelItemMetrics);

	// Scrollbars for the panel
	public readonly resourceVertical: Scrollbar;
	public readonly resourceHorizontal: Scrollbar;

	constructor(scrollbars?: ResourcePanelScrollbars) {
		this.lineHeight = editorViewState.lineHeight;
		this.charAdvance = editorViewState.charAdvance;
		if (scrollbars) {
			this.resourceVertical = scrollbars.resourceVertical;
			this.resourceHorizontal = scrollbars.resourceHorizontal;
		} else {
			this.resourceVertical = new Scrollbar('resourceVertical', 'vertical');
			this.resourceHorizontal = new Scrollbar('resourceHorizontal', 'horizontal');
		}
		this.widthRatio = defaultResourcePanelRatio();
	}

	public setFontMetrics(lineHeight: number, charAdvance: number): void {
		this.lineHeight = lineHeight;
		this.charAdvance = charAdvance;
		this.itemMetrics.clear();
	}

	// === Panel lifecycle ===
	isVisible(): boolean { return this.visible; }
	isFocused(): boolean { return this.focused; }
	setFocused(focused: boolean): void { this.focused = focused; }
	getFilterMode(): 'lua_only' | 'all' { return this.filterMode; }
	getMode(): 'resources' | 'command' { return this.mode; }

	togglePanel(): void { this.visible ? this.hide() : this.show(); }

	show(): void {
		const desiredRatio = this.widthRatio;
		const clamped = clampResourcePanelRatio(desiredRatio);
		if (!writeResourcePanelBounds(this.bounds, clamped)) {
			showEditorMessage('Viewport too small for resource panel.', constants.COLOR_STATUS_WARNING, 3.0);
			return;
		}
		this.widthRatio = clamped;
		this.mode = 'resources';
		this.visible = true;
		this.focused = true;
		this.refreshContents();
	}

	showCallHierarchy(view: CallHierarchyView): void {
		const desiredRatio = this.widthRatio;
		const clamped = clampResourcePanelRatio(desiredRatio);
		if (!writeResourcePanelBounds(this.bounds, clamped)) {
			showEditorMessage('Viewport too small for call hierarchy panel.', constants.COLOR_STATUS_WARNING, 3.0);
			return;
		}
		this.widthRatio = clamped;
		this.mode = 'command';
		this.visible = true;
		this.focused = true;
		this.callHierarchyView = view;
		this.callHierarchyExpandedNodeIds.clear();
		this.callHierarchyExpandedNodeIds.add(view.root.id);
		this.refreshContents();
	}

	hide(): void {
		this.visible = false;
		this.focused = false;
		this.resetState();
		this.mode = 'resources';
		this.callHierarchyView = null;
		this.callHierarchyExpandedNodeIds.clear();
	}

	toggleFilterMode(): void {
		if (this.mode !== 'resources') {
			showEditorMessage('Filter is unavailable in call hierarchy view.', constants.COLOR_STATUS_WARNING, 2.4);
			return;
		}
		this.filterMode = this.filterMode === 'lua_only' ? 'all' : 'lua_only';
		if (this.visible) this.refreshContents();
		const modeLabel = this.filterMode === 'lua_only' ? 'Lua resources' : 'all resources';
		showEditorMessage(`Files panel: showing ${modeLabel}`, constants.COLOR_STATUS_TEXT, 2.5);
	}

	// === Rendering ===
	draw(): void {
		if (!this.visible) return;
		renderResourcePanel(this);
	}

	// === Keyboard ===
	handleKeyboard(): void {
		handleResourcePanelKeyboardInput(this);
	}

	// === Public helpers used by editor pointer logic ===
	indexAtPosition(_x: number, y: number): number {
		const layout = this.prepareLayout();
		if (!layout) {
			return -1;
		}
		const relativeY = y - layout.contentTop;
		if (relativeY < 0) return -1;
		return resourcePanelIndexAtRelativeY(this.scroll, relativeY, this.lineHeight, this.items.length);
	}

	setSelectionIndex(index: number): void {
		const next = clampResourcePanelSelectionIndex(index, this.items.length);
		if (next === this.selectionIndex) return;
		this.selectionIndex = next;
		this.hoverIndex = -1;
		this.ensureSelectionVisible();
	}

	setHoverIndex(index: number): void {
		this.hoverIndex = index;
	}

	isCallHierarchyMarkerHit(index: number, viewportX: number): boolean {
		const item = this.items[index];
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
		this.scroll = clamp(scroll | 0, 0, layout ? layout.maxVerticalScroll : 0);
	}

	setHScroll(scroll: number): void {
		const layout = this.prepareLayout();
		this.hscroll = clamp(scroll | 0, 0, layout ? layout.maxHorizontalScroll : 0);
	}

	scrollBy(amount: number): void {
		const layout = this.prepareLayout();
		this.scroll = clamp(this.scroll + (amount | 0), 0, layout ? layout.maxVerticalScroll : 0);
		this.ensureSelectionVisible();
		this.clampHScroll();
	}

	openSelected(): void {
		if (this.mode === 'command') {
			this.activateSelectedCallHierarchy();
			return;
		}
		openSelectedResourcePanelItem(this.items, this.selectionIndex);
	}

	openSelectedCallHierarchyLocation(): void {
		if (this.mode !== 'command') {
			return;
		}
		openSelectedResourcePanelCallHierarchyLocation(this.items, this.selectionIndex);
	}

	getHorizontalScrollStep(): number {
		return this.charAdvance * 4;
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
		this.focused = true;
		this.clampHScroll();
		this.ensureSelectionVisible();
		return true;
	}

	// === Internals ===
	private resetState(): void {
		this.items = ResourcePanelController.EMPTY_ITEMS;
		this.scroll = 0;
		this.selectionIndex = -1;
		this.hoverIndex = -1;
		this.hscroll = 0;
		this.maxLineWidth = 0;
		this.pendingSelectionAssetId = null;
	}

	private refreshContents(): void {
		const bounds = this.getBounds();
		if (!bounds) {
			return;
		}
		this.hoverIndex = -1;
		if (this.mode === 'command') {
			const previousNodeId = this.selectionIndex >= 0 && this.selectionIndex < this.items.length
				? this.items[this.selectionIndex].callHierarchyNodeId
				: null;
			this.applyRefreshResult(refreshResourcePanelCallHierarchyState({
				view: this.callHierarchyView,
				expandedNodeIds: this.callHierarchyExpandedNodeIds,
				bounds,
				lineHeight: this.lineHeight,
				previousNodeId,
				previousScroll: this.scroll,
			}));
			return;
		}
		const previousDescriptor = this.pendingSelectionAssetId
			? null
			: (this.selectionIndex >= 0 && this.selectionIndex < this.items.length)
				? this.items[this.selectionIndex].descriptor
				: null;
		this.applyRefreshResult(refreshResourcePanelResourceState({
			filterMode: this.filterMode,
			bounds,
			lineHeight: this.lineHeight,
			previousDescriptor,
			targetAssetId: this.pendingSelectionAssetId,
			previousIndex: this.selectionIndex,
			previousScroll: this.scroll,
		}));
		this.pendingSelectionAssetId = null;
	}

	queuePendingSelection(assetId: string): void {
		this.pendingSelectionAssetId = assetId;
	}

	applyPendingSelection(): void {
		if (!this.visible || !this.pendingSelectionAssetId) {
			return;
		}
		const index = findResourcePanelIndexByAssetId(this.items, this.pendingSelectionAssetId);
		if (index === -1) {
			return;
		}
		this.selectionIndex = index;
		this.ensureSelectionVisible();
		this.pendingSelectionAssetId = null;
	}

	public moveSelectionBy(delta: number): void {
		const next = moveResourcePanelSelectionIndex(this.selectionIndex, this.items.length, delta);
		if (next === this.selectionIndex) return;
		this.selectionIndex = next;
		this.hoverIndex = -1;
		this.ensureSelectionVisible();
	}

	public scrollHorizontalBy(amount: number): void {
		const maxScroll = this.computeMaxHScroll();
		const next = scrollResourcePanelHorizontalOffset(this.hscroll, amount, maxScroll);
		if (next === this.hscroll) return;
		this.hscroll = next;
		this.clampHScroll();
	}

	public ensureSelectionVisible(): void {
		const layout = this.prepareLayout();
		const capacity = layout ? layout.capacity : 1;
		this.scroll = ensureResourcePanelSelectionScroll(this.selectionIndex, this.scroll, capacity, this.items.length);
		this.clampHScroll();
	}

	public lineCapacity(): number {
		const layout = this.prepareLayout();
		return layout ? layout.capacity : 1;
	}

	public getBounds(): RectBounds {
		if (!this.visible) {
			return null;
		}
		return writeResourcePanelBounds(this.bounds, this.widthRatio) ? this.bounds : null;
	}

	public prepareLayout(): ResourcePanelLayout {
		const bounds = this.getBounds();
		if (!bounds) {
			return null;
		}
		return writeResourcePanelLayout(this.layout, this.items.length, this.maxLineWidth, this.lineHeight);
	}

	public getItemMetrics(index: number): ResourcePanelItemMetrics {
		const item = this.items[index];
		const metrics = this.itemMetrics.get(index);
		if (
			metrics.item === item
			&& metrics.line === item.line
			&& metrics.contentStartColumn === item.contentStartColumn
		) {
			return metrics;
		}
		const line = item.line;
		const contentStartColumn = item.contentStartColumn;
		const markerStartColumn = item.callHierarchyExpandable ? contentStartColumn - 2 : contentStartColumn;
		metrics.item = item;
		metrics.line = line;
		metrics.contentStartColumn = contentStartColumn;
		metrics.indentText = line.slice(0, contentStartColumn);
		metrics.contentText = line.slice(contentStartColumn);
		metrics.indentWidth = measureTextRange(line, 0, contentStartColumn);
		metrics.contentWidth = measureTextRange(line, contentStartColumn, line.length);
		metrics.markerStartWidth = measureTextRange(line, 0, markerStartColumn);
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

	// Public refresh trigger
	public refresh(): void { this.refreshContents(); }

	public expandSelectedCallHierarchyNode(): void {
		const expandedNodeId = expandSelectedCallHierarchyNode(
			this.items,
			this.selectionIndex,
			this.callHierarchyExpandedNodeIds,
		);
		if (!expandedNodeId) return;
		this.refreshContents();
		this.restoreCallHierarchySelection(expandedNodeId);
	}

	public collapseSelectedCallHierarchyNode(): void {
		const collapsedNodeId = collapseSelectedCallHierarchyNode(
			this.items,
			this.selectionIndex,
			this.callHierarchyExpandedNodeIds,
		);
		if (!collapsedNodeId) return;
		this.refreshContents();
		this.restoreCallHierarchySelection(collapsedNodeId);
	}

	private activateSelectedCallHierarchy(): void {
		const toggledNodeId = activateSelectedCallHierarchyItem(
			this.items,
			this.selectionIndex,
			this.callHierarchyExpandedNodeIds,
		);
		if (!toggledNodeId) {
			return;
		}
		this.refreshContents();
		this.restoreCallHierarchySelection(toggledNodeId);
	}

	private restoreCallHierarchySelection(nodeId: string): void {
		const index = findResourcePanelIndexByCallHierarchyNodeId(this.items, nodeId);
		if (index >= 0) this.selectionIndex = index;
	}

	private applyRefreshResult(refreshed: {
		items: ResourceBrowserItem[];
		maxLineWidth: number;
		selectionIndex: number;
		scroll: number;
	}): void {
		this.items = refreshed.items;
		this.itemMetrics.clear();
		this.maxLineWidth = refreshed.maxLineWidth;
		this.selectionIndex = refreshed.selectionIndex;
		this.scroll = refreshed.scroll;
		this.clampHScroll();
	}
}

export let resourcePanel: ResourcePanelController = null;

export function initializeResourcePanel(scrollbars: ResourcePanelScrollbars): void {
	resourcePanel = new ResourcePanelController(scrollbars);
}
