import { STATUS_PRIORITY_CONTENT, type WorkbenchStatusItem } from '../../common/status_bar';
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
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { inputFocus, type FocusCommandInvocation, type InputFocusScope } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { consumeIdeKey, isKeyJustPressed, isKeyDown } from '../../../input/keyboard/key_input';
import { editorViewState } from '../../../editor/ui/view/state';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { executeTextHistoryCommand } from '../../../editor/editing/history_commands';
import { createStructuredValueEdit, type StructuredValueEdit } from '../../../language/yaml/structured_edits';
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
import type { AemEditorInput, AemProperty } from './editor_input';
import { clamp } from '../../../../machine/ts/common/clamp';
import { WorkbenchTooltip } from '../../ui/tooltip';
import { projectAemSource } from './source';
import { AemNavigationSelection } from './navigation_selection';
import * as colors from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { findEditorGroup, type EditorGroupView } from '../../services/editor/editor_group';


export class AemEditorPane extends WorkbenchViewEditorPane<AemEditorInput> {
	private readonly statusItem: WorkbenchStatusItem = { text: '', alignment: 'left', priority: STATUS_PRIORITY_CONTENT, overflow: 'ellipsis', tone: 'normal' };
	public readonly statusItems = [this.statusItem];
	public override getSourceLocation(): EditorSourceLocation | undefined {
		const input = this.input;
		return this.controller.getSourceLocation(input);
	}

	public override getSelection(): AemNavigationSelection { return new AemNavigationSelection(this.input); }

