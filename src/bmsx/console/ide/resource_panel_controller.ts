import { $ } from '../../core/game';
import type { BmsxConsoleApi } from '../api';
import * as constants from './constants';
import { clamp } from '../../utils/clamp';
import { ConsoleScrollbar } from './scrollbar';
import { renderResourcePanel } from './render/render_resource_panel';
import type { ResourceBrowserItem } from './types';
import type { RectBounds } from '../../rompack/rompack';
import type { ConsoleResourceDescriptor } from '../types';
import { consumeIdeKey, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from './input';

export interface ResourcePanelBridge {
	// Metrics and geometry
	getViewportWidth(): number;
	getViewportHeight(): number;
	getBottomMargin(): number;
	codeViewportTop(): number;
	lineHeight: number;
	charAdvance: number;

	// Text rendering
	measureText(text: string): number;
	drawText(api: BmsxConsoleApi, text: string, x: number, y: number, color: number): void;
	drawColoredText(text: string, colors: number[], x: number, y: number): void;
	drawRectOutlineColor(api: BmsxConsoleApi, left: number, top: number, right: number, bottom: number, color: { r: number; g: number; b: number; a: number }): void;

	// Editor integration
	playerIndex: number;
	listResources(): ConsoleResourceDescriptor[];
	openLuaCodeTab(descriptor: ConsoleResourceDescriptor): void;
	openResourceViewerTab(descriptor: ConsoleResourceDescriptor): void;
	focusEditorFromResourcePanel(): void;
	showMessage(text: string, color: number, duration: number): void;
}

export interface ResourcePanelScrollbars {
	resourceVertical: ConsoleScrollbar;
	resourceHorizontal: ConsoleScrollbar;
}

export class ResourcePanelController {
	private visible = false;
	private focused = false;
	private widthRatio: number | null = null;
	private filterMode: 'lua_only' | 'all' = 'lua_only';

	// Browser state
	private items: ResourceBrowserItem[] = [];
	private scroll = 0;
	private hscroll = 0;
	private selectionIndex = -1;
	private hoverIndex = -1;
	private maxLineWidth = 0;
	private pendingSelectionasset_id: string | null = null;
	// totalResourceCount intentionally not tracked here now

	// Scrollbars for the panel
	private readonly resourceVertical: ConsoleScrollbar;
	private readonly resourceHorizontal: ConsoleScrollbar;

	constructor(private readonly host: ResourcePanelBridge, scrollbars?: ResourcePanelScrollbars) {
		if (scrollbars) {
			this.resourceVertical = scrollbars.resourceVertical;
			this.resourceHorizontal = scrollbars.resourceHorizontal;
		} else {
			this.resourceVertical = new ConsoleScrollbar('resourceVertical', 'vertical');
			this.resourceHorizontal = new ConsoleScrollbar('resourceHorizontal', 'horizontal');
		}
	}

	public setFontMetrics(lineHeight: number, charAdvance: number): void {
		this.host.lineHeight = lineHeight;
		this.host.charAdvance = charAdvance;
	}

	// === Panel lifecycle ===
	isVisible(): boolean { return this.visible; }
	isFocused(): boolean { return this.focused; }
	setFocused(focused: boolean): void { this.focused = focused; }
	getFilterMode(): 'lua_only' | 'all' { return this.filterMode; }

	togglePanel(): void { this.visible ? this.hide() : this.show(); }

	show(): void {
		const desiredRatio = this.widthRatio ?? this.defaultRatio();
		const clamped = this.clampRatio(desiredRatio);
		const widthPx = this.computePixelWidth(clamped);
		if (clamped <= 0 || widthPx <= 0) {
			this.host.showMessage('Viewport too small for resource panel.', constants.COLOR_STATUS_WARNING, 3.0);
			return;
		}
		this.widthRatio = clamped;
		this.visible = true;
		this.focused = true;
		this.refreshContents();
	}

	hide(): void {
		if (!this.visible) return;
		this.visible = false;
		this.focused = false;
		this.resetState();
	}

	toggleFilterMode(): void {
		this.filterMode = this.filterMode === 'lua_only' ? 'all' : 'lua_only';
		if (this.visible) this.refreshContents();
		const modeLabel = this.filterMode === 'lua_only' ? 'Lua resources' : 'all resources';
		this.host.showMessage(`Files panel: showing ${modeLabel}`, constants.COLOR_STATUS_TEXT, 2.5);
	}

	// === Rendering ===
	draw(): void {
		if (!this.visible) return;
		const proxyHost = {
			resourcePanelVisible: this.visible,
			getResourcePanelBounds: () => this.getBounds(),
			lineHeight: this.host.lineHeight,
			measureText: (t: string) => this.host.measureText(t),
			drawText: (a: BmsxConsoleApi, t: string, x: number, y: number, c: number) => this.host.drawText(a, t, x, y, c),
			drawColoredText: (t: string, colors: number[], x: number, y: number) => this.host.drawColoredText(t, colors, x, y),
			drawRectOutlineColor: (a: BmsxConsoleApi, l: number, t: number, r: number, b: number, col: { r: number; g: number; b: number; a: number }) => this.host.drawRectOutlineColor(a, l, t, r, b, col),
			resourceBrowserItems: this.items,
			resourceBrowserScroll: this.scroll,
			resourceBrowserHorizontalScroll: this.hscroll,
			resourcePanelFocused: this.focused,
			resourceBrowserSelectionIndex: this.selectionIndex,
			resourceBrowserHoverIndex: this.hoverIndex,
			resourceBrowserMaxLineWidth: this.maxLineWidth,
			clampResourceBrowserHorizontalScroll: () => this.clampHScroll(),
			resourceVertical: this.resourceVertical,
			resourceHorizontal: this.resourceHorizontal,
		} as const;
		// Renderer may update scroll variables; capture via local class implementing same shape
		class HostProxy {
			resourcePanelVisible = proxyHost.resourcePanelVisible;
			getResourcePanelBounds = proxyHost.getResourcePanelBounds;
			lineHeight = proxyHost.lineHeight;
			measureText = proxyHost.measureText;
			drawText = proxyHost.drawText;
			drawColoredText = proxyHost.drawColoredText;
			drawRectOutlineColor = proxyHost.drawRectOutlineColor;
			resourceBrowserItems = proxyHost.resourceBrowserItems;
			resourceBrowserScroll = proxyHost.resourceBrowserScroll;
			resourceBrowserHorizontalScroll = proxyHost.resourceBrowserHorizontalScroll;
			resourcePanelFocused = proxyHost.resourcePanelFocused;
			resourceBrowserSelectionIndex = proxyHost.resourceBrowserSelectionIndex;
			resourceBrowserHoverIndex = proxyHost.resourceBrowserHoverIndex;
			resourceBrowserMaxLineWidth = proxyHost.resourceBrowserMaxLineWidth;
			clampResourceBrowserHorizontalScroll = proxyHost.clampResourceBrowserHorizontalScroll;
			resourceVertical = proxyHost.resourceVertical;
			resourceHorizontal = proxyHost.resourceHorizontal;
		}
		const hostImpl = new HostProxy();
		renderResourcePanel(hostImpl);
		this.scroll = hostImpl.resourceBrowserScroll;
		this.hscroll = hostImpl.resourceBrowserHorizontalScroll;
	}

	// === Keyboard ===
	handleKeyboard(): void {
		if (!this.visible) return;
		const { ctrlDown, metaDown, shiftDown } = { ctrlDown: isCtrlDown(), metaDown: isMetaDown(), shiftDown: isShiftDown() };
		if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressed('KeyR')) {
			consumeIdeKey('KeyR');
			// Resolution is editor concern; let host surface a message
			this.host.showMessage('Resolution toggle not handled by panel controller.', constants.COLOR_STATUS_TEXT, 1.2);
			return;
		}
		if ((ctrlDown || metaDown) && isKeyJustPressed('KeyB')) {
			consumeIdeKey('KeyB');
			this.togglePanel();
			return;
		}
		if (isKeyJustPressed('Escape')) {
			consumeIdeKey('Escape');
			this.hide();
			return;
		}
		if (isKeyJustPressed('Tab')) {
			consumeIdeKey('Tab');
			this.focused = false;
			this.host.focusEditorFromResourcePanel();
			return;
		}
		if (this.items.length === 0) return;

		// Horizontal scroll with ArrowLeft/Right
		const horizontalStep = this.host.charAdvance * 4;
		const horizontalMoves: Array<{ key: string; predicate: boolean; delta: number }> = [
			{ key: 'ArrowLeft', predicate: isKeyJustPressed('ArrowLeft'), delta: -horizontalStep },
			{ key: 'ArrowRight', predicate: isKeyJustPressed('ArrowRight'), delta: horizontalStep },
		];
		for (const entry of horizontalMoves) {
			if (entry.predicate) {
				consumeIdeKey(entry.key);
				this.scrollHorizontal(entry.delta);
				this.ensureSelectionVisible();
				return;
			}
		}
		if (isKeyJustPressed('Enter')) {
			consumeIdeKey('Enter');
			this.openSelected();
			return;
		}
		const moves: Array<{ code: string; action: () => void }> = [
			{ code: 'ArrowUp', action: () => this.moveSelection(-1) },
			{ code: 'ArrowDown', action: () => this.moveSelection(1) },
			{ code: 'PageUp', action: () => this.moveSelection(-this.lineCapacity()) },
			{ code: 'PageDown', action: () => this.moveSelection(this.lineCapacity()) },
			{ code: 'Home', action: () => this.moveSelection(Number.NEGATIVE_INFINITY) },
			{ code: 'End', action: () => this.moveSelection(Number.POSITIVE_INFINITY) },
		];
		for (const entry of moves) {
			const triggered = isKeyJustPressed(entry.code);
			if (triggered) {
				consumeIdeKey(entry.code);
				entry.action();
				return;
			}
		}
	}

	// === Public helpers used by editor pointer logic ===
	indexAtPosition(x: number, y: number): number {
		const bounds = this.getBounds();
		if (!bounds) return -1;
		if (x < bounds.left || x >= bounds.right) return -1;
		const contentTop = bounds.top + 2;
		const relativeY = y - contentTop;
		if (relativeY < 0) return -1;
		const index = this.scroll + Math.floor(relativeY / this.host.lineHeight);
		if (index < 0 || index >= this.items.length) return -1;
		return index;
	}

	selectResource(descriptor: ConsoleResourceDescriptor): void {
		if (!descriptor.asset_id || descriptor.asset_id.length === 0) return;
		this.pendingSelectionasset_id = descriptor.asset_id;
		if (!this.visible) return;
		this.applyPendingSelection();
	}

	setSelectionIndex(index: number): void {
		if (!this.visible) return;
		if (!Number.isFinite(index)) return;
		const next = clamp(Math.trunc(index), -1, Math.max(-1, this.items.length - 1));
		if (next === this.selectionIndex) return;
		this.selectionIndex = next;
		this.hoverIndex = -1;
		this.ensureSelectionVisible();
	}

	setHoverIndex(index: number): void {
		if (!this.visible) { this.hoverIndex = -1; return; }
		if (!Number.isFinite(index) || index < 0 || index >= this.items.length) { this.hoverIndex = -1; return; }
		this.hoverIndex = index;
	}

	setScroll(scroll: number): void {
		if (!this.visible) return;
		const capacity = this.lineCapacity();
		const maxScroll = Math.max(0, this.items.length - capacity);
		this.scroll = clamp(Math.round(scroll), 0, maxScroll);
	}

	setHScroll(scroll: number): void {
		if (!this.visible) return;
		const maxScroll = this.computeMaxHScroll();
		this.hscroll = clamp(scroll, 0, maxScroll);
		this.clampHScroll();
	}

	scrollBy(amount: number): void {
		if (!this.visible) return;
		const capacity = this.lineCapacity();
		if (capacity <= 0) { this.scroll = 0; return; }
		const maxScroll = Math.max(0, this.items.length - capacity);
		this.scroll = clamp(this.scroll + Math.trunc(amount), 0, maxScroll);
		this.ensureSelectionVisible();
		this.clampHScroll();
	}

	openSelected(): void {
		this.openSelectedInternal();
	}

	setRatioFromViewportX(viewportX: number, viewportWidth: number): boolean {
		const vw = viewportWidth > 0 ? viewportWidth : 1;
		const requestedRatio = viewportX / vw;
		const clampedRatio = this.clampRatio(requestedRatio);
		const pixelWidth = this.computePixelWidth(clampedRatio);
		if (pixelWidth <= 0) {
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
		this.items = [];
		this.scroll = 0;
		this.selectionIndex = -1;
		this.hoverIndex = -1;
		this.hscroll = 0;
		this.maxLineWidth = 0;
		this.pendingSelectionasset_id = null;
	}

	private refreshContents(): void {
		this.hoverIndex = -1;
		const previous = {
			descriptor: (this.selectionIndex >= 0 && this.selectionIndex < this.items.length) ? this.items[this.selectionIndex].descriptor : null,
			index: this.selectionIndex,
			scroll: this.scroll,
		} as const;
		let descriptors: ConsoleResourceDescriptor[];
		try {
			descriptors = this.host.listResources();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.host.showMessage(`Failed to enumerate resources: ${message}`, constants.COLOR_STATUS_WARNING, 3.0);
			// count omitted
			this.items = [{ line: `<failed to load resources: ${message}>`, contentStartColumn: 0, descriptor: null }];
			this.scroll = 0;
			this.selectionIndex = 0;
			this.pendingSelectionasset_id = null;
			return;
		}
		// Augment with atlas entries (moved from editor)
		const augmented = descriptors.slice();
		const rompack = $.rompack;
		const img = rompack.img;
		const atlasKeys = Object.keys(img);
		for (const key of atlasKeys) {
			if (augmented.some(entry => entry.asset_id === key)) continue;
			augmented.push({ path: `atlas/${key}`, type: 'atlas', asset_id: key });
		}
		const filtered: ConsoleResourceDescriptor[] = [];
		for (let i = 0; i < augmented.length; i++) {
			const d = augmented[i];
			if (this.matchesFilter(d)) filtered.push(d);
		}
		// count omitted
		this.items = this.buildItems(filtered);
		this.updateMetrics();
		const targetasset_id = this.pendingSelectionasset_id ?? (previous.descriptor ? previous.descriptor.asset_id : null);
		let selectionIndex = -1;
		if (targetasset_id) {
			const resolved = this.findIndexByasset_id(targetasset_id);
			if (resolved !== -1) {
				selectionIndex = resolved;
				if (this.pendingSelectionasset_id === targetasset_id) this.pendingSelectionasset_id = null;
			}
		}
		if (selectionIndex === -1 && previous.index >= 0 && previous.index < this.items.length) selectionIndex = previous.index;
		if (selectionIndex === -1 && this.items.length > 0) selectionIndex = 0;
		this.selectionIndex = selectionIndex;
		this.updateMetrics();
		if (selectionIndex < 0) {
			this.scroll = 0; this.hscroll = 0; return;
		}
		const capacity = this.lineCapacity();
		if (capacity <= 0) { this.scroll = 0; this.clampHScroll(); return; }
		const maxScroll = Math.max(0, this.items.length - capacity);
		this.scroll = clamp(previous.scroll, 0, maxScroll);
		this.ensureSelectionVisible();
		this.applyPendingSelection();
	}

	private matchesFilter(descriptor: ConsoleResourceDescriptor): boolean {
		if (this.filterMode !== 'lua_only') return true;
		if (!descriptor) return false;
		if (descriptor.type === 'lua') return true;
		const path = descriptor.path;
		if (typeof path === 'string' && path.length > 0 && path.toLowerCase().endsWith('.lua')) return true;
		const asset_id = descriptor.asset_id;
		if (typeof asset_id === 'string' && asset_id.length > 0 && asset_id.toLowerCase().endsWith('.lua')) return true;
		return false;
	}

	private buildItems(entries: ConsoleResourceDescriptor[]): ResourceBrowserItem[] {
		const items: ResourceBrowserItem[] = [];
		if (!entries || entries.length === 0) {
			const placeholder = this.filterMode === 'lua_only' ? '<no lua resources>' : '<no resources>';
			items.push({ line: placeholder, contentStartColumn: 0, descriptor: null });
			return items;
		}
		type Dir = { name: string; children: Map<string, Dir>; files: { name: string; descriptor: ConsoleResourceDescriptor }[] };
		const root: Dir = { name: '.', children: new Map(), files: [] };
		for (const entry of entries) {
			const rawPath = typeof entry.path === 'string' && entry.path.length > 0
				? entry.path
				: (entry.asset_id ?? '');
			const normalized = rawPath.replace(/\\/g, '/');
			const parts = normalized.split('/').filter(part => part.length > 0 && part !== '.');
			const fallbackName = rawPath.length > 0 ? rawPath : (entry.asset_id ?? '<resource>');
			if (parts.length === 0) {
				root.files.push({ name: fallbackName, descriptor: entry });
				continue;
			}
			let current = root;
			for (let i = 0; i < parts.length; i++) {
				const part = parts[i];
				const isLeaf = i === parts.length - 1;
				if (isLeaf) current.files.push({ name: part, descriptor: entry });
				else {
					let child = current.children.get(part);
					if (!child) { child = { name: part, children: new Map(), files: [] }; current.children.set(part, child); }
					current = child;
				}
			}
		}
		items.push({ line: './', contentStartColumn: 0, descriptor: null });
		const indentUnit = '  ';
		const compactDirectory = (directory: Dir): { label: string; terminal: Dir } => {
			const segments: string[] = [directory.name];
			let cursor = directory;
			while (cursor.files.length === 0 && cursor.children.size === 1) {
				const iterator = cursor.children.values().next();
				if (!iterator.value) {
					break;
				}
				const next = iterator.value as Dir;
				segments.push(next.name);
				cursor = next;
			}
			return { label: segments.join('/'), terminal: cursor };
		};
		const traverse = (directory: Dir, depth: number) => {
			const childDirs = Array.from(directory.children.values()).sort((a, b) => a.name.localeCompare(b.name));
			const files = directory.files.slice().sort((a, b) => a.name.localeCompare(b.name));
			for (const dir of childDirs) {
				const { label, terminal } = compactDirectory(dir);
				const indent = indentUnit.repeat(depth);
				const line = `${indent}${label}/`;
				items.push({ line, contentStartColumn: indent.length, descriptor: null });
				traverse(terminal, depth + 1);
			}
			for (const file of files) {
				const indent = indentUnit.repeat(depth);
				const line = `${indent}${file.name}`;
				items.push({ line, contentStartColumn: indent.length, descriptor: file.descriptor });
			}
		};
		traverse(root, 0);
		return items;
	}

	private updateMetrics(): void {
		let maxWidth = 0;
		for (const item of this.items) {
			const indent = item.line.slice(0, item.contentStartColumn);
			const content = item.line.slice(item.contentStartColumn);
			const width = this.host.measureText(indent) + this.host.measureText(content);
			if (width > maxWidth) maxWidth = width;
		}
		this.maxLineWidth = maxWidth;
		this.clampHScroll();
	}

	private findIndexByasset_id(asset_id: string): number {
		for (let i = 0; i < this.items.length; i++) {
			const descriptor = this.items[i].descriptor;
			if (descriptor && descriptor.asset_id === asset_id) return i;
		}
		return -1;
	}

	private applyPendingSelection(): void {
		if (!this.visible) return;
		const asset_id = this.pendingSelectionasset_id;
		if (!asset_id) return;
		const index = this.findIndexByasset_id(asset_id);
		if (index === -1) return;
		this.selectionIndex = index;
		this.ensureSelectionVisible();
		this.pendingSelectionasset_id = null;
	}

	private openSelectedInternal(): void {
		if (this.selectionIndex < 0 || this.selectionIndex >= this.items.length) return;
		const item = this.items[this.selectionIndex];
		if (!item.descriptor) return;
		const d = item.descriptor;
		if (d.type === 'atlas') {
			this.host.showMessage('Atlas resources cannot be previewed in the console editor.', constants.COLOR_STATUS_WARNING, 3.2);
			this.host.focusEditorFromResourcePanel();
			return;
		}
		if (d.type === 'lua' || this.isLuaLike(d)) this.host.openLuaCodeTab(d); else this.host.openResourceViewerTab(d);
		this.host.focusEditorFromResourcePanel();
	}

	private isLuaLike(descriptor: ConsoleResourceDescriptor): boolean {
		if (descriptor.type === 'lua') return true;
		const path = descriptor.path;
		if (typeof path === 'string' && path.length > 0 && path.toLowerCase().endsWith('.lua')) return true;
		const asset_id = descriptor.asset_id;
		if (typeof asset_id === 'string' && asset_id.length > 0 && asset_id.toLowerCase().endsWith('.lua')) return true;
		return false;
	}

	private moveSelection(delta: number): void {
		if (!this.visible) return;
		const count = this.items.length;
		if (count === 0) { this.selectionIndex = -1; return; }
		let next: number;
		if (delta === Number.NEGATIVE_INFINITY) next = 0;
		else if (delta === Number.POSITIVE_INFINITY) next = count - 1;
		else next = (this.selectionIndex >= 0 ? this.selectionIndex : 0) + Math.trunc(delta);
		next = clamp(next, 0, count - 1);
		if (next === this.selectionIndex) return;
		this.selectionIndex = next;
		this.hoverIndex = -1;
		this.ensureSelectionVisible();
	}

	private scrollHorizontal(amount: number): void {
		if (!this.visible) return;
		if (!Number.isFinite(amount) || amount === 0) return;
		const maxScroll = this.computeMaxHScroll();
		if (maxScroll <= 0) { this.hscroll = 0; return; }
		const next = clamp(this.hscroll + amount, 0, maxScroll);
		if (next === this.hscroll) return;
		this.hscroll = next;
		this.clampHScroll();
	}

	public ensureSelectionVisible(): void {
		if (!this.visible) return;
		const index = this.selectionIndex;
		if (index < 0) return;
		const capacity = this.lineCapacity();
		if (capacity <= 0) { this.scroll = 0; this.clampHScroll(); return; }
		const maxScroll = Math.max(0, this.items.length - capacity);
		if (index < this.scroll) { this.scroll = index; this.clampHScroll(); return; }
		const overflow = index - (this.scroll + capacity - 1);
		if (overflow > 0) {
			this.scroll = Math.min(this.scroll + overflow, maxScroll);
		}
		this.clampHScroll();
	}

	public lineCapacity(): number {
		const bounds = this.getBounds();
		const overlayTop = bounds ? bounds.top : this.host.codeViewportTop();
		const overlayBottom = bounds ? bounds.bottom : (this.host.getViewportHeight() - this.host.getBottomMargin());
		let contentHeight = Math.max(0, overlayBottom - overlayTop);
		let initialCapacity = Math.max(1, Math.floor(contentHeight / this.host.lineHeight));
		if (bounds) {
			const needsVerticalScrollbar = this.items.length > initialCapacity;
			const contentLeft = bounds.left + constants.RESOURCE_PANEL_PADDING_X;
			const dividerLeft = bounds.right - 1;
			const availableRight = needsVerticalScrollbar ? dividerLeft - constants.SCROLLBAR_WIDTH : dividerLeft;
			const availableWidth = Math.max(0, availableRight - contentLeft);
			const needsHorizontalScrollbar = this.maxLineWidth > availableWidth;
			if (needsHorizontalScrollbar) {
				contentHeight = Math.max(0, contentHeight - constants.SCROLLBAR_WIDTH);
				initialCapacity = Math.max(1, Math.floor(contentHeight / this.host.lineHeight));
			}
		}
		return initialCapacity;
	}

	public getBounds(): RectBounds | null {
		if (!this.visible) return null;
		const width = this.getWidth();
		if (width <= 0) return null;
		const top = this.host.codeViewportTop();
		const bottom = this.host.getViewportHeight() - this.host.getBottomMargin();
		if (bottom <= top) return null;
		return { left: 0, top, right: width, bottom };
	}

	private getWidth(): number {
		if (!this.visible) return 0;
		const ratio = this.clampRatio(this.widthRatio ?? this.defaultRatio());
		const width = this.computePixelWidth(ratio);
		if (width <= 0) return 0;
		this.widthRatio = ratio;
		return width;
	}

	public computeMaxHScroll(): number {
		const bounds = this.getBounds();
		if (!bounds) return 0;
		const contentLeft = bounds.left + constants.RESOURCE_PANEL_PADDING_X;
		const capacity = this.lineCapacity();
		const needsScrollbar = this.items.length > capacity;
		const availableRight = needsScrollbar ? bounds.right - 1 - constants.SCROLLBAR_WIDTH : bounds.right - 1;
		const availableWidth = Math.max(0, availableRight - contentLeft);
		if (availableWidth <= 0) return 0;
		const maxScroll = this.maxLineWidth - availableWidth;
		return maxScroll > 0 ? maxScroll : 0;
	}

	public clampHScroll(): void {
		const maxScroll = this.computeMaxHScroll();
		const current = Number.isFinite(this.hscroll) ? this.hscroll : 0;
		this.hscroll = clamp(current, 0, maxScroll);
	}

	private defaultRatio(): number {
		const viewportWidth = this.host.getViewportWidth();
		const screenWidth = this.host.getViewportWidth();
		const relative = Math.min(1, viewportWidth / screenWidth);
		const responsiveness = 1 - relative;
		const ratio = constants.RESOURCE_PANEL_DEFAULT_RATIO + responsiveness * (constants.RESOURCE_PANEL_MAX_RATIO - constants.RESOURCE_PANEL_DEFAULT_RATIO) * 0.6;
		return this.clampRatio(ratio);
	}

	private clampRatio(ratio: number | null): number {
		const minRatio = constants.RESOURCE_PANEL_MIN_RATIO;
		const minEditorRatio = constants.RESOURCE_PANEL_MIN_EDITOR_RATIO;
		const availableForPanel = Math.max(0, 1 - minEditorRatio);
		const maxRatio = Math.max(minRatio, Math.min(constants.RESOURCE_PANEL_MAX_RATIO, availableForPanel));
		let resolved = ratio ?? constants.RESOURCE_PANEL_DEFAULT_RATIO;
		if (!Number.isFinite(resolved)) resolved = constants.RESOURCE_PANEL_DEFAULT_RATIO;
		if (resolved < minRatio) resolved = minRatio;
		if (resolved > maxRatio) resolved = maxRatio;
		return resolved;
	}

	private computePixelWidth(ratio: number): number {
		if (!Number.isFinite(ratio) || ratio <= 0 || this.host.getViewportWidth() <= 0) return 0;
		return Math.floor(this.host.getViewportWidth() * ratio);
	}

	// Expose snapshot for editor sync
	public getStateForRender(): {
		visible: boolean;
		bounds: RectBounds | null;
		items: ResourceBrowserItem[];
		scroll: number;
		hscroll: number;
		focused: boolean;
		selectionIndex: number;
		hoverIndex: number;
		maxLineWidth: number;
		resourceVertical: ConsoleScrollbar;
		resourceHorizontal: ConsoleScrollbar;
	} {
		return {
			visible: this.visible,
			bounds: this.getBounds(),
			items: this.items,
			scroll: this.scroll,
			hscroll: this.hscroll,
			focused: this.focused,
			selectionIndex: this.selectionIndex,
			hoverIndex: this.hoverIndex,
			maxLineWidth: this.maxLineWidth,
			resourceVertical: this.resourceVertical,
			resourceHorizontal: this.resourceHorizontal,
		};
	}

	// Public refresh trigger
	public refresh(): void { this.refreshContents(); }
}
