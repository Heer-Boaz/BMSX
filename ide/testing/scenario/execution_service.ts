import { InputControllerPlayback } from '../../../hosts/common/input/controller_playback';
import type { Input } from '../../../hosts/common/input/manager';
import type { Closure } from '../../../machine/ts/machine/cpu/closure';
import type { StringId } from '../../../machine/ts/machine/cpu/string_pool';
import { Table } from '../../../machine/ts/machine/cpu/table';
import {
	asStringId,
	EMPTY_CALL_ARGS,
	type StringValue,
	type Value,
	valueTag,
	ValueTag,
} from '../../../machine/ts/machine/cpu/value';
import type { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } from '../../../machine/ts/spec/bmsx/io';
import {
	SCENARIO_GUEST_OBSERVE_FSM_TRANSITIONS_KEY,
	SCENARIO_TEST_LOADER_GLOBAL,
} from '../../../toolchain/ts/rompack/scenario_guest_api';
import {
	recordSupervisorFault,
	type RuntimeFaultState,
} from '../../runtime/fault_state';
import type { RuntimeSourceState } from '../../runtime/sources';
import { SuspendedGuestSession } from '../../runtime/suspended_guest';
import {
	type ScenarioRunResult,
	ScenarioResultService,
} from './result_service';
import { ScenarioFsmTransitionObservation } from './fsm_transition_observation';

const SCENARIO_TEST_GLOBAL = '__bmsx_host_test';
const CART_SETTLE_TICKS = 5;
const GAMEPLAY_READY_SETTLE_TICKS = 50;

type ScheduledScenarioCommand = {
	log: string | null;
	capture: string | null;
	gamepadPlayer: number;
	down: string | null;
	up: string | null;
	press: string | null;
	holdTicks: number;
};

type ScenarioProtocol = {
	readonly ready: Closure;
	readonly setup: Closure;
	readonly update: Closure;
	readonly tickKey: StringId;
	readonly pressKey: StringId;
	readonly downKey: StringId;
	readonly upKey: StringId;
	readonly holdTicksKey: StringId;
	readonly gamepadKey: StringId;
	readonly captureKey: StringId;
	readonly logKey: StringId;
	readonly doneKey: StringId;
	readonly observeFsmTransitionsKey: StringId;
};

type ScenarioCartPhase = {
	readonly kind: 'cart';
	settleTicks: number;
};

type ScenarioInstallPhase = {
	readonly kind: 'install';
	readonly loader: Closure;
	guestCallPending: boolean;
};

type ScenarioReadyPhase = {
	readonly kind: 'ready';
	readonly protocol: ScenarioProtocol;
	settleTicks: number;
	guestCallPending: boolean;
};

type ScenarioSetupPhase = {
	readonly kind: 'setup';
	readonly protocol: ScenarioProtocol;
	guestCallPending: boolean;
};

type ScenarioUpdatePhase = {
	readonly kind: 'update';
	readonly protocol: ScenarioProtocol;
	scenarioTick: number;
	guestCallPending: boolean;
};

type ScenarioExecutionPhase =
	| ScenarioCartPhase
	| ScenarioInstallPhase
	| ScenarioReadyPhase
	| ScenarioSetupPhase
	| ScenarioUpdatePhase;

type ScenarioExecution = {
	readonly result: ScenarioRunResult;
	phase: ScenarioExecutionPhase;
	logicalTicks: number;
	tickPrepared: boolean;
	fsmTransitionObservation: ScenarioFsmTransitionObservation | null;
};

/**
 * Executes the packaged guest scenario protocol against one Runtime.
 * Host frame owners call prepareLogicalTick before ICU sampling and
 * didRunLogicalTick only after the scheduler publishes that exact tick.
 */
