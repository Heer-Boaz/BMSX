import { SCROLLBAR_WIDTH } from '../../../common/constants';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import { point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { DOUBLE_CLICK_MAX_INTERVAL_MS } from '../../../common/constants';
import type { EditorCommandId, EditorCommandRunner } from '../../../common/commands';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { applyInlineFieldEditing, applyInlineFieldPointer, selectAll, setFieldText } from '../../../editor/ui/inline/text_field';
import { TextField } from '../../../editor/ui/inline/text_field_model';
import { SingleLineFieldViewport } from '../../../editor/ui/inline/single_line_viewport';
import { resetBlink } from '../../../editor/render/caret';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, type InputFocusScope } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed, isKeyDown } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import { resolveRuntimeResourceForContext, type RuntimeSourceState } from '../../../runtime/sources';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { WorkbenchTooltip } from '../../ui/tooltip';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import type { EditorNavigationController } from '../resources/navigation';
import type { RomInspectorInput } from './editor_input';
import type { RomInspectorRow, RomInspectorSort } from './model';
import { drawRomInspector, RomInspectorPresentation } from './presentation';
import { RomMapKeyWindow } from './key_window';
import { RomEntryInspectorWindow } from './reader_window';
import { clamp } from '../../../../machine/ts/common/clamp';

const COMMANDS = ['romInspector.key', 'romInspector.inspect', 'romInspector.assets', 'romInspector.structure', 'romInspector.code', 'romInspector.sort', 'romInspector.source'] as const;
const NAVIGATION = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'] as const;
const SORTS: { label: string; description: string; detail: string; sort: RomInspectorSort; descending: boolean }[] = [
	{ label: 'Name', description: 'A to Z', detail: '', sort: 'name', descending: false },
	{ label: 'Type', description: 'Type, then name', detail: '', sort: 'type', descending: false },
	{ label: 'Largest first', description: 'Stored bytes descending', detail: '', sort: 'size', descending: true },
	{ label: 'Smallest first', description: 'Stored bytes ascending', detail: '', sort: 'size', descending: false },
	{ label: 'File offset', description: 'Physical order', detail: '', sort: 'offset', descending: false },
];

// Entry names share a row with byte sizes; the next line retains category and address.
const ENTRY_READING_COLUMNS = 36;

/** Native workbench controls over one immutable packed-image input. */
export class RomInspectorPane extends WorkbenchViewEditorPane<RomInspectorInput> {
	public override get companionGameMinimumWidth(): number { return editorViewState.charAdvance * ENTRY_READING_COLUMNS + SCROLLBAR_WIDTH + 12; }

