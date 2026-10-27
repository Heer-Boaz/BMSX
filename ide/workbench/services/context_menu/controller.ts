import { point_in_rect } from '../../../../machine/ts/common/rect';
import { KeyModifier, type KeyInputEvent } from '../../../../hosts/common/input/text';
import { editorCommandTitle } from '../../../commands/catalog';
import type { EditorCommandId, EditorCommandRunner } from '../../../common/commands';
import { DisposableStore } from '../../../common/lifecycle';
import type { PointerSnapshot } from '../../../common/models';
import { InputFocusScope, type InputFocusService, type InputFocusTarget } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed, isKeyDown } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import type { PointerCaptureService, PointerCaptureTarget } from '../../../input/pointer/capture';
import type { WorkbenchMenuItem } from '../../ui/menu/registry';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import { ContextMenuModel, type ContextMenuPlacement } from './model';
import { layoutContextMenu } from './render';

export type ContextMenuOptions = {
	/** Install domain lifetime subscriptions before focus can publish a departing draft. */
	readonly onWillShow?: (lifetime: DisposableStore) => void;
	readonly selectFirst?: boolean;
	readonly placement?: ContextMenuPlacement;
	readonly shortTitles?: boolean;
	readonly onNavigate?: (direction: 1 | -1) => void;
	/** Actual invoking control; pointer toolbars may retain focus in another control. */
	readonly invocationOrigin?: InputFocusTarget;
	/** Explicit action capability owner; physical context menus use the invoking leaf. */
	readonly commandTarget?: InputFocusTarget | null;
	/** Pointer context menus return to the clicked client, independent of the previously focused control. */
	readonly returnFocus?: InputFocusTarget;
};

type ContextMenuCommandRunner = EditorCommandRunner & { isActive?(command: EditorCommandId): boolean };

type ContextMenuSession = {
	readonly commands: ContextMenuCommandRunner;
	readonly options: ContextMenuOptions;
	readonly invocationOrigin: InputFocusTarget | null;
	returnFocus: InputFocusTarget | null;
	readonly commandOrigin: InputFocusTarget | null;
	readonly disposables: DisposableStore;
	readonly presentation: DisposableStore;
	contextAdmitted: boolean;
	unbindOrigin: (() => void) | undefined;
};

/** One workbench popup lifetime. Contributions own targets and command admission. */
export class ContextMenuController implements PointerCaptureTarget {
	public readonly pointerScope = Symbol('context menu');
	public readonly model = new ContextMenuModel();
	public readonly focusTarget: InputFocusTarget;
	private readonly scroll: WorkbenchScrollControl;
	private session: ContextMenuSession | undefined;
	private retiringSession: ContextMenuSession | undefined;
	private requestRevision = 0;
	private pressedIndex = -1;
	private triggerKey: string | undefined;
	private revision = 0;
	private pointerX = 0;
	private pointerY = 0;
	private pointerKnown = false;
	private readonly unbindKeyboard: () => void;
	private readonly unbindBlur: () => void;

	public constructor(private readonly focus: InputFocusService, private readonly capture: PointerCaptureService,
		private readonly onDidChangeVisibility: (lifetime?: DisposableStore) => void = () => {}) {
		this.focusTarget = focus.createTarget(null, new InputFocusScope(this.pointerScope));
		this.focusTarget.canFocus = () => this.session !== undefined;
		this.scroll = new WorkbenchScrollControl(focus, capture, this.focusTarget, undefined, this.pointerScope);
		this.scroll.setInput(this.model.viewport);
		this.unbindKeyboard = this.focusTarget.bindKeyboard(input => this.handleKeyboard(input), () => this.cancelPointer());
		this.unbindBlur = this.focusTarget.onDidBlur(() => { if (this.session !== undefined) this.hide(false); });
	}

	public get visible(): boolean { return this.session !== undefined; }
	public get invocationOrigin(): InputFocusTarget | null { return this.session!.invocationOrigin; }
	public get returnFocus(): InputFocusTarget | null { return this.session!.returnFocus; }

