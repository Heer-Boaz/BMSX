import type { PointerSnapshot } from '../../../common/models';
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
	createBehaviorLensLayout,
	findVisibleRowIndex,
	installBehaviorLensDocument,
	prepareBehaviorLensLayout,
} from './layout';
import { scrollWorkbenchList } from '../../ui/list_view';
import {
	BehaviorLensNavigationResult,
	executeBehaviorLensNavigation,
	finishBehaviorLensNavigation,
	selectedBehaviorLensSourceRange,
	selectBehaviorLensRow,
	setBehaviorLensSourcePosition,
	type BehaviorLensNavigationCommand,
} from './navigation';
import { BehaviorLensPointerResult, handleBehaviorLensPointerInput } from './pointer';
import { buildBehaviorSourceDocument } from './recognizer';
import type { BehaviorRegistrationSource, BehaviorSourceDocument } from './model';
import type { BehaviorRegistrationIndex } from './registration_index';
import { buildBehaviorQuickPickItems } from './quick_access';
import type { BehaviorLensViewState } from './view_model';
import { createWorkbenchActionBar } from '../../ui/action_bar';

const WHEEL_SCROLL_ROWS = 3;

/** Workbench contribution for source-derived behavior topology. Inputs own every view. */
export class BehaviorLensController {
	public constructor(
		private readonly sources: RuntimeSourceState,
		private readonly navigation: EditorNavigationController,
		private readonly editorPanes: EditorPanes,
		private readonly quickInput: QuickInputController,
		private readonly registrations: BehaviorRegistrationIndex,
	) {}

	public open(): void {
		this.quickInput.pick('BEHAVIOR LENS', 'Choose an FSM, BT or ActionEffect',
			() => buildBehaviorQuickPickItems(this.sources, this.registrations),
			item => this.openDefinition(item.registration));
	}

	public openDefinition(registration: BehaviorRegistrationSource): void {
		const resource = resolveRuntimeResource(this.sources, registration.resource)!;
		const model = editorTextModelService.retain(resource, 'lua', resourceSourceForChunk(this.sources, resource));
		const source = getTextSnapshot(model.buffer);
		const sourceVersion = model.version;
		const sourceLine = registration.range.start.line;
		const sourceColumn = registration.range.start.column;
		const tabId: BehaviorLensTabId = `behavior:${resourceIdentityKey(resource)}`;
		let tab = editorTabGroup.findById(tabId);
		if (tab === undefined) {
			const document = this.buildDocument(resource, source);
			tab = new BehaviorLensInput(
				model,
				createBehaviorLensViewState(
					document,
					sourceVersion,
					sourceLine,
					sourceColumn,
				),
			);
			editorTabGroup.add(tab);
		} else {
			this.updateView(tab);
		}
		const view = tab.view;
		view.sourceLine = sourceLine;
		view.sourceColumn = sourceColumn;
		view.sourceMatchRowKeys.clear();
		view.sourceMatchRowKeys.add(registration.rowKey);
		prepareBehaviorLensLayout(view);
		selectBehaviorLensRow(view, findVisibleRowIndex(view, registration.rowKey));
		finishBehaviorLensNavigation(view);
		setActiveTab(this.editorPanes, tab.id);
	}

	/** Refreshes a visible source lens when its canonical code buffer advances. */
	public updateView(input: BehaviorLensInput): void {
		const { view, workingCopy } = input;
		if (workingCopy.version !== view.sourceVersion) {
			this.refreshView(view, getTextSnapshot(workingCopy.buffer), workingCopy.version, view.sourceLine, view.sourceColumn);
		}
	}

	public openSource(): void {
		const input = getActiveTab();
		if (input.kind !== 'behavior_lens') return;
		this.updateView(input);
		if (selectedBehaviorLensSourceRange(input.view) === null) this.openSourcePosition(input.view);
		else this.openSelectedSource(input.view);
	}

	public handlePointer(
		view: BehaviorLensViewState,
		snapshot: PointerSnapshot,
		justPressed: boolean,
		currentTimeMs: number,
	): boolean {
		prepareBehaviorLensLayout(view);
		const result = handleBehaviorLensPointerInput(view, snapshot, justPressed, currentTimeMs);
		if (result === BehaviorLensPointerResult.Activate) {
			this.openSelectedSource(view);
		}
		return result !== BehaviorLensPointerResult.Outside;
	}

	public handleWheel(view: BehaviorLensViewState, direction: number, steps: number): boolean {
		prepareBehaviorLensLayout(view);
		const previousScroll = view.scroll;
		scrollWorkbenchList(view, direction * steps * WHEEL_SCROLL_ROWS);
		return view.scroll !== previousScroll;
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
			this.openSourcePosition(view);
			return true;
		}
		if (result === BehaviorLensNavigationResult.Changed) {
			finishBehaviorLensNavigation(view);
			return true;
		}
		return false;
	}

	private refreshView(
		view: BehaviorLensViewState,
		source: string,
		sourceVersion: number,
		sourceLine: number,
		sourceColumn: number,
	): void {
		if (sourceVersion !== view.sourceVersion) {
			installBehaviorLensDocument(view, this.buildDocument(view.resource, source));
			view.sourceVersion = sourceVersion;
		}
		view.sourceLine = sourceLine;
		view.sourceColumn = sourceColumn;
		setBehaviorLensSourcePosition(view, view.resource.path, sourceLine, sourceColumn);
		prepareBehaviorLensLayout(view);
		finishBehaviorLensNavigation(view);
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

	private openSourcePosition(view: BehaviorLensViewState): void {
		this.navigation.focusChunkSourceForContext(
			view.resource.domain,
			view.resource.path,
			{
				row: view.sourceLine - 1,
				startColumn: view.sourceColumn - 1,
				endColumn: view.sourceColumn - 1,
			},
		);
	}
}

function createBehaviorLensViewState(
	document: BehaviorSourceDocument,
	sourceVersion: number,
	sourceLine: number,
	sourceColumn: number,
): BehaviorLensViewState {
	const view: BehaviorLensViewState = {
		actionBar: createWorkbenchActionBar('behaviorLens.title'),
		resource: document.resource,
		document,
		sourceVersion,
		sourceLine,
		sourceColumn,
		rows: [],
		sourceNodes: [],
		nodesByRowKey: new Map(),
		parentRowKeyByRowKey: new Map(),
		collapsedRowKeys: new Set(),
		sourceMatchRowKeys: new Set(),
		selectionIndex: -1,
		scroll: 0,
		hoverIndex: -1,
		rowsDirty: true,
		textDirty: true,
		layout: createBehaviorLensLayout(),
		status: { info: '', detail: '' },
		lastPointerClickTimeMs: 0,
		lastPointerClickRowKey: null,
	};
	installBehaviorLensDocument(view, document);
	setBehaviorLensSourcePosition(view, document.resource.path, sourceLine, sourceColumn);
	prepareBehaviorLensLayout(view);
	finishBehaviorLensNavigation(view);
	return view;
}