	private readonly actions: WorkbenchActionBarControl;
	private readonly list = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget, input => this.navigate(input));
	private readonly presentation = new RomInspectorPresentation();
	private readonly actionTooltip = new WorkbenchTooltip();
	private key: RomMapKeyWindow | undefined;
	private reader: RomEntryInspectorWindow | undefined;
	private lastClickRow: RomInspectorRow | undefined;
	private lastClickTime = 0;
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
	private freshLayout = true;
	public constructor(private readonly commands: EditorCommandRunner,
		private readonly sources: RuntimeSourceState, private readonly navigation: EditorNavigationController,
		private readonly quickInput: QuickInputController, private readonly contextMenu: ContextMenuController,
		private readonly surfaces: WorkbenchSurfaceService, private readonly owner: WorkbenchSurface,
		private readonly workArea: Readonly<RectBounds>, scope: InputFocusScope) {
		super(scope);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.focus(), contextMenu);
		this.actionTooltip.attach(surfaces, owner, workArea);
		this.actions.onDidOpenOverflow = () => this.actionTooltip.hide();
		for (const command of COMMANDS) {
			const implementation = { isEnabled: () => this.isEnabled(command), run: () => this.execute(command) };
			for (const target of [this.focusTarget, this.filter.focusTarget, this.list.focusTarget]) target.registerCommand(command, implementation);
		}
		this.list.focusTarget.commandContext = this.focusTarget;
		this.list.focusTarget.registerCommand('list.find', {
			isEnabled: () => this.hasInput,
			run: () => { this.filter.focusTarget.focus(); selectAll(this.filter); resetBlink(); },
		});
		this.actions.focusTarget.next = this.filter.focusTarget;
		this.filter.focusTarget.previous = this.actions.focusTarget;
		this.filter.focusTarget.next = this.list.focusTarget;
		this.list.focusTarget.previous = this.filter.focusTarget;
		this.list.focusTarget.next = this.actions.focusTarget;
		this.actions.focusTarget.previous = this.list.focusTarget;
	}
	public override focus(): void { this.list.focusTarget.focus(); }
	protected override activate(): void {
		this.boundRevision = -1; this.freshLayout = true; this.presentation.reset();
		this.lastClickRow = undefined; this.lastClickTime = 0;
		this.key = new RomMapKeyWindow(this.input, this.commands, this.surfaces, this.owner, this.list.focusTarget, this.workArea);
		for (const target of [this.key.window.focusTarget, this.key.scroll.focusTarget]) for (const command of COMMANDS)
			target.registerCommand(command, this.focusTarget.getCommand(command)!);
		this.actions.setInput(this.input.actions, this.focusTarget);
		this.reader = new RomEntryInspectorWindow(this.input, this.commands, this.sources, this.navigation,
			this.quickInput, this.contextMenu, this.surfaces, this.owner, this.list.focusTarget, this.workArea);
		for (const target of [this.reader.window.focusTarget, this.reader.inspector.focusTarget, this.reader.image.focusTarget,
			this.reader.bytes.focusTarget, this.reader.viewActions.focusTarget]) for (const command of COMMANDS)
			if (command !== 'romInspector.source') target.registerCommand(command, this.focusTarget.getCommand(command)!);
		this.list.setInput(this.input.list);
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
		if (!this.hasInput) return false;
		if (command === 'romInspector.inspect') return this.input.model.selection !== undefined || this.input.readerHeld && this.input.reader.subject !== undefined;
		if (command === 'romInspector.source') return this.source() !== undefined;
		if (command === 'romInspector.sort') return this.input.model.mode !== 'structure';
		if (command === 'romInspector.code') return this.input.snapshot.header.blua32ImageByteCount !== 0;
		return command === 'romInspector.key' || command === 'romInspector.assets' || command === 'romInspector.structure';
	}
	public execute(command: EditorCommandId): void {
		if (!this.isEnabled(command)) return;
		const input = this.input;
		switch (command) {
			case 'romInspector.key': this.key!.show(); break;
			case 'romInspector.inspect': this.reader!.show(); break;
			case 'romInspector.assets': input.model.setMode('assets'); input.list.scrollbar.setScroll(0); break;
			case 'romInspector.structure': input.model.setMode('structure'); input.list.scrollbar.setScroll(0); break;
			case 'romInspector.code': input.model.setMode('code'); input.list.scrollbar.setScroll(0); break;
			case 'romInspector.sort': this.quickInput.pick('SORT ROM ENTRIES', 'Choose order', () => new TextQuickPickProvider(SORTS), item => {
				input.model.sort = item.sort; input.model.descending = item.descending; input.model.project(); input.list.scrollbar.setScroll(0);
			}); break;
			case 'romInspector.source': void this.navigation.openResource(this.source()!); break;
		}
	}
	public override update(): void {
		const input = this.input, { model, layout } = input;
		const layoutChanged = updateFullWidthWorkbenchLayout(layout, this.contentBounds) || this.freshLayout;
		this.freshLayout = false;
		const changed = this.boundRevision !== model.revision;
		if (changed) {
			for (const item of input.actions.items) item.checked = item.command === `romInspector.${model.mode}`;
			this.boundRevision = model.revision;
		}
		const row = layout.rowHeight, left = layout.left, right = layout.right;
		if (layoutChanged || changed) {
			layoutWorkbenchActionBar(input.actions, right - 4, layout.top + 2, layout.top + row + 6, measureText, layout.font!.renderFont(), left + 4);
			write_rect_bounds(input.filterBounds, left + measureText('Filter') + 10, layout.top + row + 10, right - 4, layout.top + row * 2 + 16);
			write_rect_bounds(input.mapBounds, left + 4, input.filterBounds.bottom + 4, right - 4, input.filterBounds.bottom + 10);
			input.list.layout(left + 2, input.mapBounds.bottom + 5, right - 2, layout.bottom, model.rows.length * (row * 2 + 4));
			this.list.lineStep = row * 2 + 4;
		}
		this.filterViewport.layout(this.filter, input.filterBounds, editorViewState.inlineFieldMetricsRef, layout.font!, this.contentBounds);
		this.actions.update();
		const hint = input.actions.pressedCommand !== null ? undefined : this.actions.tooltipItem;
		if (hint === undefined) this.actionTooltip.hide();
		else this.actionTooltip.show(hint.tooltip, hint.bounds, layout.font!.renderFont(), measureTextRange, measureText, this.workArea);
		this.presentation.update(input, layoutChanged);
		this.reader!.update();
		this.key!.update();
	}
	private navigate(player: KeyInputEvent): boolean {
		const input = this.input, model = input.model;
		for (const key of NAVIGATION) {
			if (!isKeyDown(key, player)) continue;
			consumeIdeKey(key, player);
			this.lastClickRow = undefined;
			if (model.rows.length === 0) return true;
			const page = Math.max(1, Math.trunc(input.list.height / (input.layout.rowHeight * 2 + 4)));
			const next = key === 'Home' ? 0 : key === 'End' ? model.rows.length - 1
				: model.selected + (key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : key === 'PageUp' ? -page : page);
			model.select(clamp(next, 0, model.rows.length - 1));
			const top = model.selected * (input.layout.rowHeight * 2 + 4);
			input.list.scrollbar.reveal(top, top + input.layout.rowHeight * 2 + 4, 0);
			return true;
		}
		if (isKeyJustPressed('Enter', player) || isKeyJustPressed('NumpadEnter', player)) {
			consumeIdeKey('Enter', player); consumeIdeKey('NumpadEnter', player);
			this.execute('romInspector.inspect'); return true;
		}
		return false;
	}
	public handleKeyboard(player: KeyInputEvent): void { this.navigate(player); }
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean, now: number): boolean {
		const input = this.input;
		if (justPressed && (!this.list.focusTarget.hasFocus || !point_in_rect(snapshot.viewportX, snapshot.viewportY, input.list.bounds)
			|| Math.trunc((snapshot.viewportY - input.list.offsetTop) / (input.layout.rowHeight * 2 + 4)) >= input.model.rows.length))
			this.lastClickRow = undefined;
		if (this.actions.handlePointer(snapshot)) return true;
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
		if (!this.list.handlePointer(snapshot)) return false;
		if (justPressed && point_in_rect(snapshot.viewportX, snapshot.viewportY, input.list.bounds)) {
			const index = Math.trunc((snapshot.viewportY - input.list.offsetTop) / (input.layout.rowHeight * 2 + 4));
			if (index >= 0 && index < input.model.rows.length) {
				const row = input.model.rows[index];
				input.model.select(index);
				const doubleClick = this.lastClickRow === row && now - this.lastClickTime <= DOUBLE_CLICK_MAX_INTERVAL_MS;
				this.lastClickRow = doubleClick ? undefined : row;
				this.lastClickTime = now;
				if (doubleClick) this.execute('romInspector.inspect');
			}
		}
		return true;
	}
	public handleWheel(event: WheelInputSnapshot): void {
		this.list.handleWheel(event, event.deltaY * this.input.layout.rowHeight * 3);
	}
	public draw(): void {
		drawRomInspector(this.input, this.presentation, this.filter, this.filterViewport, this.list.focusTarget.hasFocus);
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void {
		api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
		api.blit_text_inline_with_font(this.presentation.status, bounds.left + 4, bounds.top + 2, 0, color, editorViewState.font.renderFont());
		api.popClipRect();
	}
	public override clearInput(): void {
		this.key!.dispose(); this.key = undefined; this.reader!.dispose(); this.reader = undefined; this.actionTooltip.hide();
		this.unbindFilterChange();
		this.lastClickRow = undefined;
		this.filter.focusTarget.release();
		this.actions.clearInput(); this.list.clearInput();
		super.clearInput();
	}
	public override dispose(): void {
		this.key?.dispose(); this.key = undefined; this.reader?.dispose(); this.reader = undefined; this.actionTooltip.detach();
		this.actions.dispose(); this.list.dispose();
		this.unbindFilterKeyboard();
		super.dispose();
	}
}
