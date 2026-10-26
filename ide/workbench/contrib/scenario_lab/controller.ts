import { RuntimeDebuggerResumeMode as Mode } from '../../../runtime/source_debugger';
import { openCompiledDebugSources } from '../debugger/compiled_sources';
import type { PlayController } from '../play/controller';
import type { ScenarioTestModule } from '../../../testing/scenario/test_collection';
import { LuaSyntaxError } from '../../../../toolchain/ts/lua/errors';
import { subscribeToLuaModelChanges } from '../../../editor/contrib/intellisense/model_lifetime';
import { createBehaviorQuickPickItem } from '../behavior_lens/quick_access';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { WheelInputSnapshot } from '../../../common/models';
import type { CartEditor } from '../../../cart_editor';
import type { EditorScenarioLabCommandId } from '../../../common/commands';
import type { ScenarioLabTabId } from '../../ui/tab/id';
import type { EditorNavigationController } from '../resources/navigation';
import type { EditorGroupView } from '../../services/editor/editor_group';
import { prepareScenarioLabLayout } from './layout';
import {
	scrollWorkbenchList,
	workbenchListContainsPosition,
} from '../../ui/list_view';
import {
	scenarioLabCommandEnabled,
	revealScenarioRun,
	updateScenarioLabStatus,
} from './navigation';
import {
	refreshScenarioLabProjection,
	selectedScenarioTestNode,
} from './projection';
import { ScenarioRunAdmissionError, type ScenarioRunService, type ScenarioRunEvent } from '../../services/testing/scenario_runs';
import type { ScenarioLabViewState } from './view_model';
import { createScenarioLabViewState } from './view_state';
import type { ScenarioRun, ScenarioSourceLocation } from '../../../testing/scenario/result_service';
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
		private readonly editorGroup: EditorGroupView,
		private readonly behaviorRegistrations: BehaviorRegistrationIndex,
		public readonly runs: ScenarioRunService,
		private readonly play: PlayController,
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
		this.editorGroup.openEditor(this.resolveInput());
	}

	public revealRun(run: ScenarioRun): void {
		this.refreshSources();
		revealScenarioRun(this.getOrCreateView(), run);
		this.editor.activate();
		this.open();
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
			case 'scenarioLab.play': this.refreshSources(); this.play.start(this.selectedModule()!); return;
			case 'scenarioLab.revealRun': this.revealRun(this.runs.results.liveRun ?? this.runs.results.runs[0]); return;
			case 'scenarioLab.debug':
			case 'scenarioLab.run':
			case 'scenarioLab.rerun':
				try {
					if (command !== 'scenarioLab.rerun') this.runSelected(view, command === 'scenarioLab.debug' ? 'debug' : 'run');
					else this.rerunLast(view);
				} catch (error) {
					if (!(error instanceof LuaSyntaxError) && !(error instanceof ScenarioRunAdmissionError)) throw error;
					this.editor.handleRuntimeTaskError(error, 'Invalid test declaration');
				}
				return;
			case 'scenarioLab.continue': this.runs.debugger!.resume(Mode.Continue); return;
			case 'scenarioLab.stepInto': this.runs.debugger!.resume(Mode.StepInto); return;
			case 'scenarioLab.stepOver': this.runs.debugger!.resume(Mode.StepOver); return;
			case 'scenarioLab.stepOut': this.runs.debugger!.resume(Mode.StepOut); return;
			case 'scenarioLab.pause': this.runs.debugger!.pause(); return;
			case 'scenarioLab.breakpoints': {
				const debug = this.runs.debugger!;
				openCompiledDebugSources(this.editor.quickInput, debug.sources,
					listener => debug.onDidChange(() => { if (debug.status === 'closed' || debug.status === 'finished') listener(); }),
					text => { view.status.info = text; view.status.dirty = true; });
				return;
			}
			case 'scenarioLab.cancel':
				this.runs.cancel(this.runs.results.liveRun!);
				return;
		}
	}

	public isCommandEnabled(command: EditorScenarioLabCommandId): boolean {
		if (command === 'scenarioLab.play') return (this.editorGroup.model.activeTab?.kind === 'scenario_lab') && !this.runs.active
			&& this.play.service.current === undefined && this.selectedModule()?.suite?.kind === 'integration';
		if (command === 'scenarioLab.revealRun') return this.runs.results.runs.length !== 0;
		if (command === 'scenarioLab.cancel') return this.runs.active;
		return (this.editorGroup.model.activeTab?.kind === 'scenario_lab')
			&& this.view !== null
			&& scenarioLabCommandEnabled(this.view, command);
	}

	private selectedModule(): ScenarioTestModule | undefined {
		if (this.view === null) return undefined;
		const node = selectedScenarioTestNode(this.view);
		return node?.kind === 'module' ? node : node?.kind === 'test' ? this.runs.collection.getNode(node.parentId) as ScenarioTestModule : undefined;
	}

	public handleWheel(view: ScenarioLabViewState, event: WheelInputSnapshot): void {
		prepareScenarioLabLayout(view);
		const delta = event.deltaY * WHEEL_SCROLL_ROWS;
		if (workbenchListContainsPosition(view.testPane, event.viewportX, event.viewportY)) scrollWorkbenchList(view.testPane, delta);
		else if (workbenchListContainsPosition(view.resultPane, event.viewportX, event.viewportY)) scrollWorkbenchList(view.resultPane, delta);
		else if (view.focus === 'tests') scrollWorkbenchList(view.testPane, delta);
		else scrollWorkbenchList(view.resultPane, delta);
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
		view.debugger = this.runs.debugger;
		updateScenarioLabStatus(view);
		return view;
	}

	public resolveInput(): ScenarioLabInput {
		this.refreshSources();
		const tab = this.editorGroup.model.findById(SCENARIO_LAB_TAB_ID);
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

	private runSelected(view: ScenarioLabViewState, mode: 'run' | 'debug'): void {
		this.refreshSources();
		const node = selectedScenarioTestNode(view)!;
		this.runs.start(node.id, mode);
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
		this.runs.start(scope.id, previous.mode);
	}

	private handleRunChange(event: ScenarioRunEvent): void {
		if (this.view === null) return;
		const view = this.view;
		view.runActive = this.runs.active;
		view.debugger = this.runs.debugger;
		if (event.type === 'error') this.editor.handleRuntimeTaskError(event.error, 'Test run failed');
		refreshScenarioLabProjection(view);
		updateScenarioLabStatus(view);
	}
}
