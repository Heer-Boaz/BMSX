import { copy_rect_bounds, create_rect_bounds, clear_rect_bounds, write_rect_bounds, type RectBounds } from '../../machine/ts/common/rect';
import { COLOR_FRAME, SCROLLBAR_WIDTH, SCROLLBAR_THUMB_COLOR } from '../common/constants';
import type { EditorCommandRunner } from '../common/commands';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../common/models';
import { InputFocusScope, inputFocus, type InputFocusTarget } from '../input/focus';
import { pointerCapture } from '../input/pointer/capture';
import { pointerHover } from '../input/pointer/hover';
import { api } from '../runtime/overlay_api';
import { ActionPrompt } from './contrib/modal/action_prompt';
import type { EditorCloseController, WorkingCopyConsumer } from './services/editor/editor_close';
import { editorGroupChromeMinimumWidth } from './services/editor/editor_group';
import type { WorkbenchSurface } from './services/windows/model';
import type { WorkbenchSurfaceService } from './services/windows/service';
import { WorkbenchSplitView, WORKBENCH_SPLIT_SIZE } from './ui/split_view';
import { WorkbenchSplitControl } from './ui/split_control';
import { drawWorkbenchSplit } from './render/split_view';
import { Scrollbar } from './ui/scrollbar';
import { ScrollbarController } from './ui/scrollbar_controller';
import { beginNavigationCapture, completeNavigation, NavigationHistoryEntry, navigationState, type PrimaryNavigationLocation } from '../navigation/navigation_history';
import type { SerializedMainWorkspace, SerializedPrimaryClient } from './common/main_workspace_serialization';

/** A contribution owns its subject, editing context and concrete controls, not a document tab. */
export interface MainWorkspaceClient {
	readonly consumer: WorkingCopyConsumer;
	readonly scope: InputFocusScope;
	readonly commandTarget: InputFocusTarget;
	readonly minimumWidth: number;
	serialize(): SerializedPrimaryClient;
	onDidChange(listener: () => void): () => void;
	captureNavigationLocation(): PrimaryNavigationLocation | undefined;
	isCurrent(): boolean;
	attach(bounds: Readonly<RectBounds>): void;
	detach(): void;
	layout(bounds: Readonly<RectBounds>): void;
	update(): void;
	draw(): void;
	focus(): void;
	handlePointer(snapshot: PointerInputSnapshot): void;
	handleWheel(event: WheelInputSnapshot): void;
	drawStatusBar(bounds: Readonly<RectBounds>, color: number): void;
	dispose(): void;
}

export type MainWorkspaceClientFactory = (surface: WorkbenchSurface, scope: InputFocusScope) => MainWorkspaceClient | undefined;
export type MainWorkspaceOpenOptions = { readonly recordNavigation?: boolean; readonly preserveFocus?: boolean; readonly isCurrent?: () => boolean };
export type MainWorkspaceRestoreFactory = (record: SerializedPrimaryClient, surface: WorkbenchSurface, scope: InputFocusScope,
	isCurrent: () => boolean) => Promise<MainWorkspaceClient | undefined>;
export type MainWorkspaceRestoreRequest = {
	isCurrent(): boolean;
	restore(state: SerializedMainWorkspace, factory: MainWorkspaceRestoreFactory): Promise<boolean>;
	focusPrimary(): void;
	dispose(): void;
};

type PrimaryRequest = {
	readonly closes: EditorCloseController;
	readonly previous: MainWorkspaceClient | undefined;
	readonly origin: InputFocusTarget | null;
	readonly originContext: number | undefined;
	readonly interactionRevision: number;
	readonly options: MainWorkspaceOpenOptions | undefined;
	departure: NavigationHistoryEntry | null;
	candidate: MainWorkspaceClient | undefined;
	preserveFocus: boolean;
};

