import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { buildModuleExportSlotName } from '../../toolchain/ts/lua/module_path';
import { blua32FunctionIndexAtAddress } from '../../toolchain/ts/rompack/blua32_image';
import { blua32ToolingImageForDomain } from '../../toolchain/ts/rompack/blua32_media';
import { blua32InlineCallSitesAtPc, blua32SourceRangeAtPc, blua32LocalSlotLiveAtPc } from '../../toolchain/ts/rompack/blua32_symbols';
import { resolveInlineLocalContextRange } from '../../toolchain/ts/lua/compiler/inline_debug';
import type { FileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { findLuaSemanticOccurrenceAt } from '../../toolchain/ts/lua/semantic/position_query';
import { findLuaLexicalBindingAt } from '../../toolchain/ts/lua/semantic/scope_query';
import { sourcePositionInRange } from '../../toolchain/ts/lua/semantic/source_range';
import { sourceRangesEqual, type SourceRange } from '../../toolchain/ts/lua/source_range';
import { SYSTEM_RESOURCE_DOMAIN, type ResourceDomain, type ResourceIdentity } from '../common/resource';
import type { RuntimeFaultState } from './fault_state';
import { Blua32GlobalRegisterFile, resolveRuntimeLuaSource, type RuntimeSourceState } from './sources';
import type { SuspendedGuestRead, SuspendedGuestSession, SuspendedGuestValue } from './suspended_guest';

export type RuntimeLuaInspectionValue = SuspendedGuestRead | {
	readonly kind: 'unavailable';
	readonly reason: 'source_changed' | 'not_loaded' | 'not_in_scope';
};

const SOURCE_CHANGED: RuntimeLuaInspectionValue = { kind: 'unavailable', reason: 'source_changed' };
const NOT_LOADED: RuntimeLuaInspectionValue = { kind: 'unavailable', reason: 'not_loaded' };
const NOT_IN_SCOPE: RuntimeLuaInspectionValue = { kind: 'unavailable', reason: 'not_in_scope' };

/** The compiler owns export-slot names; an installed slot is not evidence that its initializer ran. */
export function readRuntimeLuaModuleExport(
	sources: RuntimeSourceState, guest: SuspendedGuestSession, domain: ResourceDomain, modulePath: string,
): RuntimeLuaInspectionValue {
	const image = domain === SYSTEM_RESOURCE_DOMAIN ? sources.currentBlua32Media.system : sources.currentBlua32Media.cartridgeSlots[domain];
	if (image === null) return NOT_LOADED;
	const name = buildModuleExportSlotName(modulePath, []);
	const registerFile = image.globalRegisterFileByName.get(name);
	if (registerFile === undefined) return NOT_LOADED;
	return { kind: 'value', value: registerFile === Blua32GlobalRegisterFile.System ? guest.systemGlobal(name) : guest.global(name) };
}

export type RuntimeLuaFunctionSource = {
	readonly resource: ResourceIdentity;
	readonly range: SourceRange;
	readonly installedSource: string;
};

/** Read a module-scoped local retained by this closure, not a same-name local in a factory. */
export function readRuntimeLuaModuleCapture(
	sources: RuntimeSourceState, guest: SuspendedGuestSession, domain: ResourceDomain,
	modulePath: string, closure: SuspendedGuestValue, name: string,
): RuntimeLuaInspectionValue {
	const location = guest.linkedFunctionLocation(closure);
	if (location === undefined || location.domain !== domain) return NOT_IN_SCOPE;
	const image = blua32ToolingImageForDomain(sources.currentBlua32Media, domain);
	if (image === null || image.symbols === null) return NOT_LOADED;
	const symbols = image.symbols;
	const module = symbols.moduleFunctions.find(entry => entry.path === modulePath);
	if (module === undefined) return NOT_LOADED;
	const functionIndex = blua32FunctionIndexAtAddress(image.layout, location.address);
	if (functionIndex < 0) return NOT_IN_SCOPE;
	const moduleIndex = blua32FunctionIndexAtAddress(image.layout, module.address);
	const moduleId = symbols.metadata.functionIds[moduleIndex];
	const bindings = symbols.metadata.upvalueBindingsByFunction[functionIndex];
	let captureIndex = -1;
	for (let index = 0; index < bindings.length; index += 1) {
		const local = symbols.metadata.capturedLocals[bindings[index]];
		if (local.functionId !== moduleId || local.name !== name || local.definition === null) continue;
		// Preserved capture slots can outlive their use after Hot Resume. A name
		// query cannot choose between distinct bindings in the defining function.
		if (captureIndex !== -1) return NOT_IN_SCOPE;
		captureIndex = index;
	}
	return captureIndex === -1 ? NOT_IN_SCOPE : { kind: 'value', value: guest.readClosureUpvalue(closure, captureIndex) };
}

/** A closure's current mapped call target, never its presumed allocation/registration site. */
export function runtimeLuaFunctionSource(sources: RuntimeSourceState, guest: SuspendedGuestSession, value: SuspendedGuestValue): RuntimeLuaFunctionSource | undefined {
	const location = guest.linkedFunctionLocation(value);
	if (location === undefined) return undefined;
	const { domain, address } = location;
	const image = blua32ToolingImageForDomain(sources.currentBlua32Media, domain);
	if (image === null || image.symbols === null) return undefined;
	const index = blua32FunctionIndexAtAddress(image.layout, address);
	if (index < 0) return undefined;
	const definition = image.symbols.metadata.functionDefinitions[index];
	if (definition === null) return undefined;
	const record = resolveRuntimeLuaSource(sources, { domain, path: definition.path })!.record;
	const installed = domain === SYSTEM_RESOURCE_DOMAIN ? sources.systemInstalledBlua32Sources : sources.cartridgeSlots[domain]!.installedBlua32Sources;
	return { resource: { domain, path: record.source_path }, range: { ...definition, path: record.source_path },
		installedSource: installed.get(record.module_path)! };
}

/** Read a written binding from its installed debug location; never evaluate Lua or infer a value. */
export function readRuntimeLuaValue(
	runtime: Runtime,
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	guest: SuspendedGuestSession,
	analysis: FileSemanticData,
	domain: ResourceDomain,
	parts: readonly string[],
	line: number,
	column: number,
): RuntimeLuaInspectionValue {
	const record = resolveRuntimeLuaSource(sources, { domain, path: analysis.file })!.record;
	const installed = domain === SYSTEM_RESOURCE_DOMAIN
		? sources.systemInstalledBlua32Sources : sources.cartridgeSlots[domain]!.installedBlua32Sources;
	const installedSource = installed.get(record.module_path);
	if (installedSource === undefined) return NOT_LOADED;
	if (analysis.source !== installedSource) return SOURCE_CHANGED;

	const name = parts[0];
	const occurrence = findLuaSemanticOccurrenceAt(analysis, line, column);
	const binding = occurrence?.kind === 'declaration' && occurrence.declaration.namePath.length === 1
		&& occurrence.declaration.name === name
		? { kind: 'declaration' as const, declaration: occurrence.declaration }
		: findLuaLexicalBindingAt(analysis, name, line, column);
	if (binding.kind === 'global' || binding.kind === 'declaration' && binding.declaration.isGlobal) {
		const image = domain === SYSTEM_RESOURCE_DOMAIN ? sources.currentBlua32Media.system : sources.currentBlua32Media.cartridgeSlots[domain];
		if (image === null) return NOT_LOADED;
		const registerFile = image.globalRegisterFileByName.get(name);
		if (registerFile === undefined) return NOT_LOADED;
		const root = registerFile === Blua32GlobalRegisterFile.System ? guest.systemGlobal(name) : guest.global(name);
		return guest.readStringPath(root, parts, 1);
	}

	let declaration: SourceRange;
	if (binding.kind === 'receiver') {
		const receiver = analysis.scopes[binding.scopeIndex].implicitSelfValue!;
		declaration = analysis.chunk.locations.range(receiver.root.syntax.span);
	} else declaration = analysis.chunk.locations.range(binding.declaration.span);
	// The binder owns workspace paths; installed symbols own canonical module paths.
	const definition = { ...declaration, path: record.module_path };
	const cpu = runtime.machine.cpu;
	const faultFrames = fault.faultSnapshot === null ? undefined : fault.lastCpuFaultSnapshot;
	const depth = faultFrames === undefined ? cpu.getFrameDepth() : faultFrames.length;
	for (let frameIndex = depth - 1; frameIndex >= 0; frameIndex -= 1) {
		const captured = faultFrames?.[frameIndex];
		const frameDomain = captured === undefined ? cpu.readFrameExecutionDomain(frameIndex) : captured.executionDomainId;
		if (frameDomain !== domain) continue;
		const image = captured === undefined ? blua32ToolingImageForDomain(sources.currentBlua32Media, frameDomain) : captured.toolingImage;
		if (image === null || image.symbols === null) continue;
		const functionIndex = captured === undefined
			? blua32FunctionIndexAtAddress(image.layout, cpu.readFrameFunctionAddress(frameIndex)) : captured.functionIndex;
		if (functionIndex < 0) continue;
		const pc = captured !== undefined ? captured.tracePc
			: frameIndex + 1 < depth && !cpu.readFrameReturnsToCompletionLatch(frameIndex + 1)
				? cpu.readFrameCallSitePc(frameIndex + 1) : cpu.readFramePc(frameIndex);
		const symbols = image.symbols;
		const range = blua32SourceRangeAtPc(symbols, image.layout.header.textAddress, pc);
		const inlineSites = blua32InlineCallSitesAtPc(symbols, image.layout.header.textAddress, pc);
		for (const slot of symbols.metadata.localSlotsByFunction[functionIndex]) {
			if (!sourceRangesEqual(slot.definition, definition)) continue;
			const context = range === null ? null : resolveInlineLocalContextRange(slot, range, inlineSites);
			if (context === null && slot.inlineCallSites.length !== 0) continue;
			// This invocation owns the binding. An unavailable location must not
			// redirect the read to an older recursive call with the same declaration.
			if (context === null || context.path !== definition.path
				|| !sourcePositionInRange(context.start.line, context.start.column, slot.scope)
				|| !blua32LocalSlotLiveAtPc(slot, image.layout.functions[functionIndex].codeAddress, pc)) return NOT_IN_SCOPE;
			if (binding.kind === 'declaration' && analysis.chunk.locations.offsetAt(context.start)
				<= analysis.chunk.locations.offset(binding.declaration.visibleFrom.unit, binding.declaration.visibleFrom.offset)) return NOT_IN_SCOPE;
			const value = captured === undefined ? cpu.readFrameRegister(frameIndex, slot.registerIndex) : captured.registers[slot.registerIndex];
			return guest.readStringPath(value, parts, 1);
		}
		const captures = symbols.metadata.upvalueBindingsByFunction[functionIndex];
		for (let index = 0; index < captures.length; index += 1) {
			const local = symbols.metadata.capturedLocals[captures[index]];
			if (local.definition === null || !sourceRangesEqual(local.definition, definition)) continue;
			const value = captured === undefined ? cpu.readFrameUpvalue(frameIndex, index) : captured.upvalues[index];
			return guest.readStringPath(value, parts, 1);
		}
	}
	return NOT_IN_SCOPE;
}
