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
				createBehaviorLensViewState(document, model, registration.behaviorKind === 'behavior_tree' ? 'graph' : 'outline'),
			);
			editorTabGroup.add(tab);
		} else {
			this.updateView(tab);
		}
		const view = tab.view;
		selectBehaviorLensDefinition(view, registration.rowKey);
		view.sourceMatchRowKeys.clear();
		view.sourceMatchRowKeys.add(registration.rowKey);
		prepareBehaviorLensLayout(view);
		finishBehaviorLensNavigation(view);
		setActiveTab(this.editorPanes, tab.id);
	}

	/** Refreshes a visible source lens when its canonical code buffer advances. */
	public updateView(input: BehaviorLensInput): void {
		const { view, workingCopy } = input;
		if (workingCopy.version !== view.sourceVersion) {
			installBehaviorLensDocument(view, this.buildDocument(view.resource, getTextSnapshot(workingCopy.buffer)), workingCopy.buffer);
			view.sourceVersion = workingCopy.version;
			prepareBehaviorLensLayout(view);
			finishBehaviorLensNavigation(view);
		}
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
		if (view.presentation.kind !== 'graph') return;
		const item = view.presentation.viewport.selection;
		if (item === null) return;
		const node = item.kind === 'node' ? item : item.child;
		this.quickInput.pick('BT SOURCE DETAILS', 'Choose a field to open its source', () => node.details,
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
			finishBehaviorLensNavigation(view);
			return true;
		}
		return result === BehaviorLensNavigationResult.Panned;
	}

	public onDidChangeContent(model: EditorTextModel, event: EditorTextModelContentChangeEvent): void {
		for (const input of editorTabGroup.tabs) {
			if (input.kind === 'behavior_lens' && input.workingCopy === model) {
				mapBehaviorLensSourceRanges(input.view, event.changes);
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
