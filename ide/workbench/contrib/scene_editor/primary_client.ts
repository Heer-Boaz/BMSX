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
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchCompositeMenu, WorkbenchMenu, type WorkbenchMenuCommandDefinition, type WorkbenchMenuDefinition } from '../../ui/menu/model';
import { WorkbenchViewPanel } from '../../ui/view_panel/control';
import type { SceneAuthoringContext } from './authoring_context';
import { SceneAuthoringCommands } from './authoring_commands';
import { SceneHierarchyControl } from './hierarchy_control';
import { SceneDetailsControl } from './details_control';
import { measureSceneHierarchy } from './hierarchy_layout';
import { measureSceneDetails } from './details_layout';
import type { SceneViewState } from './scene_view';
import type { SceneEditorInput } from './editor_input';
import type { SceneHierarchyViewState } from './hierarchy_view';
import type { SceneDetailsViewState } from './details_view';
import type { SceneEditorSectionCommands } from './option_editor';
import type { SceneViewportControl } from './viewport/control';

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
	readonly isCurrent: () => boolean;
	createProjectRunCommand(model: EditorTextModel, target: InputFocusTarget, isRetained: () => boolean): FocusCommand;
	save(model: EditorTextModel): void;
};
const HIERARCHY_ACTIONS: readonly WorkbenchMenuCommandDefinition<undefined>[] = [{ type: 'command', command: 'sceneEditor.addMember', icon: 'add' }];
const HIERARCHY_PANEL_CONTEXT: WorkbenchMenuDefinition<MainWorkspace> = [
	{ type: 'command', command: 'sceneEditor.details', when: main => !main.regions.details.displayed },
	{ type: 'command', command: 'workspace.hierarchy.toggle', showCheckmark: false },
];
const DETAILS_PANEL_CONTEXT: WorkbenchMenuDefinition<MainWorkspace> = [
	{ type: 'command', command: 'sceneEditor.outline', when: main => !main.regions.hierarchy.displayed },
	{ type: 'command', command: 'workspace.details.toggle', showCheckmark: false },
];

/** One exact Scene context, with an authored viewport and independent hierarchy/Details presentations. */
export class ScenePrimaryClient implements MainWorkspaceClient {
	public readonly view: SceneViewState;
	public readonly hierarchy: WorkbenchViewPanel<SceneHierarchyViewState, SceneHierarchyControl>;
	public readonly details: WorkbenchViewPanel<SceneDetailsViewState, SceneDetailsControl>;
	public readonly viewportTarget: InputFocusTarget;
	public readonly authoring: SceneAuthoringContext;
	public readonly scope: InputFocusScope;
	public readonly commandTarget: InputFocusTarget;
	private readonly authoringCommands: SceneAuthoringCommands;
	private readonly unbindInteraction: () => void;
	private readonly addMemberCommand: FocusCommand;
	private readonly sections: SceneEditorSectionCommands;
	private disposed = false;
	private readonly statusItem: WorkbenchStatusItem = { text: '', alignment: 'left', priority: STATUS_PRIORITY_CONTENT, overflow: 'ellipsis', tone: 'normal' };
	public readonly statusItems = [this.statusItem];

