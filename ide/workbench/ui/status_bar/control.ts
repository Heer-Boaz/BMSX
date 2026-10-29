import type { Clipboard } from '../../../../hosts/common/clipboard';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { type KeyInputEvent } from '../../../../hosts/common/input/text';
import { point_in_rect, type RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandRunner } from '../../../common/commands';
import { editorFeedbackState } from '../../../common/feedback_state';
import type { PointerInputSnapshot } from '../../../common/models';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { writeClipboard } from '../../../input/clipboard';
import { inputFocus, InputFocusScope, type InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover, type PointerHoverTarget } from '../../../input/pointer/hover';
import type { RuntimeFaultState } from '../../../runtime/fault_state';
import type { RuntimeLuaEvaluation } from '../../../runtime/lua_evaluation';
import * as colors from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { getWorkbenchStatusLayout, type WorkbenchStatusLayout } from '../../common/layout';
import type { StudioServerConnectionState } from '../../common/server_connection';
import { EMPTY_STATUS_ITEMS, STATUS_PRIORITY_CONTENT, type WorkbenchStatusItem, type WorkbenchStatusSource } from '../../common/status_bar';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import { renderStatusBar } from '../../render/status_bar';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { createWorkbenchActionBar, layoutWorkbenchActionBar } from '../action_bar';
import { WorkbenchActionBarControl } from '../action_bar_control';
import { WorkbenchTooltip } from '../tooltip';
import { WorkbenchStatusItemsLayout } from './layout';

type StatusContext = {
	readonly source: WorkbenchStatusSource;
	readonly origin: InputFocusScope;
	readonly owner: InputFocusScope;
	readonly originGeneration: number;
	unbindOrigin: (() => void) | undefined;
};

/** One native reader over the activated presentation's retained status facts. */
export class WorkbenchStatusBar implements PointerHoverTarget {
	public readonly focusTarget: InputFocusTarget;
	public readonly itemsLayout = new WorkbenchStatusItemsLayout();
	private readonly scope = new InputFocusScope(Symbol('status context'), inputFocus.workbenchScope);
	private readonly surface: WorkbenchSurface;
	private readonly tooltip = new WorkbenchTooltip();
	private readonly actionState = createWorkbenchActionBar('status.context');
	private readonly actions: WorkbenchActionBarControl;
	private readonly overrideItems: readonly WorkbenchStatusItem[] = [
		{ text: '', alignment: 'left', priority: STATUS_PRIORITY_CONTENT, overflow: 'ellipsis', tone: 'normal' },
	];
	private context: StatusContext | undefined;
	private items: readonly WorkbenchStatusItem[] = EMPTY_STATUS_ITEMS;
	private layout: WorkbenchStatusLayout = getWorkbenchStatusLayout(false, false);
	private evaluation: RuntimeLuaEvaluation | undefined;
	private connection: StudioServerConnectionState = 'standalone';
	private runtimeFaulted = false;
	private keyChordLabel: string | undefined;
	private selectedIndex = -1;
	private hoverIndex = -1;
	private pointerX = 0;
	private pointerY = 0;
	private disposed = false;
	private actionRowHeight = -1;
	private disclosureWidth = 0;
	private readonly unbindFocus: () => void;
	private readonly unbindKeyboard: () => void;
	private readonly unbindTarget: () => void;

