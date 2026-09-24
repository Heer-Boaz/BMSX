import { retireRuntimeFrameScopes } from './frame_scopes';
import type { SuspendedGuestSession } from './suspended_guest';
import { convertToError } from '../language/lua/interpreter/value';
import type { Input } from '../../hosts/common/input/manager';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import {
	buildBlua32ExecutionRevision,
} from '../../toolchain/ts/rompack/blua32_revision';
import { clearFaultSnapshot, resetHandledLuaErrors } from './fault_state';
import {
	buildBlua32Media,
	installBlua32Media,
	layoutBlua32MediaInstallation,
	type Blua32MediaInstallation,
	type RuntimeRomAssetEditBatch,
} from './lua_pipeline';
import { CARTRIDGE_RESOURCE_DOMAINS } from '../common/resource';
import {
	SYSTEM_EXECUTION_DOMAIN_ID,
	executionDomainBit,
	type ExecutionDomainId,
	type ExecutionDomainMask,
} from '../../machine/ts/spec/blua32/execution_domain';
import {
	IO_SYS_STATUS,
	SYS_STATUS_SUPERVISOR_ACTIVE,
	SYS_STATUS_SUPERVISOR_RESUMABLE,
	IO_SYS_SUPERVISOR_FAULT_SEQUENCE,
} from '../../machine/ts/spec/bmsx/io';
import type { RuntimeSourceState } from './sources';
import type { Blua32SourceMedia } from './sources';
import type { RuntimeLuaTooling } from './lua_tooling';
import {
	applyRuntimeDebuggerHotResume,
	discardRuntimeDebuggerFramesFrom,
	pushRuntimeDebuggerControlPlan,
	type RuntimeDebuggerState,
} from './debugger_state';
import {
	RuntimeDebuggerPlanResult,
	type RuntimeDebuggerControlPlan,
} from './debugger_plans';
import type { RuntimeFaultState } from './fault_state';
import {
	applyHotResumeRelocation,
	buildHotResumeRelocation,
	type HotResumeRevision,
	type HotResumeRevisions,
} from './hot_resume_relocation';
import { clearAllRuntimeErrorOverlays } from '../runtime_error/navigation';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { blua32ToolingImageForDomain } from '../../toolchain/ts/rompack/blua32_media';

export type BuiltBlua32Revision = {
	sourceEditDomains: ExecutionDomainMask;
	mediaInstallation: Blua32MediaInstallation;
	revisions: HotResumeRevisions;
};

/** Runtime evidence, distinct from source preparation and command presentation. */
export type HotResumeEvent =
	| { readonly kind: 'applied' | 'initializing' | 'completed' | 'discarded' }
	| { readonly kind: 'rejected' | 'failed'; readonly error: unknown }
	| { readonly kind: 'faulted'; readonly sequence: number };

export type HotResumeAdmission = 'applied' | 'deferred' | 'rejected';

type PreparedHotResume = {
	readonly built: BuiltBlua32Revision | null;
	readonly media: Blua32SourceMedia;
	readonly initCalls: readonly PreparedHotResumeInitCall[];
	readonly failedCompletionFrameIndex: number;
};

type PreparedHotResumeInitCall = {
	readonly executionDomain: ExecutionDomainId;
	readonly functionAddress: number;
};

const enum HotResumeSupervisorPlanPhase {
	AwaitingSupervisorReady,
	SamplingSupervisorRequestLineLow,
	RaisingSupervisorRequest,
	RunningToUserContinuation,
	ReachedUserContinuation,
}

class HotResumeSupervisorPlan implements RuntimeDebuggerControlPlan {
	public readonly honorUserStops = false;
	private phase: HotResumeSupervisorPlanPhase;

	public constructor(
		private readonly input: Input,
		private readonly runtime: Runtime,
		private readonly runtimeTasks: RuntimeTaskQueue,
		private readonly targetFrameDepth: number,
		private readonly targetExecutionDomain: ExecutionDomainId,
		private readonly targetPc: number,
		supervisorActive: boolean,
		private readonly installation: () => void,
		private readonly isCurrent: () => boolean,
		private readonly report: (event: HotResumeEvent) => void,
	) {
		this.phase = supervisorActive
			? HotResumeSupervisorPlanPhase.AwaitingSupervisorReady
			: HotResumeSupervisorPlanPhase.RunningToUserContinuation;
	}

	public get executionDomainMask(): ExecutionDomainMask {
		return this.phase === HotResumeSupervisorPlanPhase.ReachedUserContinuation
			? 0
			: executionDomainBit(this.targetExecutionDomain);
	}

	public get preMaskableInterruptDomainMask(): ExecutionDomainMask {
		return this.executionDomainMask;
	}