	public constructor(public readonly input: SceneEditorInput, private readonly viewport: SceneViewportControl,
		private readonly options: ScenePrimaryClientOptions) {
		const consumer = this.authoring = input.view.authoring;
		this.scope = options.scope; this.view = input.view; this.viewportTarget = viewport.focusTarget;
		this.commandTarget = inputFocus.createTarget(options.focusReturn, this.scope);
		this.commandTarget.canFocus = () => false;
		const sections: SceneEditorSectionCommands = this.sections = {
			outline: { contextual: true, isEnabled: () => !this.disposed, run: () => options.main.focusPrimary('hierarchy'),
				capture: () => {
					const generation = this.scope.contextGeneration;
					const current = () => !this.disposed && this.scope.contextGeneration === generation && options.main.primary === this;
					return { editScope: this.scope, isEnabled: current, run: () => { if (current()) options.main.focusPrimary('hierarchy'); } };
				} },
			details: { contextual: true, isEnabled: () => !this.disposed && consumer.hasSelection, run: () => options.main.focusPrimary('details'),
				capture: () => {
					const generation = this.scope.contextGeneration;
					const current = () => !this.disposed && this.scope.contextGeneration === generation && options.main.primary === this;
					return { editScope: this.scope, isEnabled: () => current() && consumer.hasSelection,
						run: () => { if (current() && consumer.hasSelection) options.main.focusPrimary('details'); } };
				} },
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
		const hierarchyMenu = new WorkbenchCompositeMenu([new WorkbenchMenu(HIERARCHY_PANEL_CONTEXT, options.main), options.main.regions.hierarchy.actions]);
		this.hierarchy = new WorkbenchViewPanel({ ...common, title: 'Hierarchy', view: this.view.hierarchy,
			bodyContextMenu: 'content',
			surface: options.presentations.hierarchy, actions: createWorkbenchActionBar(new WorkbenchMenu(HIERARCHY_ACTIONS, undefined), true, hierarchyMenu),
			contextActions: hierarchyMenu, measureContent: measureSceneHierarchy,
			createControl: (scope, _target, surface) => new SceneHierarchyControl(options.commands, options.contextMenu, options.surfaces,
				surface, options.workArea, scope, this.commandTarget, sections) });
		const detailsContext = new WorkbenchMenu([], undefined);
		const detailsMenu = new WorkbenchCompositeMenu([new WorkbenchMenu(DETAILS_PANEL_CONTEXT, options.main), options.main.regions.details.actions]);
		this.details = new WorkbenchViewPanel({ ...common, title: 'Details', view: this.view.details,
			bodyContextMenu: 'content',
			surface: options.presentations.details, actions: createWorkbenchActionBar(new WorkbenchMenu([], undefined), true, detailsMenu),
			contextActions: detailsMenu, measureContent: measureSceneDetails,
			createControl: (scope, target) => new SceneDetailsControl(options.commands, options.contextMenu, scope, target, sections, detailsContext) });
		const addMember: FocusCommand = this.addMemberCommand = {
			contextual: true,
			isEnabled: () => this.canAddMember,
			run: () => this.addMember(),
			capture: () => {
				const generation = this.scope.contextGeneration;
				return { editScope: this.scope, isEnabled: () => this.scope.contextGeneration === generation && this.canAddMember,
					run: () => { if (this.scope.contextGeneration === generation && this.canAddMember) this.addMember(); } };
			},
		};
		this.commandTarget.registerCommand('sceneEditor.addMember', addMember);
		this.unbindInteraction = inputFocus.onDidActivateInteraction(target => {
			if (this.disposed) return;
			if (this.hierarchy.attached && this.hierarchy.scope.contains(target.scope)) this.view.preferredPart = 'hierarchy';
			else if (this.details.attached && this.details.scope.contains(target.scope)) this.view.preferredPart = 'details';
			else if (this.viewportTarget.scope.contains(target.scope)) this.view.preferredPart = 'viewport';
		});
	}
	private get canAddMember(): boolean {
		return !this.disposed && this.options.isCurrent() && this.viewport.canFocus && this.authoring.canAddMember(this.view.viewport.camera.mode);
	}
	public attach(): void {
		this.viewportTarget.registerCommand('sceneEditor.addMember', this.addMemberCommand);
		this.viewportTarget.registerCommand('sceneEditor.outline', this.sections.outline);
		this.viewportTarget.registerCommand('sceneEditor.details', this.sections.details);
		this.authoringCommands.attach(this.viewportTarget);
	}
	private addMember(): void {
		const camera = this.view.viewport.camera, family = camera.mode;
		const request = this.authoring.captureAddMember(family); if (request === undefined) return;
		const generation = this.scope.contextGeneration;
		const items = request.choices.map(choice => ({ choice, label: choice.id, description: '', detail: '' }));
		this.options.quickInput.pick('Add', 'Choose a prefab, then click the scene', () => new TextQuickPickProvider(items), (item, _modifiers, preserveFocus) => {
			if (preserveFocus || this.disposed || this.scope.contextGeneration !== generation || !request.isCurrent()) return;
			this.viewport.beginAddMember(request, item.choice, () => {
				if (this.hierarchy.attached) { this.hierarchy.control.update(); this.hierarchy.control.revealSelection(); }
			});
		}, lifetime => {
			lifetime.add({ dispose: this.authoring.workingCopy.onDidChangeContent(() => this.options.quickInput.hide()) });
			lifetime.add({ dispose: this.authoring.onDidChangeSelection(() => this.options.quickInput.hide()) });
			lifetime.add({ dispose: this.authoring.onDidChangeSpatialGeneration(() => this.options.quickInput.hide()) });
			lifetime.add({ dispose: this.authoring.workingCopy.onDidChangeReadOnly(() => this.options.quickInput.hide()) });
			lifetime.add({ dispose: camera.onDidChange(() => this.options.quickInput.hide()) });
		}, { commandTarget: this.commandTarget });
	}
	public get preferredPart(): MainWorkspacePrimaryPartId { return this.view.preferredPart; }
	public onDidChange(listener: () => void): () => void { return this.view.onDidChange(listener); }
	public get canOpenSource(): boolean { return !this.disposed; }
	public captureSourceLocation() { return this.disposed ? undefined : this.authoring.captureSourceLocation(); }
	public isCurrent(): boolean { return !this.disposed && this.options.isCurrent() && this.authoring.isCurrent; }
	public update(): void {
		this.authoring.refresh();
	}
	public focus(region: MainWorkspacePrimaryPartId = this.preferredPart): void {
		if (region === 'viewport') this.viewport.focus(); else this[region].focus();
	}
	public updateStatus(): void {
		const status = getTextFileRuntimeSourceStatus(this.options.sources, this.authoring.workingCopy);
		this.statusItem.text = SOURCE_STATUS[status];
		this.statusItem.tone = status === 'failed' ? 'error' : 'normal';
		this.statusItem.priority = status === 'failed' ? STATUS_PRIORITY_ERROR : STATUS_PRIORITY_CONTENT;
	}
	public dispose(): void {
		this.disposed = true; this.authoringCommands.dispose(); this.unbindInteraction();
		if (this.viewportTarget.getCommand('sceneEditor.addMember') === this.addMemberCommand)
			this.viewportTarget.unregisterCommand('sceneEditor.addMember');
		if (this.viewportTarget.getCommand('sceneEditor.outline') === this.sections.outline) this.viewportTarget.unregisterCommand('sceneEditor.outline');
		if (this.viewportTarget.getCommand('sceneEditor.details') === this.sections.details) this.viewportTarget.unregisterCommand('sceneEditor.details');
		this.authoringCommands.detach(this.viewportTarget);
		this.hierarchy.dispose(); this.details.dispose();
	}
}
const SOURCE_STATUS = {
	applied: 'SOURCE APPLIED', pending: 'SOURCE NOT APPLIED', failed: 'SOURCE APPLY FAILED',
	untracked: 'SOURCE STATUS UNKNOWN', source_only: 'SOURCE ONLY',
};
