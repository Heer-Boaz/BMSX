import { ScrollbarController } from '../../../ui/scrollbar_controller';
import { pointerHover, type PointerHoverTarget } from '../../../../input/pointer/hover';
import { clamp } from '../../../../../machine/ts/common/clamp';
import { create_rect_bounds, write_rect_bounds, point_in_rect } from '../../../../../machine/ts/common/rect';
import type { PointerInputSnapshot, PointerSnapshot } from '../../../../common/models';
import { pointerCapture } from '../../../../input/pointer/capture';
import { ScratchBuffer } from '../../../../../machine/ts/common/scratchbuffer';
import type { Scrollbar } from '../../../ui/scrollbar';
import { renderResourcePanel } from '../../../render/resource_panel';
import type { RectBounds } from '../../../../../machine/ts/common/rect';
import { showEditorMessage } from '../../../../common/feedback_state';
import { STATUS_PRIORITY_CONTENT, STATUS_PRIORITY_HINT, type WorkbenchStatusItem } from '../../../common/status_bar';
import { measureTextRange } from '../../../../editor/common/text/layout';
import { editorViewState } from '../../../../editor/ui/view/state';
import type { EditorFont } from '../../../../editor/ui/view/font';
import type { FontVariant } from '../../../../../machine/ts/render/shared/bmsx_font';
import {
	clampResourcePanelRatio,
	createResourcePanelLayout,
	writeResourcePanelBounds,
	writeResourcePanelLayout,
	type ResourcePanelLayout,
} from './layout';
import {
	clampResourcePanelSelectionIndex,
	ensureResourcePanelSelectionScroll,
	resourcePanelIndexAtRelativeY,
} from './navigation';
import { resourceIdentityKey, type ResourceIdentity } from '../../../../common/resource';
import type { CartEditor } from '../../../../cart_editor';
import type { WorkspaceSourceCatalog } from '../../../../workspace/source_catalog';
import { inputFocus, InputFocusScope, type InputFocusTarget } from '../../../../input/focus';
import { handleResourcePanelKeyboardInput } from './keyboard';
import { ResourceFilesModel, type ResourcePanelFilterMode } from './files_model';
import type { ProjectContentIndex } from './content_index';
import type { SerializedResourcePanel } from './session';
import { findProjectContentEditor, openProjectContent, prepareProjectContent, resolveProjectContentDestination } from './open_actions';
import { WORKBENCH_ICON_SIZE } from '../../../ui/icon';
import { WorkbenchTreeNavigationResult, type WorkbenchTreeNavigation, type WorkbenchTreeNode } from '../../../ui/tree_view';
import type { FileElement } from './files_model';
import { ResourcePanelContextMenu } from './context_menu';
import { findEditorGroup } from '../../../services/editor/editor_group';
import { ResourcePanelDrag } from './drag';
import { editorTextModelService } from '../../../../editor/model/model_service';
import { editorRuntimeState } from '../../../../editor/common/runtime_state';
import { isAltDown } from '../../../../input/keyboard/key_input';
import type { ProspectiveEditorOpenSource } from '../../../services/editor/editor_opening';
import { WorkbenchSplitControl } from '../../../ui/split_control';
import { WorkbenchSplitView } from '../../../ui/split_view';

export type ResourcePanelItemMetrics = {
	fontVariant: FontVariant | null;
	line: string;
	contentStartColumn: number;
	contentText: string;
	indentWidth: number;
	contentWidth: number;
	markerStartWidth: number;
	markerEndWidth: number;
};

const RESOURCE_SCROLLBARS = ['resourceVertical', 'resourceHorizontal'] as const;

export type ResourcePanelRestoreRequest = {
	restore(state: SerializedResourcePanel): boolean;
	focus(): void;
	dispose(): void;
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
		contentText: '',
		indentWidth: 0,
		contentWidth: 0,
		markerStartWidth: 0,
		markerEndWidth: 0,
	};
}