	public constructor(private readonly surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface,
		commands: EditorCommandRunner, private readonly quickInput: QuickInputController,
		private readonly clipboard: Clipboard, private readonly workArea: Readonly<RectBounds>) {
		this.scope.commands = commands;
		this.focusTarget = inputFocus.createTarget(null, this.scope);
		this.focusTarget.canFocus = () => this.canFocus;
		this.focusTarget.clipboard = { readOnly: true, copy: () => this.items[this.selectedIndex]?.text || null };
		this.unbindKeyboard = this.focusTarget.bindKeyboard(event => this.handleKeyboard(event));
		this.unbindFocus = this.focusTarget.onDidFocus(() => { this.selectFirst(); this.updateTooltip(); });
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.returnToOrigin());
		this.actions.focusTarget.next = this.actions.focusTarget.previous = () => this.returnToOrigin();
		this.actionState.items[0].visible = false;
		this.actions.setInput(this.actionState, this.focusTarget);
		this.surface = surfaces.attach({ role: 'content', lifetimeOwner: owner, presentationParent: owner,
			captureScope: this.scope.surfaceScope, isVisible: () => !this.disposed,
			getBounds: () => this.layout.context, getClip: () => this.layout.context, draw() {},
			handlePointer: snapshot => this.handlePointer(snapshot), handleWheel: () => true,
			onRetire: () => this.dispose(),
		});
		this.tooltip.attach(surfaces, this.surface, workArea);
		this.unbindTarget = inputFocus.onDidChangeTarget(() => this.selectSource());
	}

	public get canFocus(): boolean {
		if (this.disposed || this.layout.context.left >= this.layout.context.right || this.layout.context.top >= this.layout.context.bottom) return false;
		for (const item of this.items) if (item.text.length !== 0) return true;
		return false;
	}
	public get hasDetails(): boolean {
		if (this.disposed) return false;
		for (const item of this.items) if (item.text.length !== 0) return true;
		return false;
	}

	/** Empty providers are real clients; an absent provider is neutral frontend chrome. */
	private selectSource(): void {
		if (this.disposed) return;
		const target = inputFocus.admittedTarget;
		if (target === null) return;
		let origin = target.scope;
		for (let scope: InputFocusScope | null = origin; scope !== null;) {
			const source = scope.statusSource;
			if (source !== undefined) {
				const previous = this.context;
				if (previous?.source === source && previous.origin === origin && previous.owner === scope
					&& previous.originGeneration === origin.contextGeneration) return;
				const next: StatusContext = { source, origin, owner: scope, originGeneration: origin.contextGeneration,
					unbindOrigin: undefined };
				const retire = () => { if (this.context === next) this.clearContext(); };
				next.unbindOrigin = origin.onDidRetireContext(retire);
				this.context = next;
				this.scope.interactionOrigin = origin;
				this.items = EMPTY_STATUS_ITEMS; this.selectedIndex = this.hoverIndex = -1;
				previous?.unbindOrigin?.();
				this.tooltip.hide(); pointerHover.release(this);
				this.publishItems(this.overrideStatus() ?? EMPTY_STATUS_ITEMS);
				if (this.context !== next) return;
				this.scope.retireContext();
				if (this.context === next) this.projectStatus();
				return;
			}
			if (scope.interactionOrigin !== undefined) { scope = scope.interactionOrigin; origin = scope; }
			else scope = scope.commandParent;
		}
	}

	private clearContext(): void {
		const previous = this.context;
		this.context = undefined; this.scope.interactionOrigin = undefined;
		this.items = EMPTY_STATUS_ITEMS; this.selectedIndex = this.hoverIndex = -1;
		previous?.unbindOrigin?.();
		this.tooltip.hide(); pointerHover.release(this);
		this.publishItems(this.overrideStatus() ?? EMPTY_STATUS_ITEMS);
		if (this.context !== undefined) return;
		this.scope.retireContext();
		if (this.context === undefined && !this.actions.focusTarget.canFocus!()) this.actions.focusTarget.release();
		if (this.context === undefined && !this.canFocus) this.focusTarget.release();
	}

	public update(fault: RuntimeFaultState, evaluation: RuntimeLuaEvaluation, connection: StudioServerConnectionState,
		windowRestoreWidth: number, keyChordLabel?: string): void {
		this.evaluation = evaluation; this.connection = connection; this.keyChordLabel = keyChordLabel;
		const hostFailed = fault.hostFrameFailure !== undefined;
		this.runtimeFaulted = hostFailed || fault.faultSnapshot !== null;
		this.layout = getWorkbenchStatusLayout(inputFocus.admittedTarget?.guestInput !== undefined, hostFailed, windowRestoreWidth);
		this.selectSource(); this.projectStatus();
	}

	private projectStatus(): void {
		if (this.disposed) return;
		let items = this.overrideStatus();
		if (items === undefined) {
			const context = this.context;
			if (context === undefined) items = EMPTY_STATUS_ITEMS;
			else {
				context.source.updateStatus();
				if (this.context !== context) return;
				items = context.source.statusItems;
			}
		}
		this.publishItems(items);
	}

	private overrideStatus(): readonly WorkbenchStatusItem[] | undefined {
		const item = this.overrideItems[0], message = editorFeedbackState.message;
		if (this.keyChordLabel !== undefined) { item.text = this.keyChordLabel; item.tone = 'normal'; }
		else if (this.evaluation?.active !== undefined) { item.text = this.evaluation.paused ? 'LUA CALL PAUSED' : 'LUA CALL RUNNING'; item.tone = 'normal'; }
		else if (message.visible) { item.text = message.text; item.tone = message.kind; }
		else return undefined;
		return this.overrideItems;
	}

	/** Native retirement withdraws projected values before invoking any outgoing focus or popup observer. */
	private publishItems(items: readonly WorkbenchStatusItem[]): void {
		if (this.items !== items) { this.items = items; this.selectedIndex = this.hoverIndex = -1; this.tooltip.hide(); }
		this.selectFirst();
		const bounds = this.layout.context, font = editorViewState.font;
		// The icon's natural extent changes with its font/row, not with content overflow.
		const rowHeight = bounds.bottom - bounds.top, renderFont = font.renderFont();
		const remeasure = this.actionState.measuredFont !== renderFont || this.actionRowHeight !== rowHeight;
		if (remeasure) {
			this.actionRowHeight = rowHeight;
			layoutWorkbenchActionBar(this.actionState, bounds.right, bounds.top, bounds.bottom, measureText, renderFont, bounds.right);
			this.disclosureWidth = this.actionState.items[0].width;
		}
		const changed = this.itemsLayout.update(items, bounds, font, this.disclosureWidth);
		const disclosure = this.itemsLayout.disclosureBounds, item = this.actionState.items[0];
		const visible = this.itemsLayout.overflow && this.hasDetails && disclosure.right - disclosure.left >= this.disclosureWidth
			&& disclosure.top < disclosure.bottom, visibilityChanged = item.visible !== visible;
		item.visible = visible;
		if (changed || visibilityChanged || remeasure) layoutWorkbenchActionBar(this.actionState,
			visible ? disclosure.right : bounds.right, bounds.top, bounds.bottom, measureText, renderFont, visible ? disclosure.left : bounds.right);
		this.actions.update();
		if (changed) {
			if (pointerHover.has(this)) this.hoverIndex = this.hitItem(this.pointerX, this.pointerY);
			this.surfaces.changed();
		}
		// A live source may publish no readable value without retiring its immutable details snapshot.
		if (inputFocus.target === this.focusTarget && !this.canFocus
			|| inputFocus.target === this.actions.focusTarget && !this.actions.focusTarget.canFocus!()) this.returnToOrigin();
		this.updateTooltip();
	}

	private selectFirst(): void {
		if (this.selectedIndex >= 0 && this.selectedIndex < this.items.length && this.items[this.selectedIndex].text.length !== 0) return;
		this.selectedIndex = -1;
		for (let index = 0; index < this.items.length; index++) if (this.items[index].text.length !== 0) { this.selectedIndex = index; return; }
	}

	public focus(): void {
		this.selectSource(); this.projectStatus();
		if (this.canFocus) this.focusTarget.focus();
	}
	private returnToOrigin(): void {
		const context = this.context;
		const target = context?.origin.lastFocused;
		if (target !== undefined && target !== null) target.focus(); else this.focusTarget.release();
	}

	private handleKeyboard(event: KeyInputEvent): void {
		if (isKeyJustPressed('Escape', event) || isKeyJustPressed('Tab', event)) {
			consumeIdeKey(event.code, event); this.returnToOrigin(); return;
		}
		if (isKeyJustPressed('ArrowLeft', event) || isKeyJustPressed('ArrowRight', event)) {
			consumeIdeKey(event.code, event);
			if (this.items.length === 0) return;
			const direction = event.code === 'ArrowLeft' ? -1 : 1;
			let index = this.selectedIndex;
			do { index = (index + direction + this.items.length) % this.items.length; } while (this.items[index].text.length === 0 && index !== this.selectedIndex);
			this.selectedIndex = index; pointerHover.release(this); this.hoverIndex = -1; this.tooltip.hide(); this.updateTooltip(); return;
		}
		if (isKeyJustPressed('Enter', event) || isKeyJustPressed('Space', event)) { consumeIdeKey(event.code, event); this.showDetails(); }
	}

	private hitItem(x: number, y: number): number {
		for (let index = 0; index < this.itemsLayout.items.length; index++) {
			const entry = this.itemsLayout.items.peek(index);
			if (entry.visible && point_in_rect(x, y, entry.bounds)) return index;
		}
		return -1;
	}
	private handlePointer(snapshot: PointerInputSnapshot): void {
		if (this.actions.handlePointer(snapshot)) { pointerHover.release(this); this.tooltip.hide(); return; }
		if (!snapshot.valid || !snapshot.insideViewport) { pointerHover.release(this); return; }
		this.pointerX = snapshot.viewportX; this.pointerY = snapshot.viewportY;
		this.hoverIndex = this.hitItem(this.pointerX, this.pointerY);
		if (this.hoverIndex >= 0) pointerHover.visit(this); else pointerHover.release(this);
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0 && this.hoverIndex >= 0) {
			const item = this.items[this.hoverIndex];
			if (!this.focusTarget.focus()) return;
			const index = this.items.indexOf(item);
			if (index >= 0) this.selectedIndex = index;
		}
		this.updateTooltip();
	}
	public onPointerLeave(): void { this.hoverIndex = -1; this.tooltip.hide(); }
	private updateTooltip(): void {
		let index = this.hoverIndex;
		if (index < 0 && inputFocus.admittedTarget === this.focusTarget) index = this.selectedIndex;
		if (index < 0 || index >= this.itemsLayout.items.length) { this.tooltip.hide(); return; }
		const entry = this.itemsLayout.items.peek(index);
		if (inputFocus.admittedTarget !== this.focusTarget && !entry.truncated) { this.tooltip.hide(); return; }
		this.tooltip.show(entry.fullText, entry.visible ? entry.bounds : this.itemsLayout.bounds,
			editorViewState.font.renderFont(), measureTextRange, measureText, this.workArea);
	}

	public showDetails(): void {
		this.selectSource(); this.projectStatus();
		if (!this.hasDetails) return;
		const context = this.context, origin = context?.origin.lastFocused ?? null, generation = this.scope.contextGeneration;
		const choices: { label: string; description: string; detail: string; text: string }[] = [];
		let selected = 0;
		for (let index = 0; index < this.itemsLayout.items.length; index++) {
			const entry = this.itemsLayout.items.peek(index);
			if (entry.fullText.length === 0) continue;
			if (index === this.selectedIndex) selected = choices.length;
			choices.push({ label: entry.lineText, description: '', detail: '', text: entry.fullText });
		}
		this.tooltip.hide();
		this.quickInput.pick('Status Details', 'Choose a value to copy', () => new TextQuickPickProvider(choices, selected),
			item => {
				if (context === this.context && generation === this.scope.contextGeneration && !this.disposed)
					void writeClipboard(this.clipboard, item.text, 'Copied status value.');
			},
			lifetime => { lifetime.add({ dispose: this.scope.onDidRetireContext(() => { if (!lifetime.isDisposed) this.quickInput.hide(false); }) }); },
			{ invocationOrigin: origin });
	}

	public draw(): void {
		renderStatusBar(this.layout, this.itemsLayout, this.runtimeFaulted, this.connection);
		const context = this.layout.context;
		api.pushClipRect(context.left, context.top, context.right, context.bottom);
		renderWorkbenchActionBar(this.actionState, editorViewState.font.renderFont(), colors.COLOR_STATUS_TEXT, colors.COLOR_HEADER_BUTTON_TEXT_DISABLED);
		if (inputFocus.admittedTarget === this.focusTarget && this.selectedIndex >= 0) {
			const entry = this.itemsLayout.items.peek(this.selectedIndex);
			if (entry.visible) api.blit_rect(entry.bounds.left, entry.bounds.top, entry.bounds.right, entry.bounds.bottom, 0, colors.COLOR_FOCUS_BORDER);
		}
		api.popClipRect();
	}

	public dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		const context = this.context; this.context = undefined; this.items = EMPTY_STATUS_ITEMS;
		this.selectedIndex = this.hoverIndex = -1;
		this.itemsLayout.update(EMPTY_STATUS_ITEMS, this.layout.context, editorViewState.font);
		this.actionState.items[0].visible = false;
		context?.unbindOrigin?.();
		this.scope.interactionOrigin = undefined; this.unbindTarget(); this.unbindKeyboard(); this.unbindFocus();
		this.scope.retireContext(); this.tooltip.detach(); pointerHover.release(this); this.actions.dispose(); this.focusTarget.release(); this.surface.dispose();
	}
}