/** Permanent frontend composition; primary authoring and document arrangement are real siblings. */
export class MainWorkspace {
	public readonly bounds = create_rect_bounds();
	public readonly documentBounds = create_rect_bounds();
	public readonly scope: InputFocusScope;
	public readonly surface: WorkbenchSurface;
	private readonly primaryBounds = create_rect_bounds();
	private readonly viewport = create_rect_bounds();
	private readonly sashBounds = create_rect_bounds();
	private readonly primaryScope: InputFocusScope;
	private readonly primarySurface: WorkbenchSurface;
	private readonly split = new WorkbenchSplitView(0.45);
	private readonly sash: WorkbenchSplitControl;
	private readonly scrollbar = new Scrollbar('horizontal');
	private readonly scrollTrack = create_rect_bounds();
	private readonly scrollbars = { horizontal: this.scrollbar };
	private readonly scrollControl: ScrollbarController<'horizontal'>;
	private readonly prompt: ActionPrompt;
	private readonly promptSurface: WorkbenchSurface;
	private readonly unbindInteraction: () => void;
	private readonly unbindFocus: () => void;
	private readonly releaseLayoutChanges: readonly (() => void)[];
	private readonly changeListeners = new Set<() => void>();
	private readonly disposalListeners = new Set<() => void>();
	private releasePrimaryChanges: (() => void) | undefined;
	private activeClient: 'primary' | 'documents' = 'documents';
	private restoredScroll: number | undefined;
	private readonly focusTarget: InputFocusTarget;
	private primaryValue: MainWorkspaceClient | undefined;
	private attached: MainWorkspaceClient | undefined;
	private request: PrimaryRequest | undefined;
	private requestRevision = 0;
	private presented = true;
	private resetting = false;
	public get primary(): MainWorkspaceClient | undefined { return this.primaryValue; }

	public constructor(private readonly surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface, parent: InputFocusScope,
		commands: EditorCommandRunner,
		private readonly requestLayout: () => void, private readonly onPrimaryActivate: () => void,
		private readonly onDocumentsActivate: (focus: boolean) => void) {
		this.scope = new InputFocusScope(Symbol('main workspace'), parent);
		this.scope.commands = commands;
		this.primaryScope = new InputFocusScope(Symbol('main authored client'), this.scope);
		this.focusTarget = inputFocus.createTarget(null, this.scope);
		this.focusTarget.canFocus = () => this.primaryValue !== undefined;
		this.unbindFocus = this.focusTarget.onDidFocus(() => this.focusPrimary());
		this.sash = new WorkbenchSplitControl(inputFocus, pointerCapture, pointerHover, this.focusTarget,
			new InputFocusScope(Symbol('main workspace sash'), this.scope));
		this.scrollControl = new ScrollbarController(this.scrollbars, (_kind, scroll) => {
			this.scrollbar.setScroll(scroll); this.requestLayout(); this.surfaces.changed();
		}, pointerCapture);
		this.surface = surfaces.attach({
			role: 'window', lifetimeOwner: owner, presentationParent: null, captureScope: this.scope.surfaceScope,
			isVisible: () => this.presented, getBounds: () => this.bounds, getClip: () => this.bounds,
			draw: () => api.fill_rect(this.bounds.left, this.bounds.top, this.bounds.right, this.bounds.bottom, 0, COLOR_FRAME),
			onRetire: () => this.retire(),
		});
		this.primarySurface = surfaces.attach({ role: 'content', lifetimeOwner: this.surface, presentationParent: this.surface,
			captureScope: this.primaryScope.surfaceScope, isVisible: () => this.primaryValue !== undefined,
			getBounds: () => this.primaryBounds, getClip: () => this.viewport,
			draw: () => this.primaryValue!.draw(), handlePointer: snapshot => this.primaryValue!.handlePointer(snapshot),
			handleWheel: event => { this.primaryValue!.handleWheel(event); return true; },
			onRetire: () => pointerCapture.cancelScope(this.primaryScope.surfaceScope),
		});
		surfaces.attach({ role: 'content', lifetimeOwner: this.surface, presentationParent: this.surface,
			captureScope: this.sash.focusTarget.scope.surfaceScope, isVisible: () => this.primaryValue !== undefined,
			getBounds: () => this.sashBounds, getClip: () => this.viewport,
			draw: () => drawWorkbenchSplit(this.split, this.sash.hovered || this.sash.focusTarget.hasFocus),
			handlePointer: snapshot => { this.sash.handlePointer(snapshot); }, handleWheel: () => true,
			onRetire: () => { pointerCapture.cancelScope(this.sash.focusTarget.scope.surfaceScope); this.sash.clearInput(); },
		});
		surfaces.attach({ role: 'content', lifetimeOwner: this.surface, presentationParent: this.surface,
			captureScope: Symbol('main workspace horizontal scroll'), isVisible: () => this.scrollbar.isVisible(),
			getBounds: () => this.scrollbar.getTrack(), getClip: () => this.bounds,
			draw: () => this.scrollbar.draw(COLOR_FRAME, SCROLLBAR_THUMB_COLOR),
			handlePointer: snapshot => { this.scrollControl.begin(HORIZONTAL_SCROLLBAR, snapshot, 0); }, handleWheel: () => true,
			onRetire: () => this.scrollControl.cancel(),
		});
		this.prompt = new ActionPrompt(inputFocus, pointerCapture, () => surfaces.changed(),
			next => next !== null && surfaces.isInContext(next.scope.surfaceScope, this.prompt.pointerScope),
			{ kind: 'part', scope: this.primaryScope, bounds: this.primaryBounds, reveal: () => this.reveal(this.primaryBounds) });
		this.promptSurface = surfaces.attach({ role: 'modal', blockedScope: this.primarySurface, presentationParent: this.surface,
			lifetimeOwner: this.primarySurface, captureScope: this.prompt.pointerScope,
			isVisible: () => this.prompt.visible, getBounds: () => this.prompt.view.bounds, getClip: () => this.viewport,
			draw: () => this.prompt.draw(), handlePointer: snapshot => this.prompt.handlePointer(snapshot),
			onRetire: () => this.prompt.close('cancel', false),
		});
		this.unbindInteraction = inputFocus.onDidActivateInteraction(target => {
			if (this.primaryScope.contains(target.scope)) {
				this.reveal(this.primaryBounds);
				this.onPrimaryActivate();
				if (this.activeClient !== 'primary') { this.activeClient = 'primary'; this.changed(); }
			} else if (this.scope.contains(target.scope) && target !== this.sash.focusTarget) {
				this.reveal(this.documentBounds);
				if (this.activeClient !== 'documents') { this.activeClient = 'documents'; this.changed(); }
			}
		});
		this.releaseLayoutChanges = [this.scrollbar.onDidScroll(() => this.changed()), this.split.onDidChangeRatio(() => this.changed())];
	}

