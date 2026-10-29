import { STATUS_PRIORITY_CONTENT, type WorkbenchStatusItem } from '../../common/status_bar';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import { WorkbenchSplitControl } from '../../ui/split_control';
import { scrollWorkbenchList, workbenchListContainsPosition } from '../../ui/list_view';
import { drawWorkbenchSplit } from '../../render/split_view';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import { ScenarioTargetInspection } from './target_inspection';
import { WorkbenchPropertyInspector } from '../../ui/property_inspector/control';
import { drawWorkbenchPropertyInspector } from '../../render/property_inspector';
import { describeScenarioMessageDetails, describeScenarioTestResult, type ScenarioMessageProperty } from './message_inspection';
import type { ScenarioLabInspectableRow } from './view_model';
import { selectedScenarioResultRow } from './projection';
import { prepareScenarioLabLayout } from './layout';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { pointerHover } from '../../../input/pointer/hover';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { ScenarioLabNavigationSelection } from './navigation_selection';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { editorViewState } from '../../../editor/ui/view/state';
import type { IdeCommandController } from '../../../commands/controller';
import type { ScenarioLabInput } from './editor_input';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import type { ScenarioLabController, ScenarioLabExecutionCommand } from './controller';
import {
	handleScenarioLabGamepadInput,
	handleScenarioLabKeyboardInput,
} from './keyboard';
import { drawScenarioLab } from './render';
import { inputFocus, type FocusCommandInvocation, type InputFocusScope, type InputFocusTarget } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { handleScenarioLabPointerInput, ScenarioLabPointerResult } from './pointer';
import { executeScenarioLabNavigation, updateScenarioLabStatus, type ScenarioLabNavigationCommand } from './navigation';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import type { WorkbenchSurface } from '../../services/windows/model';
import { WorkbenchTooltip } from '../../ui/tooltip';
import { editorTextModelService } from '../../../editor/model/model_service';
import { subscribeToLuaModelChanges } from '../../../editor/contrib/intellisense/model_lifetime';
import { ScenarioLabRowFeedback } from './feedback';
import type { EditorScenarioLabCommandId } from '../../../common/commands';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { QuickInputController } from '../../services/quick_input/controller';

const RUN_COMMANDS = [
	'scenarioLab.revealRun', 'scenarioLab.cancel',
	'scenarioLab.continue', 'scenarioLab.stepInto', 'scenarioLab.stepOver', 'scenarioLab.stepOut', 'scenarioLab.pause', 'scenarioLab.breakpoints',
] as const satisfies readonly EditorScenarioLabCommandId[];

export class ScenarioLabEditorPane extends WorkbenchViewEditorPane<ScenarioLabInput> {
	public readonly statusItems: readonly WorkbenchStatusItem[] = [
		{ text: '', alignment: 'left', priority: STATUS_PRIORITY_CONTENT, overflow: 'ellipsis', tone: 'normal' },
	];
	public override getSelection(): ScenarioLabNavigationSelection {
		this.controller.updateView(this.input.view);
		prepareScenarioLabLayout(this.input.view, this.contentBounds);
		return new ScenarioLabNavigationSelection(this.input.view);
	}

	private readonly resultsFocus = inputFocus.createTarget(this.focusTarget);
	private readonly split = new WorkbenchSplitControl(inputFocus, pointerCapture, pointerHover, this.resultsFocus);
	private readonly unbindResultsKeyboard = this.resultsFocus.bindKeyboard(input => this.handleKeyboard(input));
	private readonly unbindResultsGamepad = this.resultsFocus.bindGamepad(input => this.handleGamepad(input));
	private readonly unbindTestsFocus = this.focusTarget.onDidFocus(() => {
		this.input.view.focus = 'tests';
		updateScenarioLabStatus(this.input.view);
		this.rowFeedback.keyboardSelection(this.input.view);
	});
	private readonly unbindResultsFocus = this.resultsFocus.onDidFocus(() => {
		this.input.view.focus = 'results';
		updateScenarioLabStatus(this.input.view);
		this.rowFeedback.keyboardSelection(this.input.view);
	});
	public readonly inspector = new WorkbenchPropertyInspector<ScenarioMessageProperty>(inputFocus, pointerCapture, pointerHover, this.resultsFocus);
	public readonly targetInspection: ScenarioTargetInspection;
	private inspectedMessage: ScenarioLabInspectableRow | undefined;
	private readonly inspectionLifetime = { dispose: () => { this.inspectedMessage = undefined; } };
	private readonly navigate = (command: ScenarioLabNavigationCommand): void => {
		const view = this.input.view;
		prepareScenarioLabLayout(view, this.contentBounds);
		const result = executeScenarioLabNavigation(view, command);
		switch (result.kind) {
			case 'none': case 'changed': this.rowFeedback.keyboardSelection(view); return;
			case 'inspect-message': this.openDetails(result.row); return;
			case 'open-source': this.controller.openSource(this.group, result.location); return;
			case 'actioneffect-source': this.controller.openActionEffectSource(view, this.group, this.quickInput, result.contextId, result.effectId); return;
		}
	};
	private readonly actionBar: WorkbenchActionBarControl;
	private readonly actionTooltip = new WorkbenchTooltip();
	private readonly rowFeedback: ScenarioLabRowFeedback;

