import { create_rect_bounds, copy_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { InputFocusScope, inputFocus, type InputFocusTarget } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { editorViewState } from '../../../editor/ui/view/state';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
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
import { WorkbenchWindowModel, type WindowPlacement } from '../../ui/window/model';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchSplitControl } from '../../ui/split_control';
import { drawWorkbenchSplit } from '../../render/split_view';
import { Scrollbar } from '../../ui/scrollbar';
import { ScrollbarController } from '../../ui/scrollbar_controller';
import { EditorGroupView, findEditorGroup } from './editor_group';
import type { EditorPaneFactories } from './editor_panes';
import type { CloseEditors } from './editor_close';
import { EditorGroupArrangement, type EditorGroupDirection, type EditorGroupLayout, type EditorGroupSplit } from './group_arrangement';
import type { SerializedEditorPart, SerializedEditorGroupLayout } from './editor_parts_serialization';
import type { EditorInputSerializers } from './editor_serialization';

type EditorPartOptions = {
	readonly initialOperation: 'none' | 'move';
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
	requestMinimize(part: EditorPart): void;
	readonly requestedBounds: Readonly<RectBounds>;
	readonly minimized: boolean;
	readonly placement: WindowPlacement;
});

type Sash = { readonly control: WorkbenchSplitControl; readonly surface: WorkbenchSurface };
const SCROLLBARS = ['horizontal', 'vertical'] as const;

/** One editor host owns its real group arrangement, not a tool-specific primary group. */
export class EditorPart {
	public readonly scope: InputFocusScope;
	public readonly clientScope: InputFocusScope;
	public readonly focusTarget: InputFocusTarget;
	public readonly surface: WorkbenchSurface;
	public readonly clientSurface: WorkbenchSurface;
	public readonly window: WorkbenchFloatingWindow | undefined;
	public readonly clientBounds = create_rect_bounds();
	public readonly arrangement: EditorGroupArrangement<EditorGroupView>;
	public readonly quickInput: QuickInputController;
	public readonly actionPrompt: ActionPrompt;
	public activeGroup: EditorGroupView;
	public get groups(): readonly EditorGroupView[] { return this.arrangement.groups; }
	private readonly groupMru: EditorGroupView[] = [];
	public get mostRecentlyActiveGroups(): readonly EditorGroupView[] { return this.groupMru; }
	private readonly groupListeners = new Set<() => void>();
	private restoreLifetime: AbortController | undefined;
	private operationValue: 'none' | 'close' | 'move';
	public get operation(): 'none' | 'close' | 'move' { return this.operationValue; }
	public get closing(): boolean { return this.operationValue === 'close'; }
	public retired = false;
	private presentedLayoutRevision = -1;
	private readonly viewport = create_rect_bounds();
	private readonly horizontalTrack = create_rect_bounds();
	private readonly verticalTrack = create_rect_bounds();
	private readonly scrollbars = { horizontal: new Scrollbar('horizontal'), vertical: new Scrollbar('vertical') };
	private readonly scrollbarControl: ScrollbarController<'horizontal' | 'vertical'>;
	private readonly sashes = new Map<EditorGroupSplit<EditorGroupView>, Sash>();
	private readonly groupSubscriptions = new Map<EditorGroupView, readonly (() => void)[]>();
	private readonly quickInputSurface: WorkbenchSurface;
	private readonly promptSurface: WorkbenchSurface;
	private readonly subscriptions: (() => void)[] = [];
	public readonly kind: 'main' | 'document';