	public onDidChange(listener: () => void): () => void { this.changeListeners.add(listener); return () => this.changeListeners.delete(listener); }
	public onWillDispose(listener: () => void): () => void { this.disposalListeners.add(listener); return () => this.disposalListeners.delete(listener); }
	private changed(): void { for (const listener of this.changeListeners) listener(); }

	public captureNavigationEntry(): NavigationHistoryEntry | null {
		const primary = this.primaryValue, location = primary?.captureNavigationLocation();
		if (this.primaryValue !== primary) { location?.dispose(); return null; }
		return location === undefined ? null : new NavigationHistoryEntry({ kind: 'primary', location });
	}

	public serialize(previous?: SerializedMainWorkspace): SerializedMainWorkspace {
		const primary = this.primaryValue?.serialize() ?? null;
		if (previous !== undefined && previous.splitRatio === this.split.ratio && previous.scrollX === this.scrollbar.getScroll()
			&& previous.activeClient === this.activeClient && (primary === null ? previous.primary === null
				: previous.primary?.kind === primary.kind && previous.primary.value === primary.value)) return previous;
		return { primary, splitRatio: this.split.ratio, scrollX: this.scrollbar.getScroll(), activeClient: this.activeClient };
	}

	/** Initial recovery owns a request before any canonical-source admission can await. */
	public beginRestore(): MainWorkspaceRestoreRequest {
		this.cancelRequest();
		const generation = this.requestRevision, interaction = inputFocus.interactionRevision;
		let disposed = false, restored = false;
		let state: SerializedMainWorkspace;
		const current = () => !disposed && !this.surface.retired && this.presented && !this.resetting && this.requestRevision === generation;
		return {
			isCurrent: current,
			restore: async (snapshot, factory) => {
				if (!current()) return false;
				state = snapshot;
				const scope = new InputFocusScope(this.primaryScope.surfaceScope, this.primaryScope);
				let candidate: MainWorkspaceClient | undefined;
				let transferred = false;
				try {
					if (snapshot.primary !== null) candidate = await factory(snapshot.primary, this.primarySurface, scope, current);
					if (!current() || snapshot.primary !== null && candidate === undefined) return false;
					if (inputFocus.interactionRevision === interaction) this.activeClient = snapshot.activeClient;
					this.split.ratio = snapshot.splitRatio;
					if (!current()) return false;
					this.restoredScroll = snapshot.scrollX;
					const client = candidate;
					candidate = undefined;
					transferred = client !== undefined;
					this.installPrimary(client);
					restored = this.primaryValue === client && current();
					return restored;
				} finally {
					if (candidate !== undefined) { candidate.scope.retireContext(); candidate.dispose(); }
					if (!transferred) scope.retireContext();
				}
			},
			focusPrimary: () => {
				if (restored && current() && state.activeClient === 'primary' && inputFocus.interactionRevision === interaction) this.focusPrimary();
			},
			dispose: () => { disposed = true; },
		};
	}

