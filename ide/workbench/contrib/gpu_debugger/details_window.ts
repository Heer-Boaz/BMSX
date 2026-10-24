import { clamp } from '../../../../machine/ts/common/clamp';
import { KeyModifier, type KeyInputEvent } from '../../../../hosts/common/input/text';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { formatNumberAsHex } from '../../../../machine/ts/common/byte_hex_string';
import { point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { HostOverlayTransform } from '../../../../machine/ts/render/host_overlay/transform';
import type { EditorCommandRunner } from '../../../common/commands';
import type { DisposableStore } from '../../../common/lifecycle';
import * as colors from '../../../common/constants';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyDown, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import { drawWorkbenchPropertyInspector } from '../../render/property_inspector';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import { WorkbenchPropertyInspector } from '../../ui/property_inspector/control';
import type { InspectedProperty } from '../../ui/property_inspector/model';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import { WorkbenchTooltip } from '../../ui/tooltip';
import { WorkbenchFloatingWindow } from '../../ui/window/control';
import { GpuDebugCanvas } from './diagram';
import type { GpuDebuggerInput, GpuInspectorPage } from './editor_input';
import { GpuDebugPresentation, gpuOperationName, type GpuDebugView } from './presentation';

const NO_SELECTION: readonly InspectedProperty[] = [{ label: 'No operation selected', value: '',
	description: 'Select an emitted operation to inspect its captured words.', warning: false }];
const NAVIGATION = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'] as const;
const VIEWS: { label: string; description: string; detail: string; page: GpuInspectorPage; view?: GpuDebugView }[] = [
	{ label: 'Properties', description: 'Decoded parameters and latched drawing state', detail: '', page: 'properties' },
	{ label: 'Geometry', description: 'Drawing coordinates and latched bounds', detail: '', page: 'diagram', view: 'geometry' },
	{ label: 'UV', description: 'Raw UV coordinates; no historical texture image', detail: '', page: 'diagram', view: 'uv' },
	{ label: 'Color', description: 'Supplied RGB bytes, not rendered pixel colors', detail: '', page: 'diagram', view: 'color' },
	{ label: 'Words', description: 'Every active captured operation word', detail: '', page: 'words' },
];

/** The sole optional observation presentation. Snapshot identity remains with the input. */
export class GpuDetailsWindow {
	public readonly window: WorkbenchFloatingWindow;
	public readonly inspector: WorkbenchPropertyInspector<InspectedProperty>;
	public readonly presentation = new GpuDebugPresentation();
	public readonly canvas = new GpuDebugCanvas();
	public readonly diagram: WorkbenchScrollControl;
	public readonly words: WorkbenchScrollControl;
	public readonly contentActions: WorkbenchActionBarControl;
	private readonly transform: HostOverlayTransform = { scale: 1, offsetX: 0, offsetY: 0 };
	private readonly tooltip = new WorkbenchTooltip();
	private readonly wordRows: { index: number; label: string }[] = [];
	private chooser: DisposableStore | undefined;
	private overflow: DisposableStore | undefined;
	private readonly unbindSelection: () => void;
	private activePage: GpuInspectorPage | undefined;
	private propertiesRevision = -1;
	private propertyItems: readonly InspectedProperty[] = NO_SELECTION;
	private captionRevision = -1;
	private expired = false;
	private titleTooltip = '';
	private diagramRevision = -1;
	private diagramWidth = -1;
	private diagramHeight = -1;
	private diagramFont: typeof editorViewState.font | undefined;
	private diagramView: GpuDebugView | undefined;
	private projectedScroll: number | undefined;
	private wordRevision = -1;
	private wordFirst = -1;
	private wordEnd = -1;

	public constructor(private readonly input: GpuDebuggerInput, commands: EditorCommandRunner,
		private readonly quickInput: QuickInputController, private readonly contextMenu: ContextMenuController,
		private readonly surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface,
		private readonly focusReturn: InputFocusTarget, private readonly workArea: Readonly<RectBounds>) {
		this.window = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, surfaces, commands, {
			model: input.detailsWindow, actionBar: input.detailsActions, lifetimeOwner: owner, focusReturn, workArea,
			getTitleTooltip: () => this.titleTooltip,
			content: {
				draw: () => this.draw(),
				handlePointer: snapshot => {
					if (this.contentActions.handlePointer(snapshot)) return;
					if (this.activePage === 'properties') { this.inspector.handlePointer(snapshot); return; }
					if (this.activePage === 'words') {
						this.words.handlePointer(snapshot);
						if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0 && point_in_rect(snapshot.viewportX, snapshot.viewportY, input.words.bounds)) {
							const index = Math.trunc((snapshot.viewportY - input.words.offsetTop) / editorViewState.lineHeight);
							if (index < input.selected.wordCount) { input.following = false; input.selectedWord = index; }
						}
						return;
					}
					this.diagram.handlePointer(snapshot);
					if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0 && point_in_rect(snapshot.viewportX, snapshot.viewportY, input.diagram.bounds)) {
						const point = this.canvas.hit(snapshot.viewportX - input.diagram.bounds.left, snapshot.viewportY - input.diagram.offsetTop);
						if (point >= 0) { input.following = false; input.selectedPoint = point; }
					}
				},
				handleWheel: event => this.activePage === 'properties' ? this.inspector.handleWheel(event, event.deltaY * editorViewState.lineHeight * 3)
					: (this.activePage === 'words' ? this.words : this.diagram).handleWheel(event, event.deltaY * editorViewState.lineHeight * 3),
			},
			layoutContent: bounds => this.layoutClient(bounds), restoreContentInput: () => this.refreshClient(),
			retireContentInput: () => { this.retireChooser(); this.retireOverflow(); this.tooltip.detach(); this.contentActions.clearInput(); this.retireClient(); },
			focusContent: () => this.contentTarget().focus(), onDidHide: () => this.retireChooser(),
		});
		this.inspector = new WorkbenchPropertyInspector(inputFocus, pointerCapture, pointerHover, this.window.clientFocusTarget, 'client');
		this.diagram = new WorkbenchScrollControl(inputFocus, pointerCapture, this.window.clientFocusTarget,
			event => this.handleDiagramKeyboard(event), this.window.clientScope.surfaceScope);
		this.words = new WorkbenchScrollControl(inputFocus, pointerCapture, this.window.clientFocusTarget,
			event => this.handleWordKeyboard(event), this.window.clientScope.surfaceScope);
		this.diagram.onWillScroll = () => { input.following = false; this.projectedScroll = undefined; };
		this.words.onWillScroll = () => { input.following = false; };
		this.contentActions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.window.clientFocusTarget,
			() => this.contentTarget().focus(), contextMenu);
		this.contentActions.onDidOpenOverflow = lifetime => {
			this.tooltip.hide(); this.overflow = lifetime; lifetime.add({ dispose: () => { if (this.overflow === lifetime) this.overflow = undefined; } });
		};
		for (const target of [this.window.focusTarget, this.inspector.focusTarget, this.diagram.focusTarget, this.words.focusTarget]) {
			target.registerCommand('gpu.view', { isEnabled: () => input.detailsWindow.open, run: () => this.chooseView() });
			if (target !== this.window.focusTarget) for (const command of ['window.collapse', 'window.hide'] as const)
				target.registerCommand(command, this.window.focusTarget.getCommand(command)!);
		}
		this.words.focusTarget.clipboard = { readOnly: true, copy: () => input.selected.sequence < 0 ? null : formatNumberAsHex(input.selected.words[input.selectedWord], 8) };
		this.unbindSelection = input.onWillChangeSelection(() => {
			this.retireChooser(); this.retireOverflow(); this.contentActions.cancelPointer();
			this.retireClient();
		});
	}

	public show(): void { this.input.detailsWindow.open = true; this.update(); this.window.show(); }
	public dispose(): void {
		this.retireChooser(); this.retireOverflow(); this.unbindSelection(); this.window.dispose();
		this.inspector.dispose(); this.diagram.dispose(); this.words.dispose(); this.contentActions.dispose();
		this.tooltip.detach();
	}

	public chooseView(): void {
		if (!this.window.visible) this.show();
		if (this.input.detailsWindow.collapsed) this.window.setCollapsed(false);
		this.update();
		this.quickInput.pick('GPU view', 'Choose captured operation evidence', (_origin, lifetime) => {
			this.chooser = lifetime; lifetime.add({ dispose: () => { if (this.chooser === lifetime) this.chooser = undefined; } });
			return new TextQuickPickProvider(VIEWS, VIEWS.findIndex(choice => choice.page === this.input.inspectorPage
				&& (choice.view === undefined || choice.view === this.input.view)));
		}, choice => {
			this.retireOverflow(); this.contentActions.cancelPointer(); this.retireClient();
			if (choice.view !== undefined && choice.view !== this.input.view) {
				this.input.diagram.scrollbar.setScroll(0); this.input.diagramView.section = 0;
				this.input.diagramView.textOffset = 0; this.input.diagramView.fraction = 0; this.input.diagramView.atEnd = false;
				this.input.selectedPoint = 0; this.input.view = choice.view;
			}
			this.input.inspectorPage = choice.page; this.refreshClient(); this.layoutClient(this.input.detailsWindow.client); this.contentTarget().focus();
		});
	}
	private retireChooser(): void { if (this.chooser !== undefined) this.quickInput.hide(); }
	private retireOverflow(): void { if (this.overflow !== undefined) this.contextMenu.hide(); }

	private retireClient(): void {
		if (this.activePage === 'properties') this.inspector.model.saveViewState(this.input.detailsView);
		if (this.activePage === 'diagram') this.saveDiagramView();
		this.inspector.hide(); this.diagram.clearInput(); this.words.clearInput(); this.activePage = undefined;
	}
	/** Reflow projects the same source anchor; only a new scroll intent replaces it. */
	private saveDiagramView(): void {
		const input = this.input;
		if (this.diagramRevision !== input.selectionRevision || this.diagramView !== input.view || this.projectedScroll === input.diagram.scrollTop) return;
		this.canvas.saveViewState(input.diagram, input.diagramView); this.projectedScroll = input.diagram.scrollTop;
	}
	private refreshClient(): void {
		const input = this.input;
		const pageChanged = this.activePage !== input.inspectorPage;
		if (pageChanged) {
			this.retireClient(); this.activePage = input.inspectorPage;
			if (this.activePage === 'diagram') this.diagram.setInput(input.diagram);
			else if (this.activePage === 'words') this.words.setInput(input.words);
		}
		if (this.activePage !== 'words') this.presentation.update(input.selected, input.selectionRevision, input.view);
		if (this.activePage === 'properties') {
			const changed = this.propertiesRevision !== input.selectionRevision;
			if (changed) {
				this.propertyItems = input.selected.sequence < 0 ? NO_SELECTION : this.presentation.details(input.selected);
				this.propertiesRevision = input.selectionRevision;
			}
			if (!this.inspector.visible) {
				this.inspector.show({ title: '', items: this.propertyItems,
					dismissible: false, focusReturn: this.focusReturn, canOpenSource: () => false, openSource() {} }, false);
				this.inspector.model.restoreViewState(input.detailsView);
			} else if (changed) {
				this.inspector.replaceItems(this.propertyItems);
				this.inspector.model.restoreViewState(input.detailsView);
			}
			this.inspector.attachFeedback(this.surfaces, this.window.clientSurface!, this.workArea);
		}
		this.contentActions.setInput(input.inspectorActions, this.window.focusTarget);
		this.tooltip.attach(this.surfaces, this.window.clientSurface!, this.workArea);
		if (pageChanged) {
			const target = this.contentTarget();
			this.window.actionFocusTarget.next = this.contentActions.focusTarget; this.contentActions.focusTarget.previous = this.window.actionFocusTarget;
			this.contentActions.focusTarget.next = target; target.previous = this.contentActions.focusTarget; target.next = this.window.focusTarget;
			this.window.focusTarget.previous = target;
			if (this.activePage === 'properties') this.inspector.setFocusOrder(this.contentActions.focusTarget, this.window.focusTarget);
		}
	}
	private contentTarget(): InputFocusTarget {
		return this.activePage === 'properties' ? this.inspector.focusTarget : this.activePage === 'diagram' ? this.diagram.focusTarget : this.words.focusTarget;
	}

	private layoutClient(bounds: Readonly<RectBounds>): void {
		const input = this.input, font = editorViewState.font.renderFont(), row = Math.max(font.lineHeight, WORKBENCH_ICON_SIZE) + 6;
		const action = input.inspectorActions.items[0];
		action.label = input.inspectorPage === 'properties' ? 'Properties' : input.inspectorPage === 'words' ? 'Words'
			: input.view === 'geometry' ? 'Geometry' : input.view === 'uv' ? 'UV' : 'Color';
		layoutWorkbenchActionBar(input.inspectorActions, bounds.right - 4, bounds.top + 2, bounds.top + row - 2,
			measureText, font, bounds.left + 4);
		write_rect_bounds(input.inspectorBounds, bounds.left + 4, bounds.top + row + 2, bounds.right - 4, bounds.bottom - 4);
		const content = input.inspectorBounds;
		this.diagram.lineStep = this.words.lineStep = font.lineHeight;
		if (this.activePage === 'properties') this.inspector.layout(font, measureTextRange, measureText, content);
		else if (this.activePage === 'diagram') {
			const width = content.right - content.left - colors.SCROLLBAR_WIDTH, height = content.bottom - content.top;
			if (this.diagramRevision !== input.selectionRevision || this.diagramWidth !== width || this.diagramHeight !== height
				|| this.diagramFont !== editorViewState.font || this.diagramView !== input.view) {
				this.saveDiagramView();
				this.canvas.layout(input, this.presentation, font, width, height);
				input.diagram.layout(content.left, content.top, content.right, content.bottom, this.canvas.contentHeight);
				this.canvas.restoreViewState(input.diagram, input.diagramView);
				this.projectedScroll = input.diagram.scrollTop;
				this.diagramRevision = input.selectionRevision; this.diagramWidth = width; this.diagramHeight = height;
				this.diagramFont = editorViewState.font; this.diagramView = input.view;
			} else input.diagram.layout(content.left, content.top, content.right, content.bottom, this.canvas.contentHeight);
		} else {
			const scroll = input.wordsRowHeight === 0 ? input.words.scrollTop : input.words.scrollTop / input.wordsRowHeight * font.lineHeight;
			input.words.layout(content.left, content.top, content.right, content.bottom, input.selected.wordCount * font.lineHeight);
			input.words.scrollbar.setScroll(scroll); input.wordsRowHeight = font.lineHeight;
			this.updateWords();
		}
	}

	private updateWords(): void {
		const input = this.input, view = input.words, line = editorViewState.lineHeight;
		const first = Math.max(0, Math.trunc(view.scrollTop / line)), end = Math.min(input.selected.wordCount, Math.trunc((view.scrollTop + view.height + line - 1) / line));
		if (this.wordRevision === input.selectionRevision && this.wordFirst === first && this.wordEnd === end) return;
		let count = 0;
		for (let index = first; index < end; index++) {
			const label = `${formatNumberAsHex(index, 6)}  ${formatNumberAsHex(input.selected.words[index], 8)}`;
			const row = this.wordRows[count]; if (row === undefined) this.wordRows.push({ index, label }); else { row.index = index; row.label = label; }
			count++;
		}
		this.wordRows.length = count; this.wordRevision = input.selectionRevision; this.wordFirst = first; this.wordEnd = end;
	}

	public update(): void {
		const input = this.input, model = input.detailsWindow;
		if (!model.open) { this.window.detach(); return; }
		const font = editorViewState.font;
		model.setMinimumSize(editorViewState.charAdvance * 28 + 12, font.lineHeight * 12 + 44);
		if (!input.detailsPlacementInitialized) {
			const area = this.workArea, width = Math.max(model.minimumWidth, Math.round((area.right - area.left) * 0.70));
			const height = Math.max(model.minimumHeight, Math.round((area.bottom - area.top) * 0.72)), bottom = input.layout.bottom - 4;
			model.setRequestedBounds({ left: area.right - width - 4, top: bottom - height, right: area.right - 4, bottom });
			input.detailsPlacementInitialized = true;
		}
		const record = input.selected, expired = record.sequence >= 0 && (record.sequence < input.history.firstSequence || record.sequence >= input.history.endSequence);
		if (this.captionRevision !== input.selectionRevision || this.expired !== expired) {
			this.captionRevision = input.selectionRevision; this.expired = expired;
			model.title = record.sequence < 0 ? 'GPU Inspector' : `${gpuOperationName(record)} #${record.sequence}${expired ? ' (expired)' : ''}`;
			this.titleTooltip = record.sequence < 0 ? 'GPU Inspector — no operation selected'
				: `Emitted GPU operation #${record.sequence} / timeline ${record.timeline}\nObserved at ${record.cycles} cycles / tick ${record.completedTick}${expired ? '\nRecord expired; retained captured words.' : ''}`;
		}
		if (!this.window.visible) this.window.show(false);
		if (!model.collapsed) this.refreshClient();
		this.window.layout(font.renderFont(), measureTextRange, measureText);
		if (!model.collapsed) {
			this.layoutClient(model.client); this.contentActions.update(); if (this.activePage === 'properties') this.inspector.update();
			const item = this.contentActions.tooltipItem;
			if (item !== undefined) this.tooltip.show(item.tooltip, item.bounds, font.renderFont(), measureTextRange, measureText, this.workArea);
			else this.tooltip.hide();
		}
		this.window.update();
	}

	private escape(event: KeyInputEvent): boolean {
		if (event.modifiers !== KeyModifier.none || !isKeyJustPressed('Escape', event)) return false;
		this.window.focusTarget.handleKeyboard(event); return true;
	}
	private handleDiagramKeyboard(event: KeyInputEvent): boolean {
		if (this.escape(event)) return true;
		if (event.modifiers !== KeyModifier.none || !isKeyJustPressed('ArrowLeft', event) && !isKeyJustPressed('ArrowRight', event)) return false;
		consumeIdeKey(event.code, event);
		if (this.presentation.points.length > 0) {
			this.input.following = false;
			this.input.selectedPoint = clamp(this.input.selectedPoint + (event.code === 'ArrowLeft' ? -1 : 1), 0, this.presentation.points.length - 1);
		}
		return true;
	}
	private handleWordKeyboard(event: KeyInputEvent): boolean {
		if (this.escape(event)) return true;
		if (event.modifiers !== KeyModifier.none) return false;
		for (const key of NAVIGATION) if (isKeyDown(key, event)) {
			consumeIdeKey(key, event); const input = this.input;
			if (input.selected.wordCount === 0) return true;
			const page = Math.max(1, Math.trunc(input.words.height / editorViewState.lineHeight));
			input.selectedWord = clamp(key === 'Home' ? 0 : key === 'End' ? input.selected.wordCount - 1
				: input.selectedWord + (key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : key === 'PageUp' ? -page : page), 0, input.selected.wordCount - 1);
			input.following = false; input.words.scrollbar.reveal(input.selectedWord * editorViewState.lineHeight, (input.selectedWord + 1) * editorViewState.lineHeight, 0); return true;
		}
		return false;
	}

	private draw(): void {
		const input = this.input, font = editorViewState.font.renderFont(), client = input.detailsWindow.client;
		api.fill_rect(client.left, client.top, client.right, client.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
		renderWorkbenchActionBar(input.inspectorActions, font, colors.COLOR_RESOURCE_VIEWER_TEXT, colors.COLOR_DESCRIPTION_TEXT);
		if (this.activePage === 'properties') { drawWorkbenchPropertyInspector(this.inspector); return; }
		const view = this.activePage === 'diagram' ? input.diagram : input.words, bounds = view.bounds;
		api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
		if (this.activePage === 'diagram') {
			this.transform.offsetX = bounds.left; this.transform.offsetY = view.offsetTop;
			api.pushTransform(this.transform); this.canvas.draw(input, this.presentation, view.scrollTop, view.scrollTop + view.height); api.popTransform();
		} else if (input.selected.sequence < 0) api.blit_text_inline_with_font('No operation selected', bounds.left + 2, bounds.top + 2,
			0, colors.COLOR_DESCRIPTION_TEXT, font);
		else for (const row of this.wordRows) {
			const top = view.offsetTop + row.index * font.lineHeight, selected = row.index === input.selectedWord;
			if (selected) api.fill_rect(bounds.left, top, bounds.right, top + font.lineHeight, 0, colors.SELECTION_OVERLAY);
			api.blit_text_inline_with_font(row.label, bounds.left + 2, top, 0, selected ? colors.COLOR_SELECTION_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		}
		api.popClipRect(); view.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	}
}