	public constructor(private readonly options: EditorPartOptions) {
		this.operationValue = options.initialOperation;
		this.kind = options.kind;
		if (options.kind === 'document') {
			const model = new WorkbenchWindowModel(options.requestedBounds, 0, 0);
			model.open = true; model.setPlacement(options.placement); model.setMinimized(options.minimized);
			this.window = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, options.surfaces, options.commands, {
				model, actionBar: createWorkbenchActionBar('window.title'), lifetimeOwner: options.owner, presentationParent: null,
				focusScope: options.scope, focusReturn: options.focusReturn, workArea: options.workArea,
				content: { draw: () => this.drawClient() }, layoutContent: bounds => this.layout(bounds),
				retireContentInput: () => this.suspend(), restoreContentInput() {}, focusContent: () => this.focus(),
				requestClose: () => options.requestClose(this), requestMinimize: () => options.requestMinimize(this),
			});
			this.window.attach(); this.scope = this.window.scope; this.clientScope = this.window.clientScope;
			this.focusTarget = this.window.clientFocusTarget; this.surface = this.window.surface!; this.clientSurface = this.window.clientSurface!;
			this.subscriptions.push(model.onDidChangePlacement(options.onDidChange));
		} else {
			this.scope = new InputFocusScope(Symbol('main editor host'), options.scope); this.clientScope = this.scope;
			this.focusTarget = inputFocus.createTarget(options.focusReturn, this.scope);
			this.focusTarget.canFocus = () => !this.retired;
			this.surface = this.clientSurface = options.surfaces.attach({
				role: 'window', lifetimeOwner: options.owner, presentationParent: null, captureScope: this.scope.surfaceScope,
				isVisible: () => true, getBounds: () => this.clientBounds, getClip: () => options.workArea,
				draw: () => this.drawClient(), handlePointer: snapshot => { if (snapshot.justPressedButtons !== 0) this.focus(); },
				onRetire: () => pointerCapture.cancelScope(this.scope.surfaceScope),
			});
		}
		this.scope.commands = options.commands;
		const first = this.makeGroup();
		this.arrangement = new EditorGroupArrangement(first); this.activeGroup = first; this.groupMru.push(first);
		this.subscriptions.push(this.focusTarget.onDidFocus(() => this.activeGroup.focus()));
		const presentation = { scope: this.scope, bounds: this.clientBounds, kind: 'part' as const };
		this.quickInput = new QuickInputController(options.contextMenu, () => options.surfaces.changed(),
			next => next !== null && options.surfaces.isInContext(next.scope.surfaceScope, this.quickInput.pointerScope),
			{ ...presentation, reveal: () => this.reveal(this.quickInputSurface) });
		this.actionPrompt = new ActionPrompt(inputFocus, pointerCapture, () => options.surfaces.changed(),
			next => next !== null && options.surfaces.isInContext(next.scope.surfaceScope, this.actionPrompt.pointerScope),
			{ ...presentation, reveal: () => this.reveal(this.promptSurface), shouldRevealOnShow: () => this.window?.model.minimized === true });
		this.quickInputSurface = options.surfaces.attach({ role: 'modal', blockedScope: this.surface,
			presentationParent: this.surface, captureScope: this.quickInput.pointerScope, lifetimeOwner: this.clientSurface,
			isVisible: () => this.quickInput.visible, getBounds: () => this.quickInput.layout.bounds, getClip: () => this.clientBounds,
			draw: () => this.quickInput.draw(), handlePointer: snapshot => this.quickInput.handlePointer(snapshot, (snapshot.justPressedButtons & PointerButton.Primary) !== 0),
			handleWheel: event => { this.quickInput.handleWheel(event.deltaY); return true; }, onRetire: () => this.quickInput.hide(false),
		});
		this.promptSurface = options.surfaces.attach({ role: 'modal', blockedScope: this.surface,
			presentationParent: this.surface, captureScope: this.actionPrompt.pointerScope, lifetimeOwner: this.clientSurface,
			isVisible: () => this.actionPrompt.visible, getBounds: () => this.actionPrompt.view.bounds, getClip: () => this.clientBounds,
			draw: () => this.actionPrompt.draw(), handlePointer: snapshot => this.actionPrompt.handlePointer(snapshot),
			onRetire: () => this.actionPrompt.close('cancel', false),
		});
		this.scrollbarControl = new ScrollbarController(this.scrollbars, (kind, scroll) => {
			this.arrangement.setScroll(kind === 'horizontal' ? scroll : this.arrangement.scrollX,
				kind === 'vertical' ? scroll : this.arrangement.scrollY); this.layout(this.clientBounds);
		}, pointerCapture);
		for (const kind of SCROLLBARS) {
			const bar = this.scrollbars[kind];
			options.surfaces.attach({ role: 'content', lifetimeOwner: this.clientSurface, presentationParent: this.clientSurface,
				captureScope: Symbol(`editor arrangement ${kind}`), isVisible: () => bar.isVisible(), getBounds: () => bar.getTrack(), getClip: () => this.clientBounds,
				draw: () => bar.draw(colors.COLOR_FRAME, colors.SCROLLBAR_THUMB_COLOR),
				handlePointer: snapshot => { this.scrollbarControl.begin(SCROLLBARS, snapshot, 0); }, handleWheel: () => true,
				onRetire: () => this.scrollbarControl.cancel(),
			});
		}
		this.subscriptions.push(inputFocus.onDidActivateInteraction(target => {
			if (this.scope.contains(target.scope)) {
				const group = findEditorGroup(target);
				if (group !== undefined && group !== null && this.groupSubscriptions.has(group) && !this.activateGroup(group)) return;
				options.onDidActivate(this);
			}
		}));
		this.window?.layout(editorViewState.font.renderFont(), measureTextRange, measureText);
	}

	public onDidChangeGroups(listener: () => void): () => void { this.groupListeners.add(listener); return () => this.groupListeners.delete(listener); }
	private makeGroup(): EditorGroupView {
		const group = new EditorGroupView(this.options.factories, this.options.commands,
			(targets, origin) => this.options.closeEditors(targets, origin, this.actionPrompt), {
				surfaces: this.options.surfaces, owner: this.clientSurface, focusScope: this.clientScope,
				workArea: this.options.workArea, renderContext: this.options.renderContext, contextMenu: this.options.contextMenu,
				layout: () => { if (!this.retired) this.layout(this.clientBounds); },
			});
		group.setOpenAdmission(this.operationValue === 'none');
		this.groupSubscriptions.set(group, [group.onWillFocus(() => this.prepareGroupFocus(group)), group.model.onDidChange(() => {
			if (this.restoreLifetime !== undefined && this.groups.includes(group)) this.restoreLifetime.abort();
			if (group === this.activeGroup && this.window !== undefined) this.window.model.title = group.model.activeTab?.title ?? 'Editor';
			this.options.onDidChange();
		}), group.panes.onDidClearEditor(this.options.onDidChange), group.panes.onWillShowEditor(openOptions => {
			if (!openOptions.preserveFocus) {
				const focusRevision = inputFocus.revision;
				if (!this.activateGroup(group) || inputFocus.revision !== focusRevision && inputFocus.target !== null) return;
				this.arrangement.reveal(group); this.reveal(null);
			}
			else this.layout(this.clientBounds);
		})]);
		return group;
	}

	public splitGroup(reference: EditorGroupView, direction: EditorGroupDirection): EditorGroupView {
		this.restoreLifetime?.abort();
		const group = this.makeGroup(); this.arrangement.split(reference, group, direction); this.groupMru.push(group);
		this.syncSashes(); for (const listener of this.groupListeners) listener();
		this.layout(this.clientBounds); this.options.onDidChange(); return group;
	}
	public activateGroup(group: EditorGroupView): boolean {
		if (this.retired || !group.openingAdmitted || !this.groups.includes(group)) return false;
		if (this.activeGroup === group) return true;
		const generation = group.panes.openGeneration;
		this.activeGroup = group; this.groupMru.splice(this.groupMru.indexOf(group), 1); this.groupMru.unshift(group);
		if (this.window !== undefined) this.window.model.title = group.model.activeTab?.title ?? 'Editor';
		this.options.onDidChange();
		return !this.retired && group.openingAdmitted && this.activeGroup === group && group.panes.openGeneration === generation;
	}
	private prepareGroupFocus(group: EditorGroupView): boolean {
		if (this.retired) return false;
		const focusRevision = inputFocus.revision;
		if (!this.activateGroup(group) || inputFocus.revision !== focusRevision && inputFocus.target !== null) return false;
		this.arrangement.reveal(group);
		if (!this.reveal(null)) return false;
		this.options.onDidActivate(this);
		return !this.retired && (inputFocus.revision === focusRevision || inputFocus.target === null);
	}
	public focus(): boolean {
		if (this.retired) return false;
		const focusRevision = inputFocus.revision, group = this.activeGroup;
		if (!this.reveal(null)) return false;
		this.options.onDidActivate(this);
		if (this.retired || this.activeGroup !== group || inputFocus.revision !== focusRevision && inputFocus.target !== null) return false;
		if (this.actionPrompt.visible && this.options.surfaces.isAdmitted(this.promptSurface)) {
			this.options.surfaces.raise(this.promptSurface); this.actionPrompt.focusTarget.focus();
		} else if (this.quickInput.visible && this.options.surfaces.isAdmitted(this.quickInputSurface)) {
			this.options.surfaces.raise(this.quickInputSurface); this.quickInput.field.focusTarget.focus();
		} else return group.focus();
		return inputFocus.target !== null && this.scope.contains(inputFocus.target.scope);
	}
	private reveal(modal: WorkbenchSurface | null): boolean {
		const focusRevision = inputFocus.revision;
		if (this.window === undefined) this.options.layoutMain();
		else this.window.show(false);
		if (this.retired || inputFocus.revision !== focusRevision && inputFocus.target !== null) return false;
		this.window?.layout(editorViewState.font.renderFont(), measureTextRange, measureText);
		this.layout(this.clientBounds);
		if (this.retired || inputFocus.revision !== focusRevision && inputFocus.target !== null) return false;
		this.raise();
		if (modal !== null) this.options.surfaces.raise(modal);
		return !this.retired && (inputFocus.revision === focusRevision || inputFocus.target === null);
	}

	public raise(): void { this.options.surfaces.raise(this.surface); }
	public setOperation(operation: 'none' | 'close' | 'move'): void {
		if (operation !== 'none') this.restoreLifetime?.abort();
		this.operationValue = operation; for (const group of this.groups) group.setOpenAdmission(operation === 'none' && !this.surface.retired);
	}
	private syncSashes(): void {
		for (const [branch, sash] of this.sashes) if (!this.arrangement.splits.includes(branch)) {
			sash.surface.dispose(); sash.control.dispose(); this.sashes.delete(branch);
		}
		for (const branch of this.arrangement.splits) if (!this.sashes.has(branch)) {
			const control = new WorkbenchSplitControl(inputFocus, pointerCapture, pointerHover, this.focusTarget,
				new InputFocusScope(Symbol('editor group sash'), this.clientScope)); control.setInput(branch.split);
			const surface = this.options.surfaces.attach({ role: 'content', lifetimeOwner: this.clientSurface, presentationParent: this.clientSurface,
				captureScope: control.focusTarget.scope.surfaceScope, isVisible: () => branch.visible && branch.resizable,
				getBounds: () => branch.sashBounds, getClip: () => branch.clip,
				draw: () => drawWorkbenchSplit(branch.split, control.hovered || control.focusTarget.hasFocus),
				handlePointer: snapshot => { control.handlePointer(snapshot); }, handleWheel: () => true, onRetire: () => control.clearInput(),
			});
			this.sashes.set(branch, { control, surface });
		}
	}
	public layout(bounds: Readonly<RectBounds>): void {
		copy_rect_bounds(this.clientBounds, bounds);
		for (const group of this.groups) this.arrangement.setMinimum(group, group.minimumWidth, group.minimumHeight);
		const minimumWidth = this.arrangement.minimumWidth, minimumHeight = this.arrangement.minimumHeight;
		const width = bounds.right - bounds.left, height = bounds.bottom - bounds.top, size = colors.SCROLLBAR_WIDTH;
		let horizontal = minimumWidth > width, vertical = minimumHeight > height;
		if (horizontal && minimumHeight > height - size) vertical = true;
		if (vertical && minimumWidth > width - size) horizontal = true;
		write_rect_bounds(this.viewport, bounds.left, bounds.top, Math.max(bounds.left, bounds.right - (vertical ? size : 0)), Math.max(bounds.top, bounds.bottom - (horizontal ? size : 0)));
		this.arrangement.layout(this.viewport);
		const changed = this.presentedLayoutRevision !== this.arrangement.layoutRevision;
		this.presentedLayoutRevision = this.arrangement.layoutRevision;
		write_rect_bounds(this.horizontalTrack, this.viewport.left, this.viewport.bottom, this.viewport.right, bounds.bottom);
		write_rect_bounds(this.verticalTrack, this.viewport.right, this.viewport.top, bounds.right, this.viewport.bottom);
		this.scrollbars.horizontal.layout(this.horizontalTrack, this.arrangement.contentWidth, this.viewport.right - this.viewport.left, this.arrangement.scrollX);
		this.scrollbars.vertical.layout(this.verticalTrack, this.arrangement.contentHeight, this.viewport.bottom - this.viewport.top, this.arrangement.scrollY);
		for (const leaf of this.arrangement.leaves) {
			const presented = this.arrangement.maximized === undefined || this.arrangement.maximized === leaf.group;
			if (changed || leaf.group.tabStrip.needsLayout || leaf.group.presented !== presented) leaf.group.layout(leaf.bounds, leaf.clip, presented);
		}
		if (changed) this.options.surfaces.changed();
	}
	private drawClient(): void { api.fill_rect(this.clientBounds.left, this.clientBounds.top, this.clientBounds.right, this.clientBounds.bottom, 0, colors.COLOR_FRAME); }
	public update(deltaSeconds: number): void {
		if (this.window !== undefined) { this.window.layout(editorViewState.font.renderFont(), measureTextRange, measureText); this.window.update(); }
		for (const group of this.groups) group.update(deltaSeconds);
		this.layout(this.clientBounds); this.quickInput.update(); this.actionPrompt.update();
	}
	public suspend(): void {
		this.scrollbarControl.cancel();
		this.quickInput.hide(false); this.actionPrompt.close('cancel', false);
		for (const group of this.groups) { pointerCapture.cancelScope(group.captureScope); pointerCapture.cancelScope(group.tabScope); }
		this.scope.retireContext();
	}
	public clear(): void {
		this.restoreLifetime?.abort();
		const retained = this.groups[0];
		for (const [group, subscriptions] of this.groupSubscriptions) {
			if (group === retained) group.clear();
			else {
				for (const unbind of subscriptions) unbind();
				this.groupSubscriptions.delete(group); group.dispose();
			}
		}
		this.arrangement.setRoot({ kind: 'group', group: retained }); this.groupMru.length = 0; this.groupMru.push(retained); this.activeGroup = retained;
		for (const listener of this.groupListeners) listener();
		this.syncSashes(); this.layout(this.clientBounds); this.options.onDidChange();
	}
	public async restore(state: SerializedEditorPart, serializers: EditorInputSerializers): Promise<boolean> {
		if (this.retired) return false;
		this.restoreLifetime?.abort();
		const lifetime = new AbortController(); this.restoreLifetime = lifetime;
		const candidates: EditorGroupView[] = [], retired: EditorGroupView[] = [];
		let published = false;
		const restore = async (node: SerializedEditorGroupLayout): Promise<EditorGroupLayout<EditorGroupView> | undefined> => {
			if (lifetime.signal.aborted) return undefined;
			if (node.kind === 'group') {
				const group = this.makeGroup(); group.presented = false; candidates.push(group);
				if (!await group.model.deserialize(node.group, serializers, lifetime.signal)) return undefined;
				return { kind: 'group', group };
			}
			const firstChild = await restore(node.first);
			if (firstChild === undefined) return undefined;
			const secondChild = await restore(node.second);
			if (secondChild === undefined) return undefined;
			return { kind: 'split', orientation: node.orientation, ratio: node.ratio, first: firstChild, second: secondChild };
		};
		try {
			const layout = await restore(state.layout);
			if (layout === undefined || lifetime.signal.aborted) return false;
			for (const group of this.groups) {
				retired.push(group); group.setOpenAdmission(false);
				for (const unbind of this.groupSubscriptions.get(group)!) unbind();
				this.groupSubscriptions.delete(group);
			}
			this.arrangement.setRoot(layout); published = true; this.groupMru.length = 0;
			for (const index of state.mru) this.groupMru.push(this.groups[index]);
			this.activeGroup = this.groups[state.active];
			for (const listener of this.groupListeners) listener();
			if (lifetime.signal.aborted) return false;
			this.syncSashes();
			if (lifetime.signal.aborted) return false;
			this.layout(this.clientBounds);
			if (lifetime.signal.aborted) return false;
			this.arrangement.setScroll(state.scrollX, state.scrollY); this.layout(this.clientBounds);
			if (lifetime.signal.aborted) return false;
			if (state.maximized !== undefined) {
				this.arrangement.toggleMaximize(this.groups[state.maximized.group]); this.layout(this.clientBounds);
				if (lifetime.signal.aborted) return false;
				this.arrangement.setScroll(state.maximized.scrollX, state.maximized.scrollY); this.layout(this.clientBounds);
			}
		} finally {
			for (const group of retired) group.dispose();
			if (!published) for (const group of candidates) {
				const subscriptions = this.groupSubscriptions.get(group);
				if (subscriptions === undefined) continue; // The part's retirement already released this provisional group.
				for (const unbind of subscriptions) unbind();
				this.groupSubscriptions.delete(group); group.dispose();
			}
			if (published && !lifetime.signal.aborted) this.options.onDidChange();
			if (this.restoreLifetime === lifetime) this.restoreLifetime = undefined;
		}
		return !lifetime.signal.aborted;
	}
	public dispose(): void {
		this.restoreLifetime?.abort(); this.retired = true; this.scrollbarControl.cancel();
		for (const unbind of this.subscriptions) unbind();
		this.quickInput.dispose(); this.actionPrompt.dispose();
		for (const sash of this.sashes.values()) { sash.surface.dispose(); sash.control.dispose(); } this.sashes.clear();
		for (const [group, subscriptions] of this.groupSubscriptions) { for (const unbind of subscriptions) unbind(); group.dispose(); }
		this.groupSubscriptions.clear(); this.groupListeners.clear(); this.scope.retireContext();
		if (this.window === undefined) this.surface.dispose(); else this.window.dispose();
	}
}