	public *workingCopyConsumers(): Iterable<WorkingCopyConsumer> {
		const primary = this.primaryValue?.consumer;
		if (primary !== undefined) yield primary;
	}

	public async openPrimary(factory: MainWorkspaceClientFactory, closes: EditorCloseController,
		origin: InputFocusTarget | null = inputFocus.target, options?: MainWorkspaceOpenOptions): Promise<boolean> {
		if (this.surface.retired || !this.presented || this.resetting) return false;
		const request = this.beginRequest(closes, origin, options);
		const scope = new InputFocusScope(this.primaryScope.surfaceScope, this.primaryScope);
		let unowned = true;
		try {
			if (this.request !== request) return false;
			const candidate = factory(this.primarySurface, scope);
			unowned = candidate === undefined;
			request.candidate = candidate;
			if (candidate === undefined || !this.current(request)) return false;
			return await this.admit(request);
		} finally {
			if (this.request === request) this.request = undefined;
			if (request.candidate !== undefined) this.disposeCandidate(request);
			if (unowned) scope.retireContext();
			request.departure?.dispose(); request.departure = null;
		}
	}

	public async clearPrimary(closes: EditorCloseController, origin: InputFocusTarget | null = inputFocus.target): Promise<boolean> {
		if (this.surface.retired || !this.presented || this.resetting) return false;
		const request = this.beginRequest(closes, origin);
		try {
			return this.request === request && await this.admit(request);
		} finally {
			if (this.request === request) this.request = undefined;
			request.departure?.dispose(); request.departure = null;
		}
	}

	private beginRequest(closes: EditorCloseController, origin: InputFocusTarget | null, options?: MainWorkspaceOpenOptions): PrimaryRequest {
		const previous = this.request;
		const request: PrimaryRequest = { closes, previous: this.primaryValue, origin, originContext: origin?.commandContext.scope.contextGeneration,
			interactionRevision: inputFocus.interactionRevision,
			options, departure: null, candidate: undefined, preserveFocus: options?.preserveFocus === true };
		this.request = request; this.requestRevision++;
		if (previous !== undefined) {
			if (previous.previous !== undefined) previous.closes.cancelRelease(previous.previous.consumer);
			this.disposeCandidate(previous);
			previous.departure?.dispose(); previous.departure = null;
		}
		if (this.request === request && options?.recordNavigation !== false) request.departure = beginNavigationCapture();
		return request;
	}

	private current(request: PrimaryRequest): boolean {
		return this.request === request && !this.surface.retired && this.presented && this.primaryValue === request.previous
			&& request.origin?.commandContext.scope.contextGeneration === request.originContext
			&& request.options?.isCurrent?.() !== false
			&& (request.candidate === undefined || request.candidate.isCurrent())
			&& this.request === request && !this.surface.retired && this.primaryValue === request.previous;
	}

	private async admit(request: PrimaryRequest): Promise<boolean> {
		const candidate = request.candidate, previous = request.previous;
		request.preserveFocus ||= inputFocus.interactionRevision !== request.interactionRevision;
		let lastTarget = inputFocus.target;
		const unbind = inputFocus.onDidActivateInteraction(target => {
			if (!this.primaryScope.contains(target.scope)
				&& !(target === request.origin && lastTarget === this.prompt.focusTarget)) request.preserveFocus = true;
			lastTarget = target;
		});
		try {
			if (previous === undefined) {
				if (!this.current(request)) return false;
				this.publish(request, unbind);
			} else if (!await request.closes.release({ consumer: previous.consumer, replacement: candidate?.consumer, scope: previous.scope,
				isCurrent: () => this.current(request), retire: () => this.publish(request, unbind) }, request.origin, this.prompt)) return false;
			const admitted = this.primaryValue === candidate && !this.surface.retired;
			if (admitted && !request.preserveFocus && request.options?.recordNavigation !== false) {
				const departure = request.departure; request.departure = null;
				completeNavigation(departure);
			}
			return admitted;
		} finally { unbind(); }
	}

