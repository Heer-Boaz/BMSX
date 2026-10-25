import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { IdeCommandController } from '../../../commands/controller';
import type { EditorTextEdit } from '../../../editor/model/text_model';
import { inputFocus } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { consumeIdeKey, isKeyJustPressed, isKeyDown } from '../../../input/keyboard/key_input';
import { editorViewState } from '../../../editor/ui/view/state';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { executeTextHistoryCommand } from '../../../editor/editing/history_commands';
import { createStructuredValueEdit } from '../../../language/yaml/structured_edits';
import { aemDocumentFormat } from '../../../../toolchain/ts/rompack/aem';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { layoutWorkbenchPropertyTree, measureWorkbenchPropertyTreeMinimumWidth } from '../../ui/property_tree';
import { drawWorkbenchPropertyTree } from '../../render/property_tree';
import { WorkbenchPropertyTreePointer, WorkbenchPropertyPointerResult } from '../../ui/property_tree_pointer';
import { WorkbenchPropertyEdit } from '../../ui/property_edit';
import { navigateWorkbenchTree } from '../../ui/tree_view';
import { scrollWorkbenchList } from '../../ui/list_view';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import type { AemEditorController } from './controller';
import type { AemEditorInput } from './editor_input';
import { clamp } from '../../../../machine/ts/common/clamp';
import { WorkbenchTooltip } from '../../ui/tooltip';
import { projectAemSource } from './source';
import * as colors from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';

const PROPERTY_NAME_READING_COLUMNS = 12;
const EXPRESSION_READING_COLUMNS = 20;

export class AemEditorPane extends WorkbenchViewEditorPane<AemEditorInput> {
	// A root property keeps a meaningful source name and expression, including its tree/control lanes.
	public override get companionGameMinimumWidth(): number {
		return measureWorkbenchPropertyTreeMinimumWidth(editorViewState.font.renderFont(), PROPERTY_NAME_READING_COLUMNS, EXPRESSION_READING_COLUMNS) + 8;
	}

