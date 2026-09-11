import { WorkbenchPropertyInspector } from '../../ui/property_inspector/control';
import { drawWorkbenchPropertyInspector } from '../../render/property_inspector';
import { describeScenarioMessage, type ScenarioMessageProperty } from './message_inspection';
import type { ScenarioLabMessageRow } from './view_model';
import { selectedScenarioResultRow } from './projection';
import { prepareScenarioLabLayout } from './layout';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { pointerHover } from '../../../input/pointer/hover';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { ScenarioLabNavigationSelection } from './navigation_selection';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../../common/models';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { editorViewState } from '../../../editor/ui/view/state';
import type { IdeCommandController } from '../../../commands/controller';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { ScenarioLabInput } from '../../ui/tab/model';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import type { ScenarioLabController } from './controller';
import {
	handleScenarioLabGamepadInput,
	handleScenarioLabKeyboardInput,
} from './keyboard';
import { drawScenarioLab } from './render';
import { inputFocus } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { handleScenarioLabPointerInput, ScenarioLabPointerResult } from './pointer';
import { executeScenarioLabNavigation, updateScenarioLabStatus, type ScenarioLabNavigationCommand } from './navigation';

export class ScenarioLabEditorPane extends FullWidthWorkbenchEditorPane<ScenarioLabInput> {
	public override getSelection(): ScenarioLabNavigationSelection {
		this.controller.updateView(this.input.view);
		return new ScenarioLabNavigationSelection(this.input.view);
	}

	private readonly resultsFocus = inputFocus.createTarget(this.focusTarget);
	private readonly unbindResultsKeyboard = this.resultsFocus.bindKeyboard(input => this.handleKeyboard(input));
	private readonly unbindTestsFocus = this.focusTarget.onDidFocus(() => {
		this.input.view.focus = 'tests';
		updateScenarioLabStatus(this.input.view);
	});
	private readonly unbindResultsFocus = this.resultsFocus.onDidFocus(() => {
		this.input.view.focus = 'results';
		updateScenarioLabStatus(this.input.view);
	});
	public readonly inspector = new WorkbenchPropertyInspector<ScenarioMessageProperty>(inputFocus, pointerCapture, pointerHover, this.resultsFocus);
	private inspectedMessage: ScenarioLabMessageRow | undefined;
	private readonly inspectionLifetime = { dispose: () => { this.inspectedMessage = undefined; } };
	private readonly navigate = (command: ScenarioLabNavigationCommand): void => {
		const view = this.input.view;
		prepareScenarioLabLayout(view);
		const result = executeScenarioLabNavigation(view, command);
		switch (result.kind) {
			case 'none': case 'changed': return;
			case 'inspect-message': this.openDetails(result.row); return;
			case 'open-source': this.controller.openSource(result.location); return;
			case 'actioneffect-source': this.controller.openActionEffectSource(view, result.executionDomain, result.effectId); return;
		}
	};
	private readonly actionBar: WorkbenchActionBarControl;

