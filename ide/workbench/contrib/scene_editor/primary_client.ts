import { STATUS_PRIORITY_CONTENT, STATUS_PRIORITY_ERROR, type WorkbenchStatusItem } from '../../common/status_bar';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandRunner } from '../../../common/commands';
import type { DisposableStore } from '../../../common/lifecycle';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { inputFocus, type FocusCommand, type InputFocusScope, type InputFocusTarget } from '../../../input/focus';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { MainWorkspace } from '../../main_workspace';
import type { MainWorkspaceClient, MainWorkspacePrimaryPartId, MainWorkspaceClientSurfaces } from '../../common/main_workspace_client';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { QuickInputController } from '../../services/quick_input/controller';
import { getTextFileRuntimeSourceStatus } from '../../services/working_copy/runtime_source_status';
import type { TextFileSaveService } from '../../services/working_copy/text_file_save';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchCompositeMenu, WorkbenchMenu, type WorkbenchMenuCommandDefinition, type WorkbenchMenuDefinition } from '../../ui/menu/model';
import { WorkbenchViewPanel } from '../../ui/view_panel/control';
import { SceneAuthoringContext, type SceneAuthoredSubject } from './authoring_context';
import { SceneAuthoringCommands } from './authoring_commands';
import { SceneHierarchyControl } from './hierarchy_control';
import { SceneDetailsControl } from './details_control';
import { measureSceneHierarchy } from './hierarchy_layout';
import { measureSceneDetails } from './details_layout';
import { SCENE_AUTHORING_CONTEXT_ACTIONS } from './menus';
import { ScenePrimaryBookmark } from './primary_bookmark';
import { ScenePrimaryNavigationLocation, type RestoreScenePrimaryBookmark } from './primary_location';
import { captureScenePrimary, restoreScenePrimaryView, type ScenePrimaryViewSnapshot } from './primary_snapshot';
import { ScenePrimaryViewState } from './primary_view';
import type { SceneSourceDocuments } from './source_documents';
import type { SceneHierarchyViewState } from './hierarchy_view';
import type { SceneDetailsViewState } from './details_view';
import type { SceneEditorSectionCommands } from './option_editor';
import { SceneViewportControl, measureSceneViewport, VIEWPORT_CONTEXT_ACTIONS } from './viewport/control';
import type { SceneViewportViewState } from './viewport/view_state';

export type ScenePrimaryClientOptions = {
	readonly commands: EditorCommandRunner;
	readonly sources: RuntimeSourceState;
	readonly saves: TextFileSaveService;
	readonly contextMenu: ContextMenuController;
	readonly quickInput: QuickInputController;
	readonly surfaces: WorkbenchSurfaceService;
	readonly presentations: MainWorkspaceClientSurfaces;
	readonly workArea: Readonly<RectBounds>;
	readonly scope: InputFocusScope;
	readonly focusReturn: InputFocusTarget;
	readonly main: MainWorkspace;
	readonly restoreNavigation: RestoreScenePrimaryBookmark;
	createProjectRunCommand(model: EditorTextModel, target: InputFocusTarget, isRetained: () => boolean): FocusCommand;
	save(model: EditorTextModel): void;
};
const PRIMARY_ACTIONS: readonly WorkbenchMenuCommandDefinition<undefined>[] = [{ type: 'command', command: 'editor.source' }];
const HIERARCHY_CONTEXT: WorkbenchMenuDefinition<MainWorkspace> = [
	{ type: 'command', command: 'sceneEditor.details', when: main => !main.regions.details.displayed },
	...SCENE_AUTHORING_CONTEXT_ACTIONS,
];
const DETAILS_CONTEXT: WorkbenchMenuDefinition<MainWorkspace> = [
	{ type: 'command', command: 'sceneEditor.outline', when: main => !main.regions.hierarchy.displayed },
	...SCENE_AUTHORING_CONTEXT_ACTIONS,
];
const HIERARCHY_PANEL_CONTEXT: WorkbenchMenuDefinition<undefined> = [{ type: 'command', command: 'workspace.hierarchy.toggle' }];
const DETAILS_PANEL_CONTEXT: WorkbenchMenuDefinition<undefined> = [{ type: 'command', command: 'workspace.details.toggle' }];