export class ScenarioExecutionService {
	private readonly playback = new InputControllerPlayback();
	private readonly suspendedGuest: SuspendedGuestSession;
	private readonly scheduledCommands = new Map<number, ScheduledScenarioCommand[]>();
	private readonly updateArgs: Value[] = [0];
	private execution: ScenarioExecution | null = null;
	private presentationResult: ScenarioRunResult | null = null;
	private supervisorFaultSequence = 0;

	public constructor(
		private readonly runtime: Runtime,
		private readonly sources: RuntimeSourceState,
		private readonly input: Input,
		private readonly fault: RuntimeFaultState,
		public readonly results: ScenarioResultService,
		private readonly maxLogicalTicks: number | null,
	) {
		this.suspendedGuest = new SuspendedGuestSession(runtime);
	}

	public get active(): boolean {
		return this.execution !== null;
	}

	public get activeResult(): ScenarioRunResult | null {
		const execution = this.execution;
		return execution === null ? null : execution.result;
	}

	public start(result: ScenarioRunResult): void {
		if (this.execution !== null) {
			throw new Error('A scenario execution is already active.');
		}
		const startTick = this.runtime.frameScheduler.lastTickSequence;
		this.scheduledCommands.clear();
		this.playback.reset();
		this.input.setInputControllerPlayback(this.playback);
		this.supervisorFaultSequence = this.runtime.machine.memory.readMappedU32LE(
			IO_SYS_SUPERVISOR_FAULT_SEQUENCE,
		);
		this.execution = {
			result,
			phase: { kind: 'cart', settleTicks: 0 },
			logicalTicks: 0,
			tickPrepared: false,
			fsmTransitionObservation: null,
		};
		this.results.appendLog(result, startTick, 'waiting for cartridge');
	}

	public prepareLogicalTick(): boolean {
		const execution = this.execution!;
		if (execution.tickPrepared) {
			return true;
		}
		try {
			const phase = execution.phase;
			if (phase.kind === 'update') {
				phase.scenarioTick += 1;
				this.applyScheduledCommands(execution, phase);
			}
			execution.tickPrepared = true;
			return true;
		} catch (error) {
			this.presentationResult = execution.result;
			this.fail(execution, error instanceof Error ? error.message : String(error));
			return false;
		}
	}

	public didRunLogicalTick(completed: boolean): void {
		if (!completed) {
			return;
		}
		const execution = this.execution!;
		execution.tickPrepared = false;
		execution.logicalTicks += 1;
		this.presentationResult = execution.result;
		try {
			this.drainFsmTransitions(execution);
			this.advance(execution);
		} catch (error) {
			this.fail(execution, error instanceof Error ? error.message : String(error));
		}
	}

	public didPresent(presentationSequence: number): number {
		const result = this.presentationResult;
		if (result === null) {
			return 0;
		}
		const captureCount = this.results.recordPresentation(result, presentationSequence);
		this.presentationResult = null;
		return captureCount;
	}

	public cancel(): void {
		const execution = this.execution!;
		this.presentationResult = null;
		this.results.cancel(
			execution.result,
			this.runtime.frameScheduler.lastTickSequence,
		);
		this.finish();
	}

