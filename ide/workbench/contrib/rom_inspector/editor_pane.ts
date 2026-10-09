import { KeyModifier, type PlayerInput } from '../../../../hosts/common/input/player';
import { formatByteSize, formatNumberAsHex } from '../../../../machine/ts/common/byte_hex_string';
import { point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { DOUBLE_CLICK_MAX_INTERVAL_MS, SCROLLBAR_WIDTH } from '../../../common/constants';
import type { EditorCommandId, EditorCommandRunner } from '../../../common/commands';
import type { PointerSnapshot } from '../../../common/models';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { applyInlineFieldEditing, applyInlineFieldPointer, setFieldText } from '../../../editor/ui/inline/text_field';
import { TextField } from '../../../editor/ui/inline/text_field_model';
import { SingleLineFieldViewport } from '../../../editor/ui/inline/single_line_viewport';
import { resetBlink } from '../../../editor/render/caret';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../input/pointer/buttons';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import { resolveRuntimeResourceForContext, type RuntimeSourceState } from '../../../runtime/sources';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { drawWorkbenchPropertyInspector } from '../../render/property_inspector';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { WorkbenchPropertyInspector } from '../../ui/property_inspector/control';
import { ScrollbarPointerControl } from '../../ui/scrollbar_pointer';
import { WorkbenchImageControl } from '../../ui/image_control';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import type { EditorNavigationController } from '../resources/navigation';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { RomInspectorInput } from './editor_input';
import type { RomInspectorByteRange, RomInspectorSort } from './model';
import { drawRomInspector, RomInspectorPresentation } from './presentation';

const COMMANDS = ['romInspector.assets', 'romInspector.structure', 'romInspector.code', 'romInspector.sort', 'romInspector.source', 'romInspector.content', 'romInspector.zoom', 'romInspector.collision'] as const;
const HORIZONTAL_NAVIGATION = ['ArrowLeft', 'ArrowRight'] as const;
const NAVIGATION = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'] as const;
const SORTS: { label: string; description: string; detail: string; sort: RomInspectorSort; descending: boolean }[] = [
	{ label: 'Name', description: 'A to Z', detail: '', sort: 'name', descending: false },
	{ label: 'Type', description: 'Type, then name', detail: '', sort: 'type', descending: false },
	{ label: 'Largest first', description: 'Stored bytes descending', detail: '', sort: 'size', descending: true },
	{ label: 'Smallest first', description: 'Stored bytes ascending', detail: '', sort: 'size', descending: false },
	{ label: 'File offset', description: 'Physical order', detail: '', sort: 'offset', descending: false },
];

const ZOOM_OPTIONS = [
	{ label: 'Fit', description: '', detail: '', scale: 'fit' as const },
	...[1, 2, 4, 8, 16, 0.5, 0.25, 0.125].map(scale => ({ label: `${scale * 100}%`, description: scale === 1 ? 'Original pixels' : '', detail: '', scale })),
];
const RANGE_LABELS: Record<RomInspectorByteRange['kind'], string> = {
	data: 'Data', metadata: 'Metadata', 'model-texture': 'Texture', collision: 'Collision',
	header: 'Header', manifest: 'Manifest', toc: 'TOC', blua32: 'BLua32', asset: 'Asset', unreferenced: 'Unreferenced', instructions: 'Instructions',
};

/** Native workbench controls over one immutable packed-image input. */
export class RomInspectorPane extends FullWidthWorkbenchEditorPane<RomInspectorInput> {
	private readonly actions: WorkbenchActionBarControl;
	private readonly contentActions: WorkbenchActionBarControl;
	private readonly image = new WorkbenchImageControl(inputFocus, pointerCapture, this.focusTarget);
	private readonly list = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget, input => this.navigate(input));
	private readonly bytes = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget, input => this.navigateBytes(input));
	private readonly horizontal = new ScrollbarPointerControl(pointerCapture);
	private readonly inspector = new WorkbenchPropertyInspector(inputFocus, pointerCapture, pointerHover, this.focusTarget);
	private readonly presentation = new RomInspectorPresentation();
	private readonly filter = new TextField(this.focusTarget, { allowSpace: true, singleLine: true });
	private readonly filterViewport = new SingleLineFieldViewport();
	private readonly filterPointer = {
		metrics: editorViewState.inlineFieldMetricsRef, textLeft: 0, pointerX: 0,
		justPressed: false, pointerPressed: false, doubleClickInterval: DOUBLE_CLICK_MAX_INTERVAL_MS,
	};
	private readonly unbindFilterKeyboard = this.filter.focusTarget.bindKeyboard(input => {
		if (isKeyJustPressed('Enter', input) || isKeyJustPressed('NumpadEnter', input) || isKeyJustPressed('Escape', input)) {
			consumeIdeKey('Enter', input); consumeIdeKey('NumpadEnter', input); consumeIdeKey('Escape', input);
			this.list.focusTarget.focus();
		} else applyInlineFieldEditing(input, this.filter);
	});
	private unbindFilterChange!: () => void;
	private boundRevision = -1;
	private boundContentRevision = -1;
	private imageActive = false;
	private zoomMode: 'fit' | number | undefined;
	private freshLayout = true;
	public constructor(resources: ResourcePanelController, commands: EditorCommandRunner,
		private readonly sources: RuntimeSourceState, private readonly navigation: EditorNavigationController,
		private readonly quickInput: QuickInputController) {
		super(resources);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget);
		this.contentActions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget);
		for (const target of [this.focusTarget, this.inspector.focusTarget, this.filter.focusTarget]) for (const command of COMMANDS)
			target.registerCommand(command, { isEnabled: () => this.isEnabled(command), run: () => this.execute(command) });
		this.list.focusTarget.commandContext = this.focusTarget;
		this.bytes.focusTarget.commandContext = this.focusTarget;
		this.image.focusTarget.commandContext = this.focusTarget;
		this.actions.focusTarget.next = this.filter.focusTarget;
		this.filter.focusTarget.previous = this.actions.focusTarget;
		this.filter.focusTarget.next = this.list.focusTarget;
		this.list.focusTarget.previous = this.filter.focusTarget;
		this.inspector.setFocusOrder(this.list.focusTarget, this.bytes.focusTarget);
		this.bytes.focusTarget.next = this.actions.focusTarget;
		this.actions.focusTarget.previous = this.bytes.focusTarget;
	}
	public override focus(): void { this.list.focusTarget.focus(); }
	protected override activate(): void {
		super.activate();
		this.boundRevision = -1; this.boundContentRevision = -1; this.zoomMode = undefined; this.freshLayout = true; this.presentation.reset();
		this.actions.setInput(this.input.actions, this.focusTarget);
		this.contentActions.setInput(this.input.contentActions, this.focusTarget);
		this.image.setInput(this.input.imageView);
		this.list.setInput(this.input.list); this.bytes.setInput(this.input.bytes);
		setFieldText(this.filter, this.input.model.filter, true);
		this.unbindFilterChange = this.filter.onDidChangeText(() => {
			const input = this.input;
			if (input.model.filter === this.filter.text) return;
			input.model.filter = this.filter.text;
			input.model.project();
			input.list.scrollbar.setScroll(0);
			resetBlink();
		});
		this.update();
	}
	private source() {
		const path = this.input.model.selection?.sourcePath;
		if (path === undefined) return undefined;
		const domain = this.input.snapshot.domain;
		const resource = resolveRuntimeResourceForContext(this.sources, domain, path);
		return resource?.domain === domain ? resource : undefined;
	}
	public isEnabled(command: EditorCommandId): boolean {
		if (command === 'romInspector.content') return this.input.model.canPreviewImage || this.input.model.ranges.length > 1;
		if (command === 'romInspector.zoom') return this.input.showingImage;
		if (command === 'romInspector.collision') return this.input.showingImage && this.input.hasCollision;
		if (command === 'romInspector.source') return this.source() !== undefined;
		if (command === 'romInspector.sort') return this.input.model.mode !== 'structure';
		if (command === 'romInspector.code') return this.input.snapshot.header.blua32ImageByteCount !== 0;
		return command === 'romInspector.assets' || command === 'romInspector.structure';
	}
	public execute(command: EditorCommandId): void {
		if (!this.isEnabled(command)) return;
		const input = this.input;
		switch (command) {
			case 'romInspector.assets': input.model.setMode('assets'); input.list.scrollbar.setScroll(0); break;
			case 'romInspector.structure': input.model.setMode('structure'); input.list.scrollbar.setScroll(0); break;
			case 'romInspector.code': input.model.setMode('code'); input.list.scrollbar.setScroll(0); break;
			case 'romInspector.sort': this.quickInput.pick('SORT ROM ENTRIES', 'Choose order', () => new TextQuickPickProvider(SORTS), item => {
				input.model.sort = item.sort; input.model.descending = item.descending; input.model.project(); input.list.scrollbar.setScroll(0);
			}); break;
			case 'romInspector.content': this.chooseContent(); break;
			case 'romInspector.zoom': this.quickInput.pick('IMAGE ZOOM', 'Scale', () => new TextQuickPickProvider(ZOOM_OPTIONS,
				ZOOM_OPTIONS.findIndex(option => option.scale === input.imageView.mode)), item => input.imageView.setScale(item.scale)); break;
			case 'romInspector.collision': input.showCollision = !input.showCollision; break;
			case 'romInspector.source': void this.navigation.openResource(this.source()!); break;
		}
	}
	private chooseContent(): void {
		const input = this.input;
		// Resolve the current selection's preview and physical ranges before building choices.
		this.quickInput.pick('ASSET CONTENT', 'Preview or byte range', () => {
			this.update();
			const choices: { label: string; description: string; detail: string; range: number | undefined }[] = [];
			if (input.model.canPreviewImage) choices.push({ label: 'Preview', description: 'Image', detail: '', range: undefined });
			const firstRange = choices.length;
			for (let index = 0; index < input.model.ranges.length; index++) {
				const range = input.model.ranges[index];
				choices.push({ label: RANGE_LABELS[range.kind], description: formatByteSize(range.end - range.start),
					detail: `${formatNumberAsHex(range.start, 8)} .. ${formatNumberAsHex(range.end, 8)}`, range: index });
			}
			return new TextQuickPickProvider(choices, input.showingImage ? 0 : firstRange + input.model.ranges.indexOf(input.model.selectedRange!));
		}, item => {
			input.contentMode = item.range === undefined ? 'preview' : 'bytes';
			if (item.range !== undefined) input.model.selectRange(item.range);
			input.contentRevision++;
		});
	}
	public override update(): void {
		const input = this.input, { model, layout } = input;
		const layoutChanged = updateFullWidthWorkbenchLayout(layout, this.contentBounds) || this.freshLayout;
		this.freshLayout = false;
		const changed = this.boundRevision !== model.revision;
		if (changed) {
			input.updatePreview();
			for (const item of input.actions.items) item.checked = item.command === `romInspector.${model.mode}`;
			this.inspector.show({ title: 'DETAILS', dismissible: false, items: model.properties, canOpenSource: () => this.source() !== undefined,
				openSource: () => { void this.navigation.openResource(this.source()!); } }, false);
			this.boundRevision = model.revision;
		}
		const contentChanged = this.boundContentRevision !== input.contentRevision;
		if (changed || contentChanged) {
			this.image.cancelPointer(); this.bytes.cancelPointer(); this.horizontal.cancelPointer();
			input.bytes.scrollbar.setScroll(0); input.horizontal.setScroll(0);
			this.boundContentRevision = input.contentRevision;
		}
		const contentActionsChanged = changed || contentChanged || this.zoomMode !== input.imageView.mode;
		if (contentActionsChanged) {
			for (const item of input.contentActions.items) {
				item.visible = this.isEnabled(item.command);
				if (item.command === 'romInspector.content') item.label = input.showingImage ? 'Preview' : model.selectedRange === undefined ? 'View' : RANGE_LABELS[model.selectedRange.kind];
				if (item.command === 'romInspector.zoom') item.label = input.imageView.mode === 'fit' ? 'Fit' : `${input.imageView.mode * 100}%`;
			}
			this.zoomMode = input.imageView.mode;
			const contentFocus = input.showingImage ? this.image.focusTarget : this.bytes.focusTarget;
			const oldContentFocus = this.imageActive ? this.image.focusTarget : this.bytes.focusTarget;
			if (oldContentFocus.hasFocus && contentFocus !== oldContentFocus) contentFocus.focus();
			const hasActions = input.contentActions.items.some(item => item.visible);
			if (!hasActions && this.contentActions.focusTarget.hasFocus) contentFocus.focus();
			this.inspector.setFocusOrder(this.list.focusTarget, hasActions ? this.contentActions.focusTarget : contentFocus);
			if (hasActions) { this.contentActions.focusTarget.next = contentFocus; contentFocus.previous = this.contentActions.focusTarget; }
			contentFocus.next = this.actions.focusTarget;
			this.actions.focusTarget.previous = contentFocus;
			this.imageActive = input.showingImage;
		}
		for (const item of input.contentActions.items) if (item.command === 'romInspector.collision') item.checked = input.showCollision;
		const row = layout.rowHeight, left = layout.left, right = layout.right;
		if (layoutChanged || changed || contentChanged) {
			layoutWorkbenchActionBar(input.actions, right - 4, layout.top + 2, layout.top + row + 6, measureText, layout.font!.renderFont());
			write_rect_bounds(input.filterBounds, left + measureText('Filter') + 10, layout.top + row + 10, right - 4, layout.top + row * 2 + 16);
			write_rect_bounds(input.mapBounds, left + 4, input.filterBounds.bottom + 4, right - 4, input.filterBounds.bottom + 10);
			const top = input.mapBounds.bottom + 5, split = left + Math.trunc((right - left) * 0.42);
			const detailBottom = top + Math.trunc((layout.bottom - top) * 0.5);
			input.list.layout(left + 2, top, split, layout.bottom, model.rows.length * (row * 2 + 4));
			write_rect_bounds(input.detailsBounds, split + 4, top, right - 2, detailBottom);
			const available = right - split - 18;
			this.presentation.byteColumns = measureText('00000000  ' + '00 '.repeat(16) + '  ' + '.'.repeat(16)) <= available ? 16 : 8;
			const range = model.selectedRange;
			const count = input.showingImage || range === undefined ? 0 : model.mode === 'code' ? model.instructions.length
				: Math.trunc((range.end - range.start + this.presentation.byteColumns - 1) / this.presentation.byteColumns);
			input.bytes.layout(split + 4, detailBottom + row + 8, right - 2, layout.bottom - SCROLLBAR_WIDTH, count * row);
			if (input.preview !== undefined) input.imageView.layout(split + 4, detailBottom + row + 8, right - 2, layout.bottom);
			write_rect_bounds(input.horizontalTrack, input.bytes.bounds.left, input.bytes.bounds.bottom, input.bytes.bounds.right, layout.bottom);
			this.list.lineStep = row * 2 + 4; this.bytes.lineStep = row;
		}
		if (layoutChanged || contentActionsChanged) layoutWorkbenchActionBar(input.contentActions, right - 4,
			input.detailsBounds.bottom + 2, input.detailsBounds.bottom + row + 6, measureText, layout.font!.renderFont());
		this.filterViewport.update(this.filter, input.filterBounds.right - input.filterBounds.left - 6,
			editorViewState.inlineFieldMetricsRef, layout.font!.renderFont());
		this.inspector.layout(layout.font!.renderFont(), measureTextRange, measureText, input.detailsBounds);
		this.inspector.update();
		this.actions.update(); this.contentActions.update();
		this.presentation.update(input, layoutChanged, contentActionsChanged);
		input.horizontal.layout(input.horizontalTrack, this.presentation.contentWidth, input.bytes.bounds.right - input.bytes.bounds.left, input.horizontal.getScroll());
	}
	private navigateBytes(player: PlayerInput): boolean {
		for (const key of HORIZONTAL_NAVIGATION) {
			if (!shouldRepeatKeyFromPlayer(key, player)) continue;
			consumeIdeKey(key, player); this.horizontal.cancelPointer();
			const bar = this.input.horizontal;
			bar.setScroll(bar.getScroll() + (key === 'ArrowLeft' ? -1 : 1) * this.input.layout.rowHeight * 3);
			return true;
		}
		return false;
	}
	private navigate(player: PlayerInput): boolean {
		const input = this.input, model = input.model;
		for (const key of NAVIGATION) {
			if (!shouldRepeatKeyFromPlayer(key, player)) continue;
			consumeIdeKey(key, player);
			if (model.rows.length === 0) return true;
			const page = Math.max(1, Math.trunc(input.list.height / (input.layout.rowHeight * 2 + 4)));
			const next = key === 'Home' ? 0 : key === 'End' ? model.rows.length - 1
				: model.selected + (key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : key === 'PageUp' ? -page : page);
			model.select(Math.max(0, Math.min(model.rows.length - 1, next)));
			const top = model.selected * (input.layout.rowHeight * 2 + 4);
			input.list.scrollbar.reveal(top, top + input.layout.rowHeight * 2 + 4, 0);
			return true;
		}
		if (isKeyJustPressed('Enter', player)) {
			consumeIdeKey('Enter', player);
			this.inspector.focusTarget.focus(); return true;
		}
		return false;
	}
	public handleKeyboard(player: PlayerInput): void { this.navigate(player); }
	protected override handleViewPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
		if (this.actions.handlePointer(snapshot) || this.contentActions.handlePointer(snapshot)) return true;
		const map = this.input.mapBounds;
		if (justPressed && snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, map)) {
			const input = this.input, model = input.model;
			const offset = (snapshot.viewportX - map.left) / (map.right - map.left) * input.snapshot.rom.byteLength;
			model.filter = ''; setFieldText(this.filter, '', true);
			if (model.mode === 'structure') model.project(); else model.setMode('structure');
			model.select(model.rows.findIndex(row => row.start <= offset && row.end > offset));
			const top = model.selected * (input.layout.rowHeight * 2 + 4);
			this.update();
			input.list.scrollbar.reveal(top, top + input.layout.rowHeight * 2 + 4, 0);
			this.list.focusTarget.focus();
			return true;
		}

		const bounds = this.input.filterBounds;
		if (this.filter.pointerSelecting || snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds)) {
			if (justPressed) this.filter.focusTarget.focus();
			this.filterPointer.textLeft = bounds.left + 3 - this.filterViewport.offset;
			this.filterPointer.pointerX = snapshot.viewportX;
			this.filterPointer.justPressed = justPressed;
			this.filterPointer.pointerPressed = (snapshot.pressedButtons & PointerButton.Primary) !== 0;
			if (applyInlineFieldPointer(this.filter, this.filterPointer).requestBlinkReset) resetBlink();
			return true;
		}
		if (this.inspector.handlePointer(snapshot)) return true;
		if (this.input.showingImage) {
			if (this.image.handlePointer(snapshot)) return true;
		} else if (this.horizontal.handlePointer(snapshot, this.input.horizontal) || this.bytes.handlePointer(snapshot)) return true;
		if (!this.list.handlePointer(snapshot)) return false;
		const input = this.input;
		if (justPressed && point_in_rect(snapshot.viewportX, snapshot.viewportY, input.list.bounds)) {
			const index = Math.trunc((snapshot.viewportY - input.list.offsetTop) / (input.layout.rowHeight * 2 + 4));
			if (index >= 0 && index < input.model.rows.length) input.model.select(index);
		}
		return true;
	}
	public handleWheel(direction: number, steps: number, pointer: PointerSnapshot | null, input: PlayerInput): void {
		if (pointer === null) return;
		const delta = direction * steps * this.input.layout.rowHeight * 3;
		if (this.input.showingImage && this.image.handleWheel(pointer, delta, -direction * steps, input.getModifiers())) {
			input.inputHandlers.pointer?.consumeButton('pointer_wheel'); return;
		}
		if (!this.input.showingImage && (input.getModifiers() & KeyModifier.shift) !== 0 && pointer.valid && pointer.insideViewport
			&& (point_in_rect(pointer.viewportX, pointer.viewportY, this.input.bytes.bounds) || point_in_rect(pointer.viewportX, pointer.viewportY, this.input.horizontalTrack))) {
			this.horizontal.cancelPointer();
			this.input.horizontal.setScroll(this.input.horizontal.getScroll() + delta);
			input.inputHandlers.pointer?.consumeButton('pointer_wheel'); return;
		}
		if (this.inspector.handleWheel(pointer, delta)
			|| this.list.handleWheel(pointer, delta) || !this.input.showingImage && this.bytes.handleWheel(pointer, delta)) input.inputHandlers.pointer?.consumeButton('pointer_wheel');
	}
	public draw(): void {
		drawRomInspector(this.input, this.presentation, this.filter, this.filterViewport);
		drawWorkbenchPropertyInspector(this.inspector);
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void {
		api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
		api.blit_text_inline_with_font(this.presentation.status, bounds.left + 4, bounds.top + 2, 0, color, editorViewState.font.renderFont());
		api.popClipRect();
	}
	public override clearInput(): void {
		this.horizontal.cancelPointer();
		this.unbindFilterChange();
		this.filter.focusTarget.release();
		this.inspector.hide(); this.contentActions.clearInput(); this.image.clearInput(); this.actions.clearInput(); this.list.clearInput(); this.bytes.clearInput();
		super.clearInput();
	}
	public override dispose(): void {
		this.horizontal.cancelPointer();
		this.inspector.dispose(); this.contentActions.dispose(); this.image.dispose(); this.actions.dispose(); this.list.dispose(); this.bytes.dispose();
		this.unbindFilterKeyboard();
		super.dispose();
	}
}
