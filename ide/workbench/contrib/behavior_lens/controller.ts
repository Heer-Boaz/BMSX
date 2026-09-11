import type { BehaviorLensNavigationSelection } from './navigation_selection';
import { captureNavigation } from '../../../navigation/navigation_history';
import type { EditorTextModel, EditorTextModelContentChangeEvent } from '../../../editor/model/text_model';
import { mapBehaviorLensSourceRanges } from './source_correspondence';
import { editorTextModelService } from '../../../editor/model/model_service';
import { resourceSourceForChunk } from '../../../runtime/lua_pipeline';
import { resolveRuntimeResource, type RuntimeSourceState } from '../../../runtime/sources';
import type { QuickInputController } from '../../services/quick_input/controller';
import { editorTabGroup, type EditorOpenOptions } from '../../ui/tab/group_model';
import { getActiveTab, openEditorTab } from '../../ui/tabs';
import type { EditorNavigationController } from '../resources/navigation';
import type { EditorPanes } from '../../services/editor/editor_panes';
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
import { BehaviorSourceDocuments } from './source_documents';
import { luaSourceRangeToTextRange } from '../../../language/lua/source_edits';
import type { BehaviorKind, BehaviorRegistrationSource } from './model';
import type { BehaviorRegistrationIndex } from './registration_index';
import { buildBehaviorQuickPickItems } from './quick_access';
import { createBehaviorLensViewState, type BehaviorLensViewState } from './view_model';
import { selectStateMachineSource } from './state_machine_selection';
import { editorViewState } from '../../../editor/ui/view/state';
import type { GraphLayoutEngineFactory } from '../../services/graph_layout/engine';
import { acceptStateGraphSelection, stateGraphSelection } from './state_graph_navigation';
import type { BehaviorInspectionProperty } from './inspection';
import { behaviorTreeEditTarget, behaviorTreeMoveTarget, duplicateBehaviorTreeChild, moveBehaviorTreeChild, removeBehaviorTreeChild } from './behavior_tree_edit';
import type { StateMachinePathUse } from './state_machine_retarget';
import { setStateMachineInitial, stateMachineInitialTarget } from './state_machine_initial';

const PICKER_TITLES: Readonly<Record<BehaviorKind, string>> = {
	action_effect: 'ACTIONEFFECTS',
	state_machine: 'STATE MACHINES',
	behavior_tree: 'BEHAVIOR TREES',
};

/** Workbench contribution for source-derived behavior topology. Inputs own every view. */
export class BehaviorLensController {
	private readonly documents: BehaviorSourceDocuments;
	public constructor(
		private readonly sources: RuntimeSourceState,
		private readonly navigation: EditorNavigationController,
		private readonly editorPanes: EditorPanes,
		private readonly quickInput: QuickInputController,
		private readonly registrations: BehaviorRegistrationIndex,
		private readonly createGraphLayoutEngine: GraphLayoutEngineFactory,
	) { this.documents = new BehaviorSourceDocuments(sources); }

	public open(kind: BehaviorKind | null = null, options: EditorOpenOptions = {}): void {
		this.quickInput.pick(kind === null ? 'BEHAVIOR LENS' : PICKER_TITLES[kind], 'Choose a definition',
			() => buildBehaviorQuickPickItems(this.sources, this.registrations, kind),
			item => this.openDefinition(item.registration, options));
	}

	public openDefinition(registration: BehaviorRegistrationSource, options: EditorOpenOptions = {}): BehaviorLensInput {
		return captureNavigation(() => {
			const resource = resolveRuntimeResource(this.sources, registration.resource)!;
			const model = editorTextModelService.retain(resource, 'lua', resourceSourceForChunk(this.sources, resource));
			const occurrence = luaSourceRangeToTextRange(model.buffer, registration.occurrenceRange);
			let input: BehaviorLensInput | undefined;
			for (const candidate of editorTabGroup.tabs) {
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
				const view = createBehaviorLensViewState(this.documents.get(model), model,
					registration.behaviorKind === 'behavior_tree' ? 'graph'
						: registration.behaviorKind === 'action_effect' ? 'properties' : 'state-graph');
				selectBehaviorLensDefinition(view, registration.rowKey);
				view.sourceMatchRowKeys.add(registration.rowKey);
				input = new BehaviorLensInput(model, view, this.createGraphLayoutEngine);
				input.updateLabel();
			}
			// Reopening a surviving occurrence preserves its selection and viewport.
			openEditorTab(this.editorPanes, input, options);
			return input;
		});
	}

	/** Refreshes a visible source lens when its canonical code buffer advances. */
	public updateView(input: BehaviorLensInput, navigationSelection?: BehaviorLensNavigationSelection): void {
		const { view, workingCopy } = input;
		const sourceChanged = workingCopy.version !== view.sourceVersion;
		if (sourceChanged) {
			installBehaviorLensDocument(view, this.documents.get(workingCopy), workingCopy.buffer);
			view.sourceVersion = workingCopy.version;
		}
		navigationSelection?.restore(input);
		if (sourceChanged || navigationSelection !== undefined) input.updateLabel();
		prepareBehaviorLensLayout(view);
		input.updatePresentation(editorViewState.font.renderFont());
		if (sourceChanged && navigationSelection === undefined) finishBehaviorLensNavigation(view);
	}

