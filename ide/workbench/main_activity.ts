import { copy_rect_bounds, create_rect_bounds, write_rect_bounds, type RectBounds } from '../../machine/ts/common/rect';
import type { EditorCommandId, EditorCommandRunner } from '../common/commands';
import { COLOR_FRAME, COLOR_HEADER_BUTTON_TEXT, COLOR_HEADER_BUTTON_TEXT_DISABLED } from '../common/constants';
import type { PointerInputSnapshot } from '../common/models';
import { editorViewState } from '../editor/ui/view/state';
import { measureText } from '../editor/common/text/layout';
import type { EditorFont } from '../editor/ui/view/font';
import { inputFocus, InputFocusScope, type InputFocusTarget } from '../input/focus';
import { pointerCapture } from '../input/pointer/capture';
import { pointerHover } from '../input/pointer/hover';
import { api } from '../runtime/overlay_api';
import { mainWorkspaceActivityHeaderHeight, type MainWorkspaceActivityClient, type MainWorkspaceActivityContext,
	type MainWorkspaceActivityDescriptor } from './common/main_workspace_activity';
import { renderWorkbenchActionBar } from './render/action_bar';
import type { ContextMenuController } from './services/context_menu/controller';
import type { WorkbenchSurface } from './services/windows/model';
import type { WorkbenchSurfaceService } from './services/windows/service';
import { createWorkbenchActionBar, layoutWorkbenchActionBar, WORKBENCH_ACTION_BAR_ITEM_SPACING,
	type WorkbenchActionBarState } from './ui/action_bar';
import { WorkbenchActionBarControl } from './ui/action_bar_control';
import { WorkbenchMenu } from './ui/menu/model';

type ActivityEntry = MainWorkspaceActivityDescriptor & { readonly client: MainWorkspaceActivityClient };

/** Retained activities, their native presentation lifetimes and the shared selector/header. */
export class MainWorkspaceActivityPart implements EditorCommandRunner {
	public readonly scope: InputFocusScope;
	public readonly surface: WorkbenchSurface;
	public readonly bounds = create_rect_bounds();
	public readonly headerBounds = create_rect_bounds();
	public readonly clientHeaderBounds = create_rect_bounds();
	public readonly commandTarget: InputFocusTarget;
	private readonly entries: ActivityEntry[] = [];
	private readonly selector: WorkbenchActionBarControl;
	private readonly hide: WorkbenchActionBarControl;
	private readonly boundary: InputFocusTarget;
	private readonly hideActions = createWorkbenchActionBar(new WorkbenchMenu([
		{ type: 'command', command: 'workspace.activity.hide', icon: 'close' },
	], undefined));
	private selectorActions: WorkbenchActionBarState | undefined;
	private selected: ActivityEntry | undefined;
	private attachedValue = false;
	private font: EditorFont | undefined;
	private selectionRevision = 0;
	private attachmentRevision = 0;