	private readonly pointer = new WorkbenchPropertyTreePointer(pointerHover);
	private readonly actions: WorkbenchActionBarControl;
	private readonly edit: WorkbenchPropertyEdit<EditorTextEdit>;
	private readonly actionTooltip = new WorkbenchTooltip();
	public constructor(private readonly controller: AemEditorController, private readonly commands: IdeCommandController, private readonly contextMenu: ContextMenuController,
		surfaces: WorkbenchSurfaceService, paneSurface: WorkbenchSurface, private readonly workArea: Readonly<RectBounds>) {
		super();
		this.focusTarget.canFocus = () => this.hasInput && this.input.tree.layout.visibleRowCount > 0;
		this.pointer.attachFeedback(surfaces, paneSurface, workArea, this.focusTarget);
		this.actionTooltip.attach(surfaces, paneSurface, workArea);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.focus(), contextMenu);
		this.actions.focusTarget.canFocus = () => this.hasInput && this.input.actionBar.bounds.left < this.input.actionBar.bounds.right
			&& this.input.actionBar.bounds.top < this.input.actionBar.bounds.bottom;
		this.actions.onDidOpenOverflow = lifetime => {
			this.pointer.hideFeedback(); this.actionTooltip.hide();
			lifetime.add({ dispose: this.input.workingCopy.onDidChangeContent(() => contextMenu.hide()) });
		};
		this.edit = new WorkbenchPropertyEdit(this.focusTarget, value => value.text, surfaces, paneSurface, workArea);
		this.focusTarget.next = this.actions.focusTarget; this.actions.focusTarget.previous = this.focusTarget;
		this.actions.focusTarget.next = this.focusTarget; this.focusTarget.previous = this.actions.focusTarget;
		this.focusTarget.registerCommand('aem.edit', { isEnabled: () => !this.input.workingCopy.readOnly && this.input.tree.rows[this.input.tree.selectionIndex]?.element.inlineEditable === true,
			run: () => this.editProperty() });
		this.focusTarget.registerCommand('aem.add', { isEnabled: () => this.controller.canAdd(this.input), run: () => this.controller.add(this.input) });
		this.focusTarget.registerCommand('aem.remove', { isEnabled: () => !this.input.workingCopy.readOnly && this.input.tree.rows[this.input.tree.selectionIndex]?.element.parent !== undefined,
			run: () => this.controller.remove(this.input) });
		this.focusTarget.registerCommand('aem.source', { isEnabled: () => true, run: () => this.controller.openSource(this.input) });
		this.focusTarget.registerCommand('contextMenu', { isEnabled: () => true, run: () => {
			const tree = this.input.tree;
			this.openContextMenu(tree.layout.contentLeft + 8, tree.layout.contentTop + (tree.selectionIndex - (tree.scroll | 0)) * tree.layout.rowHeight, true);
		} });
		for (const direction of ['undo', 'redo'] as const) this.focusTarget.registerCommand(direction, {
			isEnabled: () => !this.input.workingCopy.readOnly && (direction === 'undo' ? this.input.workingCopy.history.canUndo(this.input.workingCopy) : this.input.workingCopy.history.canRedo(this.input.workingCopy)),
			run: () => executeTextHistoryCommand(this.input.workingCopy, direction),
		});
	}
	protected override activate(): void { this.actions.setInput(this.input.actionBar, this.focusTarget); }
	public override layout(bounds: Readonly<RectBounds>): void { super.layout(bounds); this.update(); }
	public override clearInput(): void { this.edit.close(); this.pointer.clear(); this.actionTooltip.hide(); this.actions.clearInput(); super.clearInput(); }
	public override dispose(): void { this.edit.dispose(); this.pointer.dispose(); this.actionTooltip.detach(); this.actions.dispose(); super.dispose(); }
	private editProperty(): void {
		this.pointer.hideFeedback();
		const input = this.input, row = input.tree.rows[input.tree.selectionIndex], model = input.workingCopy, range = row.element.node.range!;
		const lifetime = this.edit.open({ model, tree: input.tree, row,
			parse: text => {
				try { return { value: createStructuredValueEdit(input.source, aemDocumentFormat(model.resource.path), row.element.node, text) }; }
				catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
			}, apply: edit => { model.pushEditOperations([edit]); projectAemSource(input); },
		}, { offset: range[0], deleteLength: range[1] - range[0], text: input.source.slice(range[0], range[1]) });
		lifetime.add({ dispose: model.onDidChangeContent(() => this.edit.close()) });
	}
	public override update(): void {
		projectAemSource(this.input); updateFullWidthWorkbenchLayout(this.input.layout, this.contentBounds);
		const { layout, actionBar, tree } = this.input;
		const font = editorViewState.font.renderFont();
		const left = clamp(layout.left + 4, layout.left, layout.right), right = clamp(layout.right - 4, left, layout.right);
		layoutWorkbenchActionBar(actionBar, right, layout.top, Math.min(layout.bottom, layout.top + layout.rowHeight + 4), measureText, font, left);
		layoutWorkbenchPropertyTree(tree, font, measureTextRange, left,
			Math.min(layout.bottom, layout.top + layout.rowHeight + 7), right, layout.bottom);
		if (tree.layout.visibleRowCount === 0) { this.pointer.clear(); this.focusTarget.release(); }
		if (!this.actions.focusTarget.canFocus!()) {
			pointerCapture.cancelTarget(this.actions);
			pointerHover.release(this.actions);
			this.actions.focusTarget.release();
		}
		this.pointer.updateFeedback(tree);
		this.edit.update();
		this.actions.update();
		const hint = this.actions.tooltipItem;
		if (hint !== undefined) this.actionTooltip.show(hint.tooltip, hint.bounds, font, measureTextRange, measureText, this.workArea);
		else this.actionTooltip.hide();
	}
	public draw(): void {
		const input = this.input;
		if (input.layout.left === input.layout.right || input.layout.top === input.layout.bottom) return;
		api.fill_rect(input.layout.left, input.layout.top, input.layout.right, input.layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		renderWorkbenchActionBar(input.actionBar, editorViewState.font.renderFont(), colors.COLOR_RESOURCE_VIEWER_TEXT, colors.COLOR_DESCRIPTION_TEXT);
		drawWorkbenchPropertyTree(input.tree);
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void { drawEditorText(editorViewState.font, this.input.status, bounds.left + 4, bounds.top + 2, 0, color); }
	public handleKeyboard(input: KeyInputEvent): void {
		for (const [key, command] of NAVIGATION) if (isKeyDown(key, input)) {
			consumeIdeKey(key, input); navigateWorkbenchTree(this.input.tree, command); this.pointer.keyboardSelection(this.input.tree); return;
		}
		if (isKeyJustPressed('Enter', input)) { consumeIdeKey('Enter', input); if (this.commands.isEnabled('aem.edit')) this.commands.execute('aem.edit'); }
		if (isKeyJustPressed('Delete', input)) { consumeIdeKey('Delete', input); if (this.commands.isEnabled('aem.remove')) this.commands.execute('aem.remove'); }
	}
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean, now: number): boolean {
		if (this.actions.handlePointer(snapshot)) return true;
		const result = this.pointer.handle(this.input.tree, snapshot, justPressed, now);
		if (result === WorkbenchPropertyPointerResult.Outside) return false;
		if (justPressed || result === WorkbenchPropertyPointerResult.ContextMenu) this.focus();
		if (result === WorkbenchPropertyPointerResult.ContextMenu) this.openContextMenu(snapshot.viewportX, snapshot.viewportY);
		if (result === WorkbenchPropertyPointerResult.Activate && this.commands.isEnabled('aem.edit')) this.commands.execute('aem.edit');
		return true;
	}
	private openContextMenu(x: number, y: number, keyboard = false): void {
		this.pointer.hideFeedback();
		const input = this.input;
		this.contextMenu.show(x, y, WORKBENCH_MENUS['aem.context'], this.commands, { selectFirst: keyboard, commandTarget: this.focusTarget,
			onWillShow: lifetime => { lifetime.add({ dispose: input.workingCopy.onDidChangeContent(() => this.contextMenu.hide()) }); },
		});
	}
	public handleWheel(event: WheelInputSnapshot): void {
		const tree = this.input.tree, layout = tree.layout;
		if (event.viewportX < layout.contentLeft || event.viewportX >= layout.contentRight || event.viewportY < layout.contentTop || event.viewportY >= layout.contentBottom) return;
		scrollWorkbenchList(tree, event.deltaY * 3);
	}
}
const NAVIGATION = [['ArrowUp', 'up'], ['ArrowDown', 'down'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'], ['PageUp', 'page-up'], ['PageDown', 'page-down'], ['Home', 'home'], ['End', 'end']] as const;
