import type { BehaviorLensNavigationSelection } from './navigation_selection';
import { captureNavigation } from '../../../navigation/navigation_history';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { editorTextModelService } from '../../../editor/model/model_service';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import { resolveLuaTextFileModel } from '../../services/working_copy/text_file_model';
import type { Blua32SourceImage, RuntimeSourceState } from '../../../runtime/sources';
import { CARTRIDGE_RESOURCE_DOMAINS, SYSTEM_RESOURCE_DOMAIN, type ResourceDomain } from '../../../common/resource';
import type { QuickInputController } from '../../services/quick_input/controller';
import { type EditorOpenOptions } from '../../ui/tab/group_model';
import type { EditorNavigationController } from '../resources/navigation';
import type { EditorGroupView } from '../../services/editor/editor_group';
import { BehaviorLensInput } from './editor_input';
import {
	selectBehaviorLensDefinition,
	installBehaviorLensDocument,
	prepareBehaviorLensLayout,
} from './layout';
import {
	BehaviorLensNavigationResult,
	executeBehaviorLensNavigation,
	finishBehaviorLensNavigation,
	selectedBehaviorLensSourceRange,
	type BehaviorLensNavigationCommand,
} from './navigation';
import type { BehaviorSourceDocuments } from './source_documents';
import { luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
import type { BehaviorKind, BehaviorRegistrationSource } from './model';
import { buildBehaviorQuickPickItems } from './quick_access';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import { createBehaviorLensViewState, type BehaviorLensViewState } from './view_model';
import { selectStateMachineSource, type StateMachineSourceSelection } from './state_machine_selection';
import { editorViewState } from '../../../editor/ui/view/state';
import type { GraphLayoutEngineFactory } from '../../services/graph_layout/engine';
import { acceptStateGraphSelection, stateGraphSelection } from './state_graph_navigation';
import type { BehaviorInspectionProperty } from './inspection';
import { behaviorTreeEditTarget, behaviorTreeMoveTarget, createBehaviorTreeChildDuplicateEdits, createBehaviorTreeChildMoveEdits, createBehaviorTreeChildRemovalEdits, createBehaviorTreeTransferEdit } from './behavior_tree_edit';
import type { StateMachineRetargetCheck } from './state_machine_retarget';
import { createStateMachineInitialEdits, stateMachineInitialTarget } from './state_machine_initial';
import { beginBehaviorTreeDrag, type BehaviorTreeTransferDrop } from './behavior_tree_drag';
import type { WorkbenchGraphDragSession } from '../../ui/graph/drag';
import type { LuaSourceRange } from '../../../../toolchain/ts/lua/syntax/ast';
import type { BehaviorTreeTransferAnalysis, BehaviorTreeTransferCheck } from './behavior_tree_transfer';
import { createStateMachineRetargetEdit } from './state_machine_edit';
import { behaviorTreeTransferImpacts } from './behavior_tree_review';
import { stateMachineRetargetImpacts } from './state_machine_review';
import { WorkspaceSourceContext } from '../../services/working_copy/source_context';
import { WorkspaceEditProposal } from '../../services/working_copy/workspace_edit';
import { WorkspaceEditReviewInput } from '../edit_review/editor_input';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import { canOpenBehaviorInspectionSource } from './inspection_source';
import type { WorkbenchPropertyInspector } from '../../ui/property_inspector/control';
import { inspectActionEffectDefinition, readActionEffectInstances, type ActionEffectInstanceChoice } from './action_effect_runtime';
import { inspectStateMachineDefinition, readStateMachineDefinitionStates, readStateMachineInstances, readStateMachineStates, type StateMachineInstanceChoice } from './state_machine_runtime';
import { readBehaviorDefinitions, type BehaviorDefinitionChoice } from './runtime_definitions';
import { readBehaviorTreeInstances, type BehaviorTreeInstanceChoice } from './behavior_tree_runtime';
import type { HostRewind } from '../../../../hosts/common/rewind';
import { BehaviorRuntimeInspection, type BehaviorRuntimeSelection } from './runtime_inspection';

const PICKER_TITLES: Readonly<Record<BehaviorKind, string>> = {
	action_effect: 'ACTIONEFFECTS',
	state_machine: 'STATE MACHINES',
	behavior_tree: 'BEHAVIOR TREES',
};

/** Workbench contribution for source-derived behavior topology. Inputs own every view. */
export class BehaviorLensController {
	public constructor(
		private readonly sources: RuntimeSourceState,
		private readonly navigation: EditorNavigationController,
		private readonly editorGroup: EditorGroupView,
		public readonly quickInput: QuickInputController,
		public readonly documents: BehaviorSourceDocuments,
		private readonly createGraphLayoutEngine: GraphLayoutEngineFactory,
		private readonly guest: SuspendedGuestSession,
		private readonly rewind: HostRewind,
	) {}

	public open(kind: BehaviorKind | null = null, options: EditorOpenOptions = {}): void {
		this.quickInput.pick(kind === null ? 'BEHAVIOR LENS' : PICKER_TITLES[kind], 'Choose a definition',
			() => new TextQuickPickProvider(buildBehaviorQuickPickItems(this.sources.catalog, this.documents.registrations, kind)),
			item => this.openDefinition(item.registration, options));
	}

	public openDefinition(registration: BehaviorRegistrationSource, options: EditorOpenOptions = {}): BehaviorLensInput {
		return captureNavigation(() => {
			const resource = this.sources.catalog.resolveResource(registration.resource)!;
			const model = resolveLuaTextFileModel(editorTextModelService, this.sources.catalog, resource);
			const occurrence = luaSourceRangeToTextRange(model.buffer, registration.occurrenceRange);
			let input: BehaviorLensInput | undefined;
			for (const candidate of this.editorGroup.model.tabs) {
				if (candidate.kind !== 'behavior_lens' || candidate.workingCopy !== model || candidate.view.definitionRowKey === null) continue;
				const view = candidate.view;
				const span = view.source.ranges.get(view.definitionRowKey)!;
				if (span.start !== span.end && span.start === occurrence.start && span.end === occurrence.end
					&& view.source.nodesByRowKey.get(view.definitionRowKey)!.behaviorKind === registration.behaviorKind) {
					input = candidate;
					break;
				}
			}
			if (input === undefined) {
				input = this.createInput(model,
					registration.behaviorKind === 'behavior_tree' ? 'graph'
						: registration.behaviorKind === 'action_effect' ? 'properties' : 'state-graph');
				const view = input.view;
				selectBehaviorLensDefinition(view, registration.rowKey);
				view.sourceMatchRowKeys.add(registration.rowKey);
				input.updateDefinition();
			}
			// Reopening a surviving occurrence preserves its selection and viewport.
			this.editorGroup.openEditor(input, options);
			return input;
		});
	}

	/** Source-derived input creation is independent of group admission and pane layout. */
	public createInput(model: EditorTextModel, presentation: BehaviorLensViewState['presentation']['kind']): BehaviorLensInput {
		const project = getOrCreateSemanticProject(editorTextModelService, model.resource.contextId);
		return new BehaviorLensInput(model, createBehaviorLensViewState(this.documents.get(model), model, presentation, address => {
			const resource = this.sources.catalog.resolveResource(project.getResourceIdentity(address))!;
			return resolveLuaTextFileModel(editorTextModelService, this.sources.catalog, resource);
		}), new Set(this.sources.catalog.getSourceContexts(model.resource.contextId).map(context => context.id)), this.createGraphLayoutEngine);
	}

	/** Refreshes a visible source lens when its canonical code buffer advances. */
	public updateView(input: BehaviorLensInput, navigationSelection?: BehaviorLensNavigationSelection): void {
		const { view, workingCopy } = input;
		const document = this.documents.get(workingCopy);
		const sourceChanged = document !== view.document || !view.source.isCurrent;
		if (sourceChanged) {
			installBehaviorLensDocument(view, document);
		}
		navigationSelection?.restore(input);
		if (sourceChanged || navigationSelection !== undefined) input.updateDefinition();
		prepareBehaviorLensLayout(view);
		input.updatePresentation(editorViewState.font.renderFont());
		if (sourceChanged && navigationSelection === undefined) finishBehaviorLensNavigation(view);
	}

	/** A shared literal is one versioned source edit, not one edit per recognized consumer. */
	public retargetStateMachineTransition(input: BehaviorLensInput,
		selection: Extract<StateMachineSourceSelection, { kind: 'state-outcome' }>,
		target: Extract<StateMachineRetargetCheck, { kind: 'available' }>,
	): void {
		const view = input.view, model = view.source.models.get(target.file.file)!;
		if (target.uses.length === 1) {
			model.history.applyEdits(new Map([[model, createStateMachineRetargetEdit(model, view, selection, target)]]));
			return;
		}
		const context = new WorkspaceSourceContext(editorTextModelService, this.sources.catalog);
		for (const source of view.source.models.values()) context.read(source);
		const edit = createStateMachineRetargetEdit(model, view, selection, target);
		const evidence = { summary: `${target.uses.length} recognized uses: ${target.literal.value} -> ${target.text}\nRecognized in ${view.resource.path}; other registration files and dynamic calls are not enumerated.`,
			items: stateMachineRetargetImpacts(view, target) };
		const proposal = new WorkspaceEditProposal('Retarget FSM', context, { kind: 'edit', edits: new Map([[model, edit]]) });
		this.editorGroup.openEditor(new WorkspaceEditReviewInput(proposal, evidence));
	}

	/** Capture the exact transfer and its source caveats before leaving the graph. */
	public reviewTreeTransfer(input: BehaviorLensInput, analysis: BehaviorTreeTransferAnalysis,
		insertion: number, check: Extract<BehaviorTreeTransferCheck, { kind: 'available' }>,
	): void {
		const view = input.view, model = view.source.models.get(analysis.member.file.file)!;
		const context = new WorkspaceSourceContext(editorTextModelService, this.sources.catalog);
		for (const source of view.source.models.values()) context.read(source);
		const edit = createBehaviorTreeTransferEdit(model, view, analysis.member, check, insertion);
		const evidence = { summary: `${analysis.member.branch.role} -> ${check.target.role} position ${insertion + 1}\nRecognized source uses only; dynamic consumers are not enumerated.`,
			items: behaviorTreeTransferImpacts(view, analysis, insertion, check) };
		const proposal = new WorkspaceEditProposal('Move BT source', context, { kind: 'edit', edits: new Map([[model, edit]]) });
		this.editorGroup.openEditor(new WorkspaceEditReviewInput(proposal, evidence));
	}

	public openSource(): void {
		const input = this.editorGroup.model.activeTab;
		if (input?.kind !== 'behavior_lens') return;
		this.updateView(input);
		if (selectedBehaviorLensSourceRange(input.view) === null) this.openDefinitionSource(input.view);
		else this.openSelectedSource(input.view);
	}

	public inspectRuntimeEffect(input: BehaviorLensInput, inspector: WorkbenchPropertyInspector<BehaviorInspectionProperty>): void {
		const choices: Array<ActionEffectInstanceChoice & { domain: ResourceDomain; image: Blua32SourceImage }> = [];
		for (const domain of [SYSTEM_RESOURCE_DOMAIN, ...CARTRIDGE_RESOURCE_DOMAINS] as const) {
			const image = domain === SYSTEM_RESOURCE_DOMAIN ? this.sources.currentBlua32Media.system : this.sources.currentBlua32Media.cartridgeSlots[domain];
			if (image === null || image.sourceContextId !== input.view.resource.contextId) continue;
			for (const item of readActionEffectInstances(this.sources, this.guest, domain).items) {
				choices.push({ ...item, domain, image, detail: `Physical ${domain} / ${item.detail}` });
			}
		}
		this.quickInput.pick('GRANTED ACTIONEFFECTS', 'Choose an instance and its actual installed attachment',
			(_origin, lifetime) => {
				lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
				return new TextQuickPickProvider(choices);
			}, choice => {
				this.showRuntimeInspection(input, inspector, choice.domain, choice.image, `LIVE EFFECT / ${choice.label}`, {
					kind: 'action_effect', componentHashId: choice.component.hashId, effectHashId: choice.effect.hashId,
				});
			});
	}

	public inspectRuntimeStateMachine(input: BehaviorLensInput, inspector: WorkbenchPropertyInspector<BehaviorInspectionProperty>): void {
		const choices: Array<StateMachineInstanceChoice & { domain: ResourceDomain; image: Blua32SourceImage }> = [];
		for (const domain of [SYSTEM_RESOURCE_DOMAIN, ...CARTRIDGE_RESOURCE_DOMAINS] as const) {
			const image = domain === SYSTEM_RESOURCE_DOMAIN ? this.sources.currentBlua32Media.system : this.sources.currentBlua32Media.cartridgeSlots[domain];
			if (image === null || image.sourceContextId !== input.view.resource.contextId) continue;
			for (const item of readStateMachineInstances(this.sources, this.guest, domain).items) {
				choices.push({ ...item, domain, image, detail: `Physical ${domain} / ${item.detail}` });
			}
		}
		this.quickInput.pick('FSM INSTANCES', 'Choose an instance and its actual installed attachment',
			(_origin, lifetime) => {
				lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
				return new TextQuickPickProvider(choices);
			}, machine => this.quickInput.pick(`STATES / ${machine.label}`, machine.detail,
				(_origin, lifetime) => {
					lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
					return new TextQuickPickProvider(readStateMachineStates(this.guest, machine.machine));
				}, state => {
					this.showRuntimeInspection(input, inspector, machine.domain, machine.image, `LIVE FSM / ${state.label}`, {
						kind: 'state_machine', componentHashId: machine.component.hashId,
						machineHashId: machine.machine.hashId, stateHashId: state.state.hashId,
					});
				}));
	}

	public inspectRuntimeTree(input: BehaviorLensInput, inspector: WorkbenchPropertyInspector<BehaviorInspectionProperty>): void {
		const choices: Array<BehaviorTreeInstanceChoice & { domain: ResourceDomain; image: Blua32SourceImage }> = [];
		for (const domain of [SYSTEM_RESOURCE_DOMAIN, ...CARTRIDGE_RESOURCE_DOMAINS] as const) {
			const image = domain === SYSTEM_RESOURCE_DOMAIN ? this.sources.currentBlua32Media.system : this.sources.currentBlua32Media.cartridgeSlots[domain];
			if (image === null || image.sourceContextId !== input.view.resource.contextId) continue;
			for (const item of readBehaviorTreeInstances(this.sources, this.guest, domain).items) {
				choices.push({ ...item, domain, image, detail: `Physical ${domain} / ${item.detail}` });
			}
		}
		this.quickInput.pick('BT INSTANCES', 'Choose an instance and its actual installed attachment',
			(_origin, lifetime) => {
				lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
				return new TextQuickPickProvider(choices);
			}, choice => {
				this.showRuntimeInspection(input, inspector, choice.domain, choice.image, `LIVE BT / ${choice.label}`, {
					kind: 'behavior_tree', componentHashId: choice.component.hashId,
				});
			});
	}

	private showRuntimeInspection(input: BehaviorLensInput, inspector: WorkbenchPropertyInspector<BehaviorInspectionProperty>, domain: ResourceDomain, image: Blua32SourceImage, title: string, selection: BehaviorRuntimeSelection): void {
		const inspection = new BehaviorRuntimeInspection(this.sources, this.guest, this.rewind, domain, image, selection);
		const lifetime = inspector.show({ title, items: inspection.refresh()!,
			canOpenSource: item => canOpenBehaviorInspectionSource(this.sources.catalog, item),
			openSource: item => this.openInspectionSource(input, item),
		});
		input.runtimeInspection = inspection;
		lifetime.add(inspection);
		lifetime.add({ dispose: () => { input.runtimeInspection = undefined; } });
	}

	public inspectRegisteredDefinitions(input: BehaviorLensInput, inspector: WorkbenchPropertyInspector<BehaviorInspectionProperty>): void {
		const isStateMachine = input.view.presentation.kind === 'state-graph';
		const choices: Array<BehaviorDefinitionChoice & { domain: ResourceDomain; image: Blua32SourceImage }> = [];
		for (const domain of [SYSTEM_RESOURCE_DOMAIN, ...CARTRIDGE_RESOURCE_DOMAINS] as const) {
			const image = domain === SYSTEM_RESOURCE_DOMAIN ? this.sources.currentBlua32Media.system : this.sources.currentBlua32Media.cartridgeSlots[domain];
			if (image === null || image.sourceContextId !== input.view.resource.contextId) continue;
			for (const item of readBehaviorDefinitions(this.sources, this.guest, domain,
				isStateMachine ? 'cartlib/fsm/fsm_component' : 'cartlib/actioneffects/actioneffect_component').items) {
				choices.push({ ...item, domain, image, detail: `Physical ${domain}` });
			}
		}
		const inspect = (choice: BehaviorDefinitionChoice): void => {
			const lifetime = inspector.show({ title: `REGISTERED ${isStateMachine ? 'FSM' : 'EFFECT'} / ${choice.label}`,
				items: isStateMachine ? inspectStateMachineDefinition(this.sources, this.guest, choice.definition)
					: inspectActionEffectDefinition(this.sources, this.guest, choice.definition, choice.label),
				canOpenSource: item => canOpenBehaviorInspectionSource(this.sources.catalog, item),
				openSource: item => this.openInspectionSource(input, item),
			});
			lifetime.add({ dispose: this.guest.onDidInvalidate(() => inspector.hide()) });
		};
		this.quickInput.pick(isStateMachine ? 'REGISTERED FSMS' : 'REGISTERED ACTIONEFFECTS',
			'Published definitions and their actual installed attachments',
			(_origin, lifetime) => {
				lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
				return new TextQuickPickProvider(choices);
			}, choice => {
				if (!isStateMachine) { inspect(choice); return; }
				this.quickInput.pick(`LOADED STATES / ${choice.label}`, 'Definition hierarchy, not an actor instance',
					(_origin, lifetime) => {
						lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
						return new TextQuickPickProvider(readStateMachineDefinitionStates(this.guest, choice.definition));
					}, inspect);
			});
	}


	public openInspectionSource(input: BehaviorLensInput, detail: BehaviorInspectionProperty): void {
		const view = input.view;
		const source = detail.source!;
		if (source.stateSelection !== undefined) {
			view.selection = source.stateSelection.kind === 'node' ? source.stateSelection
				: selectStateMachineSource(source.stateSelection, view.source.models);
			if (view.presentation.kind === 'state-graph') {
				const viewport = view.presentation.viewport;
				viewport.selection = stateGraphSelection(viewport.model, view.selection);
			}
			finishBehaviorLensNavigation(view);
		}
		this.navigation.focusChunkSource(source.resource, {
			row: source.range.start.line - 1, startColumn: source.range.start.column - 1, endColumn: source.range.start.column - 1,
		});
	}

	public openWrittenSource(input: BehaviorLensInput, range: LuaSourceRange): void {
		const view = input.view;
		this.navigation.focusChunkSource(view.source.models.get(range.path)!.resource, {
			row: range.start.line - 1, startColumn: range.start.column - 1, endColumn: range.start.column - 1,
		});
	}

	/** Gesture activation takes current language facts; hover never asks the workspace. */
	public beginTreeDrag(input: BehaviorLensInput, transfer: BehaviorTreeTransferDrop): WorkbenchGraphDragSession | undefined {
		const member = behaviorTreeEditTarget(input.view);
		if (member === null) return undefined;
		const model = input.view.source.models.get(member.file.file)!;
		return beginBehaviorTreeDrag(model, input.view, transfer);
	}

	public canMoveSelectedChild(direction: -1 | 1): boolean {
		const input = this.editorGroup.model.activeTab;
		if (input?.kind !== 'behavior_lens' || !input.view.source.isCurrent) return false;
		const member = behaviorTreeMoveTarget(input.view, direction);
		return member !== undefined && !input.view.source.models.get(member.file.file)!.readOnly;
	}

	public canEditSelectedChild(): boolean {
		const input = this.editorGroup.model.activeTab;
		if (input?.kind !== 'behavior_lens' || !input.view.source.isCurrent) return false;
		const member = behaviorTreeEditTarget(input.view);
		return member !== null && !input.view.source.models.get(member.file.file)!.readOnly;
	}

	public canSetSelectedInitialState(): boolean {
		const input = this.editorGroup.model.activeTab;
		if (input?.kind !== 'behavior_lens' || !input.view.source.isCurrent) return false;
		const target = stateMachineInitialTarget(input.view);
		return target !== undefined && !input.view.source.models.get(target.owner.file.file)!.readOnly;
	}

	public setSelectedInitialState(): void {
		const input = this.editorGroup.model.activeTab;
		if (input?.kind !== 'behavior_lens') return;
		this.updateView(input);
		const target = stateMachineInitialTarget(input.view);
		if (target === undefined) return;
		const model = input.view.source.models.get(target.owner.file.file)!;
		if (model.readOnly) return;
		this.editorGroup.panes.activePane.focus();
		model.pushEditOperations(createStateMachineInitialEdits(model.buffer, target));
		this.updateView(input);
	}

	public duplicateSelectedChild(): void {
		const input = this.editorGroup.model.activeTab;
		if (input?.kind !== 'behavior_lens') return;
		this.updateView(input);
		const member = behaviorTreeEditTarget(input.view);
		if (member === null) return;
		const model = input.view.source.models.get(member.file.file)!;
		if (model.readOnly) return;
		this.editorGroup.panes.activePane.focus();
		model.pushEditOperations(createBehaviorTreeChildDuplicateEdits(model.buffer, member));
		this.updateView(input);
	}

	public removeSelectedChild(): void {
		const input = this.editorGroup.model.activeTab;
		if (input?.kind !== 'behavior_lens') return;
		this.updateView(input);
		const member = behaviorTreeEditTarget(input.view);
		if (member === null) return;
		const model = input.view.source.models.get(member.file.file)!;
		if (model.readOnly) return;
		this.editorGroup.panes.activePane.focus();
		model.pushEditOperations(createBehaviorTreeChildRemovalEdits(model.buffer, member));
		// Ordinary source correspondence clears the deleted occurrence, including
		// shared/identical uses. It must not select its former index or a namesake.
		this.updateView(input);
	}

	public moveSelectedChild(direction: -1 | 1): void {
		const input = this.editorGroup.model.activeTab;
		if (input?.kind !== 'behavior_lens') return;
		this.updateView(input);
		const member = behaviorTreeMoveTarget(input.view, direction);
		if (member === undefined) return;
		const model = input.view.source.models.get(member.file.file)!;
		if (model.readOnly) return;
		this.editorGroup.panes.activePane.focus();
		model.pushEditOperations(createBehaviorTreeChildMoveEdits(model.buffer, member, member.index + direction));
		this.updateView(input);
	}

	public executeNavigation(
		view: BehaviorLensViewState,
		command: BehaviorLensNavigationCommand,
	): boolean {
		prepareBehaviorLensLayout(view);
		const result = executeBehaviorLensNavigation(view, command);
		if (result === BehaviorLensNavigationResult.Activate) {
			this.openSelectedSource(view);
			return true;
		}
		if (result === BehaviorLensNavigationResult.Back) {
			this.openDefinitionSource(view);
			return true;
		}
		if (result === BehaviorLensNavigationResult.Changed) {
			if (view.presentation.kind === 'state-graph') {
				const input = this.editorGroup.model.activeTab;
				if (input?.kind === 'behavior_lens') acceptStateGraphSelection(view, view.presentation);
			}
			finishBehaviorLensNavigation(view);
			return true;
		}
		return result === BehaviorLensNavigationResult.Panned;
	}


	private openSelectedSource(view: BehaviorLensViewState): void {
		const range = selectedBehaviorLensSourceRange(view);
		if (range === null) {
			return;
		}
		this.navigation.focusChunkSource(
			view.source.models.get(range.path)!.resource,
			{
				row: range.start.line - 1,
				startColumn: range.start.column - 1,
				endColumn: range.start.column - 1,
			},
		);
	}

	private openDefinitionSource(view: BehaviorLensViewState): void {
		if (view.definitionRowKey === null) {
			this.navigation.focusChunkSource(view.resource);
			return;
		}
		const range = view.source.nodesByRowKey.get(view.definitionRowKey)!.occurrenceRange;
		this.navigation.focusChunkSource(view.source.models.get(range.path)!.resource, {
			row: range.start.line - 1,
			startColumn: range.start.column - 1,
			endColumn: range.start.column - 1,
		});
	}
}
