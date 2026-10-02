import type { ContextMenuController } from '../../services/context_menu/controller';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../../common/models';
import type { IdeCommandController } from '../../../commands/controller';
import { inputFocus } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import { editorViewState } from '../../../editor/ui/view/state';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { executeTextHistoryCommand } from '../../../editor/editing/history_commands';
import { parseLuaFieldValueEdit, type LuaFieldValueEdit } from '../../../language/lua/field_value_edit';
import { readLuaSourceRange, luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { layoutWorkbenchPropertyTree } from '../../ui/property_tree';
import { drawWorkbenchPropertyTree } from '../../render/property_tree';
import { WorkbenchPropertyTreePointer, WorkbenchPropertyPointerResult } from '../../ui/property_tree_pointer';
import { WorkbenchPropertyEdit } from '../../ui/property_edit';
import { navigateWorkbenchTree, setWorkbenchTreeCollapsed, WorkbenchTreeNavigationResult } from '../../ui/tree_view';
import { scrollWorkbenchList } from '../../ui/list_view';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { LuaProgramController } from './controller';
import type { LuaProgramInput } from './editor_input';
import * as colors from '../../../common/constants';
import { LuaSyntaxKind } from '../../../../toolchain/ts/lua/syntax/ast';
import type { ActionStringTester } from '../scenario_lab/actionstring';
import type { RuntimeFrameNavigation } from '../../../runtime/frame_navigation';
import { truncateMeasuredText } from '../../../common/text';

export class LuaProgramEditorPane extends FullWidthWorkbenchEditorPane<LuaProgramInput> {
	private readonly pointer = new WorkbenchPropertyTreePointer(pointerHover);
	private readonly actions: WorkbenchActionBarControl;
	private readonly edit: WorkbenchPropertyEdit<LuaFieldValueEdit>;
	private headerLabel = '';
	private headerSource = '';
	private headerLive = false;
	private headerWidth = -1;
	private headerFont: typeof editorViewState.font | undefined;
	public constructor(resources: ResourcePanelController, private readonly controller: LuaProgramController,
		private readonly commands: IdeCommandController, private readonly tester: ActionStringTester,
		private readonly frameNavigation: RuntimeFrameNavigation, private readonly contextMenu: ContextMenuController) {
		super(resources);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget);
		this.edit = new WorkbenchPropertyEdit(this.focusTarget, value => value.edit.text);
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
		this.focusTarget.registerCommand('luaProgram.more', { isEnabled: () => true, run: () => {
			const bounds = this.input.actionBar.items.find(item => item.command === 'luaProgram.more')!.bounds;
			this.openContextMenu(bounds.left, bounds.bottom, true);
		} });
		this.focusTarget.registerCommand('luaProgram.selectInstance', { isEnabled: () => this.input.liveVisible,
			run: () => this.controller.chooseInstance(this.input) });
		this.focusTarget.registerCommand('runtime.pause', { isEnabled: () => this.input.liveVisible, run: () => { this.input.running = false; } });
		this.focusTarget.registerCommand('pause', { isEnabled: () => this.input.liveVisible && this.commands.isEnabled('gameView.playback'),
			run: () => { this.input.running = this.commands.toggleGamePlayback(); } });
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
			this.openContextMenu(tree.layout.contentLeft + 8, tree.layout.contentTop + (tree.selectionIndex - tree.scroll) * tree.layout.rowHeight, true);
		} });
		for (const direction of ['undo', 'redo'] as const) this.focusTarget.registerCommand(direction, {
			isEnabled: () => { const model = this.input.workingCopy.history.findModel(this.input.getWorkingCopies(), direction); return model !== undefined && !model.readOnly; },
			run: () => executeTextHistoryCommand(this.input.workingCopy.history.findModel(this.input.getWorkingCopies(), direction)!, direction),
		});
	}
	public override get suspendsRuntime(): boolean { return !this.input.running; }
	public override get runtimeControlContext() { return this.input.liveVisible ? this.focusTarget : undefined; }
	protected override activate(): void { super.activate(); this.actions.setInput(this.input.actionBar, this.focusTarget); this.update(); }
	public override clearInput(): void { this.input.running = false; this.input.invalidateProjection(); this.edit.close(); this.pointer.clear(); this.actions.clearInput(); super.clearInput(); }
	public override dispose(): void { this.edit.dispose(); this.pointer.clear(); this.actions.dispose(); super.dispose(); }
	private selected() { return this.input.liveVisible ? undefined : this.input.tree.rows[this.input.tree.selectionIndex]?.element; }
	private editProperty(): void {
		const input = this.input, row = input.tree.rows[input.tree.selectionIndex], property = row.element;
		const model = input.sourceModels.get(property.file.file)!, locations = property.file.chunk.locations, field = property.field!;
		const valueRange = locations.range(field.value.span), fieldRange = locations.range(field.span);
		const range = luaSourceRangeToTextRange(model.buffer, valueRange);
		const lifetime = this.edit.open({ model, tree: input.tree, row,
			parse: text => parseLuaFieldValueEdit(model.buffer, locations, field, text),
			apply: value => model.pushEditOperations([value.edit]),
		}, { edit: { offset: range.start, deleteLength: range.end - range.start, text: readLuaSourceRange(model.buffer, valueRange) }, fieldRange, expressionRange: valueRange });
		lifetime.add({ dispose: input.onDidInvalidateProjection(() => this.edit.close()) });
	}
	public override update(): void {
		this.controller.refresh(this.input); this.controller.refreshRuntime(this.input); this.edit.update();
		const input = this.input;
		updateFullWidthWorkbenchLayout(input.layout);
		for (const item of input.actionBar.items) {
			item.visible = item.command === 'luaProgram.authoring' ? input.liveVisible
				: item.command === 'luaProgram.live' ? !input.liveVisible
				: item.command === 'luaProgram.add' || item.command === 'luaProgram.edit' ? !input.liveVisible : true;
		}
		layoutWorkbenchActionBar(input.actionBar, input.layout.right - 4, input.layout.top, input.layout.top + input.layout.rowHeight + 4, measureText, editorViewState.font.renderFont());
		const header = input.liveVisible ? input.instanceLabel : input.title;
		const headerWidth = input.actionBar.items.find(item => item.visible)!.bounds.left - input.layout.left - 12;
		if (this.headerSource !== header || this.headerLive !== input.liveVisible || this.headerWidth !== headerWidth || this.headerFont !== editorViewState.font) {
			this.headerSource = header; this.headerLive = input.liveVisible; this.headerWidth = headerWidth; this.headerFont = editorViewState.font;
			this.headerLabel = truncateMeasuredText(input.liveVisible ? `${header} / RUNTIME` : header, headerWidth, measureTextRange);
		}
		layoutWorkbenchPropertyTree(input.liveVisible ? input.live : input.tree, editorViewState.font.renderFont(), measureTextRange,
			input.layout.left + 4, input.layout.top + input.layout.rowHeight + 7, input.layout.right - 4, input.layout.bottom);
		this.actions.update();
	}
	public draw(): void {
		const input = this.input;
		drawEditorText(editorViewState.font, this.headerLabel, input.layout.left + 4, input.layout.top + 2, 0, colors.COLOR_RESOURCE_VIEWER_TEXT);
		renderWorkbenchActionBar(input.actionBar, this.commands, editorViewState.font.renderFont());
		drawWorkbenchPropertyTree(input.liveVisible ? input.live : input.tree);
		if (this.edit.active) this.edit.draw();
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void { drawEditorText(editorViewState.font, this.input.status, bounds.left + 4, bounds.top + 2, 0, color); }
	public handleKeyboard(input: PlayerInput): void {
		const tree = this.input.liveVisible ? this.input.live : this.input.tree;
		for (const [key, command] of NAVIGATION) if (shouldRepeatKeyFromPlayer(key, input)) {
			consumeIdeKey(key, input);
			if (navigateWorkbenchTree(tree, command) === WorkbenchTreeNavigationResult.Collapse && this.input.liveVisible) this.controller.resolveRuntime(this.input);
			return;
		}
		if (isKeyJustPressed('Enter', input)) {
			consumeIdeKey('Enter', input);
			if (this.input.liveVisible) this.toggleRuntimeProperty();
			else if (this.commands.isEnabled('luaProgram.edit')) this.commands.execute('luaProgram.edit');
		}
		if (isKeyJustPressed('Delete', input)) { consumeIdeKey('Delete', input); if (this.commands.isEnabled('luaProgram.remove')) this.commands.execute('luaProgram.remove'); }
	}
	protected override handleViewPointer(snapshot: PointerSnapshot, justPressed: boolean, now: number): boolean {
		if (this.edit.handlePointer(snapshot) || this.actions.handlePointer(snapshot)) return true;
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
		const input = this.input;
		input.running = false;
		const items = WORKBENCH_MENUS['luaProgram.context'].filter(item => item.type !== 'command' || this.commands.isEnabled(item.command));
		const lifetime = this.contextMenu.show(x, y, items, this.commands, keyboard);
		lifetime.add({ dispose: input.onDidInvalidateProjection(() => this.contextMenu.hide()) });
	}
	public handleWheel(direction: number, steps: number, pointer: PointerSnapshot | null, input: PlayerInput): void {
		if (pointer === null) return;
		const tree = this.input.liveVisible ? this.input.live : this.input.tree, layout = tree.layout;
		if (pointer.viewportX < layout.contentLeft || pointer.viewportX >= layout.contentRight || pointer.viewportY < layout.contentTop || pointer.viewportY >= layout.contentBottom) return;
		scrollWorkbenchList(tree, direction * steps * 3); input.inputHandlers.pointer?.consumeButton('pointer_wheel');
	}
}
const NAVIGATION = [['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['PageUp', 'page-up'], ['PageDown', 'page-down'], ['Home', 'home'], ['End', 'end']] as const;
