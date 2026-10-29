import { RuntimeDebuggerResumeMode as Mode } from '../../../runtime/source_debugger';
import { openCompiledDebugSources } from '../debugger/compiled_sources';
import type { PlayController } from '../play/controller';
import type { ScenarioTestModule, ScenarioTestNodeId, ScenarioTestRoot } from '../../../testing/scenario/test_collection';
import { LuaSyntaxError } from '../../../../toolchain/ts/lua/errors';
import { subscribeToLuaModelChanges } from '../../../editor/contrib/intellisense/model_lifetime';
import { createBehaviorQuickPickItem } from '../behavior_lens/quick_access';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { CartEditor } from '../../../cart_editor';
import type { EditorScenarioLabCommandId } from '../../../common/commands';
import type { EditorNavigationController } from '../resources/navigation';
import type { EditorGroupView } from '../../services/editor/editor_group';
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
import type { QuickInputController } from '../../services/quick_input/controller';

export type ScenarioLabExecutionCommand = Extract<EditorScenarioLabCommandId,
	| 'scenarioLab.run' | 'scenarioLab.debug' | 'scenarioLab.rerun' | 'scenarioLab.play'
	| 'scenarioLab.runWithCompanion' | 'scenarioLab.debugWithCompanion' | 'scenarioLab.playWithCompanion'>;
type ScenarioLabControlCommand = Exclude<EditorScenarioLabCommandId, ScenarioLabExecutionCommand>;

/** Native catalog identity and the retained user intent that requested its execution. */
export type ScenarioLabExecutionIntent = {
	readonly command: ScenarioLabExecutionCommand;
	readonly input: ScenarioLabInput;
	readonly scopeId: ScenarioTestNodeId;
	readonly selectionRevision: number | undefined;
	readonly testMembership: symbol | undefined;
	readonly previous: ScenarioRun | undefined;
	readonly withCompanion: boolean;
} & ({ readonly kind: 'play'; readonly membership: ScenarioTestModule }
	| { readonly kind: 'run'; readonly membership: ScenarioTestModule | ScenarioTestRoot; readonly mode: 'run' | 'debug' });

/** Workbench contribution that projects tests/results and invokes the run owner. */
export class ScenarioLabController {
	private view: ScenarioLabViewState | null = null;
	private current: ScenarioLabInput | undefined;
	private readonly disposeRunListener: () => void;

