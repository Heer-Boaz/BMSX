import type { SuspendedGuestSession } from './suspended_guest';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { encodeBinary } from '../../machine/ts/common/serializer/binencoder';
import { valuePayload, EMPTY_CALL_ARGS } from '../../machine/ts/machine/cpu/value';
import { buildModuleExportSlotName } from '../../toolchain/ts/lua/module_path';
import {
	aemDocumentFormat,
	assertValidAemDocument,
	buildAemEventMap,
	buildAemValidationLookup,
	parseStructuredTextDocument,
} from '../../toolchain/ts/rompack/aem';
import type { RomAssetEdit } from '../../toolchain/ts/rompack/blua32_tail';
import { blua32FunctionIndexAtAddress } from '../../toolchain/ts/rompack/blua32_image';
import { BLUA32_DIAGNOSTICS_IMAGE_ID } from '../../toolchain/ts/rompack/blua32_diagnostics';
import {
	SYSTEM_RESOURCE_DOMAIN,
	resourceIdentityKey,
	type ResourceDomain,
	type RuntimeResource,
} from '../common/resource';
import type { Blua32SourceImage, RuntimeSourceState } from './sources';
import {
	buildBlua32Revision,
	publishBlua32Revision,
	prepareBlua32RevisionInstallation,
	type BuiltBlua32Revision,
} from './hot_resume';
import { buildHotResumeRelocation, type HotResumeRelocation } from './hot_resume_relocation';
import { hasOpenFrameScopes, resolveFrameScopeRetirement } from './frame_scopes';
import { RetainedContextGuestCallPlan } from './guest_call';
import { applyRuntimeDebuggerHotResume, pushRuntimeDebuggerControlPlan, type RuntimeDebuggerState } from './debugger_state';
import type { RuntimeDebuggerSourceStop } from './source_debugger';

export type BuiltAemSourceRevision = {
	resource: RuntimeResource;
	domain: ResourceDomain;
	source: string;
	eventMap: Record<string, unknown>;
	revision: BuiltBlua32Revision;
	relocation: HotResumeRelocation;
};

export type AemSourceApplyResult =
	| { readonly status: 'applied' }
	| { readonly status: 'not-applied'; readonly reason: 'inactive-domain' | 'installation-replaced' | 'context-not-installed' | 'module-not-installed' | 'asset-not-installed' | 'cpu-time-pending' | 'mutation-active' }
	| { readonly status: 'failed'; readonly phase: 'build' | 'runtime'; readonly error: unknown };