	public shouldStop(executionDomainId: ExecutionDomainId, pc: number): boolean {
		if (this.phase !== HotResumeSupervisorPlanPhase.ReachedUserContinuation
			&& this.runtime.machine.cpu.isUserMode()
			&& this.runtime.machine.cpu.getFrameDepth() === this.targetFrameDepth
			&& executionDomainId === this.targetExecutionDomain
			&& pc === this.targetPc) {
			this.phase = HotResumeSupervisorPlanPhase.ReachedUserContinuation;
			return true;
		}
		return false;
	}

	public willExecute(): void {
		if (this.phase === HotResumeSupervisorPlanPhase.RaisingSupervisorRequest) {
			this.input.setProgrammaticSupervisorRequestLine(true);
			this.phase = HotResumeSupervisorPlanPhase.RunningToUserContinuation;
			return;
		}
		if (this.phase !== HotResumeSupervisorPlanPhase.AwaitingSupervisorReady) {
			return;
		}
		const status = this.runtime.machine.memory.readMappedU32LE(IO_SYS_STATUS);
		if ((status & SYS_STATUS_SUPERVISOR_RESUMABLE) !== 0
			&& !this.input.supervisorRequestLineHigh()) {
			this.phase = HotResumeSupervisorPlanPhase.SamplingSupervisorRequestLineLow;
		}
	}

	public didExecute(): RuntimeDebuggerPlanResult {
		if (this.phase === HotResumeSupervisorPlanPhase.SamplingSupervisorRequestLineLow) {
			this.phase = HotResumeSupervisorPlanPhase.RaisingSupervisorRequest;
			return RuntimeDebuggerPlanResult.Active;
		}
		if (this.phase !== HotResumeSupervisorPlanPhase.ReachedUserContinuation) {
			return RuntimeDebuggerPlanResult.Active;
		}
		this.input.setProgrammaticSupervisorRequestLine(false);
		this.runtimeTasks.schedule(() => {
			// Reset/shutdown may retire the request after the plan queues this write.
			if (this.isCurrent()) this.installation();
		}, error => this.report({ kind: 'failed', error }));
		return RuntimeDebuggerPlanResult.Complete;
	}

	public didFault(): RuntimeDebuggerPlanResult {
		this.input.setProgrammaticSupervisorRequestLine(false);
		this.report({ kind: 'faulted', sequence: this.runtime.machine.memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_SEQUENCE) });
		return RuntimeDebuggerPlanResult.Complete;
	}

	public discard(): void {
		this.input.setProgrammaticSupervisorRequestLine(false);
		this.report({ kind: 'discarded' });
	}
}

export function buildBlua32Revision(
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
	runtime: Runtime,
	rebuildSystem: boolean,
	rebuildCartridgeSlots: readonly [boolean, boolean],
	assetEdits?: RuntimeRomAssetEditBatch,
): BuiltBlua32Revision {
	const rebuilt = buildBlua32Media(
		sources,
		luaTooling.luaInterpreter,
		runtime.machine.memory.ramByteCount(),
		rebuildSystem,
		rebuildCartridgeSlots,
		'live',
		assetEdits,
	);
	const revisions: [
		HotResumeRevision | null,
		HotResumeRevision | null,
		HotResumeRevision | null,
	] = [null, null, null];
	if (rebuilt.system !== null) {
		revisions[0] = {
			previousImage: rebuilt.system.previousImage,
			revision: buildBlua32ExecutionRevision(
				rebuilt.system.previousImage,
				rebuilt.system.previousSymbols,
				sources.systemInstalledBlua32Sources,
				rebuilt.system.linked,
				rebuilt.system.sources,
				rebuilt.system.sourceCorrespondence,
			),
		};
	}
	for (const slot of CARTRIDGE_RESOURCE_DOMAINS) {
		const image = rebuilt.cartridgeSlots[slot];
		if (image === null) {
			continue;
		}
		const cartridge = sources.cartridgeSlots[slot]!;
		revisions[slot + 1] = {
			previousImage: image.previousImage,
			revision: buildBlua32ExecutionRevision(
				image.previousImage,
				image.previousSymbols,
				cartridge.installedBlua32Sources,
				image.linked,
				image.sources,
				image.sourceCorrespondence,
			),
		};
	}

	return {
		// Linker closure can rebuild an unchanged cart after a BIOS edit. Only
		// the explicitly edited source domains request another init call.
		sourceEditDomains: (rebuildSystem ? executionDomainBit(SYSTEM_EXECUTION_DOMAIN_ID) : 0)
			| (rebuildCartridgeSlots[0] ? executionDomainBit(0) : 0)
			| (rebuildCartridgeSlots[1] ? executionDomainBit(1) : 0),
		mediaInstallation: layoutBlua32MediaInstallation(sources, rebuilt),
		revisions,
	};
}

