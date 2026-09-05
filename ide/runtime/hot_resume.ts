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
} from '../../machine/ts/spec/bmsx/io';
import type { RuntimeSourceState } from './sources';
import type { Blua32SourceMedia } from './sources';
import type { RuntimeLuaTooling } from './lua_tooling';
import {
	applyRuntimeDebuggerHotResume,
	buildRuntimeBreakpointPcs,
	discardRuntimeDebuggerFramesFrom,
	pushRuntimeDebuggerControlPlan,
	type RuntimeDebuggerState,
} from './debugger_state';
import {
	RuntimeDebuggerPlanResult,
	type RuntimeDebuggerControlPlan,
} from './debugger_plans';
import type { RuntimeFaultState } from './fault_state';
import type { CartEditor } from '../cart_editor';
import {
	applyHotResumeRelocation,
	buildHotResumeRelocation,
	type HotResumeRevision,
	type HotResumeRevisions,
} from './hot_resume_relocation';
import { clearExecutionStopHighlights } from '../runtime_error/navigation';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { blua32ToolingImageForDomain } from '../../toolchain/ts/rompack/blua32_media';

export type BuiltBlua32Revision = {
	mediaInstallation: Blua32MediaInstallation;
	revisions: HotResumeRevisions;
};

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
		private readonly onError: (error: unknown) => void,
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
		this.runtimeTasks.schedule(this.installation, this.onError);
		return RuntimeDebuggerPlanResult.Complete;
	}

	public didFault(): RuntimeDebuggerPlanResult {
		this.input.setProgrammaticSupervisorRequestLine(false);
		return RuntimeDebuggerPlanResult.Complete;
	}

	public discard(): void {
		this.input.setProgrammaticSupervisorRequestLine(false);
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
			freshImage: rebuilt.system.linked.layout,
			revision: buildBlua32ExecutionRevision(
				rebuilt.system.previousImage,
				rebuilt.system.previousSymbols,
				sources.systemInstalledBlua32Sources,
				rebuilt.system.linked,
				rebuilt.system.sources,
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
			freshImage: image.linked.layout,
			revision: buildBlua32ExecutionRevision(
				image.previousImage,
				image.previousSymbols,
				cartridge.installedBlua32Sources,
				image.linked,
				image.sources,
			),
		};
	}

	return {
		mediaInstallation: layoutBlua32MediaInstallation(sources, rebuilt, assetEdits),
		revisions,
	};
}

export function installBlua32Revision(
	sources: RuntimeSourceState,
	editor: CartEditor,
	runtime: Runtime,
	built: BuiltBlua32Revision,
	relocation: Uint32Array,
): void {
	const rebuilt = built.mediaInstallation.rebuilt;
	const cpu = runtime.machine.cpu;
	const executionAddressSpace = runtime.machine.executionAddressSpace;
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
	editor.clearNativeMemberCompletionCache();
}

export function hotResume(
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
	fault: RuntimeFaultState,
	debuggerState: RuntimeDebuggerState,
	input: Input,
	runtimeTasks: RuntimeTaskQueue,
	editor: CartEditor,
	runtime: Runtime,
	rebuildSystem: boolean,
	rebuildCartridgeSlots: readonly [boolean, boolean],
	onDeferredError: (error: unknown) => void,
	installationCompleted: (() => void) | null,
): void {
	try {
		const rebuildCartridgeSlot0 = rebuildCartridgeSlots[0];
		const rebuildCartridgeSlot1 = rebuildCartridgeSlots[1];
		const rebuildMedia = rebuildSystem
			|| rebuildCartridgeSlot0
			|| rebuildCartridgeSlot1;
		const built = rebuildMedia
			? buildBlua32Revision(
				sources,
				luaTooling,
				runtime,
				rebuildSystem,
				rebuildCartridgeSlots,
			)
			: null;
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
			userFrameDepth = 0;
			while (!cpu.isExceptionFrame(userFrameDepth)) {
				userFrameDepth += 1;
			}
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
		const installation = (): void => {
			applyPreparedHotResume(
				sources,
				luaTooling,
				fault,
				debuggerState,
				editor,
				runtime,
				prepared,
			);
			if (installationCompleted !== null) {
				installationCompleted();
			}
		};
		if (deferUntilUserExecution) {
			const targetFrameIndex = userFrameDepth - 1;
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
					onDeferredError,
				),
			);
			return;
		}
		installation();
	} catch (error) {
		throw convertToError(error);
	}
}

function applyPreparedHotResume(
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
	fault: RuntimeFaultState,
	debuggerState: RuntimeDebuggerState,
	editor: CartEditor,
	runtime: Runtime,
	prepared: PreparedHotResume,
): void {
	const cpu = runtime.machine.cpu;
	const retainedFrameCount = prepared.failedCompletionFrameIndex >= 0
		? prepared.failedCompletionFrameIndex
		: cpu.getFrameDepth();
	const relocation = prepared.built === null
		? null
		: buildHotResumeRelocation(cpu, prepared.built.revisions, retainedFrameCount);
	if (prepared.failedCompletionFrameIndex >= 0) {
		cpu.abortCompletionCall(prepared.failedCompletionFrameIndex);
		debuggerState.plans.discardCompletionBatchesFrom(
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
			editor,
			runtime,
			prepared.built,
			relocation!,
		);
	}
	luaTooling.luaInterpreter.clearLastFaultEnvironment();
	clearFaultSnapshot(fault);
	resetHandledLuaErrors(fault);
	clearExecutionStopHighlights();
	applyRuntimeDebuggerHotResume(
		debuggerState,
		buildRuntimeBreakpointPcs(debuggerState, prepared.media),
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
			cpu,
			firstFrameIndex,
			stagedExecutionDomains,
		);
	}
}