	/** Review navigation keeps the actual consumer/return, not just the shared literal. */
	public openStateMachineUseSource(input: BehaviorLensInput, use: StateMachinePathUse): void {
		const target = input.view.definitionRowKey === use.definition.rowKey ? input
			: this.openDefinition(this.registrations.getRegistrations(input.view.resource.domain)
				.find(candidate => candidate.rowKey === use.definition.rowKey)!);
		const view = target.view;
		view.selection = selectStateMachineSource({ kind: 'state-outcome', rowKey: use.transition.slot.source.rowKey,
			transition: use.transition, outcome: use.outcome }, input.workingCopy.buffer);
		finishBehaviorLensNavigation(view);
		this.openSelectedSource(view);
	}

	public openSource(): void {
		const input = getActiveTab();
		if (input.kind !== 'behavior_lens') return;
		this.updateView(input);
		if (selectedBehaviorLensSourceRange(input.view) === null) this.openDefinitionSource(input.view);
		else this.openSelectedSource(input.view);
	}

	public openInspectionSource(input: BehaviorLensInput, detail: BehaviorInspectionProperty): void {
		const view = input.view;
		if (detail.stateSelection !== undefined) {
			view.selection = detail.stateSelection.kind === 'node' ? detail.stateSelection
				: selectStateMachineSource(detail.stateSelection, input.workingCopy.buffer);
			if (view.presentation.kind === 'state-graph') {
				const viewport = view.presentation.viewport;
				viewport.selection = stateGraphSelection(viewport.model, view.selection);
			}
			finishBehaviorLensNavigation(view);
		}
		const range = detail.range!;
		this.navigation.focusChunkSourceForContext(view.resource.domain, range.path, {
			row: range.start.line - 1, startColumn: range.start.column - 1, endColumn: range.start.column - 1,
		});
	}

	public canMoveSelectedChild(direction: -1 | 1): boolean {
		const input = getActiveTab();
		return input.kind === 'behavior_lens' && !input.workingCopy.readOnly
			&& input.workingCopy.version === input.view.sourceVersion && behaviorTreeMoveTarget(input.view, direction) !== undefined;
	}

	public canEditSelectedChild(): boolean {
		const input = getActiveTab();
		return input.kind === 'behavior_lens' && !input.workingCopy.readOnly
			&& input.workingCopy.version === input.view.sourceVersion && behaviorTreeEditTarget(input.view) !== null;
	}

	public canSetSelectedInitialState(): boolean {
		const input = getActiveTab();
		return input.kind === 'behavior_lens' && !input.workingCopy.readOnly
			&& input.workingCopy.version === input.view.sourceVersion && stateMachineInitialTarget(input.view) !== undefined;
	}

	public setSelectedInitialState(): void {
		const input = getActiveTab();
		if (input.kind !== 'behavior_lens' || input.workingCopy.readOnly) return;
		this.updateView(input);
		const target = stateMachineInitialTarget(input.view);
		if (target === undefined) return;
		this.editorPanes.activePane.focus();
		setStateMachineInitial(input.workingCopy, target);
		this.updateView(input);
	}

	public duplicateSelectedChild(): void {
		const input = getActiveTab();
		if (input.kind !== 'behavior_lens' || input.workingCopy.readOnly) return;
		this.updateView(input);
		const member = behaviorTreeEditTarget(input.view);
		if (member === null) return;
		this.editorPanes.activePane.focus();
		duplicateBehaviorTreeChild(input.workingCopy, member);
		this.updateView(input);
	}

	public removeSelectedChild(): void {
		const input = getActiveTab();
		if (input.kind !== 'behavior_lens' || input.workingCopy.readOnly) return;
		this.updateView(input);
		const member = behaviorTreeEditTarget(input.view);
		if (member === null) return;
		this.editorPanes.activePane.focus();
		removeBehaviorTreeChild(input.workingCopy, member);
		// Ordinary source correspondence clears the deleted occurrence, including
		// shared/identical uses. It must not select its former index or a namesake.
		this.updateView(input);
	}

	public moveSelectedChild(direction: -1 | 1): void {
		const input = getActiveTab();
		if (input.kind !== 'behavior_lens' || input.workingCopy.readOnly) return;
		this.updateView(input);
		const member = behaviorTreeMoveTarget(input.view, direction);
		if (member === undefined) return;
		this.editorPanes.activePane.focus();
		moveBehaviorTreeChild(input.workingCopy, member, member.index + direction);
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
				const input = getActiveTab();
				if (input.kind === 'behavior_lens') acceptStateGraphSelection(view, view.presentation, input.workingCopy.buffer);
			}
			finishBehaviorLensNavigation(view);
			return true;
		}
		return result === BehaviorLensNavigationResult.Panned;
	}

	public onDidChangeContent(model: EditorTextModel, event: EditorTextModelContentChangeEvent): void {
		for (const input of editorTabGroup.tabs) {
			if (input.kind === 'behavior_lens' && input.workingCopy === model) {
				mapBehaviorLensSourceRanges(input.view, event);
				input.invalidatePresentation();
			}
		}
	}

	private openSelectedSource(view: BehaviorLensViewState): void {
		const range = selectedBehaviorLensSourceRange(view);
		if (range === null) {
			return;
		}
		this.navigation.focusChunkSourceForContext(
			view.resource.domain,
			range.path,
			{
				row: range.start.line - 1,
				startColumn: range.start.column - 1,
				endColumn: range.start.column - 1,
			},
		);
	}

	private openDefinitionSource(view: BehaviorLensViewState): void {
		if (view.definitionRowKey === null) {
			this.navigation.focusChunkSourceForContext(view.resource.domain, view.resource.path);
			return;
		}
		const range = view.source.nodesByRowKey.get(view.definitionRowKey)!.occurrenceRange;
		this.navigation.focusChunkSourceForContext(view.resource.domain, range.path, {
			row: range.start.line - 1,
			startColumn: range.start.column - 1,
			endColumn: range.start.column - 1,
		});
	}
}
