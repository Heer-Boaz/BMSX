import { STATUS_PRIORITY_CONTENT, type WorkbenchStatusItem } from '../../common/status_bar';
import type { EditorSourceLocation } from '../../../editor/navigation/source_location';
import type { QuickInputController } from '../../services/quick_input/controller';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import { clamp } from '../../../../machine/ts/common/clamp';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { IdeCommandController } from '../../../commands/controller';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { EditorPaneClearReason } from '../../services/editor/editor_pane';
import { inputFocus, type InputFocusScope, type InputFocusTarget } from '../../../input/focus';
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
import { layoutWorkbenchPropertyTree } from '../../ui/property_tree';
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
import { truncateMeasuredText } from '../../../common/text';
import { WorkbenchTooltip } from '../../ui/tooltip';


export class LuaProgramEditorPane extends WorkbenchViewEditorPane<LuaProgramInput> {
	private readonly statusItem: WorkbenchStatusItem = { text: '', alignment: 'left', priority: STATUS_PRIORITY_CONTENT, overflow: 'ellipsis', tone: 'normal' };
	public readonly statusItems = [this.statusItem];
	public override getSourceLocation(): EditorSourceLocation | undefined {
		const input = this.input;
		return this.controller.getSourceLocation(input);
	}


	private readonly pointer = new WorkbenchPropertyTreePointer(inputFocus, pointerHover, this.focusTarget);
	private readonly actions: WorkbenchActionBarControl;
	private readonly edit: WorkbenchPropertyEdit<LuaFieldValueEdit>;
	private headerLabel = '';
	private headerSource = '';
	private headerLive = false;
	private headerWidth = -1;
	private headerNaturalWidth = 0;
	private readonly actionTooltip = new WorkbenchTooltip();
	private headerFont: typeof editorViewState.font | undefined;
	private unbindInteraction: (() => void) | undefined;
	public constructor(private readonly controller: LuaProgramController,
		private readonly commands: IdeCommandController, private readonly tester: ActionStringTester,
		private readonly contextMenu: ContextMenuController,
		surfaces: WorkbenchSurfaceService, paneSurface: WorkbenchSurface, private readonly workArea: Readonly<RectBounds>, group: EditorGroupView, scope: InputFocusScope, private readonly quickInput: QuickInputController) {
		super(scope);
		this.focusTarget.canFocus = () => this.hasInput && (this.input.liveVisible ? this.input.live : this.input.tree).layout.visibleRowCount > 0;
		this.pointer.attachFeedback(surfaces, paneSurface, workArea);
		this.actionTooltip.attach(surfaces, paneSurface, workArea);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.focus(), contextMenu);
		this.actions.focusTarget.canFocus = () => this.hasInput && this.input.actionBar.bounds.left < this.input.actionBar.bounds.right
			&& this.input.actionBar.bounds.top < this.input.actionBar.bounds.bottom;
		this.actions.onDidOpenOverflow = lifetime => {
			const input = this.input;
			input.interaction.running = false; this.pointer.hideFeedback(); this.actionTooltip.hide();
			lifetime.add({ dispose: input.onDidInvalidateProjection(() => contextMenu.hide()) });
		};
		this.edit = new WorkbenchPropertyEdit(this.focusTarget, value => value.edit.text, surfaces, paneSurface, workArea);
		this.edit.control.field.focusTarget.commandContext = this.focusTarget;
		this.focusTarget.next = this.actions.focusTarget; this.actions.focusTarget.previous = this.focusTarget;
		this.actions.focusTarget.next = this.focusTarget; this.focusTarget.previous = this.actions.focusTarget;
		this.focusTarget.registerCommand('luaProgram.edit', { isEnabled: () => {
			const property = this.selected();
			return property?.field !== undefined && property.inlineEditable && !this.input.sourceModels.get(property.file.file)!.readOnly;
		}, run: () => this.editProperty() });
		this.focusTarget.registerCommand('luaProgram.add', { isEnabled: () => {
			const property = this.selected() ?? this.input.tree.roots[0]?.element;
			return !this.input.liveVisible && property?.table?.structural === true && !this.input.sourceModels.get(property.table.file.file)!.readOnly;
		}, run: () => this.controller.add(this.input, this.quickInput) });
		this.focusTarget.registerCommand('luaProgram.remove', { isEnabled: () => {
			const property = this.selected();
			return property?.field !== undefined && property.container!.structural && !this.input.sourceModels.get(property.file.file)!.readOnly;
		}, run: () => this.controller.remove(this.input) });
		this.focusTarget.registerCommand('luaProgram.live', { isEnabled: () => !this.input.liveVisible, run: () => {
			this.input.interaction.running = false;
			if (this.input.instance === undefined) this.controller.chooseInstance(this.input, this.quickInput);
			else this.input.inspectRuntime(this.commands.transport);
		} });
		this.focusTarget.registerCommand('luaProgram.authoring', { isEnabled: () => this.input.liveVisible,
			run: () => this.input.showAuthoring() });
		this.focusTarget.registerCommand('luaProgram.more', { isEnabled: () => this.input.actionBar.overflow!.button.visible, run: () => this.actions.openOverflow() });
		this.focusTarget.registerCommand('luaProgram.selectInstance', { isEnabled: () => this.input.liveVisible,
			run: () => this.controller.chooseInstance(this.input, this.quickInput) });
		this.focusTarget.registerCommand('pause', { isEnabled: () => this.input.interaction.transport?.playbackEnabled === true,
			run: () => { this.input.interaction.running = this.input.interaction.transport!.togglePlayback(); } });
		for (const [command, direction] of [['stepFrameBack', -1], ['stepFrame', 1]] as const) {
			this.focusTarget.registerCommand(command, {
				isEnabled: () => this.input.interaction.transport?.available === true && this.input.interaction.transport.navigation.canStep(direction),
				run: () => { this.input.interaction.running = false; this.input.interaction.transport!.navigation.step(direction); },
			});
		}
		this.focusTarget.registerCommand('luaProgram.testInput', { isEnabled: () => this.input.programKind === 'input' && this.tester.canStart(this.input.workingCopy.resource.contextId), run: () => {
			const selected = this.selected();
			const pattern = selected?.valueExpression?.kind === LuaSyntaxKind.StringLiteralExpression ? selected.valueExpression.value : '';
			this.tester.open(this.input.workingCopy.resource.contextId, group, this.quickInput, pattern);
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
	protected override activate(): void {
		const input = this.input, interaction = input.interaction, scope = this.focusTarget.scope;
		scope.interaction = interaction;
		const context = { target: this.focusTarget, interaction };
		const bindRuntime = () => {
			scope.runtime = interaction.transport === null ? undefined : context;
			this.pointer.setInput(input.liveVisible ? input.live : input.tree);
		};
		bindRuntime();
		this.unbindInteraction = interaction.onDidChange(bindRuntime);
		this.actions.setInput(this.input.actionBar, this.focusTarget); this.update();
	}
	public override layout(bounds: Readonly<RectBounds>): void { super.layout(bounds); this.layoutInput(); }
	public override get commandTarget(): InputFocusTarget { return this.focusTarget.canFocus!() ? this.focusTarget : this.actions.focusTarget; }
	public override clearInput(reason: EditorPaneClearReason = 'deactivate'): void {
		if (reason !== 'move') this.input.interaction.running = false;
		this.input.invalidateProjection(); this.edit.close(); this.pointer.clear(); this.actionTooltip.hide(); this.actions.clearInput();
		super.clearInput(reason);
		this.unbindInteraction!(); this.unbindInteraction = undefined;
	}
	public override dispose(): void { this.unbindInteraction?.(); this.edit.dispose(); this.pointer.dispose(); this.actionTooltip.detach(); this.actions.dispose(); super.dispose(); }
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
		this.layoutInput();
		this.pointer.updateFeedback();
		this.edit.update();
		this.actions.update();
		const hint = this.actions.tooltipItem;
		if (hint !== undefined) this.actionTooltip.show(hint.tooltip, hint.bounds, editorViewState.font.renderFont(), measureTextRange, measureText, this.workArea);
		else this.actionTooltip.hide();
	}
	private layoutInput(): void {
		const input = this.input;
		updateFullWidthWorkbenchLayout(input.layout, this.contentBounds);
		const header = input.liveVisible ? input.instanceLabel : input.title;
		const changed = this.headerSource !== header || this.headerLive !== input.liveVisible || this.headerFont !== editorViewState.font;
		if (changed) this.headerNaturalWidth = measureText(header);
		const left = clamp(input.layout.left + 4, input.layout.left, input.layout.right), right = clamp(input.layout.right - 4, left, input.layout.right);
		const actionLeft = clamp(input.layout.left + this.headerNaturalWidth + 12, left, Math.max(left, right - 4 - Math.max(WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH, input.layout.rowHeight + 4)));
		layoutWorkbenchActionBar(input.actionBar, right, input.layout.top, Math.min(input.layout.bottom, input.layout.top + input.layout.rowHeight + 4), measureText, editorViewState.font.renderFont(), actionLeft);
		const headerWidth = input.actionBar.bounds.left - input.layout.left - 8;
		if (changed || this.headerWidth !== headerWidth) {
			this.headerSource = header; this.headerLive = input.liveVisible; this.headerWidth = headerWidth; this.headerFont = editorViewState.font;
			this.headerLabel = truncateMeasuredText(input.liveVisible ? `${header} / RUNTIME` : header, headerWidth, measureTextRange);
		}
		const tree = input.liveVisible ? input.live : input.tree;
		layoutWorkbenchPropertyTree(tree, editorViewState.font.renderFont(), measureTextRange,
			left, Math.min(input.layout.bottom, input.layout.top + input.layout.rowHeight + 7), right, input.layout.bottom);
		if (tree.layout.visibleRowCount === 0) {
			if (this.edit.active) this.edit.close();
			this.pointer.clear(); this.focusTarget.release();
		} else this.pointer.setInput(tree);
		if (!this.actions.focusTarget.canFocus!()) {
			pointerCapture.cancelTarget(this.actions);
			pointerHover.release(this.actions);
			this.actions.focusTarget.release();
		}
	}
	public draw(): void {
		const input = this.input;
		api.fill_rect(input.layout.left, input.layout.top, input.layout.right, input.layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		drawEditorText(editorViewState.font, this.headerLabel, input.layout.left + 4, input.layout.top + 2, 0, colors.COLOR_RESOURCE_VIEWER_TEXT);
		renderWorkbenchActionBar(input.actionBar, editorViewState.font.renderFont(), colors.COLOR_RESOURCE_VIEWER_TEXT, colors.COLOR_DESCRIPTION_TEXT);
		drawWorkbenchPropertyTree(input.liveVisible ? input.live : input.tree);
	}
	public updateStatus(): void { this.statusItem.text = this.input.status; }
	public handleKeyboard(input: KeyInputEvent): void {
		const tree = this.input.liveVisible ? this.input.live : this.input.tree;
		for (const [key, command] of NAVIGATION) if (isKeyDown(key, input)) {
			consumeIdeKey(key, input);
			if (navigateWorkbenchTree(tree, command) === WorkbenchTreeNavigationResult.Collapse && this.input.liveVisible) this.controller.resolveRuntime(this.input);
			this.pointer.keyboardSelection();
			return;
		}
		if (isKeyJustPressed('Enter', input)) {
			consumeIdeKey('Enter', input);
			if (this.input.liveVisible) this.toggleRuntimeProperty();
			else this.commands.execute('luaProgram.edit', this.focusTarget);
		}
		if (isKeyJustPressed('Delete', input)) { consumeIdeKey('Delete', input); this.commands.execute('luaProgram.remove', this.focusTarget); }
	}
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean, now: number): boolean {
		if (this.actions.handlePointer(snapshot)) return true;
		const result = this.pointer.handle(snapshot, justPressed, now);
		if (result === WorkbenchPropertyPointerResult.Outside) return false;
		if (result === WorkbenchPropertyPointerResult.Rejected) return true;
		if (result === WorkbenchPropertyPointerResult.ContextMenu) this.openContextMenu(snapshot.viewportX, snapshot.viewportY);
		if (this.input.liveVisible) {
			if (result === WorkbenchPropertyPointerResult.Collapse) this.controller.resolveRuntime(this.input);
			if (result === WorkbenchPropertyPointerResult.Activate) this.toggleRuntimeProperty();
		}
		if (result === WorkbenchPropertyPointerResult.Activate) this.commands.execute('luaProgram.edit', this.focusTarget);
		return true;
	}
	private toggleRuntimeProperty(): void {
		const tree = this.input.live, row = tree.rows[tree.selectionIndex];
		if (row !== undefined && setWorkbenchTreeCollapsed(tree, tree.selectionIndex, !row.collapsed)) this.controller.resolveRuntime(this.input);
	}
	private openContextMenu(x: number, y: number, keyboard = false): void {
		this.pointer.hideFeedback();
		const input = this.input;
		input.interaction.running = false;
		this.contextMenu.show(x, y, input.contextActions, this.commands, { selectFirst: keyboard, commandTarget: this.focusTarget,
			onWillShow: lifetime => lifetime.add({ dispose: input.onDidInvalidateProjection(() => this.contextMenu.hide()) }) });
	}
	public handleWheel(event: WheelInputSnapshot): void {
		const tree = this.input.liveVisible ? this.input.live : this.input.tree, layout = tree.layout;
		if (event.viewportX < layout.contentLeft || event.viewportX >= layout.contentRight || event.viewportY < layout.contentTop || event.viewportY >= layout.contentBottom) return;
		scrollWorkbenchList(tree, event.deltaY * 3);
	}
}
const NAVIGATION = [['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['PageUp', 'page-up'], ['PageDown', 'page-down'], ['Home', 'home'], ['End', 'end']] as const;