	public constructor(
		resourcePanel: ResourcePanelController,
		private readonly controller: ScenarioLabController,
		private readonly commands: IdeCommandController,
	) {
		super(resourcePanel);
		this.resultsFocus.registerCommand('scenarioLab.details', {
			isEnabled: () => !this.inspector.visible && this.input.view.focus === 'results'
				&& this.selectedMessage() !== undefined,
			run: () => this.openDetails(this.selectedMessage()!),
		});
		this.actionBar = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget);
		this.focusTarget.next = this.resultsFocus;
		this.resultsFocus.previous = this.focusTarget;
		this.resultsFocus.next = this.actionBar.focusTarget;
		this.actionBar.focusTarget.previous = this.resultsFocus;
		this.actionBar.focusTarget.next = this.focusTarget;
		this.focusTarget.previous = this.actionBar.focusTarget;
	}

	protected override activate(_selection?: EditorTextSelection, navigationSelection?: ScenarioLabNavigationSelection): void {
		this.inspector.hide();
		super.activate();
		navigationSelection?.restore(this.input.view);
		this.controller.updateView(this.input.view);
		this.actionBar.setInput(this.input.view.actionBar, this.resultsFocus);
	}

	public override focus(): void {
		if (this.input.view.focus === 'results') this.resultsFocus.focus();
		else super.focus();
	}

	public override clearInput(): void {
		this.inspector.hide();
		pointerHover.release(this);
		this.actionBar.clearInput();
		super.clearInput();
	}

	public override dispose(): void {
		this.inspector.dispose();
		pointerHover.release(this);
		this.actionBar.dispose();
		this.unbindResultsKeyboard();
		this.unbindTestsFocus();
		this.unbindResultsFocus();
		super.dispose();
	}

	public override update(): void {
		const view = this.input.view;
		this.controller.updateView(view);
		this.actionBar.update();
		if (this.inspectedMessage !== undefined && selectedScenarioResultRow(this.input.view)?.id !== this.inspectedMessage.id) this.inspector.hide();
		this.inspector.update();
	}

	private selectedMessage(): ScenarioLabMessageRow | undefined {
		const row = selectedScenarioResultRow(this.input.view);
		return row !== null && (row.kind === 'log' || row.kind === 'failure') ? row : undefined;
	}

	private openDetails(row: ScenarioLabMessageRow): void {
		const lifetime = this.inspector.show({ title: row.result.test.label, items: [describeScenarioMessage(row)],
			canOpenSource: item => item.location !== undefined,
			openSource: item => this.controller.openSource(item.location!),
		});
		this.inspectedMessage = row;
		lifetime.add(this.inspectionLifetime);
	}

	public draw(): void {
		if (this.inspector.visible) {
			prepareScenarioLabLayout(this.input.view);
			this.inspector.layout(editorViewState.font.renderFont(), measureTextRange, measureText, this.input.view.layout);
			drawWorkbenchPropertyInspector(this.inspector);
			return;
		}
		const view = this.input.view;
		drawScenarioLab(view, this.commands);
	}

	public handleKeyboard(playerInput: PlayerInput): void {
		if (!handleScenarioLabKeyboardInput(playerInput, this.navigate)) {
			handleScenarioLabGamepadInput(
				playerInput,
				this.navigate,
				this.commands,
			);
		}
	}

	public onPointerLeave(): void {
		this.input.view.testPane.hoverIndex = -1;
		this.input.view.resultPane.hoverIndex = -1;
	}

	protected override handleViewPointer(
		snapshot: PointerSnapshot,
		justPressed: boolean,
		now: number,
	): boolean {
		if (this.inspector.visible) return this.inspector.handlePointer(snapshot);
		const view = this.input.view;
		if (this.actionBar.handlePointer(snapshot)) {
			if (justPressed) { view.lastPointerClickTimeMs = 0; view.lastPointerClickRowId = null; }
			return true;
		}
		const result = handleScenarioLabPointerInput(view, snapshot, justPressed, now);
		if (result === ScenarioLabPointerResult.Outside) { pointerHover.release(this); return false; }
		pointerHover.visit(this);
		if (justPressed) this.focus();
		if (result === ScenarioLabPointerResult.Activate) this.navigate('activate');
		return true;
	}

	public handleWheel(
		direction: number,
		steps: number,
		activePointer: PointerSnapshot | null,
		playerInput: PlayerInput,
	): void {
		if (this.inspector.visible) {
			if (activePointer === null || !this.inspector.handleWheel(activePointer, direction * steps * editorViewState.font.lineHeight * 3)) return;
		} else this.controller.handleWheel(this.input.view, direction, steps, activePointer);
		playerInput.inputHandlers.pointer?.consumeButton('pointer_wheel');
	}

	public drawStatusBar(statusTop: number, textColor: number): void {
		drawEditorText(
			editorViewState.font,
			this.input.view.status.renderedInfo,
			4,
			statusTop + 2,
			0,
			textColor,
		);
	}
}