	public constructor(
		private readonly editor: CartEditor,
		private readonly navigation: EditorNavigationController,
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

	public open(destination: EditorGroupView): void {
		this.editor.editorParts.revealEditor(this.resolveInput(), destination);
	}

	public revealRun(run: ScenarioRun, destination: EditorGroupView): void {
		this.refreshSources();
		revealScenarioRun(this.getOrCreateView(), run);
		if (!this.editor.isActive) this.editor.activate();
		this.open(destination);
	}

	public updateView(view: ScenarioLabViewState): void {
		this.runs.refreshSources();
		if (view.runActive !== this.runs.active) {
			view.runActive = this.runs.active;
			updateScenarioLabStatus(view);
		}
	}

	public executeCommand(command: ScenarioLabControlCommand, input: ScenarioLabInput | undefined,
		group: EditorGroupView, picker: QuickInputController): void {
		if (!this.isCommandEnabled(command, input)) return;
		if (command === 'scenarioLab.revealRun') {
			this.revealRun(this.runs.results.liveRun ?? this.runs.results.runs[0], group);
			return;
		}
		if (command === 'scenarioLab.cancel') {
			this.runs.cancel(this.runs.results.liveRun!);
			return;
		}
		const view = input!.view;
		switch (command) {
			case 'scenarioLab.continue': this.runs.debugger!.resume(Mode.Continue); return;
			case 'scenarioLab.stepInto': this.runs.debugger!.resume(Mode.StepInto); return;
			case 'scenarioLab.stepOver': this.runs.debugger!.resume(Mode.StepOver); return;
			case 'scenarioLab.stepOut': this.runs.debugger!.resume(Mode.StepOut); return;
			case 'scenarioLab.pause': this.runs.debugger!.pause(); return;
			case 'scenarioLab.breakpoints': {
				const debug = this.runs.debugger!;
				openCompiledDebugSources(picker, debug.sources,
					listener => debug.onDidChange(() => { if (debug.status === 'closed' || debug.status === 'finished') listener(); }),
					text => { view.status.info = text; });
				return;
			}
		}
	}

	public isCommandEnabled(command: EditorScenarioLabCommandId, input: ScenarioLabInput | undefined): boolean {
		if (command === 'scenarioLab.revealRun') return this.runs.results.runs.length !== 0;
		if (command === 'scenarioLab.cancel') return this.runs.active;
		if (input === undefined || input !== this.current) return false;
		if (command === 'scenarioLab.play' || command === 'scenarioLab.playWithCompanion') return !this.runs.active
			&& this.play.service.current === undefined && this.selectedModule(input.view)?.suite?.kind === 'integration';
		return scenarioLabCommandEnabled(input.view, command);
	}

	private selectedModule(view: ScenarioLabViewState): ScenarioTestModule | undefined {
		const node = selectedScenarioTestNode(view);
		return node?.kind === 'module' ? node : node?.kind === 'test' ? this.runs.collection.getNode(node.parentId) as ScenarioTestModule : undefined;
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
		if (this.current === undefined) {
			const input = new ScenarioLabInput(this.getOrCreateView());
			input.onWillDispose(() => { this.current = undefined; });
			this.current = input;
		}
		return this.current;
	}

	public openActionEffectSource(view: ScenarioLabViewState, group: EditorGroupView, quickInput: QuickInputController,
		contextId: string, effectId: string): void {
		const sources = this.behaviorRegistrations.resolve(contextId, 'action_effect', effectId);
		if (sources.length === 1) {
			const source = sources[0];
			this.openSource(group, { resource: source.resource, line: source.range.start.line, column: source.range.start.column });
			return;
		}
		if (sources.length === 0) {
			view.status.info = `ACTIONEFFECT ${effectId} / SOURCE UNRESOLVED`;
			return;
		}
		quickInput.pick('ACTIONEFFECT SOURCES', 'Choose a definition', (_origin, lifetime) => {
			lifetime.add(subscribeToLuaModelChanges(editorTextModelService, this.runs.collection.catalog, contextId, () => quickInput.hide()));
			return new TextQuickPickProvider(sources.map(registration => createBehaviorQuickPickItem(registration, this.runs.collection.catalog.getContext(registration.resource.contextId).projectRootPath)));
		}, item => this.openSource(group, { resource: item.registration.resource,
			line: item.registration.range.start.line, column: item.registration.range.start.column }));
	}

	public openSource(group: EditorGroupView, location: ScenarioSourceLocation): void {
		this.navigation.focusChunkSourceForContext(
			group, location.resource.contextId,
			location.resource.path,
			{
				row: location.line - 1,
				startColumn: location.column - 1,
				endColumn: location.column - 1,
			},
		);
	}

	/** Ordinary commands start immediately; companion media is explicit, never inherited from installed sockets. */
	public start(scopeId: ScenarioTestNodeId, group: EditorGroupView, mode: 'run' | 'debug' = 'run', companionContextId: string | null = null): void {
		this.revealRun(this.runs.start(scopeId, mode, companionContextId), group);
	}

	public captureExecution(command: ScenarioLabExecutionCommand, input: ScenarioLabInput): ScenarioLabExecutionIntent | undefined {
		if (!this.isCommandEnabled(command, input)) return;
		const previous = command === 'scenarioLab.rerun' ? this.runs.results.runs[0] : undefined;
		const scopeId = previous === undefined ? input.view.testPane.selection.nodeId! : previous.scopeId;
		const scope = this.runs.collection.getNode(scopeId);
		if (scope === undefined) return;
		const membership = scope.kind === 'test' ? this.runs.collection.getNode(scope.parentId) as ScenarioTestModule : scope;
		const selectionRevision = previous === undefined ? input.view.testPane.selection.revision : undefined;
		const testMembership = scope.kind === 'test' ? scope.membership : undefined;
		const withCompanion = command === 'scenarioLab.runWithCompanion' || command === 'scenarioLab.debugWithCompanion'
			|| command === 'scenarioLab.playWithCompanion';
		return command === 'scenarioLab.play' || command === 'scenarioLab.playWithCompanion'
			? { command, input, scopeId, previous, selectionRevision, testMembership, withCompanion, kind: 'play', membership: this.selectedModule(input.view)! }
			: { command, input, scopeId, previous, selectionRevision, testMembership, withCompanion, kind: 'run', membership,
				mode: previous?.mode ?? (command === 'scenarioLab.debug' || command === 'scenarioLab.debugWithCompanion' ? 'debug' : 'run') };
	}

	public isExecutionCurrent(intent: ScenarioLabExecutionIntent): boolean {
		if (intent.input !== this.current || this.runs.collection.getNode(intent.membership.id) !== intent.membership) return false;
		if (intent.testMembership !== undefined) {
			const test = this.runs.collection.getNode(intent.scopeId);
			if (test?.kind !== 'test' || test.membership !== intent.testMembership) return false;
		}
		if (intent.previous !== undefined) return this.runs.results.runs.includes(intent.previous);
		const selection = intent.input.view.testPane.selection;
		return selection.revision === intent.selectionRevision && selection.nodeId === intent.scopeId;
	}

	/** Discovery maps the captured catalog identity; it never chooses a replacement row. */
	public isExecutionEnabled(intent: ScenarioLabExecutionIntent): boolean {
		if (!this.isExecutionCurrent(intent)) return false;
		this.refreshSources();
		return this.isExecutionCurrent(intent) && this.runs.collection.getNode(intent.scopeId) !== undefined
			&& this.isCommandEnabled(intent.command, intent.input);
	}

	public executeExecution(intent: ScenarioLabExecutionIntent, group: EditorGroupView, picker: QuickInputController,
		isCurrent: () => boolean): void {
		if (intent.withCompanion) {
			this.startWithCompanion(intent, group, picker, isCurrent);
			return;
		}
		this.startExecution(intent, group, null);
	}

	private startExecution(intent: ScenarioLabExecutionIntent, group: EditorGroupView, companionContextId: string | null): void {
		try {
			if (intent.kind === 'play') {
				this.play.start(intent.membership, group, companionContextId);
			} else {
				this.start(intent.scopeId, group, intent.mode, intent.previous === undefined ? companionContextId : intent.previous.companionContextId);
			}
		} catch (error) {
			if (!(error instanceof LuaSyntaxError) && !(error instanceof ScenarioRunAdmissionError)) throw error;
			this.editor.handleRuntimeTaskError(error, 'Invalid test declaration');
		}
	}

	private startWithCompanion(intent: ScenarioLabExecutionIntent, group: EditorGroupView, picker: QuickInputController,
		isCurrent: () => boolean): void {
		const catalog = this.runs.collection.catalog;
		const membership = intent.membership;
		const primaryContextId = membership.kind === 'root' ? membership.contextId : membership.resource.contextId;
		let active = false;
		picker.pick(intent.kind === 'play' ? 'PLAY FIXTURE' : 'SCENARIO FIXTURE',
			intent.kind === 'play' ? `Primary: ${intent.membership.resource.path}; choose a companion project` : 'Choose a companion project', (_origin, lifetime) => {
			const choices: Array<{ label: string; description: string; detail: string; contextId: string | null }> = [
				{ label: 'No companion cartridge', description: 'Primary project only', detail: '', contextId: null },
			];
			if (!isCurrent() || !this.isExecutionEnabled(intent) || !isCurrent()) {
				picker.hide();
				return new TextQuickPickProvider(choices);
			}
			lifetime.add({ dispose: catalog.onDidChange(() => picker.hide()) });
			for (const context of catalog.contexts.values()) {
				if (context.programDomain !== 'cart') continue;
				choices.push({ label: context.projectRootPath, description: context.id === primaryContextId ? 'Primary project' : '',
					detail: 'Use this project as the companion cartridge', contextId: context.id });
			}
			return new TextQuickPickProvider(choices);
		}, choice => {
			if (!isCurrent() || !this.isExecutionEnabled(intent) || !isCurrent()) return;
			this.startExecution(intent, group, choice.contextId);
		}, lifetime => {
			active = true;
			lifetime.add({ dispose: () => { active = false; } });
		});
		// Blur can supersede focus before QuickInput prepares its provider. Retire
		// only this still-owned prompt, never a replacement opened by that callback.
		if (active && !isCurrent()) picker.hide();
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
