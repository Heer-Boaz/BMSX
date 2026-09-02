import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../../common/models';
import { resourceIdentityKey } from '../../../common/resource';
import { editorDocumentState } from '../../../editor/editing/document_state';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import { getTextSnapshot } from '../../../editor/text/source_text';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { captureActiveCodeTabSource } from '../../ui/code_tab/activation';
import { getActiveCodeTabContext, getCodeTabContextById } from '../../ui/code_tab/contexts';
import type { BehaviorLensTabId } from '../../ui/tab/id';
import { editorTabGroup } from '../../ui/tab/group_model';
import { setActiveTab } from '../../ui/tabs';
import type { EditorNavigationController } from '../resources/navigation';
import type { ResourcePanelController } from '../resources/panel/controller';
import { handleBehaviorLensGamepadInput, handleBehaviorLensKeyboardInput } from './keyboard';
import {
	createBehaviorLensLayout,
	installBehaviorLensDocument,
	prepareBehaviorLensLayout,
	setBehaviorLensScroll,
} from './layout';
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
import { drawBehaviorLens } from './render';
import type { BehaviorSourceDocument } from './model';
import type { BehaviorLensViewState } from './view_model';

const WHEEL_SCROLL_ROWS = 3;

/** Workbench contribution for source-derived behavior topology. Tab descriptors own every view. */
export class BehaviorLensController {
	public constructor(
		private readonly sources: RuntimeSourceState,
		private readonly navigation: EditorNavigationController,
		private readonly resourcePanel: ResourcePanelController,
	) {}

	public openActiveDocument(): void {
		const context = getActiveCodeTabContext();
		const source = captureActiveCodeTabSource();
		const sourceVersion = context.buffer.version;
		const sourceLine = editorDocumentState.cursorRow + 1;
		const sourceColumn = editorDocumentState.cursorColumn + 1;
		const tabId: BehaviorLensTabId = `behavior:${resourceIdentityKey(context.resource)}`;
		let tab = editorTabGroup.findById(tabId);
		if (tab === undefined) {
			const document = this.buildDocument(context.resource, source);
			tab = {
				id: tabId,
				kind: 'behavior_lens',
				title: `LENS ${context.title}`,
				closable: true,
				view: createBehaviorLensViewState(
					context.id,
					document,
					sourceVersion,
					sourceLine,
					sourceColumn,
				),
			};
			editorTabGroup.add(tab);
		} else {
			this.refreshView(tab.view, source, sourceVersion, sourceLine, sourceColumn);
		}
		setActiveTab(this.resourcePanel, tab.id);
	}

	/** Refreshes a visible source lens when its canonical code buffer advances. */
	public updateView(view: BehaviorLensViewState): void {
		const context = getCodeTabContextById(view.sourceContextId);
		const sourceLine = context.cursorRow + 1;
		const sourceColumn = context.cursorColumn + 1;
		const sourceVersion = context.buffer.version;
		if (sourceVersion !== view.sourceVersion) {
			this.refreshView(
				view,
				getTextSnapshot(context.buffer),
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

	public draw(view: BehaviorLensViewState): void {
		drawBehaviorLens(view);
	}

	public handleKeyboard(view: BehaviorLensViewState, playerInput: PlayerInput): boolean {
		return handleBehaviorLensKeyboardInput(view, playerInput, this);
	}

	public handleGamepad(view: BehaviorLensViewState, playerInput: PlayerInput): boolean {
		return handleBehaviorLensGamepadInput(view, playerInput, this);
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
		setBehaviorLensScroll(view, view.scroll + direction * steps * WHEEL_SCROLL_ROWS);
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