/** One exact Scene context, with an authored viewport and independent hierarchy/Details presentations. */
export class ScenePrimaryClient implements MainWorkspaceClient {
	public readonly view: ScenePrimaryViewState;
	public readonly hierarchy: WorkbenchViewPanel<SceneHierarchyViewState, SceneHierarchyControl>;
	public readonly details: WorkbenchViewPanel<SceneDetailsViewState, SceneDetailsControl>;
	public readonly viewport: WorkbenchViewPanel<SceneViewportViewState, SceneViewportControl>;
	public readonly scope: InputFocusScope;
	public readonly commandTarget: InputFocusTarget;
	private readonly authoringCommands: SceneAuthoringCommands;
	private readonly unbindInteraction: () => void;
	private disposed = false;
	private readonly statusItem: WorkbenchStatusItem = { text: '', alignment: 'left', priority: STATUS_PRIORITY_CONTENT, overflow: 'ellipsis', tone: 'normal' };
	public readonly statusItems = [this.statusItem];

	public constructor(public readonly consumer: SceneAuthoringContext, private readonly options: ScenePrimaryClientOptions) {
		this.scope = options.scope; this.view = new ScenePrimaryViewState(consumer, options.sources.catalog);
		this.commandTarget = inputFocus.createTarget(options.focusReturn, this.scope);
		this.commandTarget.canFocus = () => false;
		const sections: SceneEditorSectionCommands = {
			outline: { contextual: true, isEnabled: () => !this.disposed, run: () => options.main.focusPrimary('hierarchy') },
			details: { contextual: true, isEnabled: () => !this.disposed && consumer.hasSelection, run: () => options.main.focusPrimary('details') },
		};
		this.commandTarget.registerCommand('sceneEditor.outline', sections.outline);
		this.commandTarget.registerCommand('sceneEditor.details', sections.details);
		this.authoringCommands = new SceneAuthoringCommands(this.commandTarget, options.quickInput, context => {
			if (context !== consumer || !this.hierarchy.attached) return;
			this.hierarchy.control.update(); this.hierarchy.control.revealSelection();
		});
		this.authoringCommands.bind(consumer);
		this.commandTarget.registerCommand('runProject', options.createProjectRunCommand(consumer.workingCopy, this.commandTarget, () => !this.disposed));
		this.commandTarget.registerCommand('save', {
			contextual: true,
			isEnabled: () => !this.disposed && options.saves.canSave(consumer.workingCopy),
			run: () => options.save(consumer.workingCopy),
			capture: () => {
				if (this.disposed || !options.saves.canSave(consumer.workingCopy)) return;
				const generation = this.scope.contextGeneration;
				return { editScope: this.scope, isEnabled: () => !this.disposed && this.scope.contextGeneration === generation
					&& options.saves.canSave(consumer.workingCopy),
					run: () => { if (!this.disposed && this.scope.contextGeneration === generation) options.save(consumer.workingCopy); } };
			},
		});
		const observeActions = (lifetime: DisposableStore) => {
			lifetime.add({ dispose: consumer.workingCopy.onDidChangeContent(() => options.contextMenu.hide()) });
			lifetime.add({ dispose: consumer.onDidChangeSelection(() => options.contextMenu.hide()) });
		};
		const common = { commands: options.commands, contextMenu: options.contextMenu, surfaces: options.surfaces,
			workArea: options.workArea, scope: this.scope, commandTarget: this.commandTarget, focusReturn: options.focusReturn,
			description: consumer.workingCopy.resource.path, onDidOpenActions: observeActions, isPresented: () => options.main.primary === this };
		const hierarchyContext = new WorkbenchMenu(HIERARCHY_CONTEXT, options.main);
		const hierarchyMenu = new WorkbenchCompositeMenu([hierarchyContext, new WorkbenchMenu(HIERARCHY_PANEL_CONTEXT, undefined), options.main.regions.hierarchy.actions]);
		this.hierarchy = new WorkbenchViewPanel({ ...common, title: 'Hierarchy', view: this.view.hierarchy,
			bodyContextMenu: 'content',
			surface: options.presentations.hierarchy, actions: createWorkbenchActionBar(new WorkbenchMenu(PRIMARY_ACTIONS, undefined), true, hierarchyMenu),
			contextActions: hierarchyMenu, measureContent: measureSceneHierarchy,
			createControl: (scope, _target, surface) => new SceneHierarchyControl(options.commands, options.contextMenu, options.surfaces,
				surface, options.workArea, scope, this.commandTarget, sections, hierarchyContext) });
		const detailsContext = new WorkbenchMenu(DETAILS_CONTEXT, options.main);
		const detailsMenu = new WorkbenchCompositeMenu([detailsContext, new WorkbenchMenu(DETAILS_PANEL_CONTEXT, undefined), options.main.regions.details.actions]);
		this.details = new WorkbenchViewPanel({ ...common, title: 'Details', view: this.view.details,
			bodyContextMenu: 'content',
			surface: options.presentations.details, actions: createWorkbenchActionBar(new WorkbenchMenu(PRIMARY_ACTIONS, undefined), true, detailsMenu),
			contextActions: detailsMenu, measureContent: measureSceneDetails,
			createControl: scope => new SceneDetailsControl(options.commands, options.contextMenu, scope, this.commandTarget, sections, detailsContext) });
		const viewportMenu = new WorkbenchCompositeMenu([new WorkbenchMenu(VIEWPORT_CONTEXT_ACTIONS, this.view.viewport), new WorkbenchMenu(PRIMARY_ACTIONS, undefined)]);
		this.viewport = new WorkbenchViewPanel({ ...common, title: 'Scene', view: this.view.viewport, surface: options.presentations.viewport,
			bodyContextMenu: 'container',
			actions: createWorkbenchActionBar(new WorkbenchMenu([], undefined)), contextActions: viewportMenu, measureContent: measureSceneViewport,
			createControl: (scope, target) => new SceneViewportControl(scope, target) });
		this.viewport.setHeaderVisible(false);
		this.unbindInteraction = inputFocus.onDidActivateInteraction(target => {
			if (this.disposed) return;
			if (this.hierarchy.attached && this.hierarchy.scope.contains(target.scope)) this.view.preferredPart = 'hierarchy';
			else if (this.details.attached && this.details.scope.contains(target.scope)) this.view.preferredPart = 'details';
			else if (this.viewport.attached && this.viewport.scope.contains(target.scope)) this.view.preferredPart = 'viewport';
		});
	}
	public get preferredPart(): MainWorkspacePrimaryPartId { return this.view.preferredPart; }
	public serialize() { return { kind: 'scene' as const, value: JSON.stringify(captureScenePrimary(this.view)) }; }
	public onDidChange(listener: () => void): () => void { return this.view.onDidChange(listener); }
	public captureNavigationLocation(): ScenePrimaryNavigationLocation | undefined {
		const bookmark = new ScenePrimaryBookmark(this.consumer, this.view);
		if (bookmark.isDisposed) { bookmark.dispose(); return undefined; }
		return new ScenePrimaryNavigationLocation(bookmark, this.options.main, this.options.restoreNavigation);
	}
	public get canOpenSource(): boolean { return !this.disposed; }
	public captureSourceLocation() { return this.disposed ? undefined : this.consumer.captureSourceLocation(); }
	public isCurrent(): boolean { return !this.disposed && this.consumer.isCurrent && this.consumer.availability === 'available'; }
	public update(): void {
		this.consumer.refresh();
	}
	public focus(region: MainWorkspacePrimaryPartId = this.preferredPart): void { this[region].focus(); }
	public updateStatus(): void {
		const status = getTextFileRuntimeSourceStatus(this.options.sources, this.consumer.workingCopy);
		this.statusItem.text = SOURCE_STATUS[status];
		this.statusItem.tone = status === 'failed' ? 'error' : 'normal';
		this.statusItem.priority = status === 'failed' ? STATUS_PRIORITY_ERROR : STATUS_PRIORITY_CONTENT;
	}
	public dispose(): void {
		this.disposed = true; this.authoringCommands.dispose(); this.unbindInteraction();
		this.hierarchy.dispose(); this.details.dispose(); this.viewport.dispose(); this.view.dispose(); this.consumer.dispose();
	}
}

export function createScenePrimaryClient(model: EditorTextModel, documents: SceneSourceDocuments, subject: SceneAuthoredSubject,
	options: ScenePrimaryClientOptions, view?: ScenePrimaryViewSnapshot): ScenePrimaryClient | undefined {
	const context = new SceneAuthoringContext(model, documents, subject);
	if (!context.isCurrent || context.availability !== 'available') { context.dispose(); return undefined; }
	context.select(context.document!, model.version, { kind: 'scene', scene: context.subject! });
	const client = new ScenePrimaryClient(context, options);
	if (view !== undefined) restoreScenePrimaryView(client.view, view);
	return client;
}
const SOURCE_STATUS = {
	applied: 'SOURCE APPLIED', pending: 'SOURCE NOT APPLIED', failed: 'SOURCE APPLY FAILED',
	untracked: 'SOURCE STATUS UNKNOWN', source_only: 'SOURCE ONLY',
};
