import type { EditorCommandRunner } from '../../../common/commands';
import type { EditorTextModel } from '../../../editor/model/text_model';
import type { FocusCommand, InputFocusScope } from '../../../input/focus';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { MainWorkspaceClient } from '../../main_workspace';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { EditorParts } from '../../services/editor/editor_parts';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import type { EditorNavigationController } from '../resources/navigation';
import { WORKBENCH_TEXT_EDITOR_ID } from '../code_editor/editor_input';
import type { SceneAuthoringContext } from './authoring_context';
import { SceneEditorViewState } from './view_state';
import { SceneEditorControl } from './control';
import { measureSceneEditorMinimumWidth } from './layout';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { editorRuntimeState } from '../../../editor/common/runtime_state';

/** An exact authored Scene with its own coordinated controls, not a retained document input. */
export class ScenePrimaryClient implements MainWorkspaceClient {
	public readonly view: SceneEditorViewState;
	public readonly control: SceneEditorControl;
	public readonly scope: InputFocusScope;
	private disposed = false;

	public constructor(public readonly consumer: SceneAuthoringContext, options: {
		readonly commands: EditorCommandRunner;
		readonly sources: RuntimeSourceState;
		readonly contextMenu: ContextMenuController;
		readonly surfaces: WorkbenchSurfaceService;
		readonly owner: WorkbenchSurface;
		readonly workArea: Readonly<RectBounds>;
		readonly scope: InputFocusScope;
		readonly navigation: EditorNavigationController;
		readonly parts: EditorParts;
		save(model: EditorTextModel): void;
	}) {
		this.scope = options.scope;
		this.view = new SceneEditorViewState(consumer);
		this.control = new SceneEditorControl(options.commands, options.sources, options.contextMenu,
			options.surfaces, options.owner, options.workArea, options.scope);
		for (const command of ['editor.source', 'editor.sourceToSide'] as const) {
			const action: FocusCommand = {
				isEnabled: () => this.control.hasView && consumer.getSourceLocation() !== undefined,
				run: () => {
					const intent = consumer.selectionRevision, generation = this.control.inputScope.contextGeneration;
					const location = consumer.getSourceLocation();
					if (location === undefined) return;
					const current = () => consumer.isCurrent && !this.disposed && this.control.hasView
						&& this.control.inputScope.contextGeneration === generation && consumer.selectionRevision === intent && location.model.version === location.modelVersion;
					if (!current()) return;
					const origin = options.parts.main.activeGroup;
					const target = command === 'editor.source' ? origin : options.parts.sideGroup(origin);
					if (target === undefined) return;
					void options.navigation.openResource(target, location.model.resource, {
						editorId: WORKBENCH_TEXT_EDITOR_ID, selection: location.selection === undefined ? undefined : { ...location.selection, generation: location },
						isCurrent: current,
					});
				},
				capture: () => {
					const intent = consumer.selectionRevision, generation = this.control.inputScope.contextGeneration;
					const current = () => !this.disposed && this.control.inputScope.contextGeneration === generation && consumer.selectionRevision === intent;
					return { isEnabled: () => current() && action.isEnabled(), run: () => { if (current()) action.run(); } };
				},
			};
			this.control.focusTarget.registerCommand(command, action);
		}
		this.control.focusTarget.registerCommand('save', {
			isEnabled: () => this.control.hasView && !consumer.workingCopy.readOnly,
			run: () => options.save(consumer.workingCopy),
		});
	}

	public get commandTarget() { return this.control.focusTarget; }
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
