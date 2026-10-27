import { create_rect_bounds, copy_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { InputFocusScope, inputFocus, type InputFocusTarget } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { editorRuntimeState } from '../../../editor/common/runtime_state';
import { editorViewState } from '../../../editor/ui/view/state';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../../../hosts/common/input/text';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { api } from '../../../runtime/overlay_api';
import * as colors from '../../../common/constants';
import type { EditorCommandRunner } from '../../../common/commands';
import { ActionPrompt } from '../../contrib/modal/action_prompt';
import { QuickInputController } from '../quick_input/controller';
import type { ContextMenuController } from '../context_menu/controller';
import type { WorkbenchSurfaceService } from '../windows/service';
import type { WorkbenchSurface } from '../windows/model';
import type { EditorTabStripRenderContext } from '../../render/tab_bar';
import { WorkbenchFloatingWindow } from '../../ui/window/control';
import { WorkbenchWindowModel } from '../../ui/window/model';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { RuntimeTimelineControl } from '../../ui/runtime_timeline_control';
import { EditorGroupView } from './editor_group';
import type { EditorPaneFactories } from './editor_panes';
import type { CloseEditors } from './editor_close';

type EditorPartOptions = {
	readonly surfaces: WorkbenchSurfaceService;
	readonly owner: WorkbenchSurface;
	readonly scope: InputFocusScope;
	readonly workArea: Readonly<RectBounds>;
	readonly commands: EditorCommandRunner;
	readonly contextMenu: ContextMenuController;
	readonly renderContext: EditorTabStripRenderContext;
	readonly factories: EditorPaneFactories;
	readonly closeEditors: CloseEditors;
	readonly focusReturn: InputFocusTarget;
	layoutMain(): void;
	onDidActivate(part: EditorPart): void;
	onDidChange(): void;
	requestClose(part: EditorPart): void;
} & ({ readonly kind: 'main' } | {
	readonly kind: 'document';
	readonly requestedBounds: Readonly<RectBounds>;
	readonly collapsed: boolean;
	readonly maximized: boolean;
});

/** One real editor container: controls and sessions live here, documents do not. */
export class EditorPart {
	public readonly group: EditorGroupView;
	public readonly scope: InputFocusScope;
	public readonly clientScope: InputFocusScope;
	public readonly focusTarget: InputFocusTarget;
	public readonly surface: WorkbenchSurface;
	public readonly clientSurface: WorkbenchSurface;
	public readonly window: WorkbenchFloatingWindow | undefined;
	public readonly clientBounds = create_rect_bounds();
	public readonly timelineBounds = create_rect_bounds();
	public readonly quickInput: QuickInputController;
	public readonly actionPrompt: ActionPrompt;
	public readonly timeline: RuntimeTimelineControl;
	public closing = false;
	public retired = false;
	private readonly bodyBounds = create_rect_bounds();
	private readonly tabBounds = create_rect_bounds();
	private readonly statusBounds = create_rect_bounds();
	private readonly modalClip = create_rect_bounds();
	private readonly quickInputSurface: WorkbenchSurface;
	private readonly promptSurface: WorkbenchSurface;
	private laidOutTimelineHeight = -1;
	private readonly subscriptions: (() => void)[] = [];
	private readonly tabLayoutContext = {
		get font() { return editorViewState.font.renderFont(); },
		get tabBarHeight() { return editorViewState.tabBarHeight; },
		get charAdvance() { return editorViewState.charAdvance; },
		measureText, measureTextRange,
	};

	public readonly kind: 'main' | 'document';
	public constructor(private readonly options: EditorPartOptions) {
		this.kind = options.kind;
		if (options.kind === 'document') {
			const model = new WorkbenchWindowModel(options.requestedBounds, 160, 96);
			model.open = true;
			model.setMaximized(options.maximized);
			model.setCollapsed(options.collapsed);
			this.window = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, options.surfaces, options.commands, {
				model, actionBar: createWorkbenchActionBar('window.title'), lifetimeOwner: options.owner, presentationParent: null,
				focusScope: options.scope, focusReturn: options.focusReturn, workArea: options.workArea,
				content: { draw: () => this.drawClient() },
				layoutContent: bounds => this.layoutDocument(bounds),
				retireContentInput: () => this.suspend(), restoreContentInput() {},
				focusContent: () => this.focus(), requestClose: () => options.requestClose(this),
			});
			this.window.attach();
			this.scope = this.window.scope;
			this.clientScope = this.window.clientScope;
			this.focusTarget = this.window.clientFocusTarget;
			this.surface = this.window.surface!;
			this.clientSurface = this.window.clientSurface!;
			this.subscriptions.push(model.onDidChangePlacement(options.onDidChange));
		} else {
			this.scope = new InputFocusScope(Symbol('main editor part'), options.scope);
			this.clientScope = this.scope;
			this.focusTarget = inputFocus.createTarget(options.focusReturn, this.scope);
			this.focusTarget.canFocus = () => !this.retired;
			this.subscriptions.push(this.focusTarget.bindKeyboard(input => {
				if (input.modifiers !== KeyModifier.none) return;
				if (isKeyJustPressed('Enter', input)) {
					consumeIdeKey('Enter', input); options.commands.execute('home', this.focusTarget);
				} else if (isKeyJustPressed('Escape', input)) {
					consumeIdeKey('Escape', input); options.focusReturn.focus();
				}
			}));
			this.surface = this.clientSurface = options.surfaces.attach({
				role: 'content', lifetimeOwner: options.owner, presentationParent: options.owner, captureScope: this.scope.surfaceScope,
				isVisible: () => true, getBounds: () => this.clientBounds, getClip: () => options.owner.getClip(),
				draw() {}, handlePointer: snapshot => { if (snapshot.justPressedButtons !== 0) this.focus(); },
				onRetire: () => pointerCapture.cancelScope(this.scope.surfaceScope),
			});
		}
		this.scope.commands = options.commands;
		this.group = new EditorGroupView(options.factories, options.commands,
			(targets, origin) => options.closeEditors(targets, origin, this.actionPrompt), {
				surfaces: options.surfaces, owner: this.clientSurface, focusScope: this.clientScope,
				workArea: options.workArea, renderContext: options.renderContext,
			});
		this.subscriptions.push(this.focusTarget.onDidFocus(() => this.group.panes.activePane?.focus()));
		const presentation = { scope: this.scope, bounds: this.clientBounds, kind: 'part' as const };
		this.quickInput = new QuickInputController(options.contextMenu, () => options.surfaces.changed(),
			next => next !== null && options.surfaces.isInContext(next.scope.surfaceScope, this.quickInput.pointerScope),
			{ ...presentation, reveal: () => this.reveal(this.quickInputSurface) });
		this.actionPrompt = new ActionPrompt(inputFocus, pointerCapture, () => options.surfaces.changed(),
			next => next !== null && options.surfaces.isInContext(next.scope.surfaceScope, this.actionPrompt.pointerScope),
			{ ...presentation, reveal: () => this.reveal(this.promptSurface) });
		this.quickInputSurface = options.surfaces.attach({ role: 'modal', blockedScope: this.surface,
			presentationParent: this.kind === 'main' ? options.owner : this.surface, captureScope: this.quickInput.pointerScope,
			lifetimeOwner: this.clientSurface, isVisible: () => this.quickInput.visible,
			getBounds: () => this.quickInput.layout.bounds, getClip: () => this.kind === 'document' ? this.window!.model.bounds : this.modalClip,
			draw: () => this.quickInput.draw(), handlePointer: snapshot => this.quickInput.handlePointer(snapshot, (snapshot.justPressedButtons & PointerButton.Primary) !== 0),
			handleWheel: event => { this.quickInput.handleWheel(event.deltaY); return true; },
			onRetire: () => this.quickInput.hide(false),
		});
		this.promptSurface = options.surfaces.attach({ role: 'modal', blockedScope: this.surface,
			presentationParent: this.kind === 'main' ? options.owner : this.surface, captureScope: this.actionPrompt.pointerScope,
			lifetimeOwner: this.clientSurface, isVisible: () => this.actionPrompt.visible,
			getBounds: () => this.actionPrompt.view.bounds, getClip: () => this.kind === 'document' ? this.window!.model.bounds : this.modalClip,
			draw: () => this.actionPrompt.draw(), handlePointer: snapshot => this.actionPrompt.handlePointer(snapshot),
			onRetire: () => this.actionPrompt.close('cancel', false),
		});
		this.timeline = new RuntimeTimelineControl(options.commands, () => this.focus(), this.focusTarget, this.timelineBounds);
		this.timeline.attach(options.surfaces, this.clientSurface, options.workArea, options.contextMenu);
		options.surfaces.attach({ role: 'content', lifetimeOwner: this.clientSurface, presentationParent: this.clientSurface,
			captureScope: this.timeline.focusScope.surfaceScope, isVisible: () => this.timeline.visible,
			getBounds: () => this.timelineBounds, getClip: () => this.kind === 'document' ? this.window!.model.client : options.workArea,
			draw: () => this.timeline.draw(), handlePointer: snapshot => { this.timeline.handlePointer(snapshot); },
			handleWheel: () => true, onRetire: () => pointerCapture.cancelScope(this.timeline.focusScope.surfaceScope),
		});
		this.subscriptions.push(this.group.model.onDidChange(() => {
			if (this.window !== undefined) {
				this.window.model.title = this.group.model.activeTab?.title ?? 'Editor';
			}
			options.onDidChange();
		}), this.group.panes.onDidClearEditor(options.onDidChange), this.group.panes.onWillShowEditor(openOptions => {
			if (this.window === undefined) options.layoutMain();
			else {
				if (!openOptions.preserveFocus) this.window.setCollapsed(false);
				const arranged = this.window.layout(editorViewState.font.renderFont(), measureTextRange, measureText);
				if (!arranged && !this.window.model.collapsed) this.layoutDocument(this.window.model.client);
			}
		}));
		this.subscriptions.push(inputFocus.onDidChangeTarget(() => {
			const target = inputFocus.target;
			if (target !== null && this.scope.contains(target.scope)) options.onDidActivate(this);
		}));
		this.subscriptions.push(inputFocus.onDidActivateInteraction(target => {
			const runtime = target.scope.runtimeOwner?.runtime;
			if (runtime !== undefined && this.scope.contains(target.scope)) this.timeline.setContext(runtime);
		}));
		this.window?.layout(editorViewState.font.renderFont(), measureTextRange, measureText);
	}

	public focus(): void {
		this.reveal(null);
		this.options.onDidActivate(this);
		if (this.actionPrompt.visible && this.options.surfaces.isAdmitted(this.promptSurface)) {
			this.options.surfaces.raise(this.promptSurface); this.actionPrompt.focusTarget.focus();
		} else if (this.quickInput.visible && this.options.surfaces.isAdmitted(this.quickInputSurface)) {
			this.options.surfaces.raise(this.quickInputSurface); this.quickInput.field.focusTarget.focus();
		} else {
			const pane = this.group.panes.activePane;
			if (pane === null) this.focusTarget.focus(); else pane.focus();
		}
	}

	/** Present local controls before their field can acquire native input or focus. */
	private reveal(modal: WorkbenchSurface | null): void {
		if (this.window === undefined) { this.options.layoutMain(); this.raise(); }
		else {
			this.window.setCollapsed(false);
			this.window.show(false);
			this.window.layout(editorViewState.font.renderFont(), measureTextRange, measureText);
		}
		if (modal !== null) this.options.surfaces.raise(modal);
	}

	public raise(): void {
		if (this.window === undefined) this.options.surfaces.raise(this.options.owner);
		else this.window.show(false);
	}

	public setClosing(closing: boolean): void {
		this.closing = closing;
		this.group.setOpenAdmission(!closing);
	}

	public layoutMain(body: Readonly<RectBounds>, timeline: Readonly<RectBounds>): void {
		copy_rect_bounds(this.clientBounds, body);
		write_rect_bounds(this.modalClip, 0, this.group.tabStrip.layoutState.bounds.top, this.group.workArea.right, this.group.workArea.bottom);
		copy_rect_bounds(this.timelineBounds, timeline);
		this.group.panes.layout(body);
	}

	private layoutDocument(bounds: Readonly<RectBounds>): void {
		copy_rect_bounds(this.clientBounds, bounds);
		const statusTop = Math.max(bounds.top, bounds.bottom - editorViewState.lineHeight - 4);
		const timelineTop = Math.max(bounds.top, statusTop - this.timeline.height);
		write_rect_bounds(this.statusBounds, bounds.left, statusTop, bounds.right, bounds.bottom);
		write_rect_bounds(this.timelineBounds, bounds.left, timelineTop, bounds.right, statusTop);
		write_rect_bounds(this.tabBounds, bounds.left, bounds.top, bounds.right, bounds.top);
		this.group.tabStrip.layout(this.tabBounds, this.tabLayoutContext);
		write_rect_bounds(this.bodyBounds, bounds.left, Math.min(timelineTop, bounds.top + this.group.tabStrip.layoutState.totalHeight + 2), bounds.right, timelineTop);
		this.group.panes.layout(this.bodyBounds);
		this.laidOutTimelineHeight = this.timeline.height;
	}

	private drawClient(): void {
		const bounds = this.clientBounds;
		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_FRAME);
		api.pushClipRect(this.statusBounds.left, this.statusBounds.top, this.statusBounds.right, this.statusBounds.bottom);
		api.fill_rect(this.statusBounds.left, this.statusBounds.top, this.statusBounds.right, this.statusBounds.bottom, 0, colors.COLOR_STATUS_BACKGROUND);
		this.group.panes.activePane?.drawStatusBar(this.statusBounds, colors.COLOR_STATUS_TEXT);
		api.popClipRect();
	}

	public update(deltaSeconds: number): void {
		if (this.window !== undefined) {
			this.group.tabStrip.update(editorRuntimeState.currentTimeMs);
			this.window.layout(editorViewState.font.renderFont(), measureTextRange, measureText);
			if (!this.window.model.collapsed) {
				if (this.group.tabStrip.needsLayout || this.laidOutTimelineHeight !== this.timeline.height) this.layoutDocument(this.window.model.client);
			}
			this.window.update();
		}
		this.timeline.update();
		this.group.panes.activePane?.update(deltaSeconds);
		this.quickInput.update(); this.actionPrompt.update();
	}

	/** Whole frontend suspension/collapse ends UI input, not document membership. */
	public suspend(): void {
		this.quickInput.hide(false); this.actionPrompt.close('cancel', false);
		pointerCapture.cancelScope(this.group.captureScope); pointerCapture.cancelScope(this.group.tabScope);
		this.scope.retireContext();
	}

	public dispose(): void {
		this.retired = true;
		for (const unbind of this.subscriptions) unbind();
		this.quickInput.dispose(); this.actionPrompt.dispose(); this.timeline.dispose();
		this.group.dispose();
		this.scope.retireContext();
		if (this.window === undefined) this.surface.dispose(); else this.window.dispose();
	}
}
