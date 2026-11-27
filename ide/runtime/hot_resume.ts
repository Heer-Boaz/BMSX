import { retireRuntimeFrameScopes } from './frame_scopes';
import { readRuntimeLuaModuleExport } from './lua_inspection';
import type { SuspendedGuestSession } from './suspended_guest';
import type { Input } from '../../hosts/common/input/manager';
import type { Blua32ExecutionBoot } from '../../machine/ts/machine/execution_address_space';
import { FRAME_CONTROL_BYTES, FRAME_WINDOW_MASK, FrameField } from '../../machine/ts/machine/cpu/call_state';
import { asInteger, isNil, valueInteger, valueNil } from '../../machine/ts/machine/cpu/value';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import {
	buildBlua32ExecutionRevision,
} from '../../toolchain/ts/rompack/blua32_revision';
import { clearFaultSnapshot } from './fault_state';
import {
	buildBlua32Media,
	installBlua32Media,
	layoutBlua32MediaInstallation,
	type Blua32MediaInstallation,
	type Blua32BuildRequest,
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
	IO_SYS_SUPERVISOR_FAULT_EPC,
	IO_SYS_SUPERVISOR_FAULT_SEQUENCE,
} from '../../machine/ts/spec/bmsx/io';
import type { RuntimeSourceState } from './sources';
import type { Blua32SourceMedia } from './sources';
import {
	applyRuntimeDebuggerHotResume,
	discardRuntimeDebuggerFramesFrom,
	pushRuntimeDebuggerControlPlan,
	type RuntimeDebuggerState,
} from './debugger_state';
import {
	RuntimeDebuggerPlanResult,
	type RuntimeDebuggerControlPlan,
	type RuntimeDebuggerExecutionContext,
} from './debugger_plans';
import { RuntimeGuestCallPlan } from './guest_call';
import type { RuntimeFaultState } from './fault_state';
import {
	applyHotResumeRelocation,
	type HotResumeRelocation,
	buildHotResumeRelocation,
	type HotResumeRevision,
	type HotResumeRevisions,
} from './hot_resume_relocation';
import { verifyHotResumeBinding } from './hot_resume_binding';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { blua32ToolingImageForDomain, stageBlua32Executable } from '../../toolchain/ts/rompack/blua32_media';
import { blua32FunctionIndexAtAddress } from '../../toolchain/ts/rompack/blua32_image';

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
	runtime: Runtime,
	request: Blua32BuildRequest,
	assetEdits?: RuntimeRomAssetEditBatch,
): BuiltBlua32Revision {
	const rebuilt = buildBlua32Media(
		sources,
		runtime.machine.memory.ramByteCount(),
		request,
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
			nextImage: rebuilt.system.linked.layout,
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
			nextImage: image.linked.layout,
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
		sourceEditDomains: (request.system === 'workspace' ? executionDomainBit(SYSTEM_EXECUTION_DOMAIN_ID) : 0)
			| (request.cartridgeSlots[0] === 'workspace' ? executionDomainBit(0) : 0)
			| (request.cartridgeSlots[1] === 'workspace' ? executionDomainBit(1) : 0),
		mediaInstallation: layoutBlua32MediaInstallation(sources, rebuilt),
		revisions,
	};
}

export function prepareBlua32RevisionInstallation(
	sources: RuntimeSourceState,
	runtime: Runtime,
	built: BuiltBlua32Revision,
	retainedFrameCount: number,
	bindingChanges?: ExecutionDomainId[],
): HotResumeRelocation {
	const cpu = runtime.machine.cpu;
	for (let i = 0; i < built.revisions.length; ++i) {
		const revision = built.revisions[i], domain = (i - 1) as ExecutionDomainId;
		if (revision === null) continue;
		if (blua32ToolingImageForDomain(sources.currentBlua32Media, domain)?.layout !== revision.previousImage) {
			throw new Error('The installed ROM changed while preparing Hot Resume.');
		}
		if (cpu.isExecutionDomainResident(domain) && verifyHotResumeBinding(cpu, domain, revision.previousImage, revision.nextImage)) {
			if (bindingChanges === undefined) throw new Error('Publishing additional operands requires a firmware bind.');
			bindingChanges.push(domain);
		}
	}
	return buildHotResumeRelocation(cpu, built.revisions, retainedFrameCount);
}

