import { copy_rect_bounds, create_rect_bounds, type RectBounds } from '../../machine/ts/common/rect';
import type { EditorCommandRunner } from '../common/commands';
import { measureText, measureTextRange } from '../editor/common/text/layout';
import { editorViewState } from '../editor/ui/view/state';
import { inputFocus, type InputFocusScope, type InputFocusTarget } from '../input/focus';
import { pointerCapture } from '../input/pointer/capture';
import { pointerHover } from '../input/pointer/hover';
import type { WorkbenchViewSizeConstraints } from './common/layout';
import type { MainWorkspaceRegionClient, MainWorkspaceRegionId } from './common/main_workspace_client';
import type { MainWorkspaceRegionPlacement, MainWorkspaceRegionState } from './common/main_workspace_region';
import type { ContextMenuController } from './services/context_menu/controller';
import type { WorkbenchSurface } from './services/windows/model';
import type { WorkbenchSurfaceService } from './services/windows/service';
import { createWorkbenchActionBar } from './ui/action_bar';
import { WorkbenchCompositeMenu, WorkbenchMenu } from './ui/menu/model';
import { WORKBENCH_MENUS } from './ui/menu/registry';
import { WorkbenchFloatingWindow } from './ui/window/control';
import { WorkbenchWindowModel, WINDOW_HEADER_VERTICAL_PADDING, WINDOW_RESIZE_MARGIN } from './ui/window/model';

type MainRegionOptions = {
	readonly id: MainWorkspaceRegionId;
	readonly title: string;
	readonly owner: WorkbenchSurface;
	readonly presentationParent: WorkbenchSurface;
	readonly scope: InputFocusScope;
	readonly focusReturn: InputFocusTarget;
	readonly workArea: Readonly<RectBounds>;
	readonly commands: EditorCommandRunner;
	readonly contextMenu: ContextMenuController;
	readonly surfaces: WorkbenchSurfaceService;
	focus(): void;
	hide(): void;
	minimize(): void;
	changed(): void;
};

/** One Main region's native placement; its contribution retains the subject and content controls. */
export class MainWorkspaceRegionPart {
	public readonly surface: WorkbenchSurface;
	public readonly window: WorkbenchFloatingWindow;
	public readonly bounds = create_rect_bounds();
	public readonly clip = create_rect_bounds();
	public readonly actions: WorkbenchMenu<MainWorkspaceRegionPart>;
	private readonly constraints: WorkbenchViewSizeConstraints = { minimumWidth: 0, preferredWidth: 0, minimumHeight: 0 };
	private readonly windowActions = new WorkbenchMenu(WORKBENCH_MENUS['window.minimizable.context'], undefined);
	private windowMenu: WorkbenchCompositeMenu;
	private view: MainWorkspaceRegionClient | undefined;
	private placementValue: MainWorkspaceRegionPlacement = 'dockedMain';
	private visible = false;
	private stateRevision = 0;
	private readonly unbindPlacement: () => void;
	public get placement(): MainWorkspaceRegionPlacement { return this.placementValue; }
	public get client(): MainWorkspaceRegionClient | undefined { return this.view; }
	public get revision(): number { return this.stateRevision; }
	public get docked(): boolean { return this.placementValue === 'dockedMain'; }
	public get displayed(): boolean { return this.visible && this.view?.attached === true && (this.docked || this.window.visible); }