export function installBlua32Revision(
	sources: RuntimeSourceState,
	runtime: Runtime,
	guest: SuspendedGuestSession,
	built: BuiltBlua32Revision,
	relocation: Uint32Array,
): void {
	const rebuilt = built.mediaInstallation.rebuilt;
	const cpu = runtime.machine.cpu;
	const executionAddressSpace = runtime.machine.executionAddressSpace;
	retireRuntimeFrameScopes(runtime, sources, guest);
	installBlua32Media(sources, runtime, built.mediaInstallation);
	if (rebuilt.system !== null) {
		cpu.replaceExecutionImage(executionAddressSpace.resolveSystemDomain());
	}
	for (const slot of CARTRIDGE_RESOURCE_DOMAINS) {
		if (rebuilt.cartridgeSlots[slot] !== null
			&& cpu.isExecutionDomainResident(slot)) {
			const image = executionAddressSpace.resolveDomain(slot);
			if (!image) {
				throw new Error('Active execution domain has no BLua32 executable image.');
			}
			cpu.replaceExecutionImage(image);
		}
	}
	applyHotResumeRelocation(cpu, relocation);
}

/** Admit installation or a supervisor-return plan; init completion is reported by its physical roots. */
export function admitHotResume(
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
	fault: RuntimeFaultState,
	debuggerState: RuntimeDebuggerState,
	input: Input,
	runtimeTasks: RuntimeTaskQueue,
	runtime: Runtime,
	built: BuiltBlua32Revision | null,
	isCurrent: () => boolean,
	report: (event: HotResumeEvent) => void,
): HotResumeAdmission {
	try {
		const sourceEditDomains = built === null ? 0 : built.sourceEditDomains;
		const rebuildSystem = (sourceEditDomains & executionDomainBit(SYSTEM_EXECUTION_DOMAIN_ID)) !== 0;
		const rebuildCartridgeSlot0 = (sourceEditDomains & executionDomainBit(0)) !== 0;
		const rebuildCartridgeSlot1 = (sourceEditDomains & executionDomainBit(1)) !== 0;
		const rebuildMedia = built !== null;
		const freshMedia = built === null
			? sources.currentBlua32Media
			: built.mediaInstallation.sourceMedia;
		const cpu = runtime.machine.cpu;
		const activeCartridgeSlot = cpu.activeCartridgeSlot();
		let stageCartridgeInit = activeCartridgeSlot === 0
			? rebuildCartridgeSlot0 || !rebuildMedia
			: rebuildCartridgeSlot1 || !rebuildMedia;
		let cartridgeInitExecutionDomain = activeCartridgeSlot;
		let stageSystemInit = rebuildSystem;
		const supervisorActive = (
			runtime.machine.memory.readMappedU32LE(IO_SYS_STATUS)
			& SYS_STATUS_SUPERVISOR_ACTIVE
		) !== 0;
		const deferUntilUserExecution = supervisorActive || !cpu.isUserMode();
		debuggerState.plans.pruneCompletedCompletionBatches();
		let userFrameDepth = cpu.getFrameDepth();
		let failedCompletionFrameIndex = -1;
		if (deferUntilUserExecution) {
			userFrameDepth = cpu.readExceptionReturnFrameDepth();
			if (supervisorActive) {
				const exceptionFunctionAddress = sources.systemRom.header.blua32ExceptionFunctionAddress;
				let supervisorExceptionFrameIndex = cpu.getFrameDepth() - 1;
				while (!cpu.isExceptionFrame(supervisorExceptionFrameIndex)
					|| cpu.readFrameFunctionAddress(supervisorExceptionFrameIndex)
						!== exceptionFunctionAddress) {
					supervisorExceptionFrameIndex -= 1;
				}
				if (!cpu.isNonMaskableExceptionFrame(supervisorExceptionFrameIndex)) {
					let completionFrameIndex = supervisorExceptionFrameIndex - 1;
					while (completionFrameIndex >= 0
						&& !cpu.readFrameReturnsToCompletionLatch(completionFrameIndex)) {
						completionFrameIndex -= 1;
					}
					const failedBatch = debuggerState.plans.completionBatchAtFrame(
						cpu.activeThread,
						completionFrameIndex,
					);
					if (failedBatch === null) {
						failedCompletionFrameIndex = completionFrameIndex;
					} else {
						failedCompletionFrameIndex = failedBatch.firstFrameIndex;
						const uncompletedCallCount = completionFrameIndex
							- failedBatch.firstFrameIndex
							+ 1;
						for (let callIndex = 0; callIndex < uncompletedCallCount; callIndex += 1) {
							const domain = failedBatch.executionDomains[callIndex];
							if (domain === SYSTEM_EXECUTION_DOMAIN_ID) {
								stageSystemInit = true;
							} else {
								stageCartridgeInit = true;
								cartridgeInitExecutionDomain = domain;
							}
						}
					}
				}
			}
		}
		const initCalls: PreparedHotResumeInitCall[] = [];
		if (stageCartridgeInit) {
			const address = blua32ToolingImageForDomain(
				freshMedia,
				cartridgeInitExecutionDomain,
			)!.symbols!.initFunctionAddress;
			if (address !== 0) {
				initCalls.push({
					executionDomain: cartridgeInitExecutionDomain,
					functionAddress: address,
				});
			}
		}
		if (stageSystemInit) {
			const address = freshMedia.system!.symbols!.initFunctionAddress;
			if (address !== 0) {
				initCalls.push({
					executionDomain: SYSTEM_EXECUTION_DOMAIN_ID,
					functionAddress: address,
				});
			}
		}
		const prepared: PreparedHotResume = {
			built,
			media: freshMedia,
			initCalls,
			failedCompletionFrameIndex,
		};
		const installation = (): HotResumeAdmission => {
			const retainedFrameCount = prepared.failedCompletionFrameIndex >= 0
				? prepared.failedCompletionFrameIndex
				: cpu.getFrameDepth();
			let relocation: Uint32Array | null;
			try {
				relocation = prepared.built === null
					? null
					: buildHotResumeRelocation(cpu, prepared.built.revisions, retainedFrameCount);
			} catch (error) {
				// Unsupported live edits reject before any media/CPU write. They
				// must not fault the mutation queue or stop the installed program.
				report({ kind: 'rejected', error });
				return 'rejected';
			}
			applyPreparedHotResume(
				sources,
				luaTooling,
				fault,
				debuggerState,
				runtime,
				prepared,
				relocation,
				report,
			);
			report({ kind: prepared.initCalls.length === 0 ? 'completed' : 'initializing' });
			return 'applied';
		};
		if (deferUntilUserExecution) {
			const targetFrameIndex = userFrameDepth - 1;
			// The accepted supervisor-return plan executes against the retained
			// machine, not against recorded historical input.
			runtime.history.stop();
			pushRuntimeDebuggerControlPlan(
				debuggerState,
				new HotResumeSupervisorPlan(
					input,
					runtime,
					runtimeTasks,
					userFrameDepth,
					cpu.readFrameExecutionDomain(targetFrameIndex),
					cpu.readFramePc(targetFrameIndex),
					supervisorActive,
					installation,
					isCurrent,
					report,
				),
			);
			return 'deferred';
		}
		return installation();
	} catch (error) {
		throw convertToError(error);
	}
}