	/** Publication precedes old-control retirement; their callbacks cannot attach an older request. */
	private publish(request: PrimaryRequest, stopObservingInteraction: () => void): void {
		if (!this.current(request)) return;
		const candidate = request.candidate, revision = this.requestRevision;
		request.candidate = undefined;
		this.request = undefined;
		this.installPrimary(candidate);
		stopObservingInteraction();
		if (this.primaryValue === candidate && this.requestRevision === revision && !request.preserveFocus) {
			if (candidate === undefined) this.onDocumentsActivate(true); else candidate.focus();
		}
	}

	/** One admitted publication path for user navigation and initial session recovery. */
	private installPrimary(candidate: MainWorkspaceClient | undefined): void {
		const previous = this.primaryValue;
		this.releasePrimaryChanges?.();
		this.primaryValue = candidate; this.attached = undefined;
		if (candidate === undefined) this.activeClient = 'documents';
		this.releasePrimaryChanges = candidate?.onDidChange(() => this.changed());
		if (candidate !== undefined) this.prompt.focusTarget.commandContext = candidate.commandTarget;
		if (previous !== undefined) { previous.scope.retireContext(); previous.dispose(); }
		if (this.surface.retired || !this.presented || this.primaryValue !== candidate) return;
		if (candidate === undefined && navigationState.activeOwner === this) {
			this.onDocumentsActivate(false);
			if (this.surface.retired || !this.presented || this.primaryValue !== candidate) return;
		}
		if (candidate === undefined) this.sash.clearInput(); else this.sash.setInput(this.split);
		this.requestLayout();
		if (this.surface.retired || !this.presented || this.primaryValue !== candidate) return;
		if (candidate !== undefined) {
			this.attached = candidate; candidate.attach(this.primaryBounds);
		}
		this.surfaces.changed();
		this.changed();
	}

	private disposeCandidate(request: PrimaryRequest): void {
		const candidate = request.candidate;
		request.candidate = undefined;
		if (candidate !== undefined) { candidate.scope.retireContext(); candidate.dispose(); }
	}

	public layout(bounds: Readonly<RectBounds>): boolean {
		let changed = this.bounds.left !== bounds.left || this.bounds.top !== bounds.top || this.bounds.right !== bounds.right || this.bounds.bottom !== bounds.bottom;
		copy_rect_bounds(this.bounds, bounds);
		const client = this.primaryValue, available = bounds.right - bounds.left;
		const primaryMinimum = client === undefined ? 0 : client.minimumWidth, documentMinimum = editorGroupChromeMinimumWidth();
		const minimumWidth = client === undefined ? 0 : primaryMinimum + WORKBENCH_SPLIT_SIZE + documentMinimum;
		const contentWidth = Math.max(available, minimumWidth), overflow = contentWidth > available;
		const bottom = Math.max(bounds.top, bounds.bottom - (overflow ? SCROLLBAR_WIDTH : 0));
		write_rect_bounds(this.viewport, bounds.left, bounds.top, bounds.right, bottom);
		write_rect_bounds(this.scrollTrack, bounds.left, bottom, bounds.right, bounds.bottom);
		this.scrollbar.layout(this.scrollTrack, contentWidth, available, this.restoredScroll ?? this.scrollbar.getScroll());
		this.restoredScroll = undefined;
		const document = this.documentBounds, primary = this.primaryBounds;
		const oldLeft = primary.left, oldTop = primary.top, oldRight = primary.right, oldBottom = primary.bottom;
		const documentLeft = document.left, documentTop = document.top, documentRight = document.right, documentBottom = document.bottom;
		if (client === undefined) {
			clear_rect_bounds(primary); clear_rect_bounds(this.sashBounds); copy_rect_bounds(document, bounds);
		} else {
			const left = bounds.left - this.scrollbar.getScroll();
			this.split.minimumFirstSize = primaryMinimum + WORKBENCH_SPLIT_SIZE / 2;
			this.split.minimumSecondSize = documentMinimum + WORKBENCH_SPLIT_SIZE / 2;
			this.split.layout(left, bounds.top, left + contentWidth, bottom);
			const position = this.split.position;
			write_rect_bounds(primary, left, bounds.top, position - WORKBENCH_SPLIT_SIZE / 2, bottom);
			write_rect_bounds(this.sashBounds, primary.right, bounds.top, position + WORKBENCH_SPLIT_SIZE / 2, bottom);
			write_rect_bounds(document, this.sashBounds.right, bounds.top, left + contentWidth, bottom);
		}
		const primaryChanged = primary.left !== oldLeft || primary.top !== oldTop || primary.right !== oldRight || primary.bottom !== oldBottom;
		changed = changed || primaryChanged || document.left !== documentLeft || document.top !== documentTop || document.right !== documentRight || document.bottom !== documentBottom;
		if (primaryChanged && client !== undefined && this.attached === client) client.layout(primary);
		return changed;
	}