	public constructor(private readonly options: MainRegionOptions) {
		const { surfaces, owner, id } = options;
		this.surface = surfaces.attach({ role: 'content', lifetimeOwner: owner, presentationParent: owner,
			captureScope: Symbol(`main ${id}`), isVisible: () => this.view?.attached === true,
			getBounds: () => this.bounds, getClip: () => this.clip, draw() {},
			onRetire: () => pointerCapture.cancelScope(this.surface.captureScope),
		});
		this.actions = new WorkbenchMenu([
			{ type: 'command', command: id === 'hierarchy' ? 'workspace.hierarchy.float' : 'workspace.details.float', when: region => region.docked },
			{ type: 'command', command: id === 'hierarchy' ? 'workspace.hierarchy.dock' : 'workspace.details.dock', when: region => !region.docked },
		], this);
		this.windowMenu = new WorkbenchCompositeMenu([this.actions, this.windowActions]);
		const model = new WorkbenchWindowModel(undefined, 0, 0);
		model.title = options.title;
		const part = this;
		this.window = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, surfaces, options.commands, options.contextMenu, {
			model, actionBar: createWorkbenchActionBar('window.minimizable.title'),
			get contextMenu() { return part.windowMenu; },
			lifetimeOwner: owner, presentationParent: options.presentationParent, admissionParent: owner,
			focusScope: options.scope, focusReturn: options.focusReturn, workArea: options.workArea,
			getTitleTooltip: () => this.view!.description,
			content: { draw() {} }, layoutContent: bounds => this.layoutFloatingClient(bounds),
			retireContentInput: () => { if (!this.docked && (!this.visible || model.minimized)) this.view?.detach(); },
			restoreContentInput: () => this.layoutFloatingClient(model.client), focusContent: options.focus,
			requestClose: options.hide, requestMinimize: options.minimize,
		});
		this.unbindPlacement = model.onDidChangePlacement(() => { this.stateRevision++; options.changed(); });
	}

	/** Rebinding retires shell command authority, not the region's remembered placement. */
	public bind(view: MainWorkspaceRegionClient | undefined): void {
		if (this.view === view) return;
		this.view = view;
		this.window.model.description = view === undefined ? '' : `Main / ${view.description}`;
		this.window.focusTarget.commandContext = view === undefined ? this.window.focusTarget : view.commandTarget.commandContext;
		this.windowMenu = new WorkbenchCompositeMenu(view === undefined ? [this.actions, this.windowActions] : [view.contextActions, this.windowActions]);
		this.window.scope.retireContext();
		if (this.view === view) view?.setHeaderVisible(this.docked);
	}

	public isTarget(target: InputFocusTarget): boolean {
		return this.view?.scope.contains(target.scope) === true || this.window.scope.contains(target.scope);
	}

	/** Changing chrome preserves the content attachment, including a focused field's pending value. */
	public setPlacement(placement: MainWorkspaceRegionPlacement): void {
		if (placement === this.placementValue) return;
		this.placementValue = placement; this.stateRevision++;
		const view = this.view;
		view?.setHeaderVisible(this.docked);
		if (this.view !== view || this.placementValue !== placement) return;
		if (!this.docked && !this.window.model.placementInitialized && view !== undefined) {
			view.measure(editorViewState.font, this.constraints);
			const width = Math.max(this.constraints.minimumWidth, this.constraints.preferredWidth) + WINDOW_RESIZE_MARGIN * 2;
			const area = this.options.workArea, attached = view.attached;
			const left = attached ? this.bounds.left : this.options.id === 'hierarchy' ? area.left : area.right - width;
			const top = attached ? this.bounds.top : area.top;
			const height = attached ? this.bounds.bottom - this.bounds.top : area.bottom - area.top;
			this.window.model.setRequestedBounds({ left, top, right: left + width, bottom: top + height });
		}
	}

	/** Dock return moves the retained subtree before disposing the old shell's native children. */
	public layout(bounds: Readonly<RectBounds>, clip: Readonly<RectBounds>, visible: boolean): void {
		this.visible = visible;
		const view = this.view;
		if (this.docked || !visible || view === undefined) {
			copy_rect_bounds(this.bounds, bounds); copy_rect_bounds(this.clip, clip);
			if (this.surface.presentationParent !== this.options.owner) this.options.surfaces.reparent(this.surface, this.options.owner);
			if (this.view !== view) return;
			this.window.hide();
			if (this.view !== view) return;
			if (view !== undefined) {
				if (!visible) view.detach();
				else if (view.attached) view.layout(bounds); else view.attach(bounds);
			}
			return;
		}
		const window = this.window, font = editorViewState.font;
		view.measure(font, this.constraints);
		window.model.setMinimumSize(this.constraints.minimumWidth + WINDOW_RESIZE_MARGIN * 2,
			this.constraints.minimumHeight + font.lineHeight + WINDOW_HEADER_VERTICAL_PADDING + WINDOW_RESIZE_MARGIN);
		window.model.open = true;
		window.prepare();
		if (this.view !== view || this.docked || !this.visible) return;
		const arranged = window.layout(font.renderFont(), measureTextRange, measureText);
		if (this.view !== view || this.docked || !this.visible) return;
		if (window.model.minimized) view.detach();
		else if (!arranged) this.layoutFloatingClient(window.model.client);
		if (this.view === view && !this.docked && this.visible) window.attach();
	}

	private layoutFloatingClient(bounds: Readonly<RectBounds>): void {
		const view = this.view;
		if (view === undefined || this.docked || !this.visible || this.window.model.minimized) return;
		copy_rect_bounds(this.bounds, bounds); copy_rect_bounds(this.clip, bounds);
		if (this.surface.presentationParent !== this.window.clientSurface) this.options.surfaces.reparent(this.surface, this.window.clientSurface!);
		if (this.view !== view || this.docked || !this.visible) return;
		if (view.attached) view.layout(bounds); else view.attach(bounds);
	}

	public restore(state: MainWorkspaceRegionState): void {
		this.placementValue = state.placement; this.stateRevision++;
		if (state.window === undefined) this.window.model.requestDefaultPlacement(); else this.window.model.setState(state.window);
		this.view?.setHeaderVisible(this.docked);
	}
	/** Restore the named allocation, leaving this same content and its future floating default intact. */
	public resetLayout(): boolean {
		const view = this.view;
		this.placementValue = 'dockedMain'; this.stateRevision++;
		this.view?.setHeaderVisible(true);
		if (this.view !== view || !this.docked) return false;
		const generation = this.window.resetPlacement();
		return this.docked && this.window.model.placementGeneration === generation;
	}
	public serialize(previous?: MainWorkspaceRegionState): MainWorkspaceRegionState {
		const model = this.window.model, bounds = model.requestedBounds, prior = previous?.window;
		const window = !model.placementInitialized ? undefined : prior !== undefined && prior.placement === model.placement && prior.minimized === model.minimized
			&& prior.requestedBounds.left === bounds.left && prior.requestedBounds.top === bounds.top
			&& prior.requestedBounds.right === bounds.right && prior.requestedBounds.bottom === bounds.bottom
			? prior : { requestedBounds: { ...bounds }, placement: model.placement, minimized: model.minimized };
		return previous !== undefined && previous.placement === this.placementValue && previous.window === window ? previous : { placement: this.placementValue, window };
	}
	public update(): void { this.window.update(); }
	public suspend(): void { this.window.setPresented(false); }
	public resume(): void { this.window.setPresented(true); }
	public dispose(): void {
		if (this.surface.presentationParent !== this.options.owner) this.options.surfaces.reparent(this.surface, this.options.owner);
		this.unbindPlacement(); this.window.dispose();
	}
}