function applyPreparedHotResume(
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
	fault: RuntimeFaultState,
	debuggerState: RuntimeDebuggerState,
	runtime: Runtime,
	prepared: PreparedHotResume,
	relocation: Uint32Array | null,
	report: (event: HotResumeEvent) => void,
): void {
	const cpu = runtime.machine.cpu;
	// Preparation (including relocation rejection) leaves history untouched.
	// A no-source-change resume still mutates the heap through its init calls.
	if (prepared.built === null) runtime.history.stop();
	if (prepared.failedCompletionFrameIndex >= 0) {
		retireRuntimeFrameScopes(runtime, sources, luaTooling.suspendedGuest, cpu.activeThread, prepared.failedCompletionFrameIndex);
		cpu.abortCompletionCall(prepared.failedCompletionFrameIndex);
		debuggerState.plans.discardCompletionBatchesFrom(
			cpu.activeThread,
			prepared.failedCompletionFrameIndex,
		);
		discardRuntimeDebuggerFramesFrom(
			debuggerState,
			prepared.failedCompletionFrameIndex,
		);
	}
	if (prepared.built !== null) {
		installBlua32Revision(
			sources,
			runtime,
			luaTooling.suspendedGuest,
			prepared.built,
			relocation!,
		);
	}
	report({ kind: 'applied' });
	luaTooling.luaInterpreter.clearLastFaultEnvironment();
	clearFaultSnapshot(fault);
	resetHandledLuaErrors(fault);
	clearAllRuntimeErrorOverlays();
	applyRuntimeDebuggerHotResume(
		debuggerState,
		debuggerState.breakpoints.compile(prepared.media),
	);
	const firstFrameIndex = cpu.getFrameDepth();
	const stagedExecutionDomains: ExecutionDomainId[] = [];
	for (const call of prepared.initCalls) {
		cpu.beginCompletionCallInExecutionDomain(
			call.executionDomain,
			call.functionAddress,
		);
		stagedExecutionDomains.push(call.executionDomain);
	}
	if (stagedExecutionDomains.length !== 0) {
		debuggerState.plans.pushCompletionBatch(
			cpu.activeThread,
			firstFrameIndex,
			stagedExecutionDomains,
			result => report(result.status === 'faulted'
				? { kind: 'faulted', sequence: result.sequence }
				: { kind: result.status }),
		);
	}
}