	/** Domain invalidation belongs in onWillShow, before departing focus can publish source changes. */
	public show(x: number, y: number, items: readonly WorkbenchMenuItem[], commands: ContextMenuCommandRunner,
		options: ContextMenuOptions = {}): DisposableStore {
		const request = ++this.requestRevision;
		const disposables = new DisposableStore();
		const focusOrigin = this.focus.target === null ? this.focus.pendingTarget : this.focus.target;
		const origin = this.session !== undefined ? this.session.returnFocus
			: this.retiringSession !== undefined && focusOrigin === this.focusTarget ? this.retiringSession.returnFocus : focusOrigin;
		const invocationOrigin = options.invocationOrigin === undefined ? origin : options.invocationOrigin;
		const returnOrigin = options.returnFocus === undefined ? origin : options.returnFocus;
		const commandOrigin = options.commandTarget === undefined ? invocationOrigin : options.commandTarget;
		const retiring = this.retiringSession;
		if (retiring !== undefined) {
			retiring.contextAdmitted = false; retiring.unbindOrigin?.(); retiring.disposables.dispose();
			if (this.retiringSession === retiring) this.retiringSession = undefined;
		}
		this.retireSession(false);
		if (request !== this.requestRevision) { disposables.dispose(); return disposables; }
		this.capture.cancel();
		if (request !== this.requestRevision) { disposables.dispose(); return disposables; }
		const session: ContextMenuSession = { commands, invocationOrigin, returnFocus: returnOrigin, commandOrigin, disposables, options,
			presentation: new DisposableStore(), contextAdmitted: true, unbindOrigin: undefined };
		this.session = session;
		session.unbindOrigin = commandOrigin?.commandContext.scope.onDidRetireContext(() => {
			session.contextAdmitted = false;
			if (this.session === session) this.hide(false);
		});
		this.focusTarget.commandContext = commandOrigin === null ? this.focusTarget : commandOrigin;
		this.model.setItems(items, x, y, options.shortTitles, options.placement);
		this.pointerX = x;
		this.pointerY = y;
		this.pointerKnown = !options.selectFirst;
		// The source session owns its presentation attachment. It must already
		// exist when the focus owner evaluates the popup's surface admission.
		this.onDidChangeVisibility(session.presentation);
		if (this.session !== session) return disposables;
		options.onWillShow?.(disposables);
		if (this.session !== session) return disposables;
		this.focusTarget.focus();
		if (this.session !== session) return disposables;
		session.returnFocus = this.focus.resolveTarget(returnOrigin);
		this.update();
		if (this.session !== session) return disposables;
		if (options.selectFirst) this.model.selectNext(1);
		layoutContextMenu(this);
		this.revision = this.model.viewport.revision;
		return disposables;
	}

	public hide(restoreFocus = true): void {
		if (this.retiringSession !== undefined) this.retiringSession.contextAdmitted = false;
		this.requestRevision++;
		this.retireSession(restoreFocus);
	}

	private retireSession(restoreFocus: boolean, handoff = false): void {
		const session = this.session;
		if (session === undefined) return;
		const request = this.requestRevision;
		this.session = undefined;
		if (!handoff) { session.contextAdmitted = false; session.unbindOrigin?.(); }
		this.retiringSession = session;
		this.cancelPointer();
		this.scroll.cancelPointer();
		session.presentation.dispose();
		if (!handoff) {
			session.disposables.dispose();
			if (this.retiringSession === session) this.retiringSession = undefined;
		}
		if (request !== this.requestRevision) return;
		if (restoreFocus && (this.focusTarget.hasFocus || this.focus.pendingTarget === this.focusTarget)) this.focus.setTarget(session.returnFocus);
		if (request !== this.requestRevision) return;
		this.focusTarget.commandContext = this.focusTarget;
		this.onDidChangeVisibility();
	}

	public update(): void {
		const session = this.session;
		if (session === undefined) return;
		if (this.revision !== this.model.viewport.revision) {
			this.cancelPointer();
			this.revision = this.model.viewport.revision;
		}
		for (const row of this.model.rows) {
			if (row.command === undefined) continue;
			const enabled = session.commands.isEnabled(row.command, session.commandOrigin);
			if (this.session !== session) return;
			row.enabled = enabled;
			const active = session.commands.isActive?.(row.command) === true;
			if (this.session !== session) return;
			if (active !== row.active) {
				row.active = active;
				this.model.setLabel(row, editorCommandTitle(row.command, active, session.options.shortTitles).toUpperCase());
			}
		}
		if (this.pressedIndex >= 0 && !this.model.rows[this.pressedIndex].enabled) this.cancelPointer();
		if (this.model.selectedIndex >= 0 && !this.model.rows[this.model.selectedIndex].enabled) this.model.selectNext(1);
	}

	public accept(): void {
		const index = this.model.selectedIndex;
		if (index < 0) return;
		const command = this.model.rows[index].command!;
		const session = this.session!, { commands, commandOrigin } = session;
		const enabled = commands.isEnabled(command, commandOrigin);
		if (this.session !== session || !enabled) return;
		this.requestRevision++;
		try {
			this.retireSession(true, true);
			session.disposables.dispose();
			if (session.contextAdmitted) commands.execute(command, commandOrigin);
		} finally {
			session.contextAdmitted = false; session.unbindOrigin?.(); session.disposables.dispose();
			if (this.retiringSession === session) this.retiringSession = undefined;
		}
	}

