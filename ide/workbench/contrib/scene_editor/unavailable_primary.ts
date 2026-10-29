import { EMPTY_STATUS_ITEMS } from '../../common/status_bar';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { inputFocus } from '../../../input/focus';
import type { MainWorkspaceClient, MainWorkspaceRegionId } from '../../common/main_workspace_client';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchMenu, type WorkbenchMenuDefinition } from '../../ui/menu/model';
import { WorkbenchViewPanel } from '../../ui/view_panel/control';
import { WorkbenchViewMessageControl, type WorkbenchViewMessage } from '../../ui/view_panel/message';
import { measureSceneHierarchy } from './hierarchy_layout';
import { measureSceneDetails } from './details_layout';
import type { ScenePrimaryClientOptions } from './primary_client';
import type { ScenePrimarySnapshot } from './primary_snapshot';

const SOURCE_PRIMARY: WorkbenchMenuDefinition<EditorTextModel | undefined> = [
	{ type: 'command', command: 'editor.source', when: model => model !== undefined },
];
const SOURCE_ACTIONS: WorkbenchMenuDefinition<EditorTextModel | undefined> = [
	...SOURCE_PRIMARY,
	{ type: 'command', command: 'editor.sourceToSide', when: model => model !== undefined },
];
const HIERARCHY_CONTEXT: WorkbenchMenuDefinition<EditorTextModel | undefined> = [...SOURCE_ACTIONS,
	{ type: 'separator' }, { type: 'command', command: 'workspace.details.focus' }, { type: 'command', command: 'workspace.hierarchy.toggle' }];
const DETAILS_CONTEXT: WorkbenchMenuDefinition<EditorTextModel | undefined> = [...SOURCE_ACTIONS,
	{ type: 'separator' }, { type: 'command', command: 'workspace.hierarchy.focus' }, { type: 'command', command: 'workspace.details.toggle' }];

/** Unavailable keeps the exact reference and both honest region presentations, without an editable Scene context. */
export class UnavailableScenePrimaryClient implements MainWorkspaceClient {
	public readonly statusItems = EMPTY_STATUS_ITEMS;
	public readonly scope;
	public readonly commandTarget;
	public readonly consumer = this;
	public readonly hierarchy: WorkbenchViewPanel<WorkbenchViewMessage, WorkbenchViewMessageControl>;
	public readonly details: WorkbenchViewPanel<WorkbenchViewMessage, WorkbenchViewMessageControl>;
	private readonly copies: readonly EditorTextModel[];
	private readonly snapshot: ScenePrimarySnapshot;
	private preferred: MainWorkspaceRegionId;
	private readonly listeners = new Set<() => void>();
	private readonly unbindInteraction: () => void;
	private disposed = false;

	public constructor(snapshot: ScenePrimarySnapshot, private readonly model: EditorTextModel | undefined, options: ScenePrimaryClientOptions) {
		this.snapshot = { ...snapshot, subject: { ...snapshot.subject, availability: 'unavailable' } };
		this.preferred = snapshot.view.preferredRegion;
		this.scope = options.scope; this.copies = model === undefined ? [] : [model];
		this.commandTarget = inputFocus.createTarget(options.focusReturn, this.scope);
		this.commandTarget.canFocus = () => false;
		if (model !== undefined) this.commandTarget.registerCommand('runProject', options.createProjectRunCommand(model, this.commandTarget, () => !this.disposed));
		if (model !== undefined) this.commandTarget.registerCommand('save', {
			contextual: true, isEnabled: () => !this.disposed && options.saves.canSave(model),
			run: () => options.save(model),
		});
		const common = { commands: options.commands, contextMenu: options.contextMenu, surfaces: options.surfaces,
			workArea: options.workArea, scope: this.scope, commandTarget: this.commandTarget, focusReturn: options.focusReturn,
			description: snapshot.source.resource.path,
			createControl: (_scope: typeof this.scope, target: typeof this.commandTarget) => new WorkbenchViewMessageControl(target) };
		const hierarchyActions = new WorkbenchMenu(HIERARCHY_CONTEXT, model);
		this.hierarchy = new WorkbenchViewPanel({ ...common, title: 'Hierarchy', surface: options.regions.hierarchy,
			view: { paragraphs: ['Scene unavailable', snapshot.source.resource.path], warning: true },
			actions: createWorkbenchActionBar(new WorkbenchMenu(SOURCE_PRIMARY, model), true, hierarchyActions), contextActions: hierarchyActions, measureContent: measureSceneHierarchy });
		const detailsActions = new WorkbenchMenu(DETAILS_CONTEXT, model);
		this.details = new WorkbenchViewPanel({ ...common, title: 'Details', surface: options.regions.details,
			view: { paragraphs: ['No available Scene selection'], warning: true },
			actions: createWorkbenchActionBar(new WorkbenchMenu(SOURCE_PRIMARY, model), true, detailsActions), contextActions: detailsActions, measureContent: measureSceneDetails });
		this.unbindInteraction = inputFocus.onDidActivateInteraction(target => {
			if (this.disposed) return;
			let region: MainWorkspaceRegionId;
			if (this.hierarchy.attached && this.hierarchy.scope.contains(target.scope)) region = 'hierarchy';
			else if (this.details.attached && this.details.scope.contains(target.scope)) region = 'details';
			else return;
			if (region === this.preferred) return;
			this.preferred = region; for (const listener of this.listeners) listener();
		});
	}
	public getWorkingCopies(): readonly EditorTextModel[] { return this.copies; }
	public get preferredRegion(): MainWorkspaceRegionId { return this.preferred; }
	public get canOpenSource(): boolean { return !this.disposed && this.model !== undefined; }
	public captureSourceLocation() {
		const model = this.model;
		return model === undefined ? undefined : { isCurrent: () => !this.disposed,
			readLocation: () => ({ model, modelVersion: model.version }) };
	}
	public serialize() { return { kind: 'scene' as const, value: JSON.stringify({ ...this.snapshot,
		view: { ...this.snapshot.view, preferredRegion: this.preferred } }) }; }
	public onDidChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	public captureNavigationLocation() { return undefined; }
	public isCurrent(): boolean { return !this.disposed; }
	public update(): void {}
	public focus(region: MainWorkspaceRegionId = this.preferredRegion): void { this[region].focus(); }
	public updateStatus(): void {}
	public dispose(): void {
		this.disposed = true; this.unbindInteraction(); this.hierarchy.dispose(); this.details.dispose(); this.listeners.clear();
	}
}
