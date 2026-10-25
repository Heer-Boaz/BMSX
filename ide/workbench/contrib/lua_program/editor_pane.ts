import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { IdeCommandController } from '../../../commands/controller';
import { inputFocus } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { consumeIdeKey, isKeyJustPressed, isKeyDown } from '../../../input/keyboard/key_input';
import { editorViewState } from '../../../editor/ui/view/state';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { executeTextHistoryCommand } from '../../../editor/editing/history_commands';
import { parseLuaFieldValueEdit, type LuaFieldValueEdit } from '../../../language/lua/field_value_edit';
import { readLuaSourceRange, luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { layoutWorkbenchPropertyTree, measureWorkbenchPropertyTreeMinimumWidth } from '../../ui/property_tree';
import { drawWorkbenchPropertyTree } from '../../render/property_tree';
import { WorkbenchPropertyTreePointer, WorkbenchPropertyPointerResult } from '../../ui/property_tree_pointer';
import { WorkbenchPropertyEdit } from '../../ui/property_edit';
import { navigateWorkbenchTree, setWorkbenchTreeCollapsed, WorkbenchTreeNavigationResult } from '../../ui/tree_view';
import { scrollWorkbenchList } from '../../ui/list_view';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { layoutWorkbenchActionBar, WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH } from '../../ui/action_bar';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import type { LuaProgramController } from './controller';
import type { LuaProgramInput } from './editor_input';
import * as colors from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { LuaSyntaxKind } from '../../../../toolchain/ts/lua/syntax/ast';
import type { ActionStringTester } from '../scenario_lab/actionstring';
import type { RuntimeFrameNavigation } from '../../../runtime/frame_navigation';
import { truncateMeasuredText } from '../../../common/text';
import { WorkbenchTooltip } from '../../ui/tooltip';

const PROPERTY_NAME_READING_COLUMNS = 12;
const SOURCE_VALUE_READING_COLUMNS = 20;
const RUNTIME_VALUE_READING_COLUMNS = 24;

export class LuaProgramEditorPane extends WorkbenchViewEditorPane<LuaProgramInput> {
	// A root property keeps a meaningful source name and expression, including its tree/control lanes.
	public override get companionGameMinimumWidth(): number {
		return measureWorkbenchPropertyTreeMinimumWidth(editorViewState.font.renderFont(), PROPERTY_NAME_READING_COLUMNS,
			this.input.liveVisible ? RUNTIME_VALUE_READING_COLUMNS : SOURCE_VALUE_READING_COLUMNS) + 8;
	}

	private readonly pointer = new WorkbenchPropertyTreePointer(pointerHover);
	private readonly actions: WorkbenchActionBarControl;
	private readonly edit: WorkbenchPropertyEdit<LuaFieldValueEdit>;
	private headerLabel = '';
	private headerSource = '';
	private headerLive = false;
	private headerWidth = -1;
	private headerNaturalWidth = 0;
	private readonly actionTooltip = new WorkbenchTooltip();
	private headerFont: typeof editorViewState.font | undefined;
	public constructor(private readonly controller: LuaProgramController,
		private readonly commands: IdeCommandController, private readonly tester: ActionStringTester,
		private readonly frameNavigation: RuntimeFrameNavigation, private readonly contextMenu: ContextMenuController,
		surfaces: WorkbenchSurfaceService, paneSurface: WorkbenchSurface, private readonly workArea: Readonly<RectBounds>) {
		super();
		this.pointer.attachFeedback(surfaces, paneSurface, workArea, this.focusTarget);
		this.actionTooltip.attach(surfaces, paneSurface, workArea);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.focus(), contextMenu);
		this.actions.onDidOpenOverflow = lifetime => {
			const input = this.input;
			input.running = false; this.pointer.hideFeedback(); this.actionTooltip.hide();
			lifetime.add({ dispose: input.onDidInvalidateProjection(() => contextMenu.hide()) });
		};
		this.edit = new WorkbenchPropertyEdit(this.focusTarget, value => value.edit.text, surfaces, paneSurface, workArea);
		this.focusTarget.next = this.actions.focusTarget; this.actions.focusTarget.previous = this.focusTarget;
		this.actions.focusTarget.next = this.focusTarget; this.focusTarget.previous = this.actions.focusTarget;
		this.focusTarget.registerCommand('luaProgram.edit', { isEnabled: () => {
			const property = this.selected();
			return property?.field !== undefined && property.inlineEditable && !this.input.sourceModels.get(property.file.file)!.readOnly;
		}, run: () => this.editProperty() });
		this.focusTarget.registerCommand('luaProgram.add', { isEnabled: () => {
			const property = this.selected() ?? this.input.tree.roots[0]?.element;
			return !this.input.liveVisible && property?.table?.structural === true && !this.input.sourceModels.get(property.table.file.file)!.readOnly;
		}, run: () => this.controller.add(this.input) });
		this.focusTarget.registerCommand('luaProgram.remove', { isEnabled: () => {
			const property = this.selected();
			return property?.field !== undefined && property.container!.structural && !this.input.sourceModels.get(property.file.file)!.readOnly;
		}, run: () => this.controller.remove(this.input) });
		this.focusTarget.registerCommand('luaProgram.source', { isEnabled: () => true, run: () => this.controller.openSource(this.input) });
		this.focusTarget.registerCommand('luaProgram.live', { isEnabled: () => !this.input.liveVisible, run: () => {
			this.input.running = false;
			if (this.input.instance === undefined) this.controller.chooseInstance(this.input);
			else { this.input.liveVisible = true; this.input.liveDirty = true; }
		} });
		this.focusTarget.registerCommand('luaProgram.authoring', { isEnabled: () => this.input.liveVisible,
			run: () => { this.input.running = false; this.input.liveVisible = false; } });
		this.focusTarget.registerCommand('luaProgram.more', { isEnabled: () => this.input.actionBar.overflow!.button.visible, run: () => this.actions.openOverflow() });
		this.focusTarget.registerCommand('luaProgram.selectInstance', { isEnabled: () => this.input.liveVisible,
			run: () => this.controller.chooseInstance(this.input) });
		this.focusTarget.registerCommand('pause', { isEnabled: () => this.input.liveVisible && this.commands.transport.playbackEnabled,
			run: () => { this.input.running = this.commands.transport.togglePlayback(); } });
		for (const [command, direction] of [['stepFrameBack', -1], ['stepFrame', 1]] as const) {
			this.focusTarget.registerCommand(command, {
				isEnabled: () => this.input.liveVisible && this.frameNavigation.canStep(direction),
				run: () => { this.input.running = false; this.frameNavigation.step(direction); },
			});
		}
		this.focusTarget.registerCommand('luaProgram.testInput', { isEnabled: () => this.input.programKind === 'input' && this.tester.canStart(this.input.workingCopy.resource.domain), run: () => {
			const selected = this.selected();
			const pattern = selected?.valueExpression?.kind === LuaSyntaxKind.StringLiteralExpression ? selected.valueExpression.value : '';
			this.tester.open(this.input.workingCopy.resource.domain, pattern);
		} });
		this.focusTarget.registerCommand('contextMenu', { isEnabled: () => true, run: () => {
			const tree = this.input.liveVisible ? this.input.live : this.input.tree;
			this.openContextMenu(tree.layout.contentLeft + 8, tree.layout.contentTop + (tree.selectionIndex - (tree.scroll | 0)) * tree.layout.rowHeight, true);
		} });
		for (const direction of ['undo', 'redo'] as const) this.focusTarget.registerCommand(direction, {
			isEnabled: () => { const model = this.input.workingCopy.history.findModel(this.input.getWorkingCopies(), direction); return model !== undefined && !model.readOnly; },
			run: () => executeTextHistoryCommand(this.input.workingCopy.history.findModel(this.input.getWorkingCopies(), direction)!, direction),
		});
	}
	public override get suspendsRuntime(): boolean { return !this.input.running; }
	public override get runtimeTransport() { return this.runtimeControlContext === undefined ? undefined : this.commands.transport; }
	public override get runtimeControlContext() { return this.input.liveVisible ? this.focusTarget : undefined; }
	public override setRuntimeCaptureRunning(running: boolean): void { if (this.input.liveVisible) this.input.running = running; }
	protected override activate(): void { this.actions.setInput(this.input.actionBar, this.focusTarget); this.update(); }
	public override clearInput(): void { this.input.running = false; this.input.invalidateProjection(); this.edit.close(); this.pointer.clear(); this.actionTooltip.hide(); this.actions.clearInput(); super.clearInput(); }
	public override dispose(): void { this.edit.dispose(); this.pointer.dispose(); this.actionTooltip.detach(); this.actions.dispose(); super.dispose(); }
	private selected() { return this.input.liveVisible ? undefined : this.input.tree.rows[this.input.tree.selectionIndex]?.element; }
	private editProperty(): void {
		this.pointer.hideFeedback();
		const input = this.input, row = input.tree.rows[input.tree.selectionIndex], property = row.element;
		const model = input.sourceModels.get(property.file.file)!, locations = property.file.chunk.locations, field = property.field!;
		const valueRange = locations.range(field.value.span), fieldRange = locations.range(field.span);
		const range = luaSourceRangeToTextRange(model.buffer, valueRange);
		const lifetime = this.edit.open({ model, tree: input.tree, row,
			parse: text => parseLuaFieldValueEdit(model.buffer, locations, field, text),
			apply: value => { model.pushEditOperations([value.edit]); this.controller.refresh(input); },
		}, { edit: { offset: range.start, deleteLength: range.end - range.start, text: readLuaSourceRange(model.buffer, valueRange) }, fieldRange, expressionRange: valueRange });
		lifetime.add({ dispose: input.onDidInvalidateProjection(() => this.edit.close()) });
	}
	public override update(): void {
		this.controller.refresh(this.input); this.controller.refreshRuntime(this.input);
		const input = this.input;
		updateFullWidthWorkbenchLayout(input.layout, this.contentBounds);
		for (const item of input.actionBar.items) {
			item.visible = item.command === 'luaProgram.authoring' ? input.liveVisible
				: item.command === 'luaProgram.live' ? !input.liveVisible
				: item.command === 'luaProgram.add' || item.command === 'luaProgram.edit' ? !input.liveVisible : true;
		}
		const header = input.liveVisible ? input.instanceLabel : input.title;
		const changed = this.headerSource !== header || this.headerLive !== input.liveVisible || this.headerFont !== editorViewState.font;
		if (changed) this.headerNaturalWidth = measureText(header);
		let secondary = 0;
		for (const item of WORKBENCH_MENUS['luaProgram.context']) if (item.type === 'separator' || this.commands.isEnabled(item.command, this.focusTarget)) input.secondaryActions[secondary++] = item;
		input.secondaryActions.length = secondary;
		const actionLeft = Math.min(input.layout.left + this.headerNaturalWidth + 12, input.layout.right - 8 - Math.max(WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH, input.layout.rowHeight + 4));
		layoutWorkbenchActionBar(input.actionBar, input.layout.right - 4, input.layout.top, input.layout.top + input.layout.rowHeight + 4, measureText, editorViewState.font.renderFont(), actionLeft);
		const headerWidth = input.actionBar.bounds.left - input.layout.left - 8;
		if (changed || this.headerWidth !== headerWidth) {
			this.headerSource = header; this.headerLive = input.liveVisible; this.headerWidth = headerWidth; this.headerFont = editorViewState.font;
			this.headerLabel = truncateMeasuredText(input.liveVisible ? `${header} / RUNTIME` : header, headerWidth, measureTextRange);
		}
		layoutWorkbenchPropertyTree(input.liveVisible ? input.live : input.tree, editorViewState.font.renderFont(), measureTextRange,
			input.layout.left + 4, input.layout.top + input.layout.rowHeight + 7, input.layout.right - 4, input.layout.bottom);
		this.pointer.updateFeedback(input.liveVisible ? input.live : input.tree);
		this.edit.update();
		this.actions.update();
		const hint = this.actions.tooltipItem;
		if (hint !== undefined) this.actionTooltip.show(hint.tooltip, hint.bounds, editorViewState.font.renderFont(), measureTextRange, measureText, this.workArea);
		else this.actionTooltip.hide();
	}
	public draw(): void {
		const input = this.input;
		api.fill_rect(input.layout.left, input.layout.top, input.layout.right, input.layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		drawEditorText(editorViewState.font, this.headerLabel, input.layout.left + 4, input.layout.top + 2, 0, colors.COLOR_RESOURCE_VIEWER_TEXT);
		renderWorkbenchActionBar(input.actionBar, editorViewState.font.renderFont(), colors.COLOR_RESOURCE_VIEWER_TEXT, colors.COLOR_DESCRIPTION_TEXT);
		drawWorkbenchPropertyTree(input.liveVisible ? input.live : input.tree);
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void { drawEditorText(editorViewState.font, this.input.status, bounds.left + 4, bounds.top + 2, 0, color); }
	public handleKeyboard(input: KeyInputEvent): void {
		const tree = this.input.liveVisible ? this.input.live : this.input.tree;
		for (const [key, command] of NAVIGATION) if (isKeyDown(key, input)) {
			consumeIdeKey(key, input);
			if (navigateWorkbenchTree(tree, command) === WorkbenchTreeNavigationResult.Collapse && this.input.liveVisible) this.controller.resolveRuntime(this.input);
			this.pointer.keyboardSelection(tree);
			return;
		}
		if (isKeyJustPressed('Enter', input)) {
			consumeIdeKey('Enter', input);
			if (this.input.liveVisible) this.toggleRuntimeProperty();
			else if (this.commands.isEnabled('luaProgram.edit')) this.commands.execute('luaProgram.edit');
		}
		if (isKeyJustPressed('Delete', input)) { consumeIdeKey('Delete', input); if (this.commands.isEnabled('luaProgram.remove')) this.commands.execute('luaProgram.remove'); }
	}
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean, now: number): boolean {
		if (this.actions.handlePointer(snapshot)) return true;
		const result = this.pointer.handle(this.input.liveVisible ? this.input.live : this.input.tree, snapshot, justPressed, now);
		if (result === WorkbenchPropertyPointerResult.Outside) return false;
		if (justPressed || result === WorkbenchPropertyPointerResult.ContextMenu) this.focus();
		if (result === WorkbenchPropertyPointerResult.ContextMenu) this.openContextMenu(snapshot.viewportX, snapshot.viewportY);
		if (this.input.liveVisible) {
			if (result === WorkbenchPropertyPointerResult.Collapse) this.controller.resolveRuntime(this.input);
			if (result === WorkbenchPropertyPointerResult.Activate) this.toggleRuntimeProperty();
		}
		if (result === WorkbenchPropertyPointerResult.Activate && this.commands.isEnabled('luaProgram.edit')) this.commands.execute('luaProgram.edit');
		return true;
	}
	private toggleRuntimeProperty(): void {
		const tree = this.input.live, row = tree.rows[tree.selectionIndex];
		if (row !== undefined && setWorkbenchTreeCollapsed(tree, tree.selectionIndex, !row.collapsed)) this.controller.resolveRuntime(this.input);
	}
	private openContextMenu(x: number, y: number, keyboard = false): void {
		this.pointer.hideFeedback();
		const input = this.input;
		input.running = false;
		const items = WORKBENCH_MENUS['luaProgram.context'].filter(item => item.type !== 'command' || this.commands.isEnabled(item.command, this.focusTarget));
		this.contextMenu.show(x, y, items, this.commands, { selectFirst: keyboard, commandTarget: this.focusTarget,
			onWillShow: lifetime => lifetime.add({ dispose: input.onDidInvalidateProjection(() => this.contextMenu.hide()) }) });
	}
	public handleWheel(event: WheelInputSnapshot): void {
		const tree = this.input.liveVisible ? this.input.live : this.input.tree, layout = tree.layout;
		if (event.viewportX < layout.contentLeft || event.viewportX >= layout.contentRight || event.viewportY < layout.contentTop || event.viewportY >= layout.contentBottom) return;
		scrollWorkbenchList(tree, event.deltaY * 3);
	}
}
const NAVIGATION = [['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['PageUp', 'page-up'], ['PageDown', 'page-down'], ['Home', 'home'], ['End', 'end']] as const;
