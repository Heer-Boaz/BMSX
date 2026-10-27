import { HostPauseReason } from '../../../../hosts/common/execution_control';
import type { InputFocusScope, InputFocusService, InputFocusTarget } from '../../../input/focus';
import type { InputInteraction } from '../../../input/interaction';
import type { RuntimeTransport } from '../../../runtime/transport';

/** Automatic UI holds follow the activated client, independently of focus and the selected run target. */
export class WorkbenchInteraction {
	private active = false;
	private scope: InputFocusScope | undefined;
	private context: InputInteraction | undefined;
	private unbindContext: (() => void) | undefined;
	private unbindScope: (() => void) | undefined;
	private unbindTransport: (() => void) | undefined;
	private observedTransport: RuntimeTransport | null = null;
	private primaryHeld = false;
	private heldTarget: RuntimeTransport | undefined;
	private readonly unbindActivation: () => void;

	public constructor(focus: InputFocusService, private readonly primary: RuntimeTransport) {
		this.unbindActivation = focus.onDidActivateInteraction(target => {
			const scope = target.scope.interactionOwner;
			if (this.active && scope !== undefined && scope.interaction !== null) this.activate(scope, scope.interaction!);
		});
	}
	public setActive(active: boolean): void {
		if (this.active === active) return;
		this.active = active;
		if (!active) this.clearContext();
		this.publish();
	}
	/** An explicit runtime action activates its declared client without stealing a field's keyboard focus. */
	public activateRuntime(target: InputFocusTarget): void {
		const context = target.scope.runtimeOwner?.runtime;
		if (this.active && context !== undefined) this.activate(context.target.scope, context.interaction);
	}
	private activate(scope: InputFocusScope, context: InputInteraction): void {
		if (context.transport !== null && !context.transport.available) {
			this.clearContext(); this.publish(); return;
		}
		if (this.scope === scope && this.context === context) return;
		this.clearContext();
		this.scope = scope; this.context = context;
		this.unbindScope = scope.onDidRetireContext(() => { this.clearContext(); this.publish(); });
		this.unbindContext = context.onDidChange(() => this.publish());
		this.publish();
	}
	private clearContext(): void {
		this.unbindContext?.(); this.unbindContext = undefined;
		this.unbindScope?.(); this.unbindScope = undefined;
		this.unbindTransport?.(); this.unbindTransport = undefined;
		this.scope = undefined; this.context = undefined; this.observedTransport = null;
	}
	private publish(): void {
		const target = this.context === undefined ? null : this.context.transport;
		if (target !== this.observedTransport) {
			this.unbindTransport?.();
			this.observedTransport = target;
			this.unbindTransport = target?.onDidRetire(() => { this.clearContext(); this.publish(); });
		}
		const admitted = target !== null && target.available;
		const primaryHeld = this.active && !(admitted && target === this.primary && this.context!.running);
		const heldTarget = this.active && admitted && target !== this.primary && !this.context!.running ? target : undefined;
		if (this.heldTarget !== heldTarget) {
			if (this.heldTarget?.available) this.heldTarget.execution.setPauseReason(HostPauseReason.Workbench, false);
			this.heldTarget = heldTarget;
			if (heldTarget !== undefined) heldTarget.execution.setPauseReason(HostPauseReason.Workbench, true);
		}
		if (this.primaryHeld !== primaryHeld) {
			this.primaryHeld = primaryHeld;
			this.primary.execution.setPauseReason(HostPauseReason.Workbench, primaryHeld);
		}
	}
	public dispose(): void {
		this.unbindActivation();
		this.setActive(false);
		this.clearContext();
	}
}
