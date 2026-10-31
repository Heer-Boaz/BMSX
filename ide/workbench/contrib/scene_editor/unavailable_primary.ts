import { EMPTY_STATUS_ITEMS } from '../../common/status_bar';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { inputFocus } from '../../../input/focus';
import type { MainWorkspaceClient, MainWorkspacePrimaryPartId } from '../../common/main_workspace_client';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchCompositeMenu, WorkbenchMenu, type WorkbenchMenuDefinition } from '../../ui/menu/model';
import { WorkbenchViewPanel } from '../../ui/view_panel/control';
import { WorkbenchViewMessageControl, type WorkbenchViewMessage } from '../../ui/view_panel/message';
import { measureSceneHierarchy } from './hierarchy_layout';
import { measureSceneDetails } from './details_layout';
import type { ScenePrimaryClientOptions } from './primary_client';
import type { ScenePrimarySnapshot } from './primary_snapshot';
import { measureSceneViewport } from './viewport/control';

const SOURCE_PRIMARY: WorkbenchMenuDefinition<EditorTextModel | undefined> = [
	{ type: 'command', command: 'editor.source', when: model => model !== undefined },
];
const HIERARCHY_CONTEXT: WorkbenchMenuDefinition<EditorTextModel | undefined> = [...SOURCE_PRIMARY,
	{ type: 'separator' }, { type: 'command', command: 'workspace.hierarchy.toggle' }];
const DETAILS_CONTEXT: WorkbenchMenuDefinition<EditorTextModel | undefined> = [...SOURCE_PRIMARY,
	{ type: 'separator' }, { type: 'command', command: 'workspace.details.toggle' }];

/** Unavailable retains the exact reference and honest presentations, without an editable Scene context. */
export class UnavailableScenePrimaryClient implements MainWorkspaceClient {
	public readonly statusItems = EMPTY_STATUS_ITEMS;
	public readonly scope;
	public readonly commandTarget;
	public readonly consumer = this;
	public readonly hierarchy: WorkbenchViewPanel<WorkbenchViewMessage, WorkbenchViewMessageControl>;
	public readonly details: WorkbenchViewPanel<WorkbenchViewMessage, WorkbenchViewMessageControl>;
	public readonly viewport: WorkbenchViewPanel<WorkbenchViewMessage, WorkbenchViewMessageControl>;
	private readonly copies: readonly EditorTextModel[];
	private readonly snapshot: ScenePrimarySnapshot;
	private preferred: MainWorkspacePrimaryPartId;
	private readonly listeners = new Set<() => void>();
	private readonly unbindInteraction: () => void;
	private disposed = false;

	public constructor(snapshot: ScenePrimarySnapshot, private readonly model: EditorTextModel | undefined, options: ScenePrimaryClientOptions) {
		this.snapshot = { ...snapshot, subject: { ...snapshot.subject, availability: 'unavailable' } };
		this.preferred = snapshot.view.preferredPart;
		this.scope = options.scope; this.copies = model === undefined ? [] : [model];
		this.commandTarget = inputFocus.createTarget(options.focusReturn, this.scope);
		this.commandTarget.canFocus = () => false;
		if (model !== undefined) this.commandTarget.registerCommand('runProject', options.createProjectRunCommand(model, this.commandTarget, () => !this.disposed));
		if (model !== undefined) this.commandTarget.registerCommand('save', {
			contextual: true, isEnabled: () => !this.disposed && options.saves.canSave(model),
			run: () => options.save(model),
		});
		const common = { commands: options.commands, contextMenu: options.contextMenu, surfaces: options.surfaces,
			bodyContextMenu: 'container' as const,
			workArea: options.workArea, scope: this.scope, commandTarget: this.commandTarget, focusReturn: options.focusReturn,
			description: snapshot.source.resource.path, isPresented: () => options.main.primary === this,
			createControl: (_scope: typeof this.scope, target: typeof this.commandTarget) => new WorkbenchViewMessageControl(target) };
		const hierarchyActions = new WorkbenchCompositeMenu([new WorkbenchMenu(HIERARCHY_CONTEXT, model), options.main.regions.hierarchy.actions]);
		this.hierarchy = new WorkbenchViewPanel({ ...common, title: 'Hierarchy', surface: options.presentations.hierarchy,
			view: { paragraphs: ['Scene unavailable', snapshot.source.resource.path], warning: true },
			actions: createWorkbenchActionBar(new WorkbenchMenu(SOURCE_PRIMARY, model), true, hierarchyActions), contextActions: hierarchyActions, measureContent: measureSceneHierarchy });
		const detailsActions = new WorkbenchCompositeMenu([new WorkbenchMenu(DETAILS_CONTEXT, model), options.main.regions.details.actions]);
		this.details = new WorkbenchViewPanel({ ...common, title: 'Details', surface: options.presentations.details,
			view: { paragraphs: ['No available Scene selection'], warning: true },
			actions: createWorkbenchActionBar(new WorkbenchMenu(SOURCE_PRIMARY, model), true, detailsActions), contextActions: detailsActions, measureContent: measureSceneDetails });
		const viewportActions = new WorkbenchMenu(SOURCE_PRIMARY, model);
		this.viewport = new WorkbenchViewPanel({ ...common, title: 'Scene', surface: options.presentations.viewport,
			view: { paragraphs: ['Scene unavailable', snapshot.source.resource.path], warning: true },
			actions: createWorkbenchActionBar(new WorkbenchMenu([], undefined)), contextActions: viewportActions, measureContent: measureSceneViewport });
		this.viewport.setHeaderVisible(false);
		this.unbindInteraction = inputFocus.onDidActivateInteraction(target => {
			if (this.disposed) return;
			let region: MainWorkspacePrimaryPartId;
			if (this.hierarchy.attached && this.hierarchy.scope.contains(target.scope)) region = 'hierarchy';
			else if (this.details.attached && this.details.scope.contains(target.scope)) region = 'details';
			else if (this.viewport.attached && this.viewport.scope.contains(target.scope)) region = 'viewport';
			else return;
			if (region === this.preferred) return;
			this.preferred = region; for (const listener of this.listeners) listener();
		});
	}
	public getWorkingCopies(): readonly EditorTextModel[] { return this.copies; }
	public get preferredPart(): MainWorkspacePrimaryPartId { return this.preferred; }
	public get canOpenSource(): boolean { return !this.disposed && this.model !== undefined; }
	public captureSourceLocation() {
		const model = this.model;
		return model === undefined ? undefined : { isCurrent: () => !this.disposed,
			readLocation: () => ({ model, modelVersion: model.version }) };
	}
	public serialize() { return { kind: 'scene' as const, value: JSON.stringify({ ...this.snapshot,
		view: { ...this.snapshot.view, preferredPart: this.preferred } }) }; }
	public onDidChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	public captureNavigationLocation() { return undefined; }
	public isCurrent(): boolean { return !this.disposed; }
	public update(): void {}
	public focus(region: MainWorkspacePrimaryPartId = this.preferredPart): void { this[region].focus(); }
	public updateStatus(): void {}
	public dispose(): void {
		this.disposed = true; this.unbindInteraction(); this.hierarchy.dispose(); this.details.dispose(); this.viewport.dispose(); this.listeners.clear();
	}
}