/** Apply one accepted source snapshot; rejected authoring never enters machine mutation. */
export function applyAemSourceRevision(
	sources: RuntimeSourceState,
	guest: SuspendedGuestSession,
	runtime: Runtime,
	runtimeTasks: RuntimeTaskQueue,
	debuggerState: RuntimeDebuggerState,
	resource: RuntimeResource,
	domain: ResourceDomain,
	expectedImage: Blua32SourceImage,
	source: string,
): Promise<AemSourceApplyResult> {
	const { cpu } = runtime.machine;
	const { promise, resolve } = Promise.withResolvers<AemSourceApplyResult>();
	let settled = false;
	const finish = (result: AemSourceApplyResult) => { settled = true; resolve(result); };
	const failed = (error: unknown) => {
		if (settled) return;
		recordAemSourceApplyFailure(sources, resource, domain);
		finish({ status: 'failed', phase: 'runtime', error });
	};
	const currentImage = () => domain === SYSTEM_RESOURCE_DOMAIN ? sources.currentBlua32Media.system : sources.currentBlua32Media.cartridgeSlots[domain];
	const currentRom = () => domain === SYSTEM_RESOURCE_DOMAIN ? sources.systemRom.bytes : sources.cartridgeSlots[domain]!.rom.bytes;
	const reloadClosure = () => valuePayload(guest.readStringMember(guest.global(buildModuleExportSlotName('cartlib/aem', [])), 'reload_from_rom'));
	void runtimeTasks.schedule(() => {
		const image = currentImage();
		if (image !== expectedImage) {
			finish({ status: 'not-applied', reason: 'installation-replaced' });
			return;
		}
		if (image.sourceContextId !== resource.contextId) {
			finish({ status: 'not-applied', reason: 'context-not-installed' });
			return;
		}
		// Authoring spans every installed ROM; reload_from_rom belongs to the
		// currently executing domain. Do not install media or invoke another
		// cartridge's globals while the BIOS (or a different cartridge) runs.
		if (cpu.activeCartridgeSlot() !== domain) {
			finish({ status: 'not-applied', reason: 'inactive-domain' });
			return;
		}
		const installedSources = domain === SYSTEM_RESOURCE_DOMAIN ? sources.systemInstalledBlua32Sources
			: sources.cartridgeSlots[domain]!.installedBlua32Sources;
		if (!installedSources.has('cartlib/aem')) {
			finish({ status: 'not-applied', reason: 'module-not-installed' });
			return;
		}
		const installedPackage = domain === SYSTEM_RESOURCE_DOMAIN ? sources.systemPackage
			: sources.cartridgeSlots[domain]!.package;
		if (installedPackage.audioevents[resource.source.resid] === undefined) {
			finish({ status: 'not-applied', reason: 'asset-not-installed' });
			return;
		}
		if (debuggerState.plans.mutationActive) {
			finish({ status: 'not-applied', reason: 'mutation-active' });
			return;
		}
		if (!runtime.admitExternalCpuMutation()) {
			finish({ status: 'not-applied', reason: 'cpu-time-pending' });
			return;
		}
		let built: BuiltAemSourceRevision;
		try {
			built = buildAemSourceRevision(sources, runtime, resource, domain, source);
		} catch (error) {
			recordAemSourceApplyFailure(sources, resource, domain);
			finish({ status: 'failed', phase: 'build', error });
			return;
		}
		const previousRom = currentRom(), threadAddress = cpu.activeThread.address, depth = cpu.getFrameDepth();
		let unchangedScopes: boolean | undefined;
		const afterPreparation = (completed: boolean, resume: () => void) => {
			if (!completed) { failed(new Error('Audio map preparation was interrupted.')); return; }
			void runtimeTasks.schedule(() => {
				if (settled) return;
				if (currentImage() !== expectedImage || currentRom() !== previousRom) {
					finish({ status: 'not-applied', reason: 'installation-replaced' });
					return;
				}
				if (cpu.activeCartridgeSlot() !== domain || cpu.activeThread.address !== threadAddress || cpu.getFrameDepth() !== depth) {
					finish({ status: 'not-applied', reason: 'inactive-domain' });
					return;
				}
				if (debuggerState.plans.mutationActive) {
					finish({ status: 'not-applied', reason: 'mutation-active' });
					return;
				}
				resume();
			}, failed);
		};
		const runPreparation = (begin: () => void, resume: () => void) => {
			let stop: RuntimeDebuggerSourceStop | undefined;
			const plan = new RetainedContextGuestCallPlan(runtime, depth, completed => {
				if (completed && stop !== undefined && debuggerState.source.returnToStop(stop))
					debuggerState.stopPresentationPending = true;
				afterPreparation(completed, resume);
			});
			guest.invalidate();
			runtime.history.stop();
			begin();
			stop = pushRuntimeDebuggerControlPlan(debuggerState, plan, 'workbench', 'retain');
		};
		const continueInstall = (windowRequested: boolean, scopesRetired: boolean) => {
			const relocation = windowRequested || scopesRetired ? buildHotResumeRelocation(cpu, built.revision.revisions, depth) : built.relocation;
			const thread = cpu.activeThread, reload = reloadClosure();
			const binding = cpu.captureClosureBinding(reload);
			const revision = built.revision.revisions[binding.executionDomainId + 1];
			const rebound = relocation.closures.get(reload) ?? binding.functionAddress;
			const target = revision === null ? -1 : blua32FunctionIndexAtAddress(revision.nextImage, rebound);
			const functionShape = target < 0 ? binding : revision!.nextImage.functions[target];
			let callWidth = Math.max(1, functionShape.numParams, functionShape.maxStack);
			const retire = scopesRetired ? undefined : resolveFrameScopeRetirement(sources, guest);
			const needsRetirement = retire !== undefined && hasOpenFrameScopes(guest, retire.registry)
				&& !(unchangedScopes ??= preservesFrameScopes(sources, built.revision));
			if (needsRetirement) {
				const { maxStack, numParams } = cpu.captureClosureBinding(retire.closure);
				callWidth = Math.max(callWidth, maxStack, numParams);
			}
			const valueEnd = Math.max(thread.stackTop, relocation.valueEnd) + callWidth;
			if (!thread.frameSpaceFits(valueEnd)) {
				if (windowRequested) throw new Error('Not enough guest memory for the audio map reload register window.');
				if (cpu.readExceptionReturnFrameDepth() !== -1) {
					finish({ status: 'not-applied', reason: 'cpu-time-pending' });
					return;
				}
				runPreparation(
					() => cpu.requestRegisterWindow(valueEnd, depth + 2, runtime.machine.scheduler.cyclesUntilDeadline()),
					() => continueInstall(true, scopesRetired),
				);
				return;
			}
			if (needsRetirement) {
				runPreparation(() => cpu.beginCompletionCall(retire.closure), () => continueInstall(windowRequested, true));
				return;
			}

			const breakpoints = debuggerState.breakpoints.compile(built.revision.mediaInstallation.sourceMedia);
			guest.invalidate();
			publishBlua32Revision(sources, runtime, built.revision, relocation);
			installAemPackage(sources, built);
			const installedImage = currentImage()!, installedRom = currentRom();
			applyRuntimeDebuggerHotResume(debuggerState, breakpoints);
			const plan = new RetainedContextGuestCallPlan(runtime, depth, completed => {
				if (settled) return;
				if (currentImage() !== installedImage || currentRom() !== installedRom) {
					finish({ status: 'not-applied', reason: 'installation-replaced' });
				} else if (!completed) {
					failed(new Error('Audio map reload was interrupted.'));
				} else {
					sources.aemSourceApplications.set(`${domain}\0${resourceIdentityKey(resource)}`, {
						image: installedImage, rom: installedRom, installedSource: source, failed: false,
					});
					finish({ status: 'applied' });
				}
			});
			cpu.beginCompletionCall(reload, EMPTY_CALL_ARGS);
			pushRuntimeDebuggerControlPlan(debuggerState, plan, 'workbench');
		};
		continueInstall(false, false);
	}, failed);
	return promise;
}

