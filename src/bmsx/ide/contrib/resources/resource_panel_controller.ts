import * as constants from '../../core/constants';
import { clamp } from '../../../utils/clamp';
import { Scrollbar } from '../../ui/scrollbar';
import { renderResourcePanel } from '../../render/render_resource_panel';
import type { ResourceBrowserItem } from '../../core/types';
import type { RectBounds } from '../../../rompack/rompack';
import { showEditorMessage } from '../../core/editor_feedback_state';
import { measureText } from '../../core/text_utils';
import type { CallHierarchyView } from '../call_hierarchy/call_hierarchy_view';
import { editorViewState } from '../../ui/editor_view_state';
import {
	findResourcePanelIndexByCallHierarchyNodeId,
	type ResourcePanelFilterMode,
} from './resource_panel_items';
import {
	clampResourcePanelRatio,
	computeResourcePanelMaxHScroll,
	writeResourcePanelBounds,
	resourcePanelLineCapacity,
	defaultResourcePanelRatio,
} from './resource_panel_layout';
import {
	clampResourcePanelSelectionIndex,
	collapseSelectedCallHierarchyNode,
	ensureResourcePanelSelectionScroll,
	expandSelectedCallHierarchyNode,
	moveResourcePanelSelectionIndex,
	resourcePanelIndexAtRelativeY,
	scrollResourcePanelHorizontalOffset,
} from './resource_panel_navigation';
import {
	activateSelectedCallHierarchyItem,
	openSelectedResourcePanelCallHierarchyLocation,
	openSelectedResourcePanelItem,
} from './resource_panel_open_actions';
import {
	refreshResourcePanelCallHierarchyState,
	refreshResourcePanelResourceState,
} from './resource_panel_refresh';
import { handleResourcePanelKeyboardInput } from './resource_panel_keyboard';

export interface ResourcePanelScrollbars {
	resourceVertical: Scrollbar;
	resourceHorizontal: Scrollbar;
}

export class ResourcePanelController {
	private static readonly EMPTY_ITEMS: ResourceBrowserItem[] = [];
	public visible = false;
	public focused = false;
	private widthRatio: number;
	private filterMode: ResourcePanelFilterMode = 'lua_only';
	private mode: 'resources' | 'call_hierarchy' = 'resources';
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
	private readonly callHierarchyExpandedNodeIds = new Set<string>();
	private readonly bounds: RectBounds = { left: 0, top: 0, right: 0, bottom: 0 };

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
	}

	// === Panel lifecycle ===
	isVisible(): boolean { return this.visible; }
	isFocused(): boolean { return this.focused; }
	setFocused(focused: boolean): void { this.focused = focused; }
	getFilterMode(): 'lua_only' | 'all' { return this.filterMode; }
	getMode(): 'resources' | 'call_hierarchy' { return this.mode; }

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
		this.mode = 'call_hierarchy';
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
		const bounds = this.getBounds();
		if (!bounds) {
			return -1;
		}
		const contentTop = bounds.top + 2;
		const relativeY = y - contentTop;
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
		const markerEndColumn = item.contentStartColumn;
		const markerStartColumn = markerEndColumn - 2;
		const bounds = this.getBounds();
		if (!bounds) {
			return false;
		}
		const contentLeft = bounds.left + constants.RESOURCE_PANEL_PADDING_X;
		const markerLeft = contentLeft - this.hscroll + measureText(item.line.slice(0, markerStartColumn));
		const markerRight = contentLeft - this.hscroll + measureText(item.line.slice(0, markerEndColumn));
		return viewportX >= markerLeft && viewportX < markerRight;
	}

	setScroll(scroll: number): void {
		const capacity = this.lineCapacity();
		const maxScroll = Math.max(0, this.items.length - capacity);
		this.scroll = clamp(Math.round(scroll), 0, maxScroll);
	}

	setHScroll(scroll: number): void {
		const maxScroll = this.computeMaxHScroll();
		this.hscroll = clamp(Math.round(scroll), 0, maxScroll);
	}

	scrollBy(amount: number): void {
		const capacity = this.lineCapacity();
		const maxScroll = Math.max(0, this.items.length - capacity);
		this.scroll = clamp(this.scroll + Math.round(amount), 0, maxScroll);
		this.ensureSelectionVisible();
		this.clampHScroll();
	}

	openSelected(): void {
		if (this.mode === 'call_hierarchy') {
			this.activateSelectedCallHierarchy();
			return;
		}
		openSelectedResourcePanelItem(this.items, this.selectionIndex);
	}

	openSelectedCallHierarchyLocation(): void {
		if (this.mode !== 'call_hierarchy') {
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
	}

	private refreshContents(): void {
		const bounds = this.getBounds();
		if (!bounds) {
			return;
		}
		this.hoverIndex = -1;
		if (this.mode === 'call_hierarchy') {
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
		const previousDescriptor = (this.selectionIndex >= 0 && this.selectionIndex < this.items.length)
			? this.items[this.selectionIndex].descriptor
			: null;
		this.applyRefreshResult(refreshResourcePanelResourceState({
			filterMode: this.filterMode,
			bounds,
			lineHeight: this.lineHeight,
			previousDescriptor,
			previousIndex: this.selectionIndex,
			previousScroll: this.scroll,
		}));
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
		const capacity = this.lineCapacity();
		this.scroll = ensureResourcePanelSelectionScroll(this.selectionIndex, this.scroll, capacity, this.items.length);
		this.clampHScroll();
	}

	public lineCapacity(): number {
		const bounds = this.getBounds();
		if (!bounds) {
			return 1;
		}
		return resourcePanelLineCapacity(bounds, this.items.length, this.maxLineWidth, this.lineHeight);
	}

	public getBounds(): RectBounds {
		if (!this.visible) {
			return null;
		}
		return writeResourcePanelBounds(this.bounds, this.widthRatio) ? this.bounds : null;
	}

	public computeMaxHScroll(): number {
		const bounds = this.getBounds();
		if (!bounds) {
			return 0;
		}
		return computeResourcePanelMaxHScroll(bounds, this.items.length, this.maxLineWidth, this.lineHeight);
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
		this.maxLineWidth = refreshed.maxLineWidth;
		this.selectionIndex = refreshed.selectionIndex;
		this.scroll = refreshed.scroll;
		this.clampHScroll();
	}
}
