import type { EditorGroupView } from '../../services/editor/editor_group';
import { formatByteSize, formatNumberAsHex } from '../../../../machine/ts/common/byte_hex_string';
import { point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { KeyModifier, type KeyInputEvent } from '../../../../hosts/common/input/text';
import type { EditorCommandId, EditorCommandRunner } from '../../../common/commands';
import type { DisposableStore } from '../../../common/lifecycle';
import * as colors from '../../../common/constants';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyDown, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import type { RuntimeSourceState } from '../../../runtime/sources';
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
import { WorkbenchImageControl } from '../../ui/image_control';
import { WorkbenchPropertyInspector } from '../../ui/property_inspector/control';
import type { InspectedProperty } from '../../ui/property_inspector/model';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import { ScrollbarPointerControl } from '../../ui/scrollbar_pointer';
import { WorkbenchTooltip } from '../../ui/tooltip';
import { WorkbenchFloatingWindow } from '../../ui/window/control';
import type { EditorNavigationController } from '../resources/navigation';
import type { RomInspectorContentView } from './content_model';
import { drawRomInspectorContent, RomInspectorContentPresentation } from './content_presentation';
import type { RomInspectorInput } from './editor_input';
import type { RomInspectorByteRange, RomInspectorRow } from './model';

const READER_COMMANDS = ['romInspector.hold', 'romInspector.content', 'romInspector.zoom', 'romInspector.collision', 'romInspector.source'] as const;
const SUBJECT_COMMANDS = ['romInspector.content', 'romInspector.zoom', 'romInspector.collision', 'romInspector.source'] as const;
const RANGE_LABELS: Record<RomInspectorByteRange['kind'], string> = {
	data: 'Payload', metadata: 'Metadata', 'model-texture': 'Model texture', collision: 'Collision', header: 'Header',
	manifest: 'Manifest', toc: 'Table of contents', blua32: 'BLua32 image', asset: 'Asset', unreferenced: 'Unreferenced', instructions: 'Disassembly',
};
const ZOOM_OPTIONS = [
	{ label: 'Fit', description: 'Whole image', detail: '', scale: 'fit' as const },
	...[0.125, 0.25, 0.5, 1, 2, 4, 8, 16].map(scale => ({ label: `${scale * 100}%`, description: '', detail: '', scale })),
];
type ContentChoice = { label: string; description: string; detail: string } &
	({ view: 'info' | 'preview' } | { view: 'bytes'; range: RomInspectorByteRange; index: number });

/** One input-owned entry document; the window owns only its attached interaction and presentation. */
export class RomEntryInspectorWindow {
	public readonly window: WorkbenchFloatingWindow;
	public readonly inspector: WorkbenchPropertyInspector<InspectedProperty>;
	public readonly image: WorkbenchImageControl;
	public readonly bytes: WorkbenchScrollControl;
	public readonly viewActions: WorkbenchActionBarControl;
	public readonly presentation = new RomInspectorContentPresentation();
	private readonly horizontal: ScrollbarPointerControl;
	private readonly tooltip = new WorkbenchTooltip();
	private chooser: DisposableStore | undefined;
	private overflow: DisposableStore | undefined;
	private attachedView: RomInspectorContentView | undefined;
	private focusAfterClientChange = false;
	private infoRevision = -1;
	private clientRevision = -1;
	private captionSubject: RomInspectorRow | undefined;
	private titleTooltip = '';
	private measuredFont: typeof editorViewState.font | undefined;
	private rowHeight = 0;
	private clientLeft = -1;
	private clientTop = -1;
	private clientRight = -1;
	private clientBottom = -1;
	private clientFont: typeof editorViewState.font | undefined;

	public constructor(private readonly input: RomInspectorInput, commands: EditorCommandRunner,
		private readonly sources: RuntimeSourceState, private readonly navigation: EditorNavigationController,
		private readonly quickInput: QuickInputController, private readonly contextMenu: ContextMenuController,
		private readonly surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface,
		private readonly focusReturn: InputFocusTarget, private readonly group: EditorGroupView, private readonly workArea: Readonly<RectBounds>) {
		this.window = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, surfaces, commands, contextMenu, {
			model: input.readerWindow, actionBar: input.readerActions, lifetimeOwner: owner,
			presentationParent: surfaces.windowContext(owner), focusScope: focusReturn.scope, focusReturn, workArea,
			getTitleTooltip: () => this.titleTooltip,
			content: {
				draw: () => this.draw(),
				handlePointer: snapshot => {
					if (this.viewActions.handlePointer(snapshot)) return;
					if (this.attachedView === 'info') this.inspector.handlePointer(snapshot);
					else if (this.attachedView === 'preview') this.image.handlePointer(snapshot);
					else if (!this.horizontal.handlePointer(snapshot, input.readerHorizontal)) this.bytes.handlePointer(snapshot);
				},
				handleWheel: event => {
					if (this.attachedView === 'info') return this.inspector.handleWheel(event, event.deltaY * this.rowHeight * 3);
					if (this.attachedView === 'preview') return this.image.handleWheel(event);
					if (event.valid && event.insideViewport && point_in_rect(event.viewportX, event.viewportY, input.readerContentBounds)) {
						const shift = (event.modifiers & KeyModifier.shift) !== 0;
						const delta = event.deltaX === 0 && shift ? event.deltaY : event.deltaX;
						if (delta !== 0) {
							this.horizontal.cancelPointer();
							input.readerHorizontal.setScroll(input.readerHorizontal.getScroll() + delta * this.rowHeight * 3);
						}
						if (shift) return true;
					}
					return this.bytes.handleWheel(event, event.deltaY * this.rowHeight * 3);
				},
			},
			layoutContent: bounds => this.layoutClient(bounds),
			restoreContentInput: () => this.refreshClient(),
			retireContentInput: () => {
				this.retireChooser(); this.retireOverflow(); this.tooltip.detach();
				this.viewActions.clearInput(); this.retireClient();
			},
			focusContent: () => this.focusContent(),
			onDidHide: () => this.retireChooser(),
		});
		this.inspector = new WorkbenchPropertyInspector(inputFocus, pointerCapture, pointerHover, this.window.clientFocusTarget, 'client');
		this.image = new WorkbenchImageControl(inputFocus, pointerCapture, this.window.clientFocusTarget,
			this.window.clientScope.surfaceScope, event => this.handleEscape(event));
		this.bytes = new WorkbenchScrollControl(inputFocus, pointerCapture, this.window.clientFocusTarget,
			event => this.handleBytesKeyboard(event), this.window.clientScope);
		this.horizontal = new ScrollbarPointerControl(pointerCapture, this.window.clientScope.surfaceScope);
		this.viewActions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands,
			this.window.clientFocusTarget, () => this.focusContent(), contextMenu);
		this.viewActions.onDidOpenOverflow = lifetime => {
			this.tooltip.hide(); this.overflow = lifetime;
			lifetime.add({ dispose: () => { if (this.overflow === lifetime) this.overflow = undefined; } });
		};
		const commandTargets = [this.window.focusTarget, this.inspector.focusTarget, this.image.focusTarget, this.bytes.focusTarget];
		for (const command of READER_COMMANDS) {
			const implementation = {
				isEnabled: () => this.isEnabled(command), run: () => this.execute(command),
				isChecked: () => this.window.isOpen && (command === 'romInspector.hold' ? input.readerHeld
					: command === 'romInspector.collision' && input.reader.showCollision),
			};
			for (const target of commandTargets) target.registerCommand(command, implementation);
		}
		for (const target of commandTargets) {
			if (target !== this.window.focusTarget) target.registerCommand('window.hide', this.window.focusTarget.getCommand('window.hide')!);
		}
	}

	public show(): void { this.input.readerWindow.open = true; this.update(); this.window.show(); }
	public dispose(): void {
		this.retireChooser(); this.retireOverflow(); this.window.dispose();
		this.viewActions.dispose(); this.inspector.dispose(); this.image.dispose(); this.bytes.dispose(); this.horizontal.cancelPointer(); this.tooltip.detach();
	}

	private source() {
		const row = this.input.reader.subject, contextId = this.input.snapshot.sourceContextId;
		if (row === undefined) return undefined;
		if (row.kind === 'function') return row.sourceModule === undefined ? undefined : this.sources.catalog.resolveModule(contextId, row.sourceModule);
		return row.sourcePath === undefined ? undefined : this.sources.catalog.resolveResource({ contextId, path: row.sourcePath });
	}

	public isEnabled(command: EditorCommandId): boolean {
		if (!this.window.isOpen) return false;
		const document = this.input.reader;
		if (command === 'romInspector.hold') return document.subject !== undefined || this.input.readerHeld;
		if (command === 'romInspector.source') return this.source() !== undefined;
		if (this.window.clientSurface?.visible !== true) return false;
		if (command === 'romInspector.content') return document.subject !== undefined;
		if (command === 'romInspector.zoom') return document.view === 'preview' && document.preview !== undefined;
		return command === 'romInspector.collision' && document.view === 'preview' && document.hasCollision;
	}

	public execute(command: EditorCommandId): void {
		if (!this.isEnabled(command)) return;
		const input = this.input, document = input.reader;
		switch (command) {
			case 'romInspector.hold':
				input.readerHeld = !input.readerHeld; this.followSelection(); this.updateCaption(); break;
			case 'romInspector.content': this.chooseContent(); break;
			case 'romInspector.zoom':
				this.quickInput.pick('Image zoom', 'Scale', (_origin, lifetime) => {
					this.ownChooser(lifetime);
					return new TextQuickPickProvider(ZOOM_OPTIONS, ZOOM_OPTIONS.findIndex(option => option.scale === document.imageView.mode));
				}, item => document.imageView.setScale(item.scale)); break;
			case 'romInspector.collision': document.showCollision = !document.showCollision; this.clientRevision = -1; break;
			case 'romInspector.source': void this.navigation.openResource(this.group, this.source()!); break;
		}
	}

	private followSelection(): void {
		const input = this.input, document = input.reader;
		if (!input.readerWindow.open || input.readerHeld || document.subject === input.model.selection) return;
		this.retireChooser(); this.retireOverflow();
		for (const command of SUBJECT_COMMANDS) this.viewActions.cancelCommand(command);
		this.focusAfterClientChange = this.inspector.focusTarget.hasFocus || this.image.focusTarget.hasFocus || this.bytes.focusTarget.hasFocus;
		this.retireClient();
		document.setSubject(input.model.selection);
		input.readerInfoView.selectionIndex = -1; input.readerInfoView.selectionVisible = false;
		input.readerInfoView.anchorIndex = -1; input.readerInfoView.anchorOffset = 0;
		input.readerBytes.scrollbar.setScroll(0); input.readerHorizontal.setScroll(0);
		this.infoRevision = -1;
	}

	private ownChooser(lifetime: DisposableStore): void {
		this.chooser = lifetime;
		lifetime.add({ dispose: () => { if (this.chooser === lifetime) this.chooser = undefined; } });
	}
	private retireChooser(): void { if (this.chooser !== undefined) this.quickInput.hide(); }
	private retireOverflow(): void { if (this.overflow !== undefined) this.contextMenu.hide(); }

	private chooseContent(): void {
		const document = this.input.reader;
		this.quickInput.pick('Entry view', 'Properties, preview or a physical byte range', (_origin, lifetime) => {
			this.ownChooser(lifetime);
			const choices: ContentChoice[] = [{ view: 'info', label: 'Properties', description: '', detail: '' }];
			if (document.canPreviewImage) choices.push({ view: 'preview', label: 'Preview', description: 'Image', detail: '' });
			for (let index = 0; index < document.ranges.length; index++) {
				const range = document.ranges[index];
				choices.push({ view: 'bytes', range, index, label: RANGE_LABELS[range.kind],
					description: formatByteSize(range.end - range.start), detail: `${formatNumberAsHex(range.start, 8)} .. ${formatNumberAsHex(range.end, 8)}` });
			}
			return new TextQuickPickProvider(choices, choices.findIndex(choice => choice.view === document.view
				&& (choice.view !== 'bytes' || choice.range === document.selectedRange)));
		}, item => {
			if (item.view === 'bytes' && item.range !== document.selectedRange) {
				this.bytes.cancelPointer(); this.horizontal.cancelPointer();
				this.input.readerBytes.scrollbar.setScroll(0); this.input.readerHorizontal.setScroll(0);
			}
			if (item.view === 'bytes') document.selectRange(item.index); else document.setView(item.view);
			this.refreshClient(); this.layoutClient(this.input.readerWindow.client); this.focusContent();
		});
	}

	private updateCaption(): void {
		const input = this.input, subject = input.reader.subject;
		input.readerActions.items[0].checked = input.readerHeld;
		if (this.captionSubject === subject && input.readerWindow.title !== '') return;
		this.captionSubject = subject;
		input.readerWindow.title = subject === undefined ? 'Entry Inspector' : subject.label;
		this.titleTooltip = subject === undefined ? 'Entry Inspector: no entry selected'
			: `${subject.label}\n${subject.kind === 'function' ? 'Function' : subject.category.label} / ${input.snapshot.label}`;
	}

	private retireClient(): void {
		pointerCapture.cancelScope(this.window.clientScope.surfaceScope);
		if (this.attachedView === 'info') this.inspector.model.saveViewState(this.input.readerInfoView);
		this.inspector.hide(); this.image.clearInput(); this.bytes.clearInput(); this.horizontal.cancelPointer();
		this.attachedView = undefined;
		this.clientRevision = -1;
	}

	private refreshClient(): void {
		const input = this.input, document = input.reader;
		if (document.view === 'preview') document.preparePreview();
		const viewChanged = this.attachedView !== document.view;
		const contentHadFocus = this.inspector.focusTarget.hasFocus || this.image.focusTarget.hasFocus || this.bytes.focusTarget.hasFocus;
		if (viewChanged) {
			this.retireClient(); this.attachedView = document.view;
			if (document.view === 'preview') this.image.setInput(document.imageView);
			else if (document.view === 'bytes') this.bytes.setInput(input.readerBytes);
		}
		if (document.view === 'info') {
			if (!this.inspector.visible) {
				this.inspector.show({ title: '', items: document.properties, dismissible: false, focusReturn: this.focusReturn,
					canOpenSource: () => this.source() !== undefined,
					openSource: () => { void this.navigation.openResource(this.group, this.source()!); } }, false);
				this.inspector.model.restoreViewState(input.readerInfoView);
				this.infoRevision = document.rangeRevision;
			} else if (this.infoRevision !== document.rangeRevision) {
				this.inspector.replaceItems(document.properties);
				this.inspector.model.restoreViewState(input.readerInfoView);
				this.infoRevision = document.rangeRevision;
			}
			this.inspector.attachFeedback(this.surfaces, this.window.clientSurface!, this.workArea);
		}
		this.viewActions.setInput(input.readerViewActions, this.window.focusTarget);
		this.tooltip.attach(this.surfaces, this.window.clientSurface!, this.workArea);
		if (viewChanged) this.bindFocusOrder();
		if (viewChanged && (contentHadFocus || this.focusAfterClientChange)) this.focusContent();
		this.focusAfterClientChange = false;
	}

	private bindFocusOrder(): void {
		const target = this.contentTarget();
		this.window.actionFocusTarget.next = this.viewActions.focusTarget;
		this.viewActions.focusTarget.previous = this.window.actionFocusTarget;
		this.viewActions.focusTarget.next = target;
		target.previous = this.viewActions.focusTarget; target.next = this.window.focusTarget;
		this.window.focusTarget.previous = target;
		if (this.attachedView === 'info') this.inspector.setFocusOrder(this.viewActions.focusTarget, this.window.focusTarget);
	}
	private contentTarget(): InputFocusTarget {
		return this.attachedView === 'info' ? this.inspector.focusTarget : this.attachedView === 'preview' ? this.image.focusTarget : this.bytes.focusTarget;
	}
	private focusContent(): void { this.contentTarget().focus(); }

	private layoutClient(bounds: Readonly<RectBounds>): void {
		const input = this.input, document = input.reader, font = editorViewState.font.renderFont();
		if (this.clientRevision === document.revision && this.clientFont === editorViewState.font
			&& this.clientLeft === bounds.left && this.clientTop === bounds.top && this.clientRight === bounds.right && this.clientBottom === bounds.bottom) {
			if (this.attachedView === 'info') this.inspector.layout(font, measureTextRange, measureText, input.readerContentBounds);
			else if (this.attachedView === 'bytes') this.updateByteRows();
			return;
		}
		this.clientFont = editorViewState.font;
		this.clientLeft = bounds.left; this.clientTop = bounds.top; this.clientRight = bounds.right; this.clientBottom = bounds.bottom;
		const toolbarBottom = bounds.top + Math.max(font.lineHeight, WORKBENCH_ICON_SIZE) + 6;
		for (const item of input.readerViewActions.items) {
			if (item.command === 'romInspector.content') item.label = document.view === 'info' ? 'Properties' : document.view === 'preview' ? 'Preview' : document.subject?.kind === 'function' ? 'Disassembly' : 'Bytes';
			else if (item.command === 'romInspector.collision') item.checked = document.showCollision;
		}
		layoutWorkbenchActionBar(input.readerViewActions, bounds.right - 4, bounds.top + 2, toolbarBottom - 2,
			measureText, font, bounds.left + 4);
		write_rect_bounds(input.readerContentBounds, bounds.left + 4, toolbarBottom + 2, bounds.right - 4, bounds.bottom - 4);
		const content = input.readerContentBounds;
		if (this.attachedView === 'info') this.inspector.layout(font, measureTextRange, measureText, content);
		else if (this.attachedView === 'preview') document.imageView.layout(content.left, content.top, content.right, content.bottom);
		else {
			const previous = input.readerByteLayout, scroll = input.readerBytes.scrollTop;
			this.presentation.layout(font, content.right - content.left - colors.SCROLLBAR_WIDTH);
			const unitsPerRow = document.subject?.kind === 'function' ? 1 : this.presentation.byteColumns;
			input.readerBytes.layout(content.left, content.top, content.right, content.bottom - colors.SCROLLBAR_WIDTH,
				this.presentation.lineCount(document) * font.lineHeight);
			if (previous !== undefined) {
				if (previous.unitsPerRow !== unitsPerRow || previous.lineHeight !== font.lineHeight) {
					const firstRow = Math.trunc(scroll / previous.lineHeight);
					const anchor = firstRow * previous.unitsPerRow;
					const rowFraction = scroll / previous.lineHeight - firstRow;
					input.readerBytes.scrollbar.setScroll((Math.trunc(anchor / unitsPerRow) + rowFraction) * font.lineHeight);
				}
				previous.lineHeight = font.lineHeight; previous.unitsPerRow = unitsPerRow;
			} else input.readerByteLayout = { lineHeight: font.lineHeight, unitsPerRow };
			write_rect_bounds(input.readerHorizontalTrack, content.left, content.bottom - colors.SCROLLBAR_WIDTH, input.readerBytes.bounds.right, content.bottom);
			this.updateByteRows();
		}
		this.clientRevision = document.revision;
	}

	private updateByteRows(): void {
		const input = this.input;
		this.presentation.update(input, editorViewState.font.renderFont());
		input.readerHorizontal.layout(input.readerHorizontalTrack, this.presentation.contentWidth,
			input.readerBytes.bounds.right - input.readerBytes.bounds.left, input.readerHorizontal.getScroll());
	}

	public update(): void {
		const input = this.input, model = input.readerWindow;
		if (!model.open) { this.retireChooser(); this.window.detach(); return; }
		this.followSelection(); this.updateCaption();
		const font = editorViewState.font;
		if (this.measuredFont !== font) {
			this.measuredFont = font; this.rowHeight = font.lineHeight; this.bytes.lineStep = font.lineHeight;
			const width = editorViewState.charAdvance * 24 + 16;
			model.setMinimumSize(width, font.lineHeight * 7 + 32);
			if (!input.readerPlacementInitialized) {
				const area = this.workArea, requestedWidth = Math.max(width, Math.round((area.right - area.left) * 0.65));
				const height = Math.max(model.minimumHeight, Math.round((area.bottom - area.top) * 0.75));
				model.setRequestedBounds({ left: area.right - requestedWidth - 4, top: area.bottom - height - 4, right: area.right - 4, bottom: area.bottom - 4 });
				input.readerPlacementInitialized = true;
			}
		}
		if (!this.window.visible) this.window.show(false);
		this.refreshClient();
		this.window.layout(font.renderFont(), measureTextRange, measureText);
		this.layoutClient(model.client);
		this.viewActions.update();
		if (this.attachedView === 'info') this.inspector.update();
		const item = this.viewActions.tooltipItem;
		if (item !== undefined) this.tooltip.show(item.tooltip, item.bounds, font.renderFont(), measureTextRange, measureText, this.workArea);
		else this.tooltip.hide();
		this.window.update();
	}

	private handleEscape(event: KeyInputEvent): boolean {
		if (event.modifiers !== KeyModifier.none || !isKeyJustPressed('Escape', event)) return false;
		this.window.focusTarget.handleKeyboard(event); return true;
	}
	private handleBytesKeyboard(event: KeyInputEvent): boolean {
		if (this.handleEscape(event)) return true;
		if (!isKeyDown('ArrowLeft', event) && !isKeyDown('ArrowRight', event)) return false;
		consumeIdeKey(event.code, event); this.horizontal.cancelPointer();
		const bar = this.input.readerHorizontal;
		bar.setScroll(bar.getScroll() + (event.code === 'ArrowLeft' ? -16 : 16)); return true;
	}

	private draw(): void {
		const input = this.input, bounds = input.readerWindow.client, font = editorViewState.font.renderFont();
		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
		renderWorkbenchActionBar(input.readerViewActions, font, colors.COLOR_RESOURCE_VIEWER_TEXT, colors.COLOR_DESCRIPTION_TEXT);
		if (input.reader.subject === undefined) api.blit_text_inline_with_font('No entry selected', input.readerContentBounds.left + 4,
			input.readerContentBounds.top + 4, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		else if (this.attachedView === 'info') drawWorkbenchPropertyInspector(this.inspector);
		else drawRomInspectorContent(input, this.presentation, font);
	}
}