	private readonly pointer = new WorkbenchPropertyTreePointer(inputFocus, pointerHover, this.focusTarget);
	private readonly actions: WorkbenchActionBarControl;
	private readonly edit: WorkbenchPropertyEdit<StructuredValueEdit>;
	private readonly actionTooltip = new WorkbenchTooltip();
	public constructor(private readonly controller: AemEditorController, private readonly commands: IdeCommandController, private readonly contextMenu: ContextMenuController,
		surfaces: WorkbenchSurfaceService, paneSurface: WorkbenchSurface, private readonly workArea: Readonly<RectBounds>,
		private readonly group: EditorGroupView, scope: InputFocusScope, private readonly quickInput: QuickInputController) {
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
		for (const command of ['aem.edit', 'aem.add', 'aem.remove'] as const) this.focusTarget.registerCommand(command, {
			contextual: true,
			isEnabled: () => this.hasInput && this.propertyCommandEnabled(command, this.input,
				this.input.sourceSelection.selected?.property ?? (command === 'aem.add' ? this.input.tree.roots[0]?.element : undefined)),
			capture: () => this.capturePropertyCommand(command),
			run: () => inputFocus.executeCommand(command, this.focusTarget),
		});
		this.focusTarget.registerCommand('aem.apply', {
			contextual: true, isEnabled: () => this.hasInput && !this.input.applying,
			capture: () => {
				if (!this.hasInput) return;
				const input = this.input, generation = this.inputScope.contextGeneration;
				const current = () => this.hasInput && this.input === input && this.inputScope.contextGeneration === generation && input.sourceSelection.available;
				return { isEnabled: () => current() && !input.applying, run: () => { if (current()) this.controller.apply(input, this.quickInput); } };
			},
			run: () => inputFocus.executeCommand('aem.apply', this.focusTarget),
		});
		this.focusTarget.registerCommand('aem.testEvent', {
			contextual: true, isEnabled: () => this.hasInput && this.controller.canTestEvent(this.input),
			capture: () => this.captureEventCommand(),
			run: () => inputFocus.executeCommand('aem.testEvent', this.focusTarget),
		});
		this.focusTarget.registerCommand('contextMenu', { isEnabled: () => true, run: () => {
			const tree = this.input.tree;
			this.openContextMenu(tree.layout.contentLeft + 8, tree.layout.contentTop + (tree.selectionIndex - (tree.scroll | 0)) * tree.layout.rowHeight, true);
		} });
		for (const direction of ['undo', 'redo'] as const) this.focusTarget.registerCommand(direction, {
			isEnabled: () => !this.input.workingCopy.readOnly && (direction === 'undo' ? this.input.workingCopy.history.canUndo(this.input.workingCopy) : this.input.workingCopy.history.canRedo(this.input.workingCopy)),
			run: () => executeTextHistoryCommand(this.input.workingCopy, direction, this.input.editSource),
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
	private propertyCommandEnabled(command: 'aem.edit' | 'aem.add' | 'aem.remove', input: AemEditorInput, property: AemProperty | undefined): boolean {
		if (input.workingCopy.readOnly || property === undefined) return false;
		if (command === 'aem.edit') return property.inlineEditable;
		if (command === 'aem.add') return this.controller.canAdd(input, property);
		return property.parent !== undefined;
	}
	private capturePropertyCommand(command: 'aem.edit' | 'aem.add' | 'aem.remove'): FocusCommandInvocation | undefined {
		if (!this.hasInput) return;
		const input = this.input, selection = input.sourceSelection, revision = selection.revision, generation = this.inputScope.contextGeneration;
		const subject = selection.selected ?? (command === 'aem.add' ? input.tree.roots[0]?.element.sourceIdentity : undefined);
		if (subject === undefined) return;
		const current = () => this.hasInput && this.input === input && this.inputScope.contextGeneration === generation
			&& selection.available && selection.revision === revision && subject.property !== undefined;
		const readCurrent = () => { if (!current()) return false; projectAemSource(input); return current(); };
		return { editScope: this.inputScope,
			isEnabled: () => readCurrent() && this.propertyCommandEnabled(command, input, subject.property) && current(),
			run: () => {
				if (!readCurrent() || !this.propertyCommandEnabled(command, input, subject.property)) return;
				if (command === 'aem.edit') this.editProperty(subject.property!);
				else if (command === 'aem.add') this.controller.add(input, subject, readCurrent, this.quickInput);
				else this.controller.remove(input, subject.property!);
			},
		};
	}
	private captureEventCommand(): FocusCommandInvocation | undefined {
		if (!this.hasInput) return;
		const input = this.input, selection = input.sourceSelection, event = selection.event, revision = selection.eventRevision;
		const generation = this.inputScope.contextGeneration;
		if (event === undefined) return;
		const current = () => this.hasInput && this.input === input && this.inputScope.contextGeneration === generation
			&& selection.available && selection.eventRevision === revision && selection.event === event;
		const readCurrent = () => { if (!current()) return false; projectAemSource(input); return current(); };
		return { isEnabled: () => readCurrent() && this.controller.canTestEvent(input) && current(),
			run: receiver => {
				if (!readCurrent()) return;
				const destination = receiver === undefined ? this.group : findEditorGroup(receiver);
				if (destination !== undefined && destination !== null) this.controller.testEvent(input, event, readCurrent, destination, this.quickInput);
			},
		};
	}
	private editProperty(property: AemProperty): void {
		this.pointer.hideFeedback();
		const input = this.input, row = input.tree.rows.find(row => row.element.sourceIdentity === property.sourceIdentity)!;
		const model = input.workingCopy, range = property.node.range!;
		const lifetime = this.edit.open({ model, tree: input.tree, row,
			parse: text => {
				try { return { value: createStructuredValueEdit(input.source, aemDocumentFormat(model.resource.path), row.element.node, text) }; }
				catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
			}, apply: edit => this.controller.applyPropertyEdit(input, property, edit),
		}, { offset: range[0], deleteLength: range[1] - range[0], text: input.source.slice(range[0], range[1]), valueRange: { start: range[0], end: range[1] } });
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
	public updateStatus(): void { this.statusItem.text = this.input.status || this.input.applyStatus; }
	public handleKeyboard(input: KeyInputEvent): void {
		for (const [key, command] of NAVIGATION) if (isKeyDown(key, input)) {
			consumeIdeKey(key, input); navigateWorkbenchTree(this.input.tree, command);
			this.input.sourceSelection.select(this.input.tree.rows[this.input.tree.selectionIndex]?.element.sourceIdentity);
			this.pointer.keyboardSelection(); return;
		}
		if (isKeyJustPressed('Enter', input)) { consumeIdeKey('Enter', input); this.commands.execute('aem.edit', this.focusTarget); }
		if (isKeyJustPressed('Delete', input)) { consumeIdeKey('Delete', input); this.commands.execute('aem.remove', this.focusTarget); }
	}
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean, now: number): boolean {
		if (this.actions.handlePointer(snapshot)) return true;
		const result = this.pointer.handle(snapshot, justPressed, now);
		if (result === WorkbenchPropertyPointerResult.Outside) return false;
		if (result === WorkbenchPropertyPointerResult.Rejected) return true;
		if (result !== WorkbenchPropertyPointerResult.Handled)
			this.input.sourceSelection.select(this.input.tree.rows[this.input.tree.selectionIndex]?.element.sourceIdentity);
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