	public constructor(private readonly surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface, parent: InputFocusScope,
		focusReturn: InputFocusTarget, private readonly clip: Readonly<RectBounds>, contextMenu: ContextMenuController,
		private readonly open: (id: string) => boolean, private readonly hideActivity: () => boolean,
		private readonly enabled: () => boolean, private readonly onDidSelect: () => void) {
		this.scope = new InputFocusScope(Symbol('main activities'), parent);
		this.boundary = inputFocus.createTarget(focusReturn, this.scope);
		this.boundary.canFocus = () => this.attached;
		this.selector = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, this, this.boundary,
			() => { this.selected?.client.focus(); }, contextMenu);
		this.hide = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, this, this.boundary,
			() => { this.selected?.client.focus(); });
		this.commandTarget = this.selector.focusTarget;
		this.selector.focusTarget.next = this.hide.focusTarget;
		this.selector.focusTarget.previous = () => { this.selected?.client.focus(); };
		this.hide.focusTarget.previous = this.selector.focusTarget;
		this.hide.focusTarget.next = () => { this.selected?.client.focus(); };
		this.surface = surfaces.attach({ role: 'content', lifetimeOwner: owner, presentationParent: owner,
			captureScope: this.scope.surfaceScope, isVisible: () => this.attached,
			getBounds: () => this.bounds, getClip: () => this.clip,
			draw: () => api.fill_rect(this.bounds.left, this.bounds.top, this.bounds.right, this.bounds.bottom, 0, COLOR_FRAME),
			onRetire: () => this.retire(),
		});
	}

	public get attached(): boolean { return this.attachedValue; }
	public get client(): MainWorkspaceActivityClient | undefined { return this.selected?.client; }
	public get selectedId(): string | undefined { return this.selected?.id; }
	public get revision(): number { return this.selectionRevision; }

	/** Construction is explicit: registration creates a controller but never chooses or presents it. */
	public register<T extends MainWorkspaceActivityClient>(descriptor: MainWorkspaceActivityDescriptor,
		create: (context: MainWorkspaceActivityContext) => T): T {
		const scope = new InputFocusScope(Symbol(descriptor.id), this.scope);
		let client: T;
		const surface = this.surfaces.attach({ role: 'content', lifetimeOwner: this.surface, presentationParent: this.surface,
			captureScope: scope.surfaceScope, isVisible: () => this.selected !== undefined && this.selected.client === client && client.attached,
			getBounds: () => this.bounds, getClip: () => this.clip,
			draw: () => client.draw(), handlePointer: snapshot => client.handlePointer(snapshot),
			handleWheel: event => { client.handleWheel(event); return true; },
			onRetire: () => { scope.retireContext(); client.dispose(); pointerCapture.cancelScope(scope.surfaceScope); },
		});
		client = create({ surface, scope, focusReturn: this.commandTarget });
		this.entries.push({ ...descriptor, client });
		return client;
	}

	/** Complete the actual composition once, after every concrete controller has been assigned. */
	public initialize(initialId: string): void {
		const definitions = this.entries.map(entry => ({ type: 'command' as const, command: entry.command }));
		const menu = new WorkbenchMenu(definitions, undefined);
		menu.refresh(); this.hideActions.menu!.refresh();
		this.selectorActions = createWorkbenchActionBar(menu, true);
		// This header is above every client's full-width native body and domain header allocation.
		this.surfaces.attach({ role: 'content', lifetimeOwner: this.surface, presentationParent: this.surface,
			captureScope: Symbol('main activity header'), isVisible: () => this.attached,
			getBounds: () => this.headerBounds, getClip: () => this.clip,
			draw: () => {
				const font = editorViewState.font.renderFont();
				renderWorkbenchActionBar(this.selectorActions!, font, COLOR_HEADER_BUTTON_TEXT, COLOR_HEADER_BUTTON_TEXT_DISABLED);
				renderWorkbenchActionBar(this.hideActions, font, COLOR_HEADER_BUTTON_TEXT, COLOR_HEADER_BUTTON_TEXT_DISABLED);
			},
			handlePointer: snapshot => this.handleHeaderPointer(snapshot), handleWheel: () => true,
		});
		this.select(initialId);
	}

	public clientWithId(id: string): MainWorkspaceActivityClient {
		return this.entries.find(entry => entry.id === id)!.client;
	}
	public idForCommand(command: EditorCommandId): string | undefined {
		return this.entries.find(entry => entry.command === command)?.id;
	}
	public isTarget(target: InputFocusTarget | null): boolean {
		return target !== null && this.scope.contains(target.commandContext.scope);
	}
	public clientForTarget(target: InputFocusTarget): MainWorkspaceActivityClient | undefined {
		const client = this.client;
		return client?.scope.contains(target.commandContext.scope) ? client : undefined;
	}
	/** Main admits native departure before publishing a different selected activity. */
	public select(id: string): boolean {
		const entry = this.entries.find(candidate => candidate.id === id)!;
		if (this.selected === entry) return true;
		const previous = this.selected;
		this.selected = entry;
		const revision = ++this.selectionRevision;
		this.scope.statusSource = entry.client;
		entry.client.scope.statusSource = entry.client;
		if (previous !== undefined) { previous.client.scope.statusSource = undefined; previous.client.detach(); }
		if (revision !== this.selectionRevision) return false;
		for (const item of this.selectorActions!.items) item.checked = item.command === entry.command;
		this.onDidSelect();
		return revision === this.selectionRevision;
	}

	public layout(bounds: Readonly<RectBounds>): void {
		const geometryChanged = this.font !== editorViewState.font || this.bounds.left !== bounds.left || this.bounds.top !== bounds.top
			|| this.bounds.right !== bounds.right || this.bounds.bottom !== bounds.bottom;
		copy_rect_bounds(this.bounds, bounds); this.font = editorViewState.font;
		if (geometryChanged) this.layoutHeader();
		const client = this.client!;
		if (!this.attached) {
			const revision = ++this.attachmentRevision;
			this.attachedValue = true;
			this.selector.setInput(this.selectorActions!, this.commandTarget);
			if (revision !== this.attachmentRevision) return;
			this.hide.setInput(this.hideActions, this.commandTarget);
			if (revision !== this.attachmentRevision) return;
		}
		if (this.client !== client) return;
		if (client.attached) client.layout(this.bounds, this.clientHeaderBounds); else client.attach(this.bounds, this.clientHeaderBounds);
	}

	private layoutHeader(): void {
		const font = this.font!, height = mainWorkspaceActivityHeaderHeight(font), bounds = this.bounds;
		write_rect_bounds(this.headerBounds, bounds.left, bounds.top, bounds.right, Math.min(bounds.bottom, bounds.top + height));
		const padding = Math.min(2, (bounds.right - bounds.left) / 2), left = bounds.left + padding, right = bounds.right - padding;
		const verticalPadding = Math.min(1, (this.headerBounds.bottom - this.headerBounds.top) / 2);
		const top = bounds.top + verticalPadding, bottom = this.headerBounds.bottom - verticalPadding;
		const buttonWidth = Math.min(bottom - top, right - left);
		layoutWorkbenchActionBar(this.hideActions, right, top, bottom, measureText, font.renderFont(), Math.max(left, right - buttonWidth));
		const selector = this.selectorActions!, selectorRight = Math.max(left, this.hideActions.bounds.left - buttonWidth - 4);
		layoutWorkbenchActionBar(selector, selectorRight, top, bottom, measureText, font.renderFont(), left, 'start');
		const headerRight = Math.max(left, this.hideActions.bounds.left - WORKBENCH_ACTION_BAR_ITEM_SPACING);
		write_rect_bounds(this.clientHeaderBounds, Math.min(headerRight, selector.bounds.right + 4), this.headerBounds.top,
			headerRight, this.headerBounds.bottom);
	}

	public detach(): void {
		if (!this.attached) return;
		const revision = ++this.attachmentRevision;
		this.attachedValue = false;
		this.scope.retireContext();
		if (revision !== this.attachmentRevision) return;
		this.selector.clearInput();
		if (revision !== this.attachmentRevision) return;
		this.hide.clearInput();
		if (revision !== this.attachmentRevision) return;
		this.client?.detach();
		if (revision !== this.attachmentRevision) return;
		pointerCapture.cancelScope(this.scope.surfaceScope);
	}
	public update(): void {
		if (!this.attached) return;
		const revision = this.attachmentRevision;
		this.selector.update();
		if (revision !== this.attachmentRevision || !this.attached) return;
		this.hide.update();
		if (revision !== this.attachmentRevision || !this.attached) return;
		this.client!.update();
	}
	private handleHeaderPointer(snapshot: PointerInputSnapshot): void {
		if (!this.selector.handlePointer(snapshot) && !this.hide.handlePointer(snapshot)) this.client!.handlePointer(snapshot);
	}
	public isEnabled(command: EditorCommandId): boolean {
		return this.attached && this.enabled() && (command === 'workspace.activity.hide' || this.idForCommand(command) !== undefined);
	}
	public isActive(command: EditorCommandId): boolean { return this.selected?.command === command; }
	public execute(command: EditorCommandId): void {
		if (!this.isEnabled(command)) return;
		if (command === 'workspace.activity.hide') this.hideActivity();
		else this.open(this.idForCommand(command)!);
	}
	private retire(): void {
		this.detach(); this.selector.dispose(); this.hide.dispose();
	}
	public dispose(): void { this.surface.dispose(); }
}