	public constructor(
		private readonly controller: ScenarioLabController,
		private readonly commands: IdeCommandController,
		contextMenu: ContextMenuController,
		surfaces: WorkbenchSurfaceService,
		paneSurface: WorkbenchSurface,
		private readonly workArea: Readonly<RectBounds>,
		private readonly group: EditorGroupView,
		private readonly quickInput: QuickInputController,
		scope: InputFocusScope,
	) {
		super(scope);
		for (const command of [
			'scenarioLab.play', 'scenarioLab.playWithCompanion', 'scenarioLab.debug', 'scenarioLab.debugWithCompanion',
			'scenarioLab.run', 'scenarioLab.runWithCompanion', 'scenarioLab.rerun',
		] as const) {
			const implementation = {
				isEnabled: () => this.hasInput && this.controller.isCommandEnabled(command, this.input),
				capture: () => this.captureExecution(command),
				run: () => inputFocus.executeCommand(command, this.focusTarget),
			};
			this.focusTarget.registerCommand(command, implementation);
			this.resultsFocus.registerCommand(command, implementation);
		}
		for (const command of RUN_COMMANDS) {
			const implementation = {
				isEnabled: () => this.hasInput && this.controller.isCommandEnabled(command, this.input),
				run: () => this.controller.executeCommand(command, this.input, this.group, this.quickInput),
			};
			this.focusTarget.registerCommand(command, implementation);
			this.resultsFocus.registerCommand(command, implementation);
		}
		this.targetInspection = new ScenarioTargetInspection(this.resultsFocus, commands, contextMenu, surfaces, paneSurface, workArea);
		this.actionTooltip.attach(surfaces, paneSurface, workArea);
		this.rowFeedback = new ScenarioLabRowFeedback(surfaces, paneSurface, workArea, this.focusTarget, this.resultsFocus);
		const inspectStop = {
			isEnabled: () => this.hasInput && this.controller.runs.debugger?.stopped === true && this.targetInspection.model === undefined,
			run: () => { this.inspector.hide(); this.targetInspection.show(this.controller.runs.debugger!.inspect()); },
		};
		this.focusTarget.registerCommand('scenarioLab.inspectStop', inspectStop);
		this.resultsFocus.registerCommand('scenarioLab.inspectStop', inspectStop);
		this.resultsFocus.registerCommand('scenarioLab.inspectTarget', {
			isEnabled: () => this.hasInput && !this.inspector.visible && this.targetInspection.model === undefined
				&& this.selectedDetailsRow() !== undefined && this.controller.runs.canInspect(this.selectedDetailsRow()!.result),
			run: () => this.targetInspection.show(this.controller.runs.inspect(this.selectedDetailsRow()!.result)),
		});
		this.resultsFocus.registerCommand('scenarioLab.details', {
			isEnabled: () => this.hasInput && !this.inspector.visible && this.targetInspection.model === undefined && this.input.view.focus === 'results'
				&& this.selectedDetailsRow() !== undefined,
			run: () => this.openDetails(this.selectedDetailsRow()!),
		});
		this.actionBar = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.focus(), contextMenu);
		this.actionBar.onDidOpenOverflow = lifetime => {
			this.actionTooltip.hide();
			this.rowFeedback.clear();
			lifetime.add({ dispose: controller.runs.onDidChangeRun(() => contextMenu.hide()) });
			for (const root of this.input.view.collection.roots)
				lifetime.add(subscribeToLuaModelChanges(editorTextModelService, this.controller.runs.collection.catalog, root.contextId, () => contextMenu.hide()));
		};
		this.focusTarget.next = this.resultsFocus;
		this.resultsFocus.previous = this.focusTarget;
		this.split.focusTarget.previous = this.resultsFocus;
		this.split.focusTarget.next = this.actionBar.focusTarget;
		this.actionBar.focusTarget.next = this.focusTarget;
		this.focusTarget.previous = this.actionBar.focusTarget;
	}

	private captureExecution(command: ScenarioLabExecutionCommand): FocusCommandInvocation | undefined {
		if (!this.hasInput) return;
		const input = this.input, scope = this.focusTarget.scope, generation = scope.contextGeneration;
		const intent = this.controller.captureExecution(command, input);
		if (intent === undefined) return;
		const isCurrent = () => this.hasInput && this.input === input && scope.contextGeneration === generation
			&& this.controller.isExecutionCurrent(intent);
		return {
			// Choosing fixture identity is presentation; only immediate execution consumes a draft now.
			editScope: intent.withCompanion ? undefined : scope,
			isEnabled: () => isCurrent() && (intent.withCompanion
				? this.controller.isCommandEnabled(command, input) : this.controller.isExecutionEnabled(intent)) && isCurrent(),
			run: () => { if (isCurrent()) this.controller.executeExecution(intent, this.group, this.quickInput, isCurrent); },
		};
	}

	protected override activate(): void {
		this.actionBar.setInput(this.input.view.actionBar, this.resultsFocus);
		this.split.setInput(this.input.view.split);
	}
	public override setOptions(_selection?: EditorTextSelection, navigationSelection?: ScenarioLabNavigationSelection): void {
		if (navigationSelection === undefined) return;
		this.inspector.hide();
		this.targetInspection.hide();
		navigationSelection.restore(this.input.view);
		this.controller.updateView(this.input.view);
		prepareScenarioLabLayout(this.input.view, this.contentBounds);
	}

	public override get commandTarget(): InputFocusTarget { return this.input.view.focus === 'results' ? this.resultsFocus : this.focusTarget; }

	public override clearInput(): void {
		this.split.clearInput();
		this.inspector.hide();
		this.targetInspection.hide();
		pointerHover.release(this);
		this.actionBar.clearInput();
		this.actionTooltip.hide();
		this.rowFeedback.clear();
		super.clearInput();
	}

	public override dispose(): void {
		this.split.dispose();
		this.inspector.dispose();
		this.targetInspection.dispose();
		pointerHover.release(this);
		this.actionBar.dispose();
		this.actionTooltip.detach();
		this.rowFeedback.dispose();
		this.unbindResultsKeyboard(); this.unbindResultsGamepad();
		this.unbindTestsFocus();
		this.unbindResultsFocus();
		super.dispose();
	}

	public override layout(bounds: Readonly<RectBounds>): void {
		super.layout(bounds);
		prepareScenarioLabLayout(this.input.view, bounds);
		this.updateFocusOrder();
	}

	public override update(): void {
		const view = this.input.view;
		this.controller.updateView(view);
		prepareScenarioLabLayout(view, this.contentBounds);
		this.actionBar.update();
		const hint = this.actionBar.tooltipItem;
		if (hint !== undefined && !this.inspector.visible && this.targetInspection.model === undefined)
			this.actionTooltip.show(hint.tooltip, hint.bounds, editorViewState.font.renderFont(), measureTextRange, measureText, this.workArea);
		else this.actionTooltip.hide();
		if (hint !== undefined || this.inspector.visible || this.targetInspection.model !== undefined) this.rowFeedback.clear();
		else this.rowFeedback.update(editorViewState.font.renderFont(), measureTextRange, measureText);
		if (this.inspectedMessage !== undefined && selectedScenarioResultRow(this.input.view)?.id !== this.inspectedMessage.id) this.inspector.hide();
		this.inspector.update();
		this.targetInspection.update(view.layout);
		if (this.inspector.visible) this.inspector.layout(editorViewState.font.renderFont(), measureTextRange, measureText, view.layout);
		this.updateFocusOrder();
	}

	/** The actual arranged sash participates only while its two clients can resize. */
	private updateFocusOrder(): void {
		const resizable = this.input.view.split.resizable;
		this.resultsFocus.next = resizable ? this.split.focusTarget : this.actionBar.focusTarget;
		this.actionBar.focusTarget.previous = resizable ? this.split.focusTarget : this.resultsFocus;
		if (!resizable) {
			pointerCapture.cancelTarget(this.split); pointerHover.release(this.split);
			this.split.focusTarget.release();
		}
	}

	private selectedDetailsRow(): ScenarioLabInspectableRow | undefined {
		const row = selectedScenarioResultRow(this.input.view);
		return row !== null && (row.kind === 'result' || row.kind === 'log' || row.kind === 'failure') ? row : undefined;
	}

	private openDetails(row: ScenarioLabInspectableRow): void {
		const lifetime = this.inspector.show({ title: row.result.test.label,
			items: row.kind === 'result' ? describeScenarioTestResult(row.result) : describeScenarioMessageDetails(row),
			canOpenSource: item => item.location !== undefined,
			openSource: item => this.controller.openSource(this.group, item.location!),
		});
		this.inspectedMessage = row;
		lifetime.add(this.inspectionLifetime);
	}

	public draw(): void {
		if (this.targetInspection.model !== undefined) {
			this.targetInspection.draw(); return;
		}
		if (this.inspector.visible) {
			drawWorkbenchPropertyInspector(this.inspector);
			return;
		}
		const view = this.input.view;
		drawScenarioLab(view);
		drawWorkbenchSplit(view.split, this.split.hovered || this.split.focusTarget.hasFocus);
	}

	public handleKeyboard(event: KeyInputEvent): void {
		handleScenarioLabKeyboardInput(event, this.navigate);
	}

	public override handleGamepad(input: PlayerInput): void {
		handleScenarioLabGamepadInput(input, this.navigate, this.commands);
	}

	public onPointerLeave(): void {
		this.input.view.testPane.hoverIndex = -1;
		this.input.view.resultPane.hoverIndex = -1;
		this.rowFeedback.onPointerLeave();
	}

	protected override handleViewPointer(
		snapshot: PointerInputSnapshot,
		justPressed: boolean,
		now: number,
	): boolean {
		if (this.targetInspection.model !== undefined) return this.targetInspection.handlePointer(snapshot, justPressed, now);
		if (this.inspector.visible) return this.inspector.handlePointer(snapshot);
		const view = this.input.view;
		if (this.split.handlePointer(snapshot) || this.actionBar.handlePointer(snapshot)) {
			if (justPressed) { view.lastPointerClickTimeMs = 0; view.lastPointerClickRowId = null; }
			return true;
		}
		const result = handleScenarioLabPointerInput(view, snapshot, justPressed, now);
		if (result === ScenarioLabPointerResult.Outside) { pointerHover.release(this); return false; }
		pointerHover.visit(this);
		if (justPressed) this.focus();
		this.rowFeedback.pointer(view, snapshot);
		if (result === ScenarioLabPointerResult.Activate) this.navigate('activate');
		return true;
	}

	public handleWheel(event: WheelInputSnapshot): void {
		if (this.targetInspection.model !== undefined) this.targetInspection.handleWheel(event, event.deltaY * 3);
		else if (this.inspector.visible) this.inspector.handleWheel(event, event.deltaY * editorViewState.font.lineHeight * 3);
		else {
			const view = this.input.view;
			prepareScenarioLabLayout(view, this.contentBounds);
			const delta = event.deltaY * 3;
			if (workbenchListContainsPosition(view.testPane, event.viewportX, event.viewportY)) scrollWorkbenchList(view.testPane, delta);
			else if (workbenchListContainsPosition(view.resultPane, event.viewportX, event.viewportY)) scrollWorkbenchList(view.resultPane, delta);
			else if (view.focus === 'tests') scrollWorkbenchList(view.testPane, delta);
			else scrollWorkbenchList(view.resultPane, delta);
		}
	}

	public updateStatus(): void {
		this.statusItems[0].text = this.split.focusTarget.hasFocus ? 'RESIZE PANES: LEFT/RIGHT | HOME: RESET' : this.input.view.status.info;
	}
}