export class ResourcePanelController implements PointerHoverTarget {
	public readonly statusItems: readonly WorkbenchStatusItem[] = [
		{ text: '', alignment: 'left', priority: STATUS_PRIORITY_CONTENT, overflow: 'ellipsis', tone: 'normal' },
		{ text: 'CTRL+SHIFT+L TOGGLE FILTER', alignment: 'right', priority: STATUS_PRIORITY_HINT, overflow: 'hide', tone: 'normal' },
	];
	public updateStatus(): void { this.statusItems[0].text = this.getFilterMode() === 'lua_only' ? 'FILES (LUA)' : 'FILES (ALL)'; }
	public onPointerLeave(): void { this.hoverIndex = -1; }
	public visible = false;
	public readonly focusTarget = inputFocus.createTarget();
	public readonly split: WorkbenchSplitView;
	public readonly sash: WorkbenchSplitControl;
	private sashAttached = false;
	private filterMode: ResourcePanelFilterMode = 'lua_only';
	private fontLineHeight: number;
	public get lineHeight(): number { return Math.max(this.fontLineHeight, WORKBENCH_ICON_SIZE) + 2; }
	private fontVariant: FontVariant | null = null;

	public readonly files = new ResourceFilesModel();
	private filesMaxWidth = 0;
	private filesWidthRevision = -1;
	private filesWidthFont: FontVariant | null = null;
	public get itemCount(): number { return this.files.tree.rows.length; }
	public get scroll(): number { return this.files.tree.scroll; }
	public set scroll(value: number) { this.files.tree.scroll = value; }
	public get hscroll(): number { return this.files.horizontalScroll; }
	public set hscroll(value: number) { this.files.horizontalScroll = value; }
	public get selectionIndex(): number { return this.files.tree.selectionIndex; }
	public set selectionIndex(value: number) { this.files.tree.selectionIndex = value; }
	public get hoverIndex(): number { return this.files.tree.hoverIndex; }
	public set hoverIndex(value: number) { this.files.tree.hoverIndex = value; }
	public get maxLineWidth(): number { return this.filesMaxWidth; }
	private pendingSelectionIdentity: ResourceIdentity = null;
	private selectionRevealRevision = -1;
	private readonly bounds: RectBounds = create_rect_bounds();
	public readonly layout: ResourcePanelLayout = createResourcePanelLayout(this.bounds);
	public readonly resizeBounds = this.layout.resizeBounds;
	private readonly filesMetrics = new ScratchBuffer<ResourcePanelItemMetrics>(createResourcePanelItemMetrics);
	private readonly scrollbarController: ScrollbarController<'resourceVertical' | 'resourceHorizontal'>;
	public readonly resourceVertical: Scrollbar;
	public readonly resourceHorizontal: Scrollbar;
	private readonly unbindKeyboard: () => void;
	private readonly unbindResize: () => void;
	private readonly unbindNativeResize: () => void;
	private readonly unbindFocus: () => void;
	private readonly unbindBlur: () => void;
	private readonly changeListeners = new Set<() => void>();
	private restoreRevision = 0;
	private disposed = false;
	private readonly contextMenu: ResourcePanelContextMenu;
	private drag: ResourcePanelDrag | undefined;
	private readonly unbindModelClear: () => void;

