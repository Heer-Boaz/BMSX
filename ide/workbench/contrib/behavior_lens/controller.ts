import type { BehaviorLensNavigationSelection } from './navigation_selection';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { TrackedTextRange } from '../../../editor/text/text_change';
import { editorTextModelService } from '../../../editor/model/model_service';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import { resolveLuaTextFileModel } from '../../services/working_copy/text_file_model';
import type { Blua32SourceImage, RuntimeSourceState } from '../../../runtime/sources';
import { CARTRIDGE_RESOURCE_DOMAINS, SYSTEM_RESOURCE_DOMAIN, resourceIdentityEquals, resourceIdentityKey, type ResourceDomain, type ResourceIdentity } from '../../../common/resource';
import { luaSourceLocation } from '../../../language/lua/source_location';
import type { EditorSourceLocation } from '../../../editor/navigation/source_location';
import type { QuickInputController } from '../../services/quick_input/controller';
import type { EditorNavigationController } from '../resources/navigation';
import type { EditorGroupView, EditorTabOpenOptions } from '../../services/editor/editor_group';
import { BehaviorLensInput } from './editor_input';
import {
	selectBehaviorLensDefinition,
	installBehaviorLensDocument,
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
import type { RuntimeTransport } from '../../../runtime/transport';
import { captureBehaviorLensView, restoreBehaviorLensView } from './view_snapshot';

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
		public readonly documents: BehaviorSourceDocuments,
		private readonly createGraphLayoutEngine: GraphLayoutEngineFactory,
		private readonly guest: SuspendedGuestSession,
		private readonly rewind: HostRewind,
		private readonly transport: RuntimeTransport,
	) {}

	public readonly createView = (source: BehaviorLensInput): BehaviorLensInput => {
		this.updateView(source);
		const view = captureBehaviorLensView(source);
		const input = this.createInput(source.workingCopy, source.view.presentation.kind, source.getWorkingCopies());
		restoreBehaviorLensView(input, view);
		input.updateDefinition();
		return input;
	};

	public open(group: EditorGroupView, quickInput: QuickInputController, kind: BehaviorKind | null = null, options: EditorTabOpenOptions = {}): void {
		quickInput.pick(kind === null ? 'BEHAVIOR LENS' : PICKER_TITLES[kind], 'Choose a definition',
			(_origin, lifetime) => {
				lifetime.add({ dispose: editorTextModelService.onDidChangeContent(() => quickInput.hide()) });
				lifetime.add({ dispose: editorTextModelService.onWillClear(() => quickInput.hide()) });
				lifetime.add({ dispose: this.sources.catalog.onDidChange(() => quickInput.hide()) });
				return new TextQuickPickProvider(buildBehaviorQuickPickItems(this.sources.catalog, this.documents.registrations, kind));
			},
			(item, _modifiers, preserveFocus) => {
				const source = new WorkspaceSourceContext(editorTextModelService, this.sources.catalog);
				try {
					const isCurrent = () => source.reason === undefined && options.isCurrent?.() !== false && this.documents.registrations
						.getRegistrations(item.registration.resource.contextId).includes(item.registration);
					this.openDefinition(group, item.registration, { ...options, preserveFocus: options.preserveFocus || preserveFocus, isCurrent });
				} finally { source.dispose(); }
			}, lifetime => {
				lifetime.add({ dispose: group.onWillDispose(() => quickInput.hide()) });
			});
	}

	public findDefinition(group: EditorGroupView, resource: ResourceIdentity, kind: BehaviorKind, range: Readonly<TrackedTextRange>): BehaviorLensInput | undefined {
		for (const candidate of group.model.tabs) {
			if (candidate.kind !== 'behavior_lens' || !resourceIdentityEquals(candidate.workingCopy.resource, resource) || candidate.view.definitionRowKey === null) continue;
			const view = candidate.view;
			const span = view.source.ranges.get(view.definitionRowKey)!;
			if (span.start !== span.end && span.start === range.start && span.end === range.end
				&& view.source.nodesByRowKey.get(view.definitionRowKey)!.behaviorKind === kind) {
				return candidate;
			}
		}
		return undefined;
	}

	public openDefinition(group: EditorGroupView, registration: BehaviorRegistrationSource, options: EditorTabOpenOptions = {}): BehaviorLensInput | undefined {
		return group.openProducedEditor(() => {
			const resource = this.sources.catalog.resolveResource(registration.resource)!;
			const model = resolveLuaTextFileModel(editorTextModelService, this.sources.catalog, resource);
			if (options.isCurrent?.() === false) return undefined;
			const occurrence = luaSourceRangeToTextRange(model.buffer, registration.occurrenceRange);
			let input = this.findDefinition(group, resource, registration.behaviorKind, occurrence);
			if (input === undefined) {
				input = this.createInput(model,
					registration.behaviorKind === 'behavior_tree' ? 'graph'
						: registration.behaviorKind === 'action_effect' ? 'properties' : 'state-graph');
				if (options.isCurrent?.() === false) { input.dispose(); return undefined; }
				const view = input.view;
				selectBehaviorLensDefinition(view, registration.rowKey);
				view.sourceMatchRowKeys.add(registration.rowKey);
				input.updateDefinition();
			}
			// Reopening a surviving occurrence preserves its selection and viewport.
			return input;
		}, options);
	}

	/** Source-derived input creation is independent of group admission and pane layout. */
	public createInput(model: EditorTextModel, presentation: BehaviorLensViewState['presentation']['kind'],
		initialWorkingCopies?: readonly EditorTextModel[]): BehaviorLensInput {
		const project = getOrCreateSemanticProject(editorTextModelService, model.resource.contextId);
		return new BehaviorLensInput(model, createBehaviorLensViewState(this.documents.get(model), model, presentation, address => {
			const resource = this.sources.catalog.resolveResource(project.getResourceIdentity(address))!;
			return resolveLuaTextFileModel(editorTextModelService, this.sources.catalog, resource);
		}), new Set(this.sources.catalog.getSourceContexts(model.resource.contextId).map(context => context.id)), this.createGraphLayoutEngine, this.createView, initialWorkingCopies);
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
	}

	/** A shared literal is one versioned source edit, not one edit per recognized consumer. */
	public retargetStateMachineTransition(group: EditorGroupView, input: BehaviorLensInput,
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
		group.openEditor(new WorkspaceEditReviewInput(proposal, evidence));
	}

	/** Capture the exact transfer and its source caveats before leaving the graph. */
	public reviewTreeTransfer(group: EditorGroupView, input: BehaviorLensInput, analysis: BehaviorTreeTransferAnalysis,
		insertion: number, check: Extract<BehaviorTreeTransferCheck, { kind: 'available' }>,
	): void {
		const view = input.view, model = view.source.models.get(analysis.member.file.file)!;
		const context = new WorkspaceSourceContext(editorTextModelService, this.sources.catalog);
		for (const source of view.source.models.values()) context.read(source);
		const edit = createBehaviorTreeTransferEdit(model, view, analysis.member, check, insertion);
		const evidence = { summary: `${analysis.member.branch.role} -> ${check.target.role} position ${insertion + 1}\nRecognized source uses only; dynamic consumers are not enumerated.`,
			items: behaviorTreeTransferImpacts(view, analysis, insertion, check) };
		const proposal = new WorkspaceEditProposal('Move BT source', context, { kind: 'edit', edits: new Map([[model, edit]]) });
		group.openEditor(new WorkspaceEditReviewInput(proposal, evidence));
	}

	public getSourceLocation(input: BehaviorLensInput, subject: 'selected' | 'definition' = 'selected'): EditorSourceLocation | undefined {
		this.updateView(input);
		const view = input.view;
		const selected = subject === 'selected' ? selectedBehaviorLensSourceRange(view) : null;
		const range = selected ?? (view.definitionRowKey === null ? undefined : view.source.nodesByRowKey.get(view.definitionRowKey)!.occurrenceRange);
		const model = range === undefined ? input.workingCopy : view.source.models.get(range.path)!;
		const path = resourceIdentityKey(model.identity), file = view.document.files.find(file => file.file === path)!;
		const project = getOrCreateSemanticProject(editorTextModelService, input.workingCopy.resource.contextId);
		return luaSourceLocation(project, model, file, range);
	}

	public inspectRuntimeEffect(group: EditorGroupView, quickInput: QuickInputController, input: BehaviorLensInput, inspector: WorkbenchPropertyInspector<BehaviorInspectionProperty>): void {
		const choices: Array<ActionEffectInstanceChoice & { domain: ResourceDomain; image: Blua32SourceImage }> = [];
		for (const domain of [SYSTEM_RESOURCE_DOMAIN, ...CARTRIDGE_RESOURCE_DOMAINS] as const) {
			const image = domain === SYSTEM_RESOURCE_DOMAIN ? this.sources.currentBlua32Media.system : this.sources.currentBlua32Media.cartridgeSlots[domain];
			if (image === null || image.sourceContextId !== input.view.resource.contextId) continue;
			for (const item of readActionEffectInstances(this.sources, this.guest, domain).items) {
				choices.push({ ...item, domain, image, detail: `Physical ${domain} / ${item.detail}` });
			}
		}
		quickInput.pick('GRANTED ACTIONEFFECTS', 'Choose an instance and its actual installed attachment',
			(_origin, lifetime) => {
				lifetime.add({ dispose: this.guest.onDidInvalidate(() => quickInput.hide()) });
				return new TextQuickPickProvider(choices);
			}, choice => {
				this.showRuntimeInspection(group, input, inspector, choice.domain, choice.image, `LIVE EFFECT / ${choice.label}`, {
					kind: 'action_effect', componentHashId: choice.component.hashId, effectHashId: choice.effect.hashId,
				});
			}, lifetime => {
				lifetime.add({ dispose: group.onWillDispose(() => quickInput.hide()) });
			});
	}

	public inspectRuntimeStateMachine(group: EditorGroupView, quickInput: QuickInputController, input: BehaviorLensInput, inspector: WorkbenchPropertyInspector<BehaviorInspectionProperty>): void {
		const choices: Array<StateMachineInstanceChoice & { domain: ResourceDomain; image: Blua32SourceImage }> = [];
		for (const domain of [SYSTEM_RESOURCE_DOMAIN, ...CARTRIDGE_RESOURCE_DOMAINS] as const) {
			const image = domain === SYSTEM_RESOURCE_DOMAIN ? this.sources.currentBlua32Media.system : this.sources.currentBlua32Media.cartridgeSlots[domain];
			if (image === null || image.sourceContextId !== input.view.resource.contextId) continue;
			for (const item of readStateMachineInstances(this.sources, this.guest, domain).items) {
				choices.push({ ...item, domain, image, detail: `Physical ${domain} / ${item.detail}` });
			}
		}
		quickInput.pick('FSM INSTANCES', 'Choose an instance and its actual installed attachment',
			(_origin, lifetime) => {
				lifetime.add({ dispose: this.guest.onDidInvalidate(() => quickInput.hide()) });
				return new TextQuickPickProvider(choices);
			}, machine => quickInput.pick(`STATES / ${machine.label}`, machine.detail,
				(_origin, lifetime) => {
					lifetime.add({ dispose: this.guest.onDidInvalidate(() => quickInput.hide()) });
					return new TextQuickPickProvider(readStateMachineStates(this.guest, machine.machine));
				}, state => {
					this.showRuntimeInspection(group, input, inspector, machine.domain, machine.image, `LIVE FSM / ${state.label}`, {
						kind: 'state_machine', componentHashId: machine.component.hashId,
						machineHashId: machine.machine.hashId, stateHashId: state.state.hashId,
					});
				}, lifetime => {
					lifetime.add({ dispose: group.onWillDispose(() => quickInput.hide()) });
				}), lifetime => {
				lifetime.add({ dispose: group.onWillDispose(() => quickInput.hide()) });
			});
	}

	public inspectRuntimeTree(group: EditorGroupView, quickInput: QuickInputController, input: BehaviorLensInput, inspector: WorkbenchPropertyInspector<BehaviorInspectionProperty>): void {
		const choices: Array<BehaviorTreeInstanceChoice & { domain: ResourceDomain; image: Blua32SourceImage }> = [];
		for (const domain of [SYSTEM_RESOURCE_DOMAIN, ...CARTRIDGE_RESOURCE_DOMAINS] as const) {
			const image = domain === SYSTEM_RESOURCE_DOMAIN ? this.sources.currentBlua32Media.system : this.sources.currentBlua32Media.cartridgeSlots[domain];
			if (image === null || image.sourceContextId !== input.view.resource.contextId) continue;
			for (const item of readBehaviorTreeInstances(this.sources, this.guest, domain).items) {
				choices.push({ ...item, domain, image, detail: `Physical ${domain} / ${item.detail}` });
			}
		}
		quickInput.pick('BT INSTANCES', 'Choose an instance and its actual installed attachment',
			(_origin, lifetime) => {
				lifetime.add({ dispose: this.guest.onDidInvalidate(() => quickInput.hide()) });
				return new TextQuickPickProvider(choices);
			}, choice => {
				this.showRuntimeInspection(group, input, inspector, choice.domain, choice.image, `LIVE BT / ${choice.label}`, {
					kind: 'behavior_tree', componentHashId: choice.component.hashId,
				});
			}, lifetime => {
				lifetime.add({ dispose: group.onWillDispose(() => quickInput.hide()) });
			});
	}

	private showRuntimeInspection(group: EditorGroupView, input: BehaviorLensInput, inspector: WorkbenchPropertyInspector<BehaviorInspectionProperty>, domain: ResourceDomain, image: Blua32SourceImage, title: string, selection: BehaviorRuntimeSelection): void {
		const inspection = new BehaviorRuntimeInspection(this.sources, this.guest, this.rewind, domain, image, selection, this.transport);
		const lifetime = inspector.show({ title, items: inspection.refresh()!, interaction: inspection.interaction,
			canOpenSource: item => canOpenBehaviorInspectionSource(this.sources.catalog, item),
			openSource: item => this.openInspectionSource(group, input, item),
		});
		input.runtimeInspection = inspection;
		lifetime.add(inspection);
		lifetime.add({ dispose: () => { input.runtimeInspection = undefined; } });
	}

	public inspectRegisteredDefinitions(group: EditorGroupView, quickInput: QuickInputController, input: BehaviorLensInput, inspector: WorkbenchPropertyInspector<BehaviorInspectionProperty>): void {
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
				openSource: item => this.openInspectionSource(group, input, item),
			});
			lifetime.add({ dispose: this.guest.onDidInvalidate(() => inspector.hide()) });
		};
		quickInput.pick(isStateMachine ? 'REGISTERED FSMS' : 'REGISTERED ACTIONEFFECTS',
			'Published definitions and their actual installed attachments',
			(_origin, lifetime) => {
				lifetime.add({ dispose: this.guest.onDidInvalidate(() => quickInput.hide()) });
				return new TextQuickPickProvider(choices);
			}, choice => {
				if (!isStateMachine) { inspect(choice); return; }
				quickInput.pick(`LOADED STATES / ${choice.label}`, 'Definition hierarchy, not an actor instance',
					(_origin, lifetime) => {
						lifetime.add({ dispose: this.guest.onDidInvalidate(() => quickInput.hide()) });
						return new TextQuickPickProvider(readStateMachineDefinitionStates(this.guest, choice.definition));
					}, inspect, lifetime => {
						lifetime.add({ dispose: group.onWillDispose(() => quickInput.hide()) });
					});
			}, lifetime => {
				lifetime.add({ dispose: group.onWillDispose(() => quickInput.hide()) });
			});
	}


	public openInspectionSource(group: EditorGroupView, input: BehaviorLensInput, detail: BehaviorInspectionProperty): void {
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
		this.navigation.focusChunkSource(group, source.resource, {
			row: source.range.start.line - 1, startColumn: source.range.start.column - 1, endColumn: source.range.start.column - 1,
		});
	}

	public openWrittenSource(group: EditorGroupView, input: BehaviorLensInput, range: LuaSourceRange): void {
		const view = input.view;
		this.navigation.focusChunkSource(group, view.source.models.get(range.path)!.resource, {
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

	public canMoveSelectedChild(input: BehaviorLensInput, direction: -1 | 1): boolean {
		if (!input.view.source.isCurrent) return false;
		const member = behaviorTreeMoveTarget(input.view, direction);
		return member !== undefined && !input.view.source.models.get(member.file.file)!.readOnly;
	}

	public canEditSelectedChild(input: BehaviorLensInput): boolean {
		if (!input.view.source.isCurrent) return false;
		const member = behaviorTreeEditTarget(input.view);
		return member !== null && !input.view.source.models.get(member.file.file)!.readOnly;
	}

	public canSetSelectedInitialState(input: BehaviorLensInput): boolean {
		if (!input.view.source.isCurrent) return false;
		const target = stateMachineInitialTarget(input.view);
		return target !== undefined && !input.view.source.models.get(target.owner.file.file)!.readOnly;
	}

	public setSelectedInitialState(input: BehaviorLensInput): void {
		this.updateView(input);
		const target = stateMachineInitialTarget(input.view);
		if (target === undefined) return;
		const model = input.view.source.models.get(target.owner.file.file)!;
		if (model.readOnly) return;
		model.pushEditOperations(createStateMachineInitialEdits(model.buffer, target));
		this.updateView(input);
	}

	public duplicateSelectedChild(input: BehaviorLensInput): void {
		this.updateView(input);
		const member = behaviorTreeEditTarget(input.view);
		if (member === null) return;
		const model = input.view.source.models.get(member.file.file)!;
		if (model.readOnly) return;
		model.pushEditOperations(createBehaviorTreeChildDuplicateEdits(model.buffer, member));
		this.updateView(input);
	}

	public removeSelectedChild(input: BehaviorLensInput): void {
		this.updateView(input);
		const member = behaviorTreeEditTarget(input.view);
		if (member === null) return;
		const model = input.view.source.models.get(member.file.file)!;
		if (model.readOnly) return;
		model.pushEditOperations(createBehaviorTreeChildRemovalEdits(model.buffer, member));
		// Ordinary source correspondence clears the deleted occurrence, including
		// shared/identical uses. It must not select its former index or a namesake.
		this.updateView(input);
	}

	public moveSelectedChild(input: BehaviorLensInput, direction: -1 | 1): void {
		this.updateView(input);
		const member = behaviorTreeMoveTarget(input.view, direction);
		if (member === undefined) return;
		const model = input.view.source.models.get(member.file.file)!;
		if (model.readOnly) return;
		model.pushEditOperations(createBehaviorTreeChildMoveEdits(model.buffer, member, member.index + direction));
		this.updateView(input);
	}

	public executeNavigation(
		group: EditorGroupView,
		input: BehaviorLensInput,
		command: BehaviorLensNavigationCommand,
	): boolean {
		const view = input.view;
		const result = executeBehaviorLensNavigation(view, command);
		if (result === BehaviorLensNavigationResult.Activate) {
			void this.navigation.openSource(group, () => this.getSourceLocation(input));
			return true;
		}
		if (result === BehaviorLensNavigationResult.Back) {
			void this.navigation.openSource(group, () => this.getSourceLocation(input, 'definition'));
			return true;
		}
		if (result === BehaviorLensNavigationResult.Changed) {
			if (view.presentation.kind === 'state-graph') {
				acceptStateGraphSelection(view, view.presentation);
			}
			finishBehaviorLensNavigation(view);
			return true;
		}
		return result === BehaviorLensNavigationResult.Panned;
	}

}
