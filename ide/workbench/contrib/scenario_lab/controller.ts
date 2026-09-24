import { LuaSyntaxError } from '../../../../toolchain/ts/lua/errors';
import { subscribeToLuaModelChanges } from '../../../editor/contrib/intellisense/model_lifetime';
import { createBehaviorQuickPickItem } from '../behavior_lens/quick_access';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { PointerSnapshot } from '../../../common/models';
import type { CartEditor } from '../../../cart_editor';
import type { EditorScenarioLabCommandId } from '../../../common/commands';
import type { ScenarioLabTabId } from '../../ui/tab/id';
import { editorTabGroup } from '../../ui/tab/group_model';
import { isScenarioLabActive, openEditorTab } from '../../ui/tabs';
import type { EditorNavigationController } from '../resources/navigation';
import type { EditorPanes } from '../../services/editor/editor_panes';
import { prepareScenarioLabLayout } from './layout';
import {
	scrollWorkbenchList,
	workbenchListContainsPosition,
} from '../../ui/list_view';
import {
	scenarioLabCommandEnabled,
	updateScenarioLabStatus,
} from './navigation';
import {
	refreshScenarioLabProjection,
	selectedScenarioTestNode,
} from './projection';
import { ScenarioRunAdmissionError, type ScenarioRunService, type ScenarioRunEvent } from '../../services/testing/scenario_runs';
import type { ScenarioLabViewState } from './view_model';
import { createScenarioLabViewState } from './view_state';
import type { ScenarioSourceLocation } from '../../../testing/scenario/result_service';
import type { BehaviorRegistrationIndex } from '../behavior_lens/registration_index';
import { ScenarioLabInput } from './editor_input';

const SCENARIO_LAB_TAB_ID: ScenarioLabTabId = 'scenario-lab';
const WHEEL_SCROLL_ROWS = 3;

/** Workbench contribution that projects tests/results and invokes the run owner. */
export class ScenarioLabController {
	private view: ScenarioLabViewState | null = null;
	private readonly disposeRunListener: () => void;

	public constructor(
		private readonly editor: CartEditor,
		private readonly navigation: EditorNavigationController,
		private readonly editorPanes: EditorPanes,
		private readonly behaviorRegistrations: BehaviorRegistrationIndex,
		private readonly runs: ScenarioRunService,
	) {
		this.disposeRunListener = this.runs.onDidChangeRun(
			event => this.handleRunChange(event),
		);
	}

	private refreshSources(): void {
		this.runs.refreshSources();
		if (this.view !== null) {
			refreshScenarioLabProjection(this.view);
		}
	}

	public dispose(): void {
		this.disposeRunListener();
	}

	public open(): void {
		openEditorTab(this.editorPanes, this.resolveInput());
	}

	public updateView(view: ScenarioLabViewState): void {
		this.runs.refreshSources();
		if (view.runActive !== this.runs.active) {
			view.runActive = this.runs.active;
			updateScenarioLabStatus(view);
		}
		prepareScenarioLabLayout(view);
	}

	public executeCommand(command: EditorScenarioLabCommandId): void {
		const view = this.view!;
		switch (command) {
			case 'scenarioLab.run':
			case 'scenarioLab.rerun':
				try {
					if (command === 'scenarioLab.run') this.runSelected(view);
					else this.rerunLast(view);
				} catch (error) {
					if (!(error instanceof LuaSyntaxError) && !(error instanceof ScenarioRunAdmissionError)) throw error;
					this.editor.handleRuntimeTaskError(error, 'Invalid test declaration');
				}
				return;
			case 'scenarioLab.cancel':
				this.runs.cancel(this.runs.results.liveRun!);
				return;
		}
	}

	public isCommandEnabled(command: EditorScenarioLabCommandId): boolean {
		if (command === 'scenarioLab.cancel') return this.runs.active;
		return isScenarioLabActive()
			&& this.view !== null
			&& scenarioLabCommandEnabled(this.view, command);
	}

	public handleWheel(
		view: ScenarioLabViewState,
		direction: number,
		steps: number,
		pointer: PointerSnapshot | null,
	): void {
		prepareScenarioLabLayout(view);
		const delta = direction * steps * WHEEL_SCROLL_ROWS;
		if (pointer !== null
			&& workbenchListContainsPosition(
				view.testPane,
				pointer.viewportX,
				pointer.viewportY,
			)) {
			scrollWorkbenchList(view.testPane, delta);
			return;
		}
		if (pointer !== null
			&& workbenchListContainsPosition(
				view.resultPane,
				pointer.viewportX,
				pointer.viewportY,
			)) {
			scrollWorkbenchList(view.resultPane, delta);
			return;
		}
		if (view.focus === 'tests') {
			scrollWorkbenchList(view.testPane, delta);
		} else {
			scrollWorkbenchList(view.resultPane, delta);
		}
	}

	private getOrCreateView(): ScenarioLabViewState {
		if (this.view !== null) {
			return this.view;
		}
		const view = createScenarioLabViewState(
			this.runs.collection,
			this.runs.results,
			this.runs.active,
		);
		this.view = view;
		return view;
	}

	public resolveInput(): ScenarioLabInput {
		this.refreshSources();
		const tab = editorTabGroup.findById(SCENARIO_LAB_TAB_ID);
		return tab === undefined ? new ScenarioLabInput(this.getOrCreateView()) : tab;
	}

	public openActionEffectSource(view: ScenarioLabViewState, executionDomain: 0 | 1, effectId: string): void {
		const sources = this.behaviorRegistrations.resolve(executionDomain, 'action_effect', effectId);
		if (sources.length === 1) {
			const source = sources[0];
			this.openSource({ resource: source.resource, line: source.range.start.line, column: source.range.start.column });
			return;
		}
		if (sources.length === 0) {
			view.status.info = `ACTIONEFFECT ${effectId} / SOURCE UNRESOLVED`;
			view.status.dirty = true;
			return;
		}
		const quickInput = this.editor.quickInput;
		quickInput.pick('ACTIONEFFECT SOURCES', 'Choose a definition', (_origin, lifetime) => {
			lifetime.add(subscribeToLuaModelChanges(editorTextModelService, executionDomain, () => quickInput.hide()));
			return new TextQuickPickProvider(sources.map(createBehaviorQuickPickItem));
		}, item => this.openSource({ resource: item.registration.resource,
			line: item.registration.range.start.line, column: item.registration.range.start.column }));
	}

	public openSource(location: ScenarioSourceLocation): void {
		this.navigation.focusChunkSourceForContext(
			location.resource.domain,
			location.resource.path,
			{
				row: location.line - 1,
				startColumn: location.column - 1,
				endColumn: location.column - 1,
			},
		);
	}

	private runSelected(view: ScenarioLabViewState): void {
		this.refreshSources();
		const node = selectedScenarioTestNode(view)!;
		this.runs.start(node.id);
	}

	private rerunLast(view: ScenarioLabViewState): void {
		const previous = this.runs.results.runs[0];
		this.refreshSources();
		const scope = this.runs.collection.getNode(previous.scopeId);
		if (scope === undefined) {
			view.status.info = 'THE PREVIOUS TEST SELECTION NO LONGER EXISTS';
			view.status.dirty = true;
			return;
		}
		this.runs.start(scope.id);
	}

	private handleRunChange(event: ScenarioRunEvent): void {
		if (this.view === null) return;
		const view = this.view;
		view.runActive = this.runs.active;
		if (event.type === 'error') this.editor.handleRuntimeTaskError(event.error, 'Test run failed');
		refreshScenarioLabProjection(view);
		updateScenarioLabStatus(view);
	}
}