	constructor(
		private readonly editor: CartEditor,
		private readonly catalog: WorkspaceSourceCatalog,
		scrollbars: ResourcePanelScrollbars,
		initialWidthRatio: number,
		private readonly content: ProjectContentIndex,
	) {
		this.fontLineHeight = editorViewState.lineHeight;
		this.split = new WorkbenchSplitView(clampResourcePanelRatio(initialWidthRatio));
		this.sash = new WorkbenchSplitControl(inputFocus, pointerCapture, pointerHover, this.focusTarget,
			new InputFocusScope(Symbol('Files resize'), this.focusTarget.scope));
		this.unbindResize = this.split.onDidChangeRatio(() => this.prepareLayout());
		this.unbindNativeResize = this.split.onDidResize(() => { this.restoreRevision++; this.changed(); });
		this.unbindFocus = this.focusTarget.onDidFocus(() => { this.restoreRevision++; this.changed(); });
		this.unbindBlur = this.focusTarget.onDidBlur(() => this.changed());
		this.resourceVertical = scrollbars.resourceVertical;
		this.resourceHorizontal = scrollbars.resourceHorizontal;
		this.scrollbarController = new ScrollbarController(scrollbars, (kind, scroll) => {
			if (kind === 'resourceVertical') this.setScroll(scroll); else this.setHScroll(scroll);
		}, pointerCapture);
		this.focusTarget.canFocus = () => this.visible && !this.disposed;
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => handleResourcePanelKeyboardInput(input, this));
		this.contextMenu = new ResourcePanelContextMenu(editor, catalog, content, this);
		this.unbindModelClear = editorTextModelService.onWillClear(() => {
			this.drag?.cancel(); this.focusTarget.scope.retireContext();
		});
		this.focusTarget.registerCommand('resources.openToSide', {
			isEnabled: () => {
				const kind = this.files.selectedNode?.element.kind;
				return this.isVisible() && (kind === 'file' || kind === 'definition');
			},
			run: editorContext => { if (this.focusTarget.hasFocus) this.openSelected('side', editorContext); },
		});
		this.focusTarget.registerCommand('contextMenu', {
			isEnabled: () => this.isVisible() && this.files.selectedNode !== null,
			run: () => {
				const layout = this.prepareLayout(), index = this.selectionIndex;
				this.showContextMenu(index, layout.contentLeft, layout.contentTop + (index - (this.scroll | 0) + 1) * this.lineHeight, true);
			},
		});
	}

	public dispose(): void {
		this.disposed = true; this.restoreRevision++;
		this.unbindFocus(); this.unbindBlur(); this.unbindNativeResize();
		this.hide(); this.sash.dispose(); this.unbindResize(); this.focusTarget.release(); this.unbindKeyboard(); this.unbindModelClear(); this.content.dispose();
		this.changeListeners.clear();
	}

	public onDidChange(listener: () => void): () => void {
		this.changeListeners.add(listener);
		return () => { this.changeListeners.delete(listener); };
	}
	private changed(): void { for (const listener of this.changeListeners) listener(); }
	/** New browser interaction retires recovery and an older explicit file-reveal request. */
	private acceptBrowserIntent(): void { this.restoreRevision++; this.pendingSelectionIdentity = null; }

	public serialize(previous?: SerializedResourcePanel): SerializedResourcePanel {
		const view = this.files.captureView(this.content, previous?.view), focused = this.isFocused();
		if (previous !== undefined && previous.visible === this.visible && previous.filter === this.filterMode
			&& previous.widthRatio === this.split.ratio && previous.focused === focused && previous.view === view) return previous;
		return { visible: this.visible, filter: this.filterMode, widthRatio: this.split.ratio, focused, view };
	}

	/** Recovery applies inert browser state once; native focus remains a separate admitted operation. */
	public beginRestore(): ResourcePanelRestoreRequest {
		const revision = ++this.restoreRevision, context = this.focusTarget.scope.contextGeneration;
		const interaction = inputFocus.interactionRevision;
		let active = true, applied = false, focused = false;
		const isCurrent = () => active && !this.disposed && this.restoreRevision === revision
			&& this.focusTarget.scope.contextGeneration === context;
		return {
			restore: state => {
				if (!isCurrent() || applied) return false;
				applied = true; focused = state.focused;
				this.pendingSelectionIdentity = null;
				this.visible = state.visible; this.filterMode = state.filter; this.split.ratio = state.widthRatio;
				this.content.sync();
				if (!isCurrent()) return false;
				this.files.sync(this.catalog, this.filterMode, this.content.entriesByResource, this.content.revision);
				if (!isCurrent()) return false;
				this.files.restoreView(state.view, this.content);
				if (!isCurrent()) return false;
				this.updateFilesMetrics(); this.prepareLayout();
				return isCurrent();
			},
			focus: () => {
				if (applied && focused && isCurrent() && inputFocus.interactionRevision === interaction && this.visible) this.focusTarget.focus();
			},
			dispose: () => { active = false; },
		};
	}

	public update(now: number): void { this.drag?.advance(now); }

	public handleScrollbarPointer(snapshot: PointerSnapshot): boolean {
		return this.isVisible() && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.bounds)
			&& this.scrollbarController.begin(RESOURCE_SCROLLBARS, snapshot, this.fontLineHeight);
	}

	public setFontMetrics(font: EditorFont): void {
		if (this.fontVariant === font.variant) return;
		pointerHover.release(this);
		this.fontVariant = font.variant;
		this.fontLineHeight = font.lineHeight;
		this.files.tree.layout.indentWidth = this.files.tree.layout.twistieWidth = Math.max(font.advance(' ') * 2, WORKBENCH_ICON_SIZE + 2);
		this.updateFilesMetrics();
	}

	// === Panel lifecycle ===
	isVisible(): boolean { return this.bounds.right > this.bounds.left && this.bounds.bottom > this.bounds.top; }
	isFocused(): boolean { return this.focusTarget.hasFocus; }
	setFocused(focused: boolean): void {
		if (focused) {
			this.focusTarget.focus();
		} else if (this.focusTarget.hasFocus) {
			const group = this.editor.editorParts.activeGroup, activePane = group.panes.activePane;
			const bounds = group.panes.contentBounds;
			if (activePane === null || bounds.right === bounds.left || bounds.bottom === bounds.top) this.focusTarget.release();
			else activePane.focus();
		}
	}
	getFilterMode(): 'lua_only' | 'all' { return this.filterMode; }

	togglePanel(): void { this.visible ? this.hide() : this.show(); }

	show(): void {
		this.restoreRevision++;
		const changed = !this.visible;
		this.drag?.cancel();
		this.contextMenu.close(); this.focusTarget.scope.retireContext();
		pointerHover.release(this);
		this.files.tree.hoverIndex = -1;
		this.visible = true;
		this.refresh();
		this.focusTarget.focus();
		if (changed) this.changed();
	}

	hide(): void {
		this.acceptBrowserIntent();
		const changed = this.visible;
		this.drag?.cancel();
		this.contextMenu.close(); this.focusTarget.scope.retireContext();
		this.scrollbarController.cancel();
		pointerHover.release(this);
		this.visible = false;
		this.setFocused(false);
		this.prepareLayout();
		if (changed) this.changed();
	}

	toggleFilterMode(): void {
		this.restoreRevision++;
		this.drag?.cancel();
		this.contextMenu.close(); this.focusTarget.scope.retireContext();
		this.filterMode = this.filterMode === 'lua_only' ? 'all' : 'lua_only';
		if (this.visible) this.refresh();
		this.changed();
		const modeLabel = this.filterMode === 'lua_only' ? 'Lua resources' : 'all resources';
		showEditorMessage(`Files panel: showing ${modeLabel}`, 'info', 2.5);
	}

	// === Rendering ===
	draw(): void {
		if (!this.isVisible()) return;
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
		this.acceptBrowserIntent();
		const next = clampResourcePanelSelectionIndex(index, this.itemCount);
		if (next === this.selectionIndex) return;
		this.selectionIndex = next;
		this.hoverIndex = -1;
		this.ensureSelectionVisible();
		this.changed();
	}

	/** Press retains a real tree subject; neither hover nor a pending click produces an editor. */
	public beginResourceDrag(index: number, snapshot: PointerInputSnapshot): void {
		const node = this.files.tree.rows[index], element = node.element;
		if (element.kind !== 'file' && element.kind !== 'definition') return;
		this.setSelectionIndex(index);
		const resource = element.kind === 'file' ? element.resource : element.content.ownerResource;
		const entry = element.kind === 'definition' ? element.content : undefined;
		const key = resourceIdentityKey(resource), context = this.focusTarget.scope.contextGeneration;
		const invoking = this.editor.editorParts.activeGroup;
		const editorId = entry === undefined ? this.editor.resourceEditors.getEditorId(resource) : undefined;
		const identity = entry === undefined ? { resource, editorId: editorId! } : undefined;
		const source: ProspectiveEditorOpenSource = {
			kind: 'opening',
			isCurrent: () => (entry === undefined || this.content.isCurrent(entry)) && this.isVisible()
				&& this.focusTarget.scope.contextGeneration === context && this.catalog.resourceByIdentity.get(key) === resource,
			findExisting: group => entry === undefined ? group.model.findByResourceEditor(identity!)
				: findProjectContentEditor(this.editor, entry, group),
			resolve: entry === undefined ? async () => ({ input: await this.editor.resourceEditors.resolveEditorInput(resource, editorId) })
				: group => prepareProjectContent(this.editor, this.content, entry, group, source.isCurrent),
		};
		this.drag ??= new ResourcePanelDrag(this.editor.editorParts.dropTarget);
		this.drag.begin(source, snapshot, editorRuntimeState.currentTimeMs, released => {
			if (!this.focusTarget.hasFocus) return;
			const hit = this.indexAtPosition(released.viewportX, released.viewportY);
			if (hit < 0 || this.files.tree.rows[hit] !== node || this.isDisclosureHit(hit, released.viewportX)) return;
			this.setSelectionIndex(hit);
			this.openSelected(isAltDown(released) ? 'side' : 'default', invoking.focusTarget);
		});
	}

	isDisclosureHit(index: number, viewportX: number): boolean {
		const expandable = this.files.tree.rows[index].expandable;
		if (!expandable) {
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
		this.acceptBrowserIntent();
		const previous = this.scroll;
		const layout = this.prepareLayout();
		if (layout !== null) this.scroll = clamp(scroll, 0, layout.maxVerticalScroll);
		if (previous !== this.scroll) this.changed();
	}

	setHScroll(scroll: number): void {
		this.acceptBrowserIntent();
		const previous = this.hscroll;
		const layout = this.prepareLayout();
		if (layout !== null) this.hscroll = clamp(scroll, 0, layout.maxHorizontalScroll);
		if (previous !== this.hscroll) this.changed();
	}

	scrollBy(amount: number): void {
		this.acceptBrowserIntent();
		const previous = this.scroll, horizontal = this.hscroll;
		const layout = this.prepareLayout();
		if (layout !== null) this.scroll = clamp(this.scroll + amount, 0, layout.maxVerticalScroll);
		this.clampHScroll();
		if (previous !== this.scroll || horizontal !== this.hscroll) this.changed();
	}

	openSelected(placement: 'default' | 'side' = 'default', editorContext?: InputFocusTarget): void {
		const selected = this.files.selectedNode;
		if (selected === null) return;
		const element = selected.element;
		if (element.kind !== 'file' && element.kind !== 'definition') {
			if (placement === 'default') this.toggleFileDisclosure(selected);
			return;
		}
		const resource = element.kind === 'file' ? element.resource : element.content.ownerResource;
		const entry = element.kind === 'definition' ? element.content : undefined;
		const origin = inputFocus.admittedTarget;
		if (origin === null) return;
		const invoking = findEditorGroup(editorContext === undefined ? origin : editorContext);
		if (invoking === null) return;
		const parts = this.editor.editorParts, reference = invoking ?? parts.activeGroup, part = parts.partForGroup(reference);
		const scope = origin.scope, context = scope.contextGeneration, generation = reference.panes.openGeneration;
		const filesContext = this.focusTarget.scope.contextGeneration, revision = this.files.revision;
		// Draft and topology callbacks retain this subject, never the row selected afterwards.
		const current = (): boolean => {
			const subject = entry === undefined ? this.catalog.resolveResource(resource) === resource : this.content.isCurrent(entry);
			const focused = inputFocus.admittedTarget;
			return subject && this.isVisible() && this.files.revision === revision
				&& this.focusTarget.scope.contextGeneration === filesContext && scope.contextGeneration === context
				&& parts.partForGroup(reference) === part && !part.surface.retired && reference.openingAdmitted && part.operation === 'none'
				&& reference.panes.openGeneration === generation && (focused === null || scope.contains(focused.scope));
		};
		if (!reference.commitPendingEdit() || !current()) return;
		const editorId = entry === undefined ? this.editor.resourceEditors.getEditorId(resource) : undefined;
		const destination = placement === 'side' ? parts.sideGroup(reference)
			: entry === undefined ? parts.editorDestination(reference, { resource, editorId: editorId! })
				: resolveProjectContentDestination(this.editor, entry, reference);
		if (destination === undefined || !current()) return;
		if (entry === undefined) void this.editor.navigation.openResource(destination, resource, { editorId });
		else {
			const settledOrigin = inputFocus.admittedTarget;
			if (settledOrigin !== null) openProjectContent(this.editor, this.content, entry, destination, settledOrigin);
		}
	}

	public toggleSelectedFileDisclosure(): void {
		const node = this.files.selectedNode;
		if (node !== null) this.toggleFileDisclosure(node);
	}

	public toggleFileDisclosure(node: WorkbenchTreeNode<FileElement>): void {
		this.acceptBrowserIntent();
		if (this.files.toggle(this.files.tree.rows.indexOf(node))) { this.updateFilesMetrics(); this.ensureSelectionVisible(); this.changed(); }
	}

	public showContextMenu(index: number, x: number, y: number, keyboard: boolean): void {
		if (index < 0) return;
		const node = this.files.tree.rows[index];
		this.setSelectionIndex(index);
		this.contextMenu.open(node, x, y, keyboard);
	}

	/** Surface retirement withdraws this attachment without discarding its requested width. */
	public retireResize(): void {
		if (!this.sashAttached) return;
		this.sashAttached = false;
		pointerCapture.cancelScope(this.sash.focusTarget.scope.surfaceScope);
		this.sash.clearInput();
	}

	// === Internals ===
	/** Publish Files catalog and reading geometry without replacing its browser identity. */
	public refresh(): boolean {
		if (!this.visible) return false;
		const previousInset = editorViewState.editorAreaLeft;
		let reveal = false;
		if (this.editor.isActive) {
			this.content.sync();
			const changed = this.files.sync(this.catalog, this.filterMode, this.content.entriesByResource, this.content.revision);
			if (this.pendingSelectionIdentity !== null && this.selectionRevealRevision !== this.files.revision) {
				this.selectionRevealRevision = this.files.revision;
				reveal = this.files.reveal(this.pendingSelectionIdentity);
				if (reveal) this.pendingSelectionIdentity = null;
			}
			this.updateFilesMetrics();
			if (changed || reveal) pointerHover.release(this);
		}
		if (this.prepareLayout() !== null && reveal) this.ensureSelectionVisible();
		if (reveal) this.changed();
		return editorViewState.editorAreaLeft !== previousInset;
	}

	public navigateFiles(command: WorkbenchTreeNavigation): void {
		this.acceptBrowserIntent();
		this.prepareLayout();
		const result = this.files.navigate(command);
		if (result === WorkbenchTreeNavigationResult.Collapse) this.updateFilesMetrics();
		if (result !== WorkbenchTreeNavigationResult.None) this.ensureSelectionVisible();
		if (result !== WorkbenchTreeNavigationResult.None) this.changed();
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

	queuePendingSelection(identity: ResourceIdentity): void {
		this.restoreRevision++;
		this.pendingSelectionIdentity = identity;
		this.selectionRevealRevision = -1;
	}

	applyPendingSelection(): void {
		if (!this.isVisible() || this.pendingSelectionIdentity === null) return;
		this.selectionRevealRevision = this.files.revision;
		if (!this.files.reveal(this.pendingSelectionIdentity)) return;
		this.pendingSelectionIdentity = null;
		this.updateFilesMetrics(); this.ensureSelectionVisible();
		this.changed();
	}

	public ensureSelectionVisible(): void {
		const layout = this.prepareLayout();
		if (layout === null) return;
		this.scroll = ensureResourcePanelSelectionScroll(this.selectionIndex, this.scroll, layout.capacity, this.itemCount);
		this.clampHScroll();
	}

	public getBounds(): RectBounds {
		return this.isVisible() ? this.bounds : null;
	}

	public prepareLayout(): ResourcePanelLayout {
		if (this.visible && this.editor.isActive) writeResourcePanelBounds(this.bounds, this.split);
		else write_rect_bounds(this.bounds, 0, 0, 0, 0);
		const layout = writeResourcePanelLayout(this.layout, this.itemCount, this.maxLineWidth, this.lineHeight);
		this.resourceVertical.layout(layout.verticalTrack, this.itemCount, layout.capacity, this.scroll);
		this.resourceHorizontal.layout(layout.horizontalTrack, Math.max(this.maxLineWidth, layout.availableWidth), layout.availableWidth, this.hscroll);
		editorViewState.editorAreaLeft = this.bounds.right - this.bounds.left;
		if (this.isVisible()) {
			if (!this.sashAttached) { this.sash.setInput(this.split); this.sashAttached = true; }
			this.scroll = this.resourceVertical.getScroll();
			this.hscroll = this.resourceHorizontal.getScroll();
		} else {
			pointerHover.release(this);
			this.retireResize();
			if (!this.visible) this.focusTarget.release();
		}
		const tree = this.files.tree.layout;
		tree.contentLeft = layout.contentLeft; tree.contentTop = layout.contentTop;
		tree.contentRight = layout.contentRight; tree.contentBottom = layout.effectiveBottom;
		tree.rowHeight = this.lineHeight; tree.visibleRowCount = layout.capacity;
		return this.isVisible() ? layout : null;
	}

	public getItemMetrics(index: number): ResourcePanelItemMetrics {
		const node = this.files.tree.rows[index], item = node.element;
		const metrics = this.filesMetrics.get(index);
		if (
			metrics.line === item.line
			&& metrics.contentStartColumn === item.contentStartColumn
		) {
			if (metrics.fontVariant === this.fontVariant) return metrics;
		} else {
			metrics.line = item.line;
			metrics.contentStartColumn = item.contentStartColumn;
			metrics.contentText = item.label;
		}
		metrics.fontVariant = this.fontVariant;
		metrics.indentWidth = (node.depth + 1) * this.files.tree.layout.indentWidth;
		metrics.contentWidth = measureTextRange(metrics.contentText, 0, metrics.contentText.length);
		metrics.markerStartWidth = metrics.indentWidth - this.files.tree.layout.twistieWidth;
		metrics.markerEndWidth = metrics.indentWidth;
		return metrics;
	}

	public computeMaxHScroll(): number {
		const layout = this.prepareLayout();
		return layout ? layout.maxHorizontalScroll : 0;
	}

	public clampHScroll(): void {
		const layout = this.prepareLayout();
		if (layout === null) return;
		const maxScroll = layout.maxHorizontalScroll;
		const current = this.hscroll;
		this.hscroll = clamp(current, 0, maxScroll);
	}
}
