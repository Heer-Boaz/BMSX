import type { EditorTextModel, EditorTextModelContentChangeEvent } from '../../../editor/model/text_model';
import { mapBehaviorLensSourceRanges } from './source_correspondence';
import { resourceIdentityKey } from '../../../common/resource';
import { editorTextModelService } from '../../../editor/model/model_service';
import { resourceSourceForChunk } from '../../../runtime/lua_pipeline';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import { getTextSnapshot } from '../../../editor/text/source_text';
import { resolveRuntimeResource, type RuntimeSourceState } from '../../../runtime/sources';
import type { QuickInputController } from '../../services/quick_input/controller';
import type { BehaviorLensTabId } from '../../ui/tab/id';
import { editorTabGroup } from '../../ui/tab/group_model';
import { getActiveTab, setActiveTab } from '../../ui/tabs';
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
import { buildBehaviorSourceDocument } from './recognizer';
import type { BehaviorKind, BehaviorRegistrationSource, BehaviorSourceDocument } from './model';
import type { BehaviorRegistrationIndex } from './registration_index';
import { toggleBehaviorGraphBranch } from './graph_navigation';
import { buildBehaviorQuickPickItems } from './quick_access';
import { createBehaviorLensViewState, type BehaviorLensViewState } from './view_model';
import { selectStateMachineSource } from './state_machine_selection';
import { editorViewState } from '../../../editor/ui/view/state';
import type { GraphLayoutEngineFactory } from '../../services/graph_layout/engine';
import { acceptStateGraphSelection, stateGraphSelection } from './state_graph_navigation';
import { buildStateMachineDetails } from './state_machine_details';
import { behaviorTreeEditTarget, behaviorTreeMoveTarget, duplicateBehaviorTreeChild, moveBehaviorTreeChild, removeBehaviorTreeChild } from './behavior_tree_edit';

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
		private readonly editorPanes: EditorPanes,
		private readonly quickInput: QuickInputController,
		private readonly registrations: BehaviorRegistrationIndex,
		private readonly createGraphLayoutEngine: GraphLayoutEngineFactory,
	) {}

	public open(kind: BehaviorKind | null = null): void {
		this.quickInput.pick(kind === null ? 'BEHAVIOR LENS' : PICKER_TITLES[kind], 'Choose a definition',
			() => buildBehaviorQuickPickItems(this.sources, this.registrations, kind),
			item => this.openDefinition(item.registration));
	}

	public openDefinition(registration: BehaviorRegistrationSource): void {
		const resource = resolveRuntimeResource(this.sources, registration.resource)!;
		const model = editorTextModelService.retain(resource, 'lua', resourceSourceForChunk(this.sources, resource));
		const source = getTextSnapshot(model.buffer);
		const tabId: BehaviorLensTabId = `behavior:${resourceIdentityKey(resource)}`;
		let tab = editorTabGroup.findById(tabId);
		if (tab === undefined) {
			const document = this.buildDocument(resource, source);
			tab = new BehaviorLensInput(
				model,
				createBehaviorLensViewState(document, model, registration.behaviorKind === 'behavior_tree' ? 'graph'
					: registration.behaviorKind === 'action_effect' ? 'properties' : 'state-graph'),
				this.createGraphLayoutEngine,
			);
			editorTabGroup.add(tab);
		} else {
			this.updateView(tab);
		}
		const view = tab.view;
		if (view.definitionRowKey !== registration.rowKey) tab.invalidatePresentation();
		selectBehaviorLensDefinition(view, registration.rowKey);
		view.sourceMatchRowKeys.clear();
		view.sourceMatchRowKeys.add(registration.rowKey);
		prepareBehaviorLensLayout(view);
		tab.updatePresentation(editorViewState.font.renderFont());
		finishBehaviorLensNavigation(view);
		setActiveTab(this.editorPanes, tab.id);
	}

	/** Refreshes a visible source lens when its canonical code buffer advances. */
	public updateView(input: BehaviorLensInput): void {
		const { view, workingCopy } = input;
		const sourceChanged = workingCopy.version !== view.sourceVersion;
		if (sourceChanged) {
			installBehaviorLensDocument(view, this.buildDocument(view.resource, getTextSnapshot(workingCopy.buffer)), workingCopy.buffer);
			view.sourceVersion = workingCopy.version;
		}
		prepareBehaviorLensLayout(view);
		input.updatePresentation(editorViewState.font.renderFont());
		if (sourceChanged) finishBehaviorLensNavigation(view);
	}

	public openSource(): void {
		const input = getActiveTab();
		if (input.kind !== 'behavior_lens') return;
		this.updateView(input);
		if (selectedBehaviorLensSourceRange(input.view) === null) this.openDefinitionSource(input.view);
		else this.openSelectedSource(input.view);
	}

	public openDetails(): void {
		const input = getActiveTab();
		if (input.kind !== 'behavior_lens') return;
		this.updateView(input);
		const view = input.view;
		if (view.selection === null) return;
		if (view.nodesByRowKey.get(view.selection.rowKey)!.behaviorKind === 'state_machine') {
			this.quickInput.pick('FSM SOURCE EVIDENCE', 'Choose a field, return or entry source', (_origin, disposables) => {
				disposables.add({ dispose: input.workingCopy.onDidChangeContent(() => this.quickInput.hide()) });
				return buildStateMachineDetails(view);
			}, detail => {
				view.selection = detail.source.kind === 'node' ? detail.source : selectStateMachineSource(detail.source, input.workingCopy.buffer);
				if (view.presentation.kind === 'state-graph') {
					const viewport = view.presentation.viewport;
					viewport.selection = stateGraphSelection(viewport.model, view.selection);
				}
				finishBehaviorLensNavigation(view);
				this.openSelectedSource(view);
			});
			return;
		}
		if (view.presentation.kind !== 'graph') return;
		const item = view.presentation.viewport.selection;
		if (item === null) return;
		const node = item.kind === 'node' ? item : item.child;
		this.quickInput.pick('BT SOURCE DETAILS', 'Choose a field to open its source', (_origin, disposables) => {
			disposables.add({ dispose: input.workingCopy.onDidChangeContent(() => this.quickInput.hide()) });
			return node.details;
		},
			detail => this.navigation.focusChunkSourceForContext(view.resource.domain, detail.range.path, {
				row: detail.range.start.line - 1, startColumn: detail.range.start.column - 1, endColumn: detail.range.start.column - 1,
			}));
	}

	public toggleBranch(): void {
		const input = getActiveTab();
		if (input.kind !== 'behavior_lens') return;
		this.updateView(input);
		if (input.view.presentation.kind === 'graph') toggleBehaviorGraphBranch(input.view, input.view.presentation);
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
				mapBehaviorLensSourceRanges(input.view, event.changes);
				input.invalidatePresentation();
			}
		}
	}

	private buildDocument(
		resource: BehaviorSourceDocument['resource'],
		source: string,
	): BehaviorSourceDocument {
		const project = getOrCreateSemanticProject(resource.domain);
		project.synchronizeRuntimeSources(this.sources);
		return buildBehaviorSourceDocument(
			resource,
			project.updateDocument(resource.path, source),
		);
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
		const range = view.nodesByRowKey.get(view.definitionRowKey)!.occurrenceRange;
		this.navigation.focusChunkSourceForContext(view.resource.domain, range.path, {
			row: range.start.line - 1,
			startColumn: range.start.column - 1,
			endColumn: range.start.column - 1,
		});
	}
}
