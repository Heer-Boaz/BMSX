import type { EditorCommandRunner } from '../../../common/commands';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { InputFocusScope } from '../../../input/focus';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { MainWorkspace, MainWorkspaceClient } from '../../main_workspace';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { SceneAuthoringContext, type SceneAuthoredSubject } from './authoring_context';
import type { SceneSourceDocuments } from './source_documents';
import { captureScenePrimary } from './primary_snapshot';
import { ScenePrimaryBookmark } from './primary_bookmark';
import { ScenePrimaryNavigationLocation, type RestoreScenePrimaryBookmark } from './primary_location';
import { restoreSceneEditorView, type SceneEditorViewSnapshot } from './view_snapshot';
import { SceneEditorViewState } from './view_state';
import { SceneEditorControl } from './control';
import { measureSceneEditorMinimumWidth } from './layout';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { editorRuntimeState } from '../../../editor/common/runtime_state';

export type ScenePrimaryClientOptions = {
	readonly commands: EditorCommandRunner;
	readonly sources: RuntimeSourceState;
	readonly contextMenu: ContextMenuController;
	readonly surfaces: WorkbenchSurfaceService;
	readonly owner: WorkbenchSurface;
	readonly workArea: Readonly<RectBounds>;
	readonly scope: InputFocusScope;
	readonly main: MainWorkspace;
	readonly restoreNavigation: RestoreScenePrimaryBookmark;
	save(model: EditorTextModel): void;
};

/** An exact authored Scene with its own coordinated controls, not a retained document input. */
export class ScenePrimaryClient implements MainWorkspaceClient {
	public readonly view: SceneEditorViewState;
	public readonly control: SceneEditorControl;
	public readonly scope: InputFocusScope;
	private disposed = false;

	public constructor(public readonly consumer: SceneAuthoringContext, private readonly options: ScenePrimaryClientOptions) {
		this.scope = options.scope;
		this.view = new SceneEditorViewState(consumer);
		this.control = new SceneEditorControl(options.commands, options.sources, options.contextMenu,
			options.surfaces, options.owner, options.workArea, options.scope);
		this.control.focusTarget.registerCommand('save', {
			isEnabled: () => this.control.hasView && !consumer.workingCopy.readOnly,
			run: () => options.save(consumer.workingCopy),
		});
	}

	public serialize() { return { kind: 'scene' as const, value: JSON.stringify(captureScenePrimary(this.view)) }; }
	public onDidChange(listener: () => void): () => void { return this.view.onDidChange(listener); }
	public captureNavigationLocation(): ScenePrimaryNavigationLocation | undefined {
		const bookmark = new ScenePrimaryBookmark(this.consumer, this.view);
		if (bookmark.isDisposed) { bookmark.dispose(); return undefined; }
		return new ScenePrimaryNavigationLocation(bookmark, this.options.main, this.options.restoreNavigation);
	}

	public get commandTarget() { return this.control.focusTarget; }
	public get canOpenSource(): boolean { return !this.disposed && this.control.canOpenSource; }
	public captureSourceLocation() { return this.control.captureSourceLocation(); }
	public get minimumWidth(): number { return measureSceneEditorMinimumWidth(); }
	public isCurrent(): boolean { return !this.disposed && this.consumer.isCurrent && this.consumer.availability === 'available'; }
	public attach(bounds: Readonly<RectBounds>): void { this.control.setView(this.view, bounds); this.control.layout(bounds); }
	public detach(): void { if (this.control.hasView) this.control.clearView(); }
	public layout(bounds: Readonly<RectBounds>): void { this.control.layout(bounds); }
	public update(): void { this.control.update(); }
	public draw(): void { this.control.draw(); }
	public focus(): void { this.control.focus(); }
	public handlePointer(snapshot: PointerInputSnapshot): void {
		this.control.handlePointer(snapshot, (snapshot.justPressedButtons & PointerButton.Primary) !== 0,
			(snapshot.justPressedButtons & PointerButton.Secondary) !== 0, editorRuntimeState.currentTimeMs, false);
	}
	public handleWheel(event: WheelInputSnapshot): void { this.control.handleWheel(event); }
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void { this.control.drawStatusBar(bounds, color); }
	public dispose(): void {
		this.disposed = true;
		this.control.dispose(); this.view.dispose(); this.consumer.dispose();
	}
}

/** Source admission, shared by explicit navigation, history and session correspondence. */
export function createScenePrimaryClient(model: EditorTextModel, documents: SceneSourceDocuments, subject: SceneAuthoredSubject,
	options: ScenePrimaryClientOptions, view?: SceneEditorViewSnapshot): ScenePrimaryClient | undefined {
	const context = new SceneAuthoringContext(model, documents, subject);
	if (!context.isCurrent || context.availability !== 'available') { context.dispose(); return undefined; }
	const client = new ScenePrimaryClient(context, options);
	client.view.refresh();
	if (view !== undefined) restoreSceneEditorView(client.view, view);
	return client;
}