function buildRuntimeAemValidationLookup(sources: RuntimeSourceState, domain: ResourceDomain) {
	const resourcePackage = domain === SYSTEM_RESOURCE_DOMAIN ? sources.systemPackage : sources.cartridgeSlots[domain]!.package;
	const dataRecordNames = Object.keys(resourcePackage.data);
	const dataRecords: Array<{ name: string; value: unknown }> = new Array(dataRecordNames.length);
	for (let index = 0; index < dataRecordNames.length; index += 1) {
		const name = dataRecordNames[index]!;
		dataRecords[index] = { name, value: resourcePackage.data[name] };
	}
	return buildAemValidationLookup({
		audioIds: Object.keys(resourcePackage.audio),
		dataRecords,
	});
}

export function buildAemSourceRevision(
	sources: RuntimeSourceState,
	runtime: Runtime,
	resource: RuntimeResource,
	domain: ResourceDomain,
	source: string,
): BuiltAemSourceRevision {
	const assetId = resource.source.resid;
	const doc = parseStructuredTextDocument(source, aemDocumentFormat(resource.path), `AEM file '${resource.path}'`);
	const lookup = buildRuntimeAemValidationLookup(sources, domain);
	assertValidAemDocument(doc, lookup, resource.path);
	const eventMap = buildAemEventMap(doc, lookup);
	const assetEdits: [RomAssetEdit[], RomAssetEdit[], RomAssetEdit[]] = [[], [], []];
	assetEdits[domain + 1].push(['aem', assetId, encodeBinary(eventMap)]);
	const revision = buildBlua32Revision(
		sources,
		runtime,
		{
			system: domain === SYSTEM_RESOURCE_DOMAIN ? 'installed' : null,
			cartridgeSlots: [domain === 0 ? 'installed' : null, domain === 1 ? 'installed' : null],
		},
		assetEdits,
	);
	const relocation = prepareBlua32RevisionInstallation(
		sources, runtime, revision,
		runtime.machine.cpu.getFrameDepth(),
	);
	return { resource, domain, source, eventMap, revision, relocation };
}

