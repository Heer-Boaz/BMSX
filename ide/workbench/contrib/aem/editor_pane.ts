import type { EditorSourceLocation } from '../../../editor/navigation/source_location';
import type { QuickInputController } from '../../services/quick_input/controller';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { IdeCommandController } from '../../../commands/controller';
import type { EditorTextEdit } from '../../../editor/model/text_model';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { inputFocus, type InputFocusScope } from '../../../input/focus';
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
import { layoutWorkbenchPropertyTree } from '../../ui/property_tree';
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
import { AemNavigationSelection } from './navigation_selection';
import * as colors from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';


export class AemEditorPane extends WorkbenchViewEditorPane<AemEditorInput> {
	public override getSourceLocation(): EditorSourceLocation | undefined {
		const input = this.input;
		return this.controller.getSourceLocation(input);
	}

	public override getSelection(): AemNavigationSelection { return new AemNavigationSelection(this.input); }

	private readonly pointer = new WorkbenchPropertyTreePointer(inputFocus, pointerHover, this.focusTarget);
	private readonly actions: WorkbenchActionBarControl;
	private readonly edit: WorkbenchPropertyEdit<EditorTextEdit>;
	private readonly actionTooltip = new WorkbenchTooltip();
	public constructor(private readonly controller: AemEditorController, private readonly commands: IdeCommandController, private readonly contextMenu: ContextMenuController,
		surfaces: WorkbenchSurfaceService, paneSurface: WorkbenchSurface, private readonly workArea: Readonly<RectBounds>, scope: InputFocusScope, private readonly quickInput: QuickInputController) {
		super(scope);
		this.focusTarget.canFocus = () => this.hasInput && this.input.tree.layout.visibleRowCount > 0;
		this.pointer.attachFeedback(surfaces, paneSurface, workArea);
		this.actionTooltip.attach(surfaces, paneSurface, workArea);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.focus(), contextMenu);
		this.actions.focusTarget.canFocus = () => this.hasInput && this.input.actionBar.bounds.left < this.input.actionBar.bounds.right
			&& this.input.actionBar.bounds.top < this.input.actionBar.bounds.bottom;
		this.actions.onDidOpenOverflow = lifetime => {
			this.pointer.hideFeedback(); this.actionTooltip.hide();
			lifetime.add({ dispose: this.input.workingCopy.onDidChangeContent(() => contextMenu.hide()) });
		};
		this.edit = new WorkbenchPropertyEdit(this.focusTarget, value => value.text, surfaces, paneSurface, workArea);
		this.edit.control.field.focusTarget.commandContext = this.focusTarget;
		this.focusTarget.next = this.actions.focusTarget; this.actions.focusTarget.previous = this.focusTarget;
		this.actions.focusTarget.next = this.focusTarget; this.focusTarget.previous = this.actions.focusTarget;
		this.focusTarget.registerCommand('aem.edit', { isEnabled: () => !this.input.workingCopy.readOnly && this.input.tree.rows[this.input.tree.selectionIndex]?.element.inlineEditable === true,
			run: () => this.editProperty() });
		this.focusTarget.registerCommand('aem.add', { isEnabled: () => this.controller.canAdd(this.input), run: () => this.controller.add(this.input, this.quickInput) });
		this.focusTarget.registerCommand('aem.remove', { isEnabled: () => !this.input.workingCopy.readOnly && this.input.tree.rows[this.input.tree.selectionIndex]?.element.parent !== undefined,
			run: () => this.controller.remove(this.input) });
		this.focusTarget.registerCommand('aem.apply', { isEnabled: () => !this.input.applying, run: () => this.controller.apply(this.input, this.quickInput) });
		this.focusTarget.registerCommand('contextMenu', { isEnabled: () => true, run: () => {
			const tree = this.input.tree;
			this.openContextMenu(tree.layout.contentLeft + 8, tree.layout.contentTop + (tree.selectionIndex - (tree.scroll | 0)) * tree.layout.rowHeight, true);
		} });
		for (const direction of ['undo', 'redo'] as const) this.focusTarget.registerCommand(direction, {
			isEnabled: () => !this.input.workingCopy.readOnly && (direction === 'undo' ? this.input.workingCopy.history.canUndo(this.input.workingCopy) : this.input.workingCopy.history.canRedo(this.input.workingCopy)),
			run: () => executeTextHistoryCommand(this.input.workingCopy, direction),
		});
	}
	protected override activate(): void {
		projectAemSource(this.input);
		this.actions.setInput(this.input.actionBar, this.focusTarget); this.pointer.setInput(this.input.tree);
		this.layoutInput();
	}
	public override setOptions(_selection?: EditorTextSelection, navigationSelection?: AemNavigationSelection): void {
		if (navigationSelection === undefined) return;
		this.edit.close(); this.pointer.clear();
		navigationSelection.restore(this.input);
		this.update();
	}
	public override layout(bounds: Readonly<RectBounds>): void { super.layout(bounds); this.layoutInput(); }
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
		projectAemSource(this.input);
		this.layoutInput();
		this.pointer.updateFeedback();
		this.edit.update();
		this.actions.update();
		const hint = this.actions.tooltipItem;
		if (hint !== undefined) this.actionTooltip.show(hint.tooltip, hint.bounds, editorViewState.font.renderFont(), measureTextRange, measureText, this.workArea);
		else this.actionTooltip.hide();
	}
	private layoutInput(): void {
		updateFullWidthWorkbenchLayout(this.input.layout, this.contentBounds);
		const { layout, actionBar, tree } = this.input;
		const font = editorViewState.font.renderFont();
		const left = clamp(layout.left + 4, layout.left, layout.right), right = clamp(layout.right - 4, left, layout.right);
		layoutWorkbenchActionBar(actionBar, right, layout.top, Math.min(layout.bottom, layout.top + layout.rowHeight + 4), measureText, font, left);
		layoutWorkbenchPropertyTree(tree, font, measureTextRange, left,
			Math.min(layout.bottom, layout.top + layout.rowHeight + 7), right, layout.bottom);
		if (tree.layout.visibleRowCount === 0) { this.pointer.clear(); this.focusTarget.release(); }
		else this.pointer.setInput(tree);
		if (!this.actions.focusTarget.canFocus!()) {
			pointerCapture.cancelTarget(this.actions);
			pointerHover.release(this.actions);
			this.actions.focusTarget.release();
		}
	}
	public draw(): void {
		const input = this.input;
		if (input.layout.left === input.layout.right || input.layout.top === input.layout.bottom) return;
		api.fill_rect(input.layout.left, input.layout.top, input.layout.right, input.layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		renderWorkbenchActionBar(input.actionBar, editorViewState.font.renderFont(), colors.COLOR_RESOURCE_VIEWER_TEXT, colors.COLOR_DESCRIPTION_TEXT);
		drawWorkbenchPropertyTree(input.tree);
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void { drawEditorText(editorViewState.font, this.input.status || this.input.applyStatus, bounds.left + 4, bounds.top + 2, 0, color); }
	public handleKeyboard(input: KeyInputEvent): void {
		for (const [key, command] of NAVIGATION) if (isKeyDown(key, input)) {
			consumeIdeKey(key, input); navigateWorkbenchTree(this.input.tree, command); this.pointer.keyboardSelection(); return;
		}
		if (isKeyJustPressed('Enter', input)) { consumeIdeKey('Enter', input); this.commands.execute('aem.edit', this.focusTarget); }
		if (isKeyJustPressed('Delete', input)) { consumeIdeKey('Delete', input); this.commands.execute('aem.remove', this.focusTarget); }
	}
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean, now: number): boolean {
		if (this.actions.handlePointer(snapshot)) return true;
		const result = this.pointer.handle(snapshot, justPressed, now);
		if (result === WorkbenchPropertyPointerResult.Outside) return false;
		if (result === WorkbenchPropertyPointerResult.Rejected) return true;
		if (result === WorkbenchPropertyPointerResult.ContextMenu) this.openContextMenu(snapshot.viewportX, snapshot.viewportY);
		if (result === WorkbenchPropertyPointerResult.Activate) this.commands.execute('aem.edit', this.focusTarget);
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
