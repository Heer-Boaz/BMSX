import type { PointerSnapshot } from '../../../common/models';
import { resourceIdentityKey } from '../../../common/resource';
import { activeCodeEditor } from '../../../editor/ui/code_editor_state';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import { getTextSnapshot } from '../../../editor/text/source_text';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { getActiveCodeTabContext, getCodeTabContextById } from '../../ui/code_tab/contexts';
import type { BehaviorLensTabId } from '../../ui/tab/id';
import { editorTabGroup } from '../../ui/tab/group_model';
import { setActiveTab } from '../../ui/tabs';
import type { EditorNavigationController } from '../resources/navigation';
import type { EditorPanes } from '../../services/editor/editor_panes';
import { BehaviorLensInput } from './editor_input';
import {
	createBehaviorLensLayout,
	installBehaviorLensDocument,
	prepareBehaviorLensLayout,
} from './layout';
import { scrollWorkbenchList } from '../../ui/list_view';
import {
	BehaviorLensNavigationResult,
	executeBehaviorLensNavigation,
	finishBehaviorLensNavigation,
	selectedBehaviorLensSourceRange,
	setBehaviorLensSourcePosition,
	type BehaviorLensNavigationCommand,
} from './navigation';
import { BehaviorLensPointerResult, handleBehaviorLensPointerInput } from './pointer';
import { buildBehaviorSourceDocument } from './recognizer';
import type { BehaviorSourceDocument } from './model';
import type { BehaviorLensViewState } from './view_model';

const WHEEL_SCROLL_ROWS = 3;

/** Workbench contribution for source-derived behavior topology. Inputs own every view. */
export class BehaviorLensController {
	public constructor(
		private readonly sources: RuntimeSourceState,
		private readonly navigation: EditorNavigationController,
		private readonly editorPanes: EditorPanes,
	) {}

	public openActiveDocument(): void {
		const context = getActiveCodeTabContext();
		const source = getTextSnapshot(activeCodeEditor.model.buffer);
		const sourceVersion = context.model.version;
		const sourceLine = activeCodeEditor.view.cursorRow + 1;
		const sourceColumn = activeCodeEditor.view.cursorColumn + 1;
		const tabId: BehaviorLensTabId = `behavior:${resourceIdentityKey(context.model.resource)}`;
		let tab = editorTabGroup.findById(tabId);
		if (tab === undefined) {
			const document = this.buildDocument(context.model.resource, source);
			tab = new BehaviorLensInput(
				createBehaviorLensViewState(
					context.id,
					document,
					sourceVersion,
					sourceLine,
					sourceColumn,
				),
				context.title,
			);
			editorTabGroup.add(tab);
		} else {
			this.refreshView(tab.view, source, sourceVersion, sourceLine, sourceColumn);
		}
		setActiveTab(this.editorPanes, tab.id);
	}

	/** Refreshes a visible source lens when its canonical code buffer advances. */
	public updateView(view: BehaviorLensViewState): void {
		const context = getCodeTabContextById(view.sourceContextId);
		const sourceLine = context.view.cursorRow + 1;
		const sourceColumn = context.view.cursorColumn + 1;
		const sourceVersion = context.model.version;
		if (sourceVersion !== view.sourceVersion) {
			this.refreshView(
				view,
				getTextSnapshot(context.model.buffer),
				sourceVersion,
				sourceLine,
				sourceColumn,
			);
			return;
		}
		if (sourceLine === view.sourceLine && sourceColumn === view.sourceColumn) {
			return;
		}
		setBehaviorLensSourcePosition(view, view.resource.path, sourceLine, sourceColumn);
		prepareBehaviorLensLayout(view);
		finishBehaviorLensNavigation(view);
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
	sourceContextId: BehaviorLensViewState['sourceContextId'],
	document: BehaviorSourceDocument,
	sourceVersion: number,
	sourceLine: number,
	sourceColumn: number,
): BehaviorLensViewState {
	const view: BehaviorLensViewState = {
		sourceContextId,
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
