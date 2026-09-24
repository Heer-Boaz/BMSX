import type { IdeCommandController } from '../../../commands/controller';
import type { TestStopInspection } from '../../../testing/stop_inspection';
import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../../common/models';
import type { EditorCommandId } from '../../../common/commands';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { editorViewState } from '../../../editor/ui/view/state';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { api } from '../../../runtime/overlay_api';
import { COLOR_RESOURCE_VIEWER_BACKGROUND, COLOR_RESOURCE_VIEWER_TEXT } from '../../../common/constants';
import type { TestTargetInspection } from '../../../testing/retained_inspection';
import type { InspectedProperty } from '../../ui/property_inspector/model';
import { truncateMeasuredText } from '../../../common/text';
import { WorkbenchPropertyInspector } from '../../ui/property_inspector/control';
import { drawWorkbenchPropertyInspector } from '../../render/property_inspector';
import { layoutWorkbenchPropertyTree } from '../../ui/property_tree';
import { drawWorkbenchPropertyTree } from '../../render/property_tree';
import { WorkbenchPropertyTreePointer, WorkbenchPropertyPointerResult } from '../../ui/property_tree_pointer';
import { navigateWorkbenchTree, setWorkbenchTreeCollapsed } from '../../ui/tree_view';
import { scrollWorkbenchList, workbenchListContainsPosition } from '../../ui/list_view';
import { createWorkbenchActionBar, layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import { handleScenarioLabKeyboardInput } from './keyboard';
import { TestTargetInspectionModel } from './target_inspection_model';

/** Ordinary Scenario Lab attachment. Closing this view never disposes its retained test target. */
export class ScenarioTargetInspection {
	public model: TestTargetInspectionModel | undefined;
	private readonly focus: InputFocusTarget;
	private readonly pointer = new WorkbenchPropertyTreePointer(pointerHover);
	private readonly details: WorkbenchPropertyInspector<InspectedProperty>;
	private readonly bar = createWorkbenchActionBar('scenarioLab.target');
	private readonly actions: WorkbenchActionBarControl;
	private readonly unbindKeyboard: () => void;
	private unbindInspection: (() => void) | undefined;
	private readonly header = create_rect_bounds();
	private headerFont: BFont | undefined;
	private title = '';

	public constructor(private readonly parent: InputFocusTarget, private readonly commands: IdeCommandController) {
		this.focus = inputFocus.createTarget(parent);
		this.details = new WorkbenchPropertyInspector(inputFocus, pointerCapture, pointerHover, this.focus);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, this, this.focus);
		this.focus.next = this.actions.focusTarget; this.focus.previous = this.actions.focusTarget;
		this.actions.focusTarget.next = this.focus; this.actions.focusTarget.previous = this.focus;
		this.unbindKeyboard = this.focus.bindKeyboard(input => this.keyboard(input));
		this.focus.registerCommand('scenarioLab.closeTarget', { isEnabled: () => this.model !== undefined, run: () => this.hide() });
		this.focus.registerCommand('scenarioLab.details', { isEnabled: () => this.isEnabled('scenarioLab.details'), run: () => this.openDetails() });
	}

	public show(inspection: TestTargetInspection | TestStopInspection): void {
		this.hide();
		this.model = new TestTargetInspectionModel(inspection);
		this.headerFont = undefined;
		for (const item of this.bar.items) item.visible = item.command === 'scenarioLab.details' || item.command === 'scenarioLab.closeTarget'
			|| inspection.state.role === 'live-test' && this.commands.isEnabled(item.command);
		this.unbindInspection = inspection.onDidDispose(() => this.hide());
		this.actions.setInput(this.bar, this.focus);
		this.focus.focus();
	}
	public hide(): void {
		this.unbindInspection?.(); this.unbindInspection = undefined;
		this.details.hide(); this.pointer.clear(); this.actions.clearInput();
		if (this.focus.hasFocus || this.actions.focusTarget.hasFocus) this.parent.focus();
		this.model?.inspection.dispose(); this.model = undefined;
	}
	public dispose(): void { this.hide(); this.details.dispose(); this.actions.dispose(); this.unbindKeyboard(); }
	public update(): void {
		if (this.model === undefined) return;
		this.details.update(); this.actions.update();
	}
	public isEnabled(command: EditorCommandId): boolean {
		return this.model !== undefined && (command === 'scenarioLab.closeTarget'
			|| (command === 'scenarioLab.details' ? this.model.tree.selectionIndex >= 0 : this.commands.isEnabled(command)));
	}
	public execute(command: EditorCommandId): void {
		if (command === 'scenarioLab.closeTarget') this.hide();
		else if (command === 'scenarioLab.details') this.openDetails();
		else this.commands.execute(command);
	}

	private openDetails(): void {
		const model = this.model!, element = model.tree.rows[model.tree.selectionIndex].element;
		const source = element.frame === undefined ? undefined : model.inspection.frameSource(element.frame);
		const items = source === undefined ? [{ label: element.label, value: element.value, description: element.description, warning: false }]
			: [{ label: source.status === 'available' ? source.path : 'Source', value: source.status === 'available' ? source.text : source.status, description: 'Compiled test image, not the current editor buffer.', warning: false }];
		this.details.show({ title: source === undefined ? 'Test value' : 'Compiled test source (read-only)', items,
			canOpenSource: () => false, openSource: () => {} });
	}

	private keyboard(input: PlayerInput): boolean {
		if (isKeyJustPressed('Escape', input)) { consumeIdeKey('Escape', input); this.hide(); return true; }
		return handleScenarioLabKeyboardInput(input, command => {
			const model = this.model!, tree = model.tree;
			if (command === 'activate') { if (tree.selectionIndex >= 0) this.openDetails(); return; }
			navigateWorkbenchTree(tree, command);
			if (tree.selectionIndex >= 0) model.resolve(tree.rows[tree.selectionIndex]);
		});
	}

	public draw(bounds: RectBounds): void {
		const font = editorViewState.font;
		if (this.details.visible) {
			this.details.layout(font.renderFont(), measureTextRange, measureText, bounds);
			drawWorkbenchPropertyInspector(this.details); return;
		}
		const renderFont = font.renderFont(), top = bounds.top + font.lineHeight + 8;
		if (this.headerFont !== renderFont || this.header.left !== bounds.left || this.header.top !== bounds.top || this.header.right !== bounds.right) {
			this.headerFont = renderFont;
			write_rect_bounds(this.header, bounds.left, bounds.top, bounds.right, top);
			layoutWorkbenchActionBar(this.bar, bounds.right - 4, bounds.top + 2, top - 2, measureText);
			const state = this.model!.inspection.state, first = this.bar.items.find(item => item.visible)!;
			this.title = truncateMeasuredText(state.role === 'retained-test' ? 'TEST / POST-MORTEM / CASE-END HEAP' : `TEST / STOPPED / ${state.reason}`, first.bounds.left - bounds.left - 8, measureTextRange);
		}
		api.fill_rect(bounds.left, bounds.top, bounds.right, top, 0, COLOR_RESOURCE_VIEWER_BACKGROUND);
		drawEditorText(font, this.title, bounds.left + 4, bounds.top + 4, 0, COLOR_RESOURCE_VIEWER_TEXT);
		renderWorkbenchActionBar(this.bar, this, renderFont);
		layoutWorkbenchPropertyTree(this.model!.tree, renderFont, measureTextRange, bounds.left, top, bounds.right, bounds.bottom);
		drawWorkbenchPropertyTree(this.model!.tree);
	}

	public handlePointer(snapshot: PointerSnapshot, justPressed: boolean, now: number): boolean {
		if (this.details.visible) return this.details.handlePointer(snapshot);
		if (this.actions.handlePointer(snapshot)) return true;
		const model = this.model!, result = this.pointer.handle(model.tree, snapshot, justPressed, now);
		if (result === WorkbenchPropertyPointerResult.Outside) return false;
		if (justPressed) this.focus.focus();
		const node = model.tree.rows[model.tree.selectionIndex];
		if (result === WorkbenchPropertyPointerResult.Collapse) model.resolve(node);
		if (result === WorkbenchPropertyPointerResult.Activate) {
			if (node.expandable) {
				setWorkbenchTreeCollapsed(model.tree, model.tree.selectionIndex, !node.collapsed); model.resolve(node);
			} else this.openDetails();
		}
		return true;
	}
	public handleWheel(pointer: PointerSnapshot, delta: number): boolean {
		if (this.details.visible) return this.details.handleWheel(pointer, delta * editorViewState.font.lineHeight);
		const tree = this.model!.tree;
		if (!workbenchListContainsPosition(tree, pointer.viewportX, pointer.viewportY)) return false;
		scrollWorkbenchList(tree, delta); return true;
	}
}