export function installBlua32Revision(
	sources: RuntimeSourceState,
	runtime: Runtime,
	guest: SuspendedGuestSession,
	built: BuiltBlua32Revision,
	relocation: HotResumeRelocation,
): void {
	const rebuilt = built.mediaInstallation.rebuilt;
	const cpu = runtime.machine.cpu;
	const executionAddressSpace = runtime.machine.executionAddressSpace;
	retireRuntimeFrameScopes(runtime, sources, guest);
	installBlua32Media(sources, runtime, built.mediaInstallation);
	const replacements: Blua32ExecutionBoot[] = [];
	if (rebuilt.system !== null) replacements.push(executionAddressSpace.resolveSystemDomain());
	for (const slot of CARTRIDGE_RESOURCE_DOMAINS) {
		if (rebuilt.cartridgeSlots[slot] !== null
			&& cpu.isExecutionDomainResident(slot)) {
			const image = executionAddressSpace.resolveDomain(slot);
			if (!image) {
				throw new Error('Active execution domain has no BLua32 executable image.');
			}
			replacements.push(image);
		}
	}
	cpu.replaceExecutionImages(replacements);
	applyHotResumeRelocation(cpu, relocation);
}

/** Admit installation or a supervisor-return plan; init completion is reported by its physical roots. */
export function admitHotResume(
	sources: RuntimeSourceState,
	guest: SuspendedGuestSession,
	fault: RuntimeFaultState,
	debuggerState: RuntimeDebuggerState,
	input: Input,
	runtimeTasks: RuntimeTaskQueue,
	runtime: Runtime,
	built: BuiltBlua32Revision | null,
	isCurrent: () => boolean,
	report: (event: HotResumeEvent) => void,
	context: RuntimeDebuggerExecutionContext = 'game',
): HotResumeAdmission {
	if (!runtime.admitExternalCpuMutation()) {
		report({ kind: 'rejected', error: new Error('Finish the active CPU/device frontier before installing an image revision.') });
		return 'rejected';
	}
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
	let synchronousUserReturn = false;
	let failedCompletionFrameIndex = -1;
	if (deferUntilUserExecution) {
		userFrameDepth = cpu.readExceptionReturnFrameDepth();
		if (userFrameDepth <= 0) {
			report({ kind: 'rejected', error: new Error('Hot Resume requires a retained User continuation.') });
			return 'rejected';
		}
		if (supervisorActive) {
			let supervisorExceptionFrameIndex = cpu.getFrameDepth() - 1;
			while (supervisorExceptionFrameIndex >= userFrameDepth
				&& (!cpu.isExceptionFrame(supervisorExceptionFrameIndex)
					|| cpu.readFrameExecutionDomain(supervisorExceptionFrameIndex) !== SYSTEM_EXECUTION_DOMAIN_ID)) {
				supervisorExceptionFrameIndex -= 1;
			}
			if (supervisorExceptionFrameIndex < userFrameDepth) {
				report({ kind: 'rejected', error: new Error('Hot Resume requires a retained System exception frame.') });
				return 'rejected';
			}
			if (!cpu.isNonMaskableExceptionFrame(supervisorExceptionFrameIndex)) {
				synchronousUserReturn = supervisorExceptionFrameIndex === userFrameDepth;
				let completionFrameIndex = supervisorExceptionFrameIndex - 1;
				while (completionFrameIndex >= 0
					&& !cpu.readFrameReturnsToCompletionLatch(completionFrameIndex)) {
					completionFrameIndex -= 1;
				}
				const failedBatch = debuggerState.plans.completionBatchAtFrame(
					cpu.activeThread.address,
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
		)!.layout.header.initFunctionAddress;
		if (address !== 0) {
			initCalls.push({
				executionDomain: cartridgeInitExecutionDomain,
				functionAddress: address,
			});
		}
	}
	if (stageSystemInit) {
		const address = freshMedia.system!.layout.header.initFunctionAddress;
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
	const installation = (windowRequested = false, unwound = false): HotResumeAdmission => {
		if ((deferUntilUserExecution || windowRequested) && !runtime.admitExternalCpuMutation()) {
			report({ kind: 'rejected', error: new Error('Finish the active CPU/device frontier before installing an image revision.') });
			return 'rejected';
		}
		const retainedFrameCount = prepared.failedCompletionFrameIndex >= 0
			? prepared.failedCompletionFrameIndex
			: cpu.getFrameDepth();
		const thread = cpu.activeThread;
		const bindingChanges: ExecutionDomainId[] = [];
		let relocation: HotResumeRelocation | null;
		let unwindFunctionAddress = 0;
		let bindFunctionAddress = 0;
		let valueEnd = 0, frameEnd = 0;
		try {
			relocation = prepared.built === null
				? null
				: prepareBlua32RevisionInstallation(sources, runtime, prepared.built, retainedFrameCount, bindingChanges);
			if (relocation !== null || prepared.initCalls.length !== 0) {
				valueEnd = relocation === null ? 0 : relocation.valueEnd;
				for (let index = 0; relocation === null && index < retainedFrameCount; ++index) {
					const base = cpu.readThreadFrameWord(thread.address, index, FrameField.StackBase) & FRAME_WINDOW_MASK;
					const width = cpu.readThreadFrameWord(thread.address, index, FrameField.StackCapacity) & FRAME_WINDOW_MASK;
					valueEnd = Math.max(valueEnd, base + width);
				}
				for (const call of prepared.initCalls) {
					const image = blua32ToolingImageForDomain(freshMedia, call.executionDomain)!.layout;
					const fn = image.functions[blua32FunctionIndexAtAddress(image, call.functionAddress)];
					valueEnd += Math.max(1, fn.maxStack, fn.numParams);
				}
				frameEnd = retainedFrameCount + prepared.initCalls.length + 1;
			}
			if (prepared.failedCompletionFrameIndex >= 0 && !unwound) {
				const system = sources.currentBlua32Media.system!;
				const unwind = system.symbols?.metadata.functionIds.indexOf('module:kernel/frame_unwind/module');
				if (unwind === undefined || unwind < 0 || retainedFrameCount === 0)
					throw new Error('The installed System ROM cannot unwind the failed initializer.');
				const fn = system.layout.functions[unwind];
				unwindFunctionAddress = fn.address;
				let tail = thread.stackTop;
				for (let frame = thread.currentFrame; frame !== null; frame = frame.previous)
					tail = Math.max(tail, frame.stackBase + frame.stackCapacity);
				valueEnd = Math.max(valueEnd, tail + Math.max(1, fn.numParams, fn.maxStack));
				frameEnd = Math.max(frameEnd, thread.frameDepth + 2);
			}
			if (bindingChanges.length !== 0) {
				if (bindingChanges.length > 1) throw new Error('Publish operand growth in one resident image at a time.');
				const system = sources.currentBlua32Media.system!;
				const bind = system.symbols?.metadata.functionIds.indexOf('module:kernel/bind_image_entry/module');
				if (bind === undefined || bind < 0)
					throw new Error('The installed System ROM has no executable operand loader.');
				const fn = system.layout.functions[bind];
				bindFunctionAddress = fn.address;
				let tail = thread.stackTop;
				for (let frame = thread.currentFrame; frame !== null; frame = frame.previous)
					tail = Math.max(tail, frame.stackBase + frame.stackCapacity);
				valueEnd = Math.max(valueEnd, tail + Math.max(1, fn.numParams, fn.maxStack));
				frameEnd = Math.max(frameEnd, thread.frameDepth + 2);
			}
		} catch (error) {
			// Unsupported live edits reject before any media/CPU write. They
			// must not fault the mutation queue or stop the installed program.
			report({ kind: 'rejected', error });
			return 'rejected';
		}
		if (valueEnd > thread.stackRegisters.capacity() || frameEnd > thread.frameBackingBytes / FRAME_CONTROL_BYTES) {
			if (windowRequested) {
				report({ kind: 'rejected', error: new Error('Not enough guest memory for the new register windows.') });
				return 'rejected';
			}
			// Reserve on the installed image. Collection can retire closures,
			// so recompute relocation once this exception has returned.
			const plan = new RuntimeGuestCallPlan(runtime, cpu.getFrameDepth(), 'exception', false, completed => {
				if (!completed) {
					report({ kind: 'discarded' });
					return;
				}
				void runtimeTasks.schedule(() => {
					if (isCurrent()) installation(true, unwound);
				}, error => report({ kind: 'failed', error }));
			});
			runtime.history.stop();
			guest.invalidate();
			cpu.requestRegisterWindow(valueEnd, frameEnd, runtime.machine.scheduler.cyclesUntilDeadline());
			pushRuntimeDebuggerControlPlan(debuggerState, plan, context);
			return 'deferred';
		}
		if (unwindFunctionAddress !== 0) {
			const plan = new RuntimeGuestCallPlan(runtime, retainedFrameCount, 'exception', false, completed => {
				if (!completed) {
					report({ kind: 'discarded' });
					return;
				}
				void runtimeTasks.schedule(() => {
					if (isCurrent()) installation(false, true);
				}, error => report({ kind: 'failed', error }));
			});
			const scopes = readRuntimeLuaModuleExport(sources, guest, SYSTEM_EXECUTION_DOMAIN_ID, 'debug/frame_scopes');
			const retireScopes = scopes.kind === 'value' && !isNil(scopes.value) ? guest.readStringMember(scopes.value, 'retire') : valueNil();
			runtime.history.stop();
			guest.invalidate();
			cpu.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, unwindFunctionAddress, [valueInteger(retainedFrameCount), retireScopes]);
			pushRuntimeDebuggerControlPlan(debuggerState, plan, context);
			return 'deferred';
		}
		if (bindFunctionAddress !== 0) {
			const built = prepared.built!, domain = bindingChanges[0], candidate = built.revisions[domain + 1]!.nextImage;
			const system = sources.systemRom.bytes;
			let staged: ReturnType<typeof stageBlua32Executable>;
			try {
				staged = stageBlua32Executable(system, candidate, SYSTEM_EXECUTION_DOMAIN_ID);
			} catch (error) {
				report({ kind: 'rejected', error });
				return 'rejected';
			}
			const { memory, executionAddressSpace } = runtime.machine;
			const plan = new RuntimeGuestCallPlan(runtime, retainedFrameCount, 'completion', false, completed => {
				if (!completed) {
					report({ kind: 'discarded' });
					return;
				}
				const status = asInteger(runtime.readCompletionValues()[0]);
				void runtimeTasks.schedule(() => {
					if (status !== 0 || built.mediaInstallation.systemLayer === null) {
						memory.installSystemRom(system);
						cpu.replaceExecutionImages([executionAddressSpace.resolveSystemDomain()]);
					}
					if (status !== 0) {
						report({ kind: 'rejected', error: new Error(`Firmware could not bind the replacement image (status ${status}).`) });
						return;
					}
					// Admission may have collected unreachable closures. Rediscover
					// the live records before installing the new executable views.
					const live = buildHotResumeRelocation(cpu, built.revisions, retainedFrameCount);
					applyPreparedHotResume(sources, guest, fault, debuggerState, runtime, prepared, live, report, context);
					report({ kind: prepared.initCalls.length === 0 ? 'completed' : 'initializing' });
				}, error => report({ kind: 'failed', error }));
			});
			runtime.history.stop();
			guest.invalidate();
			memory.installSystemRom(staged.bytes);
			cpu.replaceExecutionImages([executionAddressSpace.resolveSystemDomain()]);
			cpu.beginCompletionCallInExecutionDomain(SYSTEM_EXECUTION_DOMAIN_ID, bindFunctionAddress,
				[valueInteger(domain), valueInteger(staged.imageAddress), valueInteger(candidate.address)]);
			pushRuntimeDebuggerControlPlan(debuggerState, plan, context);
			return 'deferred';
		}
		applyPreparedHotResume(
			sources,
			guest,
			fault,
			debuggerState,
			runtime,
			prepared,
			relocation,
			report,
			context,
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
				synchronousUserReturn ? runtime.machine.memory.readMappedU32LE(IO_SYS_SUPERVISOR_FAULT_EPC) : cpu.readFramePc(targetFrameIndex),
				supervisorActive,
				installation,
				isCurrent,
				report,
			),
			context,
		);
		return 'deferred';
	}
	return installation();
}

function applyPreparedHotResume(
	sources: RuntimeSourceState,
	guest: SuspendedGuestSession,
	fault: RuntimeFaultState,
	debuggerState: RuntimeDebuggerState,
	runtime: Runtime,
	prepared: PreparedHotResume,
	relocation: HotResumeRelocation | null,
	report: (event: HotResumeEvent) => void,
	context: RuntimeDebuggerExecutionContext,
): void {
	const cpu = runtime.machine.cpu;
	// Preparation (including relocation rejection) leaves history untouched.
	// A no-source-change resume still mutates the heap through its init calls.
	if (prepared.built === null) runtime.history.stop();
	if (prepared.failedCompletionFrameIndex >= 0) {
		debuggerState.plans.discardCompletionBatchesFrom(
			cpu.activeThread.address,
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
			guest,
			prepared.built,
			relocation!,
		);
	}
	report({ kind: 'applied' });
	clearFaultSnapshot(fault);
	fault.hostFrameFailure = undefined;
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
			cpu.activeThread.address,
			firstFrameIndex,
			stagedExecutionDomains,
			result => report(result.status === 'faulted'
				? { kind: 'faulted', sequence: result.sequence }
				: { kind: result.status }),
		);
		if (context === 'workbench') {
			// The ordinary call fence stops before returning to gameplay, including
			// a pending IRQ. Breakpoints can suspend init without losing its roots.
			pushRuntimeDebuggerControlPlan(debuggerState,
				new RuntimeGuestCallPlan(runtime, firstFrameIndex, 'completion', true, completed => {
					if (completed) debuggerState.plans.pruneCompletedCompletionBatches();
				}), context);
		}
	}
}
