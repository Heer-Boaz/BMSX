import { LuaSyntaxError } from '../../../../toolchain/ts/lua/errors';
import { subscribeToLuaModelChanges } from '../../../editor/contrib/intellisense/model_lifetime';
import { createBehaviorQuickPickItem } from '../behavior_lens/quick_access';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { PointerSnapshot } from '../../../common/models';
import type { CartEditor } from '../../../cart_editor';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { EditorScenarioLabCommandId } from '../../../common/commands';
import {
	captureCurrentLuaSource,
	captureLuaTextModelSources,
} from '../../services/working_copy/lua_sources';
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
import type { ScenarioRunService } from './run_service';
import type {
	ScenarioRunEvent,
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
	private readonly disposeRunListener: () => void;
	private readonly sourceListeners: (() => void)[];
	private sourcesDirty = true;

	public constructor(
		private readonly editor: CartEditor,
		private readonly sources: RuntimeSourceState,
		private readonly navigation: EditorNavigationController,
		private readonly editorPanes: EditorPanes,
		private readonly behaviorRegistrations: BehaviorRegistrationIndex,
		private readonly collection: ScenarioTestCollection,
		private readonly runs: ScenarioRunService,
	) {
		this.disposeRunListener = this.runs.onDidChangeRun(
			event => this.handleRunChange(event),
		);
		const changed = () => { this.sourcesDirty = true; };
		this.sourceListeners = [editorTextModelService.onDidAddModel(changed),
			editorTextModelService.onDidChangeContent(changed), editorTextModelService.onDidRemoveModel(changed)];
	}

	private refreshSources(): void {
		const membershipChanged = this.collection.refresh();
		if (!this.sourcesDirty && !membershipChanged) return;
		for (const root of this.collection.roots) {
			for (const module of root.children) {
				const snapshot = captureCurrentLuaSource(editorTextModelService, this.sources, module.resource);
				this.collection.updateSource(module, snapshot.source, snapshot.revision);
			}
		}
		this.sourcesDirty = false;
		if (this.view !== null) {
			this.view.testPane.rowsDirty = true;
			refreshScenarioLabProjection(this.view);
		}
	}

	public dispose(): void {
		this.disposeRunListener();
		for (const dispose of this.sourceListeners) dispose();
		this.runs.dispose();
	}

	public open(): void {
		openEditorTab(this.editorPanes, this.resolveInput());
	}

	public updateView(view: ScenarioLabViewState): void {
		this.refreshSources();
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
					if (!(error instanceof LuaSyntaxError)) throw error;
					this.editor.handleRuntimeTaskError(error, 'Invalid test declaration');
				}
				return;
			case 'scenarioLab.cancel':
				this.runs.cancel();
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
			this.collection,
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
		this.startRun(view, node.id, this.collection.resolveNode(node));
	}

	private rerunLast(view: ScenarioLabViewState): void {
		const previous = this.runs.results.runs[0];
		this.refreshSources();
		const scope = this.collection.getNode(previous.scopeId);
		if (scope === undefined) {
			view.status.info = 'THE PREVIOUS TEST SELECTION NO LONGER EXISTS';
			view.status.dirty = true;
			return;
		}
		this.startRun(view, scope.id, this.collection.resolveNode(scope));
	}

	private startRun(
		view: ScenarioLabViewState,
		scopeId: ScenarioTestNodeId,
		tests: readonly ScenarioTestItem[],
	): void {
		const testSources = new Array<ScenarioRunTestSource>(tests.length);
		for (let index = 0; index < tests.length; index += 1) {
			const test = tests[index];
			const snapshot = captureCurrentLuaSource(editorTextModelService, this.sources, test.resource);
			testSources[index] = {
				test,
				source: snapshot.source,
				sourceRevision: snapshot.revision,
			};
		}
		const programSources = captureLuaTextModelSources(editorTextModelService, this.sources, true);
		view.runActive = true;
		updateScenarioLabStatus(view);
		void this.runs.start(
			scopeId,
			testSources,
			programSources,
		);
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