	private advance(execution: ScenarioExecution): void {
		const memory = this.runtime.machine.memory;
		if (memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_SEQUENCE)
			!== this.supervisorFaultSequence) {
			const stackText = recordSupervisorFault(
				this.fault,
				this.sources,
				this.runtime,
				this.suspendedGuest,
			);
			this.results.appendLog(
				execution.result,
				this.runtime.frameScheduler.lastTickSequence,
				stackText,
			);
			this.results.requestCapture(
				execution.result,
				this.runtime.frameScheduler.lastTickSequence,
				'failed',
			);
			this.results.fail(
				execution.result,
				this.runtime.frameScheduler.lastTickSequence,
				{
					message: this.fault.faultSnapshot.message,
					location: {
						resource: this.fault.faultSnapshot.resource,
						line: this.fault.faultSnapshot.line,
						column: this.fault.faultSnapshot.column,
					},
				},
				this.fault.faultSnapshot,
			);
			this.finish();
			return;
		}
		if (this.maxLogicalTicks !== null
			&& execution.logicalTicks >= this.maxLogicalTicks) {
			this.fail(
				execution,
				`Scenario did not finish within ${this.maxLogicalTicks} logical ticks.`,
			);
			return;
		}
		if (!this.runtime.machine.cpu.isCartridgeExecutionActive()) {
			return;
		}
		const phase = execution.phase;
		switch (phase.kind) {
			case 'cart':
				phase.settleTicks += 1;
				if (phase.settleTicks === CART_SETTLE_TICKS) {
					const cpu = this.runtime.machine.cpu;
					execution.phase = {
						kind: 'install',
						loader: cpu.getGlobalByKey(
							cpu.stringPool.intern(SCENARIO_TEST_LOADER_GLOBAL),
						) as Closure,
						guestCallPending: false,
					};
				}
				return;
			case 'install':
				if (!this.guestCallCompleted(phase, phase.loader, EMPTY_CALL_ARGS)) {
					return;
				}
				const protocol = this.bindTest();
				this.results.markRunning(execution.result);
				this.results.appendLog(
					execution.result,
					this.runtime.frameScheduler.lastTickSequence,
					'scenario loaded',
				);
				execution.phase = {
					kind: 'ready',
					protocol,
					settleTicks: 0,
					guestCallPending: false,
				};
				return;
			case 'ready':
				if (!this.guestCallCompleted(phase, phase.protocol.ready, EMPTY_CALL_ARGS)) {
					return;
				}
				if (this.guestResult() !== true) {
					phase.settleTicks = 0;
					return;
				}
				phase.settleTicks += 1;
				if (phase.settleTicks === GAMEPLAY_READY_SETTLE_TICKS) {
					this.results.appendLog(
						execution.result,
						this.runtime.frameScheduler.lastTickSequence,
						'gameplay ready',
					);
					execution.phase = {
						kind: 'setup',
						protocol: phase.protocol,
						guestCallPending: false,
					};
				}
				return;
			case 'setup':
				if (!this.guestCallCompleted(phase, phase.protocol.setup, EMPTY_CALL_ARGS)) {
					return;
				}
				const updatePhase: ScenarioUpdatePhase = {
					kind: 'update',
					protocol: phase.protocol,
					scenarioTick: 0,
					guestCallPending: false,
				};
				this.applyCommands(execution, updatePhase, this.guestResult());
				this.drainFsmTransitions(execution);
				execution.phase = updatePhase;
				return;
			case 'update': {
				if (!phase.guestCallPending) {
					this.updateArgs[0] = phase.scenarioTick;
				}
				if (!this.guestCallCompleted(phase, phase.protocol.update, this.updateArgs)) {
					return;
				}
				const result = this.guestResult();
				this.applyCommands(execution, phase, result);
				this.drainFsmTransitions(execution);
				if (result === true
					|| (valueTag(result) === ValueTag.Table
						&& (result as Table).getStringKey(phase.protocol.doneKey) === true)) {
					this.results.requestCapture(
						execution.result,
						this.runtime.frameScheduler.lastTickSequence,
						'passed',
					);
					this.results.pass(
						execution.result,
						this.runtime.frameScheduler.lastTickSequence,
					);
					this.finish();
				}
				return;
			}
		}
	}

	private bindTest(): ScenarioProtocol {
		const cpu = this.runtime.machine.cpu;
		const testTable = cpu.getGlobalByKey(
			cpu.stringPool.intern(SCENARIO_TEST_GLOBAL),
		) as Table;
		return {
			ready: testTable.getStringKey(cpu.stringPool.intern('ready')) as Closure,
			setup: testTable.getStringKey(cpu.stringPool.intern('setup')) as Closure,
			update: testTable.getStringKey(cpu.stringPool.intern('update')) as Closure,
			tickKey: cpu.stringPool.intern('tick'),
			pressKey: cpu.stringPool.intern('press'),
			downKey: cpu.stringPool.intern('down'),
			upKey: cpu.stringPool.intern('up'),
			holdTicksKey: cpu.stringPool.intern('hold_ticks'),
			gamepadKey: cpu.stringPool.intern('gamepad'),
			captureKey: cpu.stringPool.intern('capture'),
			logKey: cpu.stringPool.intern('log'),
			doneKey: cpu.stringPool.intern('done'),
			observeFsmTransitionsKey: cpu.stringPool.intern(
				SCENARIO_GUEST_OBSERVE_FSM_TRANSITIONS_KEY,
			),
		};
	}

	private guestCallCompleted(
		phase: { guestCallPending: boolean },
		fn: Closure,
		args: ReadonlyArray<Value>,
	): boolean {
		if (!phase.guestCallPending) {
			this.runtime.callClosure(fn, args);
			phase.guestCallPending = this.runtime.completionCallPending();
			return !phase.guestCallPending;
		}
		phase.guestCallPending = this.runtime.completionCallPending();
		return !phase.guestCallPending;
	}

	private guestResult(): Value {
		const results = this.runtime.readCompletionValues();
		return results.length === 0 ? null : results[0];
	}

	private applyCommands(
		execution: ScenarioExecution,
		phase: ScenarioUpdatePhase,
		value: Value,
	): void {
		switch (valueTag(value)) {
			case ValueTag.Nil:
			case ValueTag.False:
			case ValueTag.True:
				return;
			case ValueTag.String:
				this.results.appendLog(
					execution.result,
					this.runtime.frameScheduler.lastTickSequence,
					this.runtime.machine.cpu.stringPool.toString(asStringId(value as StringValue)),
				);
				return;
			case ValueTag.Table:
				this.applyCommandTable(execution, phase, value as Table);
				return;
			case ValueTag.Number:
			case ValueTag.Closure:
			case ValueTag.BuiltinFunction:
				throw new Error('Scenario update returned an unsupported command value.');
		}
	}

	private applyCommandTable(
		execution: ScenarioExecution,
		phase: ScenarioUpdatePhase,
		command: Table,
	): void {
		const protocol = phase.protocol;
		const tickValue = command.getStringKey(protocol.tickKey);
		const pressValue = command.getStringKey(protocol.pressKey);
		const downValue = command.getStringKey(protocol.downKey);
		const upValue = command.getStringKey(protocol.upKey);
		const holdTicksValue = command.getStringKey(protocol.holdTicksKey);
		const gamepadValue = command.getStringKey(protocol.gamepadKey);
		const captureValue = command.getStringKey(protocol.captureKey);
		const logValue = command.getStringKey(protocol.logKey);
		const fsmTransitionsValue = command.getStringKey(
			protocol.observeFsmTransitionsKey,
		);
		if (fsmTransitionsValue !== null) {
			execution.fsmTransitionObservation = new ScenarioFsmTransitionObservation(
				fsmTransitionsValue as Table,
				this.runtime.machine.cpu.stringPool,
				this.results,
				execution.result,
			);
			return;
		}
		if (pressValue === null
			&& downValue === null
			&& upValue === null
			&& captureValue === null
			&& logValue === null) {
			for (let index = 1; index <= command.arrayLength; index += 1) {
				this.applyCommands(execution, phase, command.getInteger(index));
			}
			return;
		}
		const stringPool = this.runtime.machine.cpu.stringPool;
		const press = pressValue === null
			? null
			: stringPool.toString(asStringId(pressValue as StringValue));
		const down = downValue === null
			? null
			: stringPool.toString(asStringId(downValue as StringValue));
		const up = upValue === null
			? null
			: stringPool.toString(asStringId(upValue as StringValue));
		let capture: string | null = null;
		switch (valueTag(captureValue)) {
			case ValueTag.Nil:
				break;
			case ValueTag.True:
				capture = 'capture';
				break;
			case ValueTag.String:
				capture = stringPool.toString(asStringId(captureValue as StringValue));
				break;
			default:
				throw new Error('Scenario capture label must be true or a string.');
		}
		const log = logValue === null
			? null
			: stringPool.toString(asStringId(logValue as StringValue));
		const holdTicks = holdTicksValue === null ? 1 : holdTicksValue as number;
		const gamepadPlayer = gamepadValue === null ? 0 : gamepadValue as number;
		const scheduled = {
			log,
			capture,
			gamepadPlayer,
			down,
			up,
			press,
			holdTicks,
		};
		if (tickValue !== null && (tickValue as number) > 0) {
			this.scheduleCommand(phase.scenarioTick + (tickValue as number), scheduled);
			return;
		}
		this.applyCommand(
			execution,
			scheduled,
			phase.scenarioTick + 1,
			this.runtime.frameScheduler.lastTickSequence,
		);
	}

	private drainFsmTransitions(execution: ScenarioExecution): void {
		const observation = execution.fsmTransitionObservation;
		if (observation !== null) {
			observation.drain(this.runtime.frameScheduler.lastTickSequence);
		}
	}

	private applyScheduledCommands(
		execution: ScenarioExecution,
		phase: ScenarioUpdatePhase,
	): void {
		const commands = this.scheduledCommands.get(phase.scenarioTick);
		if (commands === undefined) {
			return;
		}
		this.scheduledCommands.delete(phase.scenarioTick);
		for (let index = 0; index < commands.length; index += 1) {
			this.applyCommand(
				execution,
				commands[index],
				phase.scenarioTick,
				this.runtime.frameScheduler.lastTickSequence + 1,
			);
		}
	}

	private scheduleCommand(tick: number, command: ScheduledScenarioCommand): void {
		let commands = this.scheduledCommands.get(tick);
		if (commands === undefined) {
			commands = [];
			this.scheduledCommands.set(tick, commands);
		}
		commands.push(command);
	}

	private applyCommand(
		execution: ScenarioExecution,
		command: ScheduledScenarioCommand,
		firstSampleScenarioTick: number,
		requestLogicalTick: number,
	): void {
		if (command.log !== null) {
			this.results.appendLog(execution.result, requestLogicalTick, command.log);
		}
		if (command.capture !== null) {
			this.results.requestCapture(execution.result, requestLogicalTick, command.capture);
		}
		const padIndex = command.gamepadPlayer - 1;
		if (command.down !== null) {
			this.setInput(command.gamepadPlayer, padIndex, command.down, true);
		}
		if (command.up !== null) {
			this.setInput(command.gamepadPlayer, padIndex, command.up, false);
		}
		if (command.press !== null) {
			this.setInput(command.gamepadPlayer, padIndex, command.press, true);
			this.scheduleCommand(firstSampleScenarioTick + command.holdTicks, {
				log: null,
				capture: null,
				gamepadPlayer: command.gamepadPlayer,
				down: null,
				up: command.press,
				press: null,
				holdTicks: 1,
			});
		}
	}

	private setInput(player: number, padIndex: number, code: string, down: boolean): void {
		if (player === 0) {
			this.playback.setKeyboardKey(code, down);
			return;
		}
		this.playback.setGamepadButton(padIndex, code, down);
	}

	private fail(execution: ScenarioExecution, message: string): void {
		this.results.requestCapture(
			execution.result,
			this.runtime.frameScheduler.lastTickSequence,
			'failed',
		);
		this.results.fail(
			execution.result,
			this.runtime.frameScheduler.lastTickSequence,
			{
				message,
				location: {
					resource: execution.result.test.resource,
					line: 1,
					column: 1,
				},
			},
			null,
		);
		this.finish();
	}

	private finish(): void {
		this.playback.reset();
		this.input.setInputControllerPlayback(null);
		this.scheduledCommands.clear();
		this.execution = null;
	}
}
