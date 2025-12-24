import { $ } from '../../core/engine_core';
import * as constants from './constants';
import { clamp } from '../../utils/clamp';
import { VMScrollbar } from './scrollbar';
import { renderResourcePanel } from './render/render_resource_panel';
import type { ResourceBrowserItem } from './types';
import type { RectBounds } from '../../rompack/rompack';
import type { VMResourceDescriptor } from '../types';
import { consumeIdeKey, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from './ide_input';
import { ide_state } from './ide_state';
import { bottomMargin, codeViewportTop, focusEditorFromResourcePanel, listResourcesStrict, openLuaCodeTab, openResourceViewerTab } from './vm_cart_editor';
import { measureText } from './text_utils';

export interface ResourcePanelScrollbars {
	resourceVertical: VMScrollbar;
	resourceHorizontal: VMScrollbar;
}

export class ResourcePanelController {
	public visible = false;
	public focused = false;
	private widthRatio: number;
	private filterMode: 'lua_only' | 'all' = 'lua_only';
	public lineHeight: number;
	private charAdvance: number;

	// Browser state
	public items: ResourceBrowserItem[] = [];
	public scroll = 0;
	public hscroll = 0;
	public selectionIndex = -1;
	public hoverIndex = -1;
	public maxLineWidth = 0;
	private pendingSelectionAssetId: string = null;

	// Scrollbars for the panel
	public readonly resourceVertical: VMScrollbar;
	public readonly resourceHorizontal: VMScrollbar;

	constructor(scrollbars?: ResourcePanelScrollbars) {
		this.lineHeight = ide_state.lineHeight;
		this.charAdvance = ide_state.charAdvance;
		if (scrollbars) {
			this.resourceVertical = scrollbars.resourceVertical;
			this.resourceHorizontal = scrollbars.resourceHorizontal;
		} else {
			this.resourceVertical = new VMScrollbar('resourceVertical', 'vertical');
			this.resourceHorizontal = new VMScrollbar('resourceHorizontal', 'horizontal');
		}
		this.widthRatio = this.defaultRatio();
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

	togglePanel(): void { this.visible ? this.hide() : this.show(); }

	show(): void {
		const desiredRatio = this.widthRatio;
		const clamped = this.clampRatio(desiredRatio);
		const widthPx = this.computePixelWidth(clamped);
		const top = codeViewportTop();
		const bottom = ide_state.viewportHeight - bottomMargin();
		if (clamped <= 0 || widthPx <= 0 || bottom <= top) {
			ide_state.showMessage('Viewport too small for resource panel.', constants.COLOR_STATUS_WARNING, 3.0);
			return;
		}
		this.widthRatio = clamped;
		this.visible = true;
		this.focused = true;
		this.refreshContents();
	}

	hide(): void {
		this.visible = false;
		this.focused = false;
		this.resetState();
	}

	toggleFilterMode(): void {
		this.filterMode = this.filterMode === 'lua_only' ? 'all' : 'lua_only';
		if (this.visible) this.refreshContents();
		const modeLabel = this.filterMode === 'lua_only' ? 'Lua resources' : 'all resources';
		ide_state.showMessage(`Files panel: showing ${modeLabel}`, constants.COLOR_STATUS_TEXT, 2.5);
	}

	// === Rendering ===
	draw(): void {
		if (!this.visible) return;
		renderResourcePanel(this);
	}

	// === Keyboard ===
	handleKeyboard(): void {
		const { ctrlDown, metaDown, shiftDown } = { ctrlDown: isCtrlDown(), metaDown: isMetaDown(), shiftDown: isShiftDown() };
		if ((ctrlDown || metaDown) && shiftDown && isKeyJustPressed('KeyR')) {
			consumeIdeKey('KeyR');
			// Resolution is editor concern; let host surface a message
			ide_state.showMessage('Resolution toggle not handled by panel controller.', constants.COLOR_STATUS_TEXT, 1.2);
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
			focusEditorFromResourcePanel();
			return;
		}

		// Horizontal scroll with ArrowLeft/Right
		const horizontalStep = this.charAdvance * 4;
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
	indexAtPosition(_x: number, y: number): number {
		const bounds = this.getBounds();
		const contentTop = bounds.top + 2;
		const relativeY = y - contentTop;
		if (relativeY < 0) return -1;
		const index = this.scroll + Math.floor(relativeY / this.lineHeight);
		if (index < 0 || index >= this.items.length) return -1;
		return index;
	}

	setSelectionIndex(index: number): void {
		const next = clamp(Math.trunc(index), -1, Math.max(-1, this.items.length - 1));
		if (next === this.selectionIndex) return;
		this.selectionIndex = next;
		this.hoverIndex = -1;
		this.ensureSelectionVisible();
	}

	setHoverIndex(index: number): void {
		this.hoverIndex = index;
	}

	setScroll(scroll: number): void {
		const capacity = this.lineCapacity();
		const maxScroll = Math.max(0, this.items.length - capacity);
		this.scroll = clamp(scroll, 0, maxScroll);
	}

	setHScroll(scroll: number): void {
		const maxScroll = this.computeMaxHScroll();
		this.hscroll = clamp(scroll, 0, maxScroll);
		this.clampHScroll();
	}

	scrollBy(amount: number): void {
		const capacity = this.lineCapacity();
		const maxScroll = Math.max(0, this.items.length - capacity);
		this.scroll = clamp(this.scroll + Math.trunc(amount), 0, maxScroll);
		this.ensureSelectionVisible();
		this.clampHScroll();
	}

	openSelected(): void {
		this.openSelectedInternal();
	}

	setRatioFromViewportX(viewportX: number, viewportWidth: number): boolean {
		const requestedRatio = viewportX / viewportWidth;
		const clampedRatio = this.clampRatio(requestedRatio);
		const pixelWidth = this.computePixelWidth(clampedRatio);
		const top = codeViewportTop();
		const bottom = ide_state.viewportHeight - bottomMargin();
		if (pixelWidth <= 0 || bottom <= top) {
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
		this.pendingSelectionAssetId = null;
	}

	private refreshContents(): void {
		this.hoverIndex = -1;
		const previous = {
			descriptor: (this.selectionIndex >= 0 && this.selectionIndex < this.items.length) ? this.items[this.selectionIndex].descriptor : null,
			index: this.selectionIndex,
			scroll: this.scroll,
		} as const;
		const descriptors = listResourcesStrict();
		// Augment with atlas entries (moved from editor)
		const augmented = descriptors.slice();
		const assets = $.assets;
		const img = assets.img;
		const atlasKeys = Object.keys(img);
		for (const key of atlasKeys) {
			if (augmented.some(entry => entry.asset_id === key)) continue;
			augmented.push({ path: `atlas/${key}`, type: 'atlas', asset_id: key });
		}
		const filtered: VMResourceDescriptor[] = [];
		for (let i = 0; i < augmented.length; i++) {
			const d = augmented[i];
			if (this.matchesFilter(d)) filtered.push(d);
		}
		// count omitted
		this.items = this.buildItems(filtered);
		this.updateMetrics();
		const targetAssetId = this.pendingSelectionAssetId ?? (previous.descriptor ? previous.descriptor.asset_id : null);
		let selectionIndex = -1;
		if (targetAssetId) {
			const resolved = this.findIndexByAssetId(targetAssetId);
			if (resolved !== -1) {
				selectionIndex = resolved;
				if (this.pendingSelectionAssetId === targetAssetId) this.pendingSelectionAssetId = null;
			}
		}
		if (selectionIndex === -1 && previous.index >= 0 && previous.index < this.items.length) selectionIndex = previous.index;
		if (selectionIndex === -1 && this.items.length > 0) selectionIndex = 0;
		this.selectionIndex = selectionIndex;
		this.updateMetrics();
		const capacity = this.lineCapacity();
		const maxScroll = Math.max(0, this.items.length - capacity);
		this.scroll = clamp(previous.scroll, 0, maxScroll);
		this.ensureSelectionVisible();
		this.applyPendingSelection();
	}

	private matchesFilter(descriptor: VMResourceDescriptor): boolean {
		if (this.filterMode !== 'lua_only') return true;
		return descriptor.type === 'lua';
	}

	private buildItems(entries: VMResourceDescriptor[]): ResourceBrowserItem[] {
		const items: ResourceBrowserItem[] = [];
		if (entries.length === 0) {
			const placeholder = this.filterMode === 'lua_only' ? '<no lua resources>' : '<no resources>';
			items.push({ line: placeholder, contentStartColumn: 0, descriptor: null });
			return items;
		}
		type Dir = { name: string; children: Map<string, Dir>; files: { name: string; descriptor: VMResourceDescriptor }[] };
		const root: Dir = { name: '.', children: new Map(), files: [] };
		for (const entry of entries) {
			const rawPath = entry.path;
			const normalized = rawPath.replace(/\\/g, '/');
			const parts = normalized.split('/').filter(part => part.length > 0 && part !== '.');
			const fallbackName = rawPath;
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
			const width = measureText(indent) + measureText(content);
			if (width > maxWidth) maxWidth = width;
		}
		this.maxLineWidth = maxWidth;
		this.clampHScroll();
	}

	private findIndexByAssetId(asset_id: string): number {
		for (let i = 0; i < this.items.length; i++) {
			const descriptor = this.items[i].descriptor;
			if (descriptor && descriptor.asset_id === asset_id) return i;
		}
		return -1;
	}

	private applyPendingSelection(): void {
		const asset_id = this.pendingSelectionAssetId;
		if (!asset_id) return;
		const index = this.findIndexByAssetId(asset_id);
		if (index === -1) return;
		this.selectionIndex = index;
		this.ensureSelectionVisible();
		this.pendingSelectionAssetId = null;
	}

	private openSelectedInternal(): void {
		const item = this.items[this.selectionIndex];
		if (!item.descriptor) return;
		const d = item.descriptor;
		if (d.type === 'atlas') {
			ide_state.showMessage('Atlas resources cannot be previewed in the IDE.', constants.COLOR_STATUS_WARNING, 3.2);
			focusEditorFromResourcePanel();
			return;
		}
		if (d.type === 'lua') openLuaCodeTab(d); else openResourceViewerTab(d);
		focusEditorFromResourcePanel();
	}

	private moveSelection(delta: number): void {
		const count = this.items.length;
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
		const maxScroll = this.computeMaxHScroll();
		if (maxScroll <= 0) { this.hscroll = 0; return; }
		const next = clamp(this.hscroll + amount, 0, maxScroll);
		if (next === this.hscroll) return;
		this.hscroll = next;
		this.clampHScroll();
	}

	public ensureSelectionVisible(): void {
		const index = this.selectionIndex;
		const capacity = this.lineCapacity();
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
		const overlayTop = bounds.top;
		const overlayBottom = bounds.bottom;
		let contentHeight = Math.max(0, overlayBottom - overlayTop);
		let initialCapacity = Math.max(1, Math.floor(contentHeight / this.lineHeight));
		const needsVerticalScrollbar = this.items.length > initialCapacity;
		const contentLeft = bounds.left + constants.RESOURCE_PANEL_PADDING_X;
		const dividerLeft = bounds.right - 1;
		const availableRight = needsVerticalScrollbar ? dividerLeft - constants.SCROLLBAR_WIDTH : dividerLeft;
		const availableWidth = Math.max(0, availableRight - contentLeft);
		const needsHorizontalScrollbar = this.maxLineWidth > availableWidth;
		if (needsHorizontalScrollbar) {
			contentHeight = Math.max(0, contentHeight - constants.SCROLLBAR_WIDTH);
			initialCapacity = Math.max(1, Math.floor(contentHeight / this.lineHeight));
		}
		return initialCapacity;
	}

	public getBounds(): RectBounds {
		if (!this.visible) return null;
		const width = this.getWidth();
		if (width <= 0) return null;
		const top = codeViewportTop();
		const bottom = ide_state.viewportHeight - bottomMargin();
		if (bottom <= top) return null;
		return { left: 0, top, right: width, bottom };
	}

	private getWidth(): number {
		const ratio = this.clampRatio(this.widthRatio);
		const width = this.computePixelWidth(ratio);
		if (width <= 0) return 0;
		this.widthRatio = ratio;
		return width;
	}

	public computeMaxHScroll(): number {
		const bounds = this.getBounds();
		const contentLeft = bounds.left + constants.RESOURCE_PANEL_PADDING_X;
		const capacity = this.lineCapacity();
		const needsScrollbar = this.items.length > capacity;
		const availableRight = needsScrollbar ? bounds.right - 1 - constants.SCROLLBAR_WIDTH : bounds.right - 1;
		const availableWidth = Math.max(0, availableRight - contentLeft);
		const maxScroll = this.maxLineWidth - availableWidth;
		return maxScroll > 0 ? maxScroll : 0;
	}

	public clampHScroll(): void {
		const maxScroll = this.computeMaxHScroll();
		const current = this.hscroll;
		this.hscroll = clamp(current, 0, maxScroll);
	}

	private defaultRatio(): number {
		const viewportWidth = ide_state.viewportWidth;
		const screenWidth = ide_state.viewportWidth;
		const relative = Math.min(1, viewportWidth / screenWidth);
		const responsiveness = 1 - relative;
		const ratio = constants.RESOURCE_PANEL_DEFAULT_RATIO + responsiveness * (constants.RESOURCE_PANEL_MAX_RATIO - constants.RESOURCE_PANEL_DEFAULT_RATIO) * 0.6;
		return this.clampRatio(ratio);
	}

	private clampRatio(ratio: number): number {
		const minRatio = constants.RESOURCE_PANEL_MIN_RATIO;
		const minEditorRatio = constants.RESOURCE_PANEL_MIN_EDITOR_RATIO;
		const availableForPanel = Math.max(0, 1 - minEditorRatio);
		const maxRatio = Math.max(minRatio, Math.min(constants.RESOURCE_PANEL_MAX_RATIO, availableForPanel));
		let resolved = ratio;
		if (resolved < minRatio) resolved = minRatio;
		if (resolved > maxRatio) resolved = maxRatio;
		return resolved;
	}

	private computePixelWidth(ratio: number): number {
		return Math.floor(ide_state.viewportWidth * ratio);
	}

	// Expose snapshot for editor sync
	public getStateForRender(): {
		visible: boolean;
		bounds: RectBounds;
		items: ResourceBrowserItem[];
		scroll: number;
		hscroll: number;
		focused: boolean;
		selectionIndex: number;
		hoverIndex: number;
		maxLineWidth: number;
		resourceVertical: VMScrollbar;
		resourceHorizontal: VMScrollbar;
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