	public cancelPointer(): void { this.capture.release(this); this.pressedIndex = -1; this.triggerKey = undefined; }

	public handlePointer(snapshot: PointerSnapshot): boolean {
		if (!snapshot.valid || !snapshot.insideViewport) return true;
		const x = snapshot.viewportX;
		const y = snapshot.viewportY;
		if ((snapshot.justPressedButtons & PointerButton.Secondary) !== 0) {
			const inside = point_in_rect(x, y, this.model.bounds);
			this.hide();
			return inside; // A new right-click outside targets the underlying contribution.
		}
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0 && !point_in_rect(x, y, this.model.bounds)) {
			this.hide();
			return true;
		}
		if (point_in_rect(x, y, this.model.viewport.scrollbar.getTrack())) {
			this.scroll.handlePointer(snapshot);
			return true;
		}
		const moved = this.pointerKnown && (this.pointerX !== x || this.pointerY !== y);
		this.pointerX = x;
		this.pointerY = y;
		this.pointerKnown = true;
		if (moved || (snapshot.justPressedButtons & PointerButton.Primary) !== 0) {
			const index = this.model.hitTest(x, y);
			this.model.selectedIndex = index >= 0 && this.model.rows[index].enabled ? index : -1;
		}
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0 && this.model.selectedIndex >= 0) {
			this.capture.capture(this, PointerButton.Primary, this.pointerScope);
			this.pressedIndex = this.model.selectedIndex;
			if ((snapshot.justReleasedButtons & PointerButton.Primary) !== 0) this.releaseCapturedPointer(snapshot);
		}
		return true;
	}

	public handleCapturedPointer(snapshot: PointerSnapshot): void {
		const index = this.model.hitTest(snapshot.viewportX, snapshot.viewportY);
		this.model.selectedIndex = index === this.pressedIndex ? index : -1;
	}

	public releaseCapturedPointer(snapshot: PointerSnapshot): void {
		this.handleCapturedPointer(snapshot);
		this.cancelPointer();
		if (this.model.selectedIndex >= 0) this.accept();
	}

	public handleWheel(steps: number): void {
		this.cancelPointer();
		this.scroll.cancelPointer();
		const view = this.model.viewport;
		view.scrollbar.setScroll(view.scrollTop + steps * this.model.rowHeight);
	}

	public handleKeyboard(input: KeyInputEvent): boolean {
		if (isKeyJustPressed('Escape', input) || isKeyJustPressed('Tab', input)) {
			consumeIdeKey('Escape', input);
			consumeIdeKey('Tab', input);
			this.hide();
			return true;
		}
		if (input.modifiers !== KeyModifier.none) {
			if (this.triggerKey !== undefined) this.cancelPointer();
			return false;
		}
		const navigate = this.session!.options.onNavigate;
		if (navigate !== undefined && (isKeyDown('ArrowLeft', input) || isKeyDown('ArrowRight', input))) {
			consumeIdeKey(input.code, input);
			this.cancelPointer();
			navigate(input.code === 'ArrowLeft' ? -1 : 1);
			return true;
		}
		if (ACCEPT_KEYS.includes(input.code as typeof ACCEPT_KEYS[number]) && !input.consumed) {
			if (input.down && !input.repeat && this.triggerKey === undefined && this.model.selectedIndex >= 0) {
				this.cancelPointer();
				this.triggerKey = input.code;
				this.pressedIndex = this.model.selectedIndex;
			}
			consumeIdeKey(input.code, input);
			if (input.code === this.triggerKey && !input.down) {
				const accept = this.model.selectedIndex === this.pressedIndex;
				this.cancelPointer();
				if (accept) this.accept();
			}
			return true;
		}
		for (const code of NAVIGATION_KEYS) if (isKeyDown(code, input)) {
			consumeIdeKey(code, input);
			this.cancelPointer();
			switch (code) {
				case 'ArrowUp': this.model.selectNext(-1, this.model.selectedIndex < 0 ? 0 : this.model.selectedIndex); break;
				case 'ArrowDown': this.model.selectNext(1); break;
				case 'Home': this.model.selectNext(1, -1); break;
				case 'End': this.model.selectNext(-1, 0); break;
			}
			return true;
		}
		return false;
	}

	public dispose(): void {
		this.hide();
		this.scroll.dispose();
		this.unbindKeyboard();
		this.unbindBlur();
	}
}

const ACCEPT_KEYS = ['Enter', 'NumpadEnter', 'Space'] as const;
const NAVIGATION_KEYS = ['ArrowUp', 'ArrowDown', 'Home', 'End'] as const;
