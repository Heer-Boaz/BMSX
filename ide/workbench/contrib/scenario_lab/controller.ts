import type { HostAudioOutput } from '../../../../hosts/common/audio_output';
import type { PointerSnapshot } from '../../../common/models';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { CartEditor } from '../../../cart_editor';
import type { OverlayRenderer } from '../../../runtime/overlay_renderer';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { EditorScenarioLabCommandId } from '../../../common/commands';
import { activateEditor, deactivateEditor } from '../../overlay_modes';
import {
	captureCurrentLuaSource,
	captureLuaTextModelSources,
} from '../../services/working_copy/lua_sources';
import type { ScenarioLabTabId } from '../../ui/tab/id';
import { editorTabGroup } from '../../ui/tab/group_model';
import { isScenarioLabActive, setActiveTab } from '../../ui/tabs';
import type { EditorNavigationController } from '../resources/navigation';
import type { EditorPanes } from '../../services/editor/editor_panes';
import { prepareScenarioLabLayout } from './layout';
import {
	scrollWorkbenchList,
	workbenchListContainsPosition,
} from '../../ui/list_view';
import {
	executeScenarioLabNavigation,
	scenarioLabCommandEnabled,
	type ScenarioLabNavigationResult,
	type ScenarioLabNavigationCommand,
	updateScenarioLabStatus,
} from './navigation';
import {
	refreshScenarioLabProjection,
	selectedScenarioTestNode,
} from './projection';
import {
	handleScenarioLabPointerInput,
	ScenarioLabPointerResult,
} from './pointer';
import type { ScenarioRunService } from './run_service';
import type {
	ScenarioMediaSessionEvent,
	ScenarioRunTestSource,
} from './run_service';
import type {
	ScenarioTestCollection,
	ScenarioTestItem,
	ScenarioTestNodeId,
} from '../../../testing/scenario/test_collection';
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
	private readonly disposeMediaSessionListener: () => void;

	public constructor(
		private readonly editor: CartEditor,
		private readonly sources: RuntimeSourceState,
		private readonly navigation: EditorNavigationController,
		private readonly editorPanes: EditorPanes,
		private readonly behaviorRegistrations: BehaviorRegistrationIndex,
		private readonly collection: ScenarioTestCollection,
		private readonly runs: ScenarioRunService,
		private readonly runtime: Runtime,
		private readonly overlayRenderer: OverlayRenderer,
		private readonly audioOutput: HostAudioOutput,
	) {
		this.disposeMediaSessionListener = this.runs.onDidEndMediaSession(
			event => this.handleMediaSessionEnd(event),
		);
	}

	public dispose(): void {
		this.disposeMediaSessionListener();
	}

	public open(): void {
		this.openView(this.getOrCreateView());
	}

	public updateView(view: ScenarioLabViewState): void {
		if (view.runActive !== this.runs.active) {
			view.runActive = this.runs.active;
			updateScenarioLabStatus(view);
		}
		prepareScenarioLabLayout(view);
	}

	public executeNavigation(
		view: ScenarioLabViewState,
		command: ScenarioLabNavigationCommand,
	): boolean {
		prepareScenarioLabLayout(view);
		const result = executeScenarioLabNavigation(view, command);
		return this.applyNavigationResult(view, result);
	}

	public handlePointer(
		view: ScenarioLabViewState,
		snapshot: PointerSnapshot,
		justPressed: boolean,
		currentTimeMs: number,
	): boolean {
		prepareScenarioLabLayout(view);
		const result = handleScenarioLabPointerInput(
			view,
			snapshot,
			justPressed,
			currentTimeMs,
			this.editor.commands,
		);
		switch (result) {
			case ScenarioLabPointerResult.Outside:
				return false;
			case ScenarioLabPointerResult.Handled:
				return true;
			case ScenarioLabPointerResult.Activate:
				this.applyNavigationResult(
					view,
					executeScenarioLabNavigation(view, 'activate'),
				);
				return true;
		}
	}

	public executeCommand(command: EditorScenarioLabCommandId): void {
		const view = this.view!;
		switch (command) {
			case 'scenarioLab.run':
				this.runSelected(view);
				return;
			case 'scenarioLab.rerun':
				this.rerunLast(view);
				return;
			case 'scenarioLab.cancel':
				this.runs.cancel();
				return;
		}
	}

	public isCommandEnabled(command: EditorScenarioLabCommandId): boolean {
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
			this.collection,
			this.runs.results,
			this.runs.active,
		);
		this.view = view;
		return view;
	}

	private openView(view: ScenarioLabViewState): void {
		let tab = editorTabGroup.findById(SCENARIO_LAB_TAB_ID);
		if (tab === undefined) {
			tab = new ScenarioLabInput(view);
			editorTabGroup.add(tab);
		}
		setActiveTab(this.editorPanes, tab.id);
	}

	private applyNavigationResult(
		view: ScenarioLabViewState,
		result: ScenarioLabNavigationResult,
	): boolean {
		switch (result.kind) {
			case 'none':
				return false;
			case 'changed':
				return true;
			case 'open-source':
				this.openSource(result.location);
				return true;
			case 'actioneffect-source': {
				const sources = this.behaviorRegistrations.resolve(
					result.executionDomain,
					'action_effect',
					result.effectId,
				);
				if (sources.length === 1) {
					const source = sources[0];
					this.openSource({
						resource: source.resource,
						line: source.range.start.line,
						column: source.range.start.column,
					});
					return true;
				}
				view.status.info = sources.length === 0
					? `ACTIONEFFECT ${result.effectId} / SOURCE UNRESOLVED`
					: `ACTIONEFFECT ${result.effectId} / ${sources.length} SOURCES`;
				view.status.dirty = true;
				return true;
			}
		}
	}

	private openSource(location: ScenarioSourceLocation): void {
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
		const node = selectedScenarioTestNode(view)!;
		this.startRun(view, node.id, this.collection.resolveNode(node));
	}

	private rerunLast(view: ScenarioLabViewState): void {
		const previous = this.runs.results.runs[0];
		const tests = new Array<ScenarioTestItem>(previous.items.length);
		for (let index = 0; index < previous.items.length; index += 1) {
			tests[index] = previous.items[index].test;
		}
		this.startRun(view, previous.scopeId, tests);
	}

	private startRun(
		view: ScenarioLabViewState,
		scopeId: ScenarioTestNodeId,
		tests: readonly ScenarioTestItem[],
	): void {
		const testSources = new Array<ScenarioRunTestSource>(tests.length);
		for (let index = 0; index < tests.length; index += 1) {
			const test = tests[index];
			const snapshot = captureCurrentLuaSource(this.sources, test.resource);
			testSources[index] = {
				test,
				source: snapshot.source,
				sourceRevision: snapshot.revision,
			};
		}
		const programSources = captureLuaTextModelSources(this.sources);
		view.runActive = true;
		updateScenarioLabStatus(view);
		void this.runs.start(
			scopeId,
			testSources,
			programSources,
		);
		deactivateEditor(this.editor, this.overlayRenderer, this.audioOutput);
	}

	private handleMediaSessionEnd(event: ScenarioMediaSessionEvent): void {
		const view = this.view!;
		if (event.type === 'error') {
			this.handleRunError(view, event.error);
			return;
		}
		this.completeRun(view);
	}

	private handleRunError(view: ScenarioLabViewState, error: unknown): void {
		view.runActive = false;
		activateEditor(
			this.editor,
			this.sources,
			this.overlayRenderer,
			this.runtime,
			this.audioOutput,
		);
		this.editor.handleRuntimeTaskError(error, 'Scenario run failed');
		this.openView(view);
		refreshScenarioLabProjection(view);
		updateScenarioLabStatus(view);
	}

	private completeRun(view: ScenarioLabViewState): void {
		view.runActive = false;
		activateEditor(
			this.editor,
			this.sources,
			this.overlayRenderer,
			this.runtime,
			this.audioOutput,
		);
		this.openView(view);
		refreshScenarioLabProjection(view);
		updateScenarioLabStatus(view);
	}
}
