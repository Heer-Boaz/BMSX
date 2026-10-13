import { BrowserInputTraceBuffer, BROWSER_INPUT_TRACE_TOUCH_IDS } from './input_trace_buffer';
import type { BrowserInputDiagnostics, BrowserInputResetReason, BrowserInputTraceRoute } from './input_trace_contract';
import { BrowserInputTraceView } from './input_trace_view';
import type { BrowserOnscreenGamepad } from './onscreen_gamepad';
import type { GamepadInput } from '../common/input/gamepad';

/** Opt-in native observation. Installed before the input owner's capture listeners. */
export class BrowserInputTrace implements BrowserInputDiagnostics {
	readonly buffer = new BrowserInputTraceBuffer();
	readonly view: BrowserInputTraceView;
	private controller: BrowserOnscreenGamepad | null = null;
	commonGamepad: GamepadInput | null = null;

	constructor(private readonly window: Window) {
		this.view = new BrowserInputTraceView(window.document, this.buffer);
		window.addEventListener('error', this.onError, { capture: true });
		window.addEventListener('unhandledrejection', this.onRejection);
		for (const kind of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) {
			window.addEventListener(kind, this.onPointer, { capture: true, passive: true });
		}
		for (const kind of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
			window.addEventListener(kind, this.onTouch, { capture: true, passive: true });
		}
		window.addEventListener('blur', this.onLifecycle, { capture: true });
		window.addEventListener('pagehide', this.onLifecycle, { capture: true });
		window.document.addEventListener('visibilitychange', this.onLifecycle, { capture: true });
		this.setStatus('Wacht op spel');
	}

	setController(controller: BrowserOnscreenGamepad | null): void {
		this.controller = controller;
		this.setStatus('Input verbonden');
	}

	setCommonGamepad(gamepad: GamepadInput | null): void {
		this.commonGamepad = gamepad;
	}

	/** Observe authoritative layout admission and its retained-contact edges. */
	controllerLayout(revision: number, left: number, top: number, width: number, height: number, before: number, after: number, commonBefore: number): void {
		if (this.buffer.frozen) return;
		const common = this.commonGamepad ? this.commonGamepad.physicalGamepadButtonsWord() : -1;
		this.view.setButtons(after, common);
		const record = this.buffer.reserve('control-layout', 'layout', this.window.performance.now());
		record.geometryRevision = revision;
		record.x = left;
		record.y = top;
		record.width = width;
		record.height = height;
		record.route = 'controller';
		record.before = before;
		record.after = after;
		record.commonBefore = commonBefore;
		record.commonAfter = common;
	}

	setStatus(status: string): void {
		if (!this.buffer.frozen) this.buffer.reserve('status', 'status', this.window.performance.now()).message = status;
		this.view.setStatus(status);
	}

	pointerRouted(event: PointerEvent, route: BrowserInputTraceRoute, before: number, after: number, commonBefore: number, commonAfter: number, completed: boolean): void {
		if (this.buffer.frozen || this.view.contains(event.target)) return;
		this.view.setButtons(after, commonAfter);
		const record = this.pointerRecord(event, 'route');
		record.route = route;
		record.before = before;
		record.after = after;
		record.commonBefore = commonBefore;
		record.commonAfter = commonAfter;
		record.completed = completed;
	}

	inputReset(reason: BrowserInputResetReason, before: number, after: number, commonBefore: number, commonAfter: number, completed: boolean): void {
		if (this.buffer.frozen) return;
		this.view.setButtons(after, commonAfter);
		const record = this.buffer.reserve(reason, 'reset', this.window.performance.now());
		record.route = 'all-input';
		record.before = before;
		record.after = after;
		record.commonBefore = commonBefore;
		record.commonAfter = commonAfter;
		record.completed = completed;
	}

	bootError(error: unknown): void {
		this.buffer.recordError('boot', this.window.performance.now(), error instanceof Error ? `${String(error)}\n${error.stack}` : String(error));
		this.view.setStatus('Opstartfout');
	}

	private pointerRecord(event: PointerEvent, phase: string) {
		const record = this.buffer.reserve(event.type, phase, event.timeStamp);
		record.pointerId = event.pointerId;
		record.pointerType = event.pointerType;
		record.primary = event.isPrimary;
		record.trusted = event.isTrusted;
		record.cancelable = event.cancelable;
		record.prevented = event.defaultPrevented;
		record.x = event.clientX;
		record.y = event.clientY;
		record.width = event.width;
		record.height = event.height;
		record.geometryRevision = this.controller ? this.controller.geometryRevision : 0;
		record.nativeButtons = event.buttons;
		record.pressure = event.pressure;
		record.target = event.target instanceof Element ? event.target.id : '';
		record.before = this.controller ? this.controller.buttons : 0;
		record.after = record.before;
		return record;
	}

	private readonly onPointer = (event: PointerEvent): void => {
		if (this.buffer.frozen || this.view.contains(event.target)) return;
		this.pointerRecord(event, 'native');
	};

	private readonly onTouch = (event: TouchEvent): void => {
		if (this.buffer.frozen || this.view.contains(event.target)) return;
		const record = this.buffer.reserve(event.type, 'native', event.timeStamp);
		record.pointerType = 'touch-snapshot';
		record.trusted = event.isTrusted;
		record.cancelable = event.cancelable;
		record.prevented = event.defaultPrevented;
		record.target = event.target instanceof Element ? event.target.id : '';
		record.touchCount = event.touches.length;
		record.changedTouchCount = event.changedTouches.length;
		for (let index = 0; index < Math.min(event.touches.length, BROWSER_INPUT_TRACE_TOUCH_IDS); index += 1) {
			record.touchIds[index] = event.touches[index].identifier;
		}
		for (let index = 0; index < Math.min(event.changedTouches.length, BROWSER_INPUT_TRACE_TOUCH_IDS); index += 1) {
			record.changedTouchIds[index] = event.changedTouches[index].identifier;
		}
	};

	private readonly onLifecycle = (event: Event): void => {
		if (this.buffer.frozen) return;
		const record = this.buffer.reserve(event.type, 'native', event.timeStamp);
		record.before = this.controller ? this.controller.buttons : 0;
		record.after = record.before;
		record.message = this.window.document.visibilityState;
	};

	private readonly onError = (event: Event): void => {
		let message: string;
		if (event instanceof ErrorEvent) {
			message = `${event.message}\n${event.filename}:${event.lineno}:${event.colno}\n${event.error instanceof Error ? event.error.stack : ''}`;
		} else if (event.target instanceof HTMLScriptElement) {
			message = `Script kon niet laden: ${event.target.src}`;
		} else {
			message = 'Resource kon niet laden';
		}
		this.buffer.recordError('javascript', event.timeStamp, message);
		this.view.setStatus('Fout vastgelegd');
	};

	private readonly onRejection = (event: PromiseRejectionEvent): void => {
		this.buffer.recordError('promise', event.timeStamp, event.reason instanceof Error ? `${String(event.reason)}\n${event.reason.stack}` : String(event.reason));
		this.view.setStatus('Fout vastgelegd');
	};
}