function preservesFrameScopes(sources: RuntimeSourceState, built: BuiltBlua32Revision): boolean {
	const replaced = [built.mediaInstallation.systemLayer, ...built.mediaInstallation.cartridgeLayers];
	for (let i = 0; i < built.revisions.length; ++i) {
		const revision = built.revisions[i];
		if (revision === null) continue;
		const { previousImage, nextImage } = revision;
		if (previousImage.address !== nextImage.address || !sameBytes(previousImage.bytes, nextImage.bytes)) return false;
		const oldLayer = i === 0 ? sources.systemRom : sources.cartridgeSlots[i - 1]!.rom;
		const nextLayer = replaced[i]!;
		const oldScopes = oldLayer.index.entries.find(item => item.resid === BLUA32_DIAGNOSTICS_IMAGE_ID);
		const newScopes = nextLayer.index.entries.find(item => item.resid === BLUA32_DIAGNOSTICS_IMAGE_ID);
		if (oldScopes === undefined || newScopes === undefined) {
			if (oldScopes !== newScopes) return false;
		} else if (!sameBytes(oldLayer.bytes.subarray(oldScopes.start!, oldScopes.end!),
			nextLayer.bytes.subarray(newScopes.start!, newScopes.end!))) return false;
	}
	return true;
}

function sameBytes(before: Uint8Array, after: Uint8Array): boolean {
	if (before.length !== after.length) return false;
	for (let i = 0; i < before.length; ++i) if (before[i] !== after[i]) return false;
	return true;
}

function installAemPackage(sources: RuntimeSourceState, built: BuiltAemSourceRevision): void {
	const { resource, domain, eventMap } = built;
	const assetId = resource.source.resid;
	const runtimePackage = domain === SYSTEM_RESOURCE_DOMAIN
		? sources.systemPackage
		: sources.cartridgeSlots[domain]!.package;
	const installedPackage = { ...runtimePackage, audioevents: { ...runtimePackage.audioevents, [assetId]: eventMap } };
	if (domain === SYSTEM_RESOURCE_DOMAIN) {
		sources.systemPackage = installedPackage;
		sources.systemRom.package = installedPackage;
	} else {
		const installed = sources.cartridgeSlots[domain]!;
		installed.package = installedPackage;
		installed.rom.package = installedPackage;
	}
	if (sources.activeCartridgeSlot === domain) sources.activePackage = installedPackage;
}

export function recordAemSourceApplyFailure(sources: RuntimeSourceState, resource: RuntimeResource, domain: ResourceDomain): void {
	const key = `${domain}\0${resourceIdentityKey(resource)}`;
	const image = (domain === -1 ? sources.currentBlua32Media.system : sources.currentBlua32Media.cartridgeSlots[domain])!;
	const rom = domain === -1 ? sources.systemRom.bytes : sources.cartridgeSlots[domain]!.rom.bytes;
	const application = sources.aemSourceApplications.get(key);
	if (application === undefined || application.image !== image || application.rom !== rom) {
		sources.aemSourceApplications.set(key, { image, rom, installedSource: undefined, failed: true });
	} else {
		application.failed = true;
	}
}