	public update(): void {
		if (!this.presented || this.surface.retired) return;
		this.prompt.update();
		const client = this.primaryValue;
		if (client !== undefined) {
			if (this.attached !== client) {
				this.attached = client; client.attach(this.primaryBounds);
			}
			if (this.primaryValue === client && !this.surface.retired) client.update();
		}
	}

	public focusPrimary(): void {
		const client = this.primaryValue;
		if (client === undefined || this.surface.retired || !this.presented || this.resetting) return;
		this.reveal(this.primaryBounds);
		if (this.primaryValue !== client) return;
		if (this.prompt.visible) { this.surfaces.raise(this.promptSurface); this.prompt.focusTarget.focus(); }
		else client.focus();
	}

	public revealDocuments(): void { this.reveal(this.documentBounds); }

	private reveal(region: Readonly<RectBounds>): void {
		const scroll = this.scrollbar.getScroll();
		this.scrollbar.reveal(region.left - this.bounds.left + scroll, region.right - this.bounds.left + scroll);
		if (this.scrollbar.getScroll() !== scroll) this.requestLayout();
		this.surfaces.raise(this.surface);
	}

	public suspend(): void {
		this.presented = false;
		this.cancelRequest();
		this.primaryScope.retireContext();
		const client = this.attached;
		this.attached = undefined;
		client?.detach(); this.prompt.close('cancel', false); this.sash.clearInput(); this.scrollControl.cancel();
		pointerCapture.cancelScope(this.primaryScope.surfaceScope);
		this.surfaces.changed();
	}

	public resume(): void {
		if (this.presented || this.surface.retired || this.resetting) return;
		this.presented = true;
		this.requestLayout();
		if (this.primaryValue !== undefined) this.sash.setInput(this.split);
		this.update(); this.surfaces.changed();
	}

	private cancelRequest(): void {
		const request = this.request;
		this.request = undefined; this.requestRevision++;
		if (request !== undefined) {
			if (request.previous !== undefined) request.closes.cancelRelease(request.previous.consumer);
			this.disposeCandidate(request);
			request.departure?.dispose(); request.departure = null;
		}
	}

	/** Workspace replacement forcibly retires contexts, unlike a user-requested clear. */
	public reset(): void {
		if (this.resetting) return;
		this.resetting = true;
		this.cancelRequest();
		const client = this.primaryValue;
		this.releasePrimaryChanges?.(); this.releasePrimaryChanges = undefined;
		this.primaryValue = this.attached = undefined;
		this.activeClient = 'documents';
		if (client !== undefined) { client.scope.retireContext(); client.dispose(); }
		this.primaryScope.retireContext(); this.prompt.close('cancel', false); this.sash.clearInput();
		this.resetting = false;
		if (!this.surface.retired) { this.requestLayout(); this.surfaces.changed(); }
		this.changed();
	}

	private retire(): void {
		for (const listener of this.disposalListeners) listener(); this.disposalListeners.clear();
		this.reset();
		this.unbindInteraction(); this.unbindFocus();
		for (const release of this.releaseLayoutChanges) release();
		this.changeListeners.clear(); this.prompt.dispose(); this.sash.dispose(); this.scrollControl.cancel();
		pointerCapture.cancelScope(this.scope.surfaceScope); this.scope.retireContext();
	}

	public dispose(): void { this.surface.dispose(); }
}

const HORIZONTAL_SCROLLBAR = ['horizontal'] as const;
