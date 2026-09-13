import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { blua32FunctionIndexAtAddress } from '../../toolchain/ts/rompack/blua32_image';
import { blua32ToolingImageForDomain } from '../../toolchain/ts/rompack/blua32_media';
import { blua32InlineCallSitesAtPc, blua32SourceRangeAtPc, blua32LocalSlotLiveAtPc } from '../../toolchain/ts/rompack/blua32_symbols';
import { resolveInlineLocalContextRange } from '../../toolchain/ts/lua/compiler/inline_debug';
import type { FileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { findLuaSemanticOccurrenceAt } from '../../toolchain/ts/lua/semantic/position_query';
import { findLuaLexicalBindingAt } from '../../toolchain/ts/lua/semantic/scope_query';
import { compareSourcePosition, sourcePositionInRange } from '../../toolchain/ts/lua/semantic/source_range';
import { sourceRangesEqual, type SourceRange } from '../../toolchain/ts/lua/source_range';
import { SYSTEM_RESOURCE_DOMAIN, type ResourceDomain } from '../common/resource';
import type { RuntimeFaultState } from './fault_state';
import { Blua32GlobalRegisterFile, resolveRuntimeLuaSource, type RuntimeSourceState } from './sources';
import type { SuspendedGuestRead, SuspendedGuestSession } from './suspended_guest';

export type RuntimeLuaInspectionValue = SuspendedGuestRead | {
	readonly kind: 'unavailable';
	readonly reason: 'source_changed' | 'not_loaded' | 'not_in_scope';
};

const SOURCE_CHANGED: RuntimeLuaInspectionValue = { kind: 'unavailable', reason: 'source_changed' };
const NOT_LOADED: RuntimeLuaInspectionValue = { kind: 'unavailable', reason: 'not_loaded' };
const NOT_IN_SCOPE: RuntimeLuaInspectionValue = { kind: 'unavailable', reason: 'not_in_scope' };

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
		declaration = receiver.root.syntax.range;
	} else declaration = binding.declaration.range;
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
			: frameIndex + 1 < depth ? cpu.readFrameCallSitePc(frameIndex + 1) : cpu.readFramePc(frameIndex);
		const symbols = image.symbols;
		const range = blua32SourceRangeAtPc(symbols, image.layout.header.textAddress, pc);
		if (range !== null) {
			const inlineSites = blua32InlineCallSitesAtPc(symbols, image.layout.header.textAddress, pc);
			for (const slot of symbols.metadata.localSlotsByFunction[functionIndex]) {
				if (!sourceRangesEqual(slot.definition, definition)
					|| !blua32LocalSlotLiveAtPc(slot, image.layout.functions[functionIndex].codeAddress, pc)) continue;
				const context = resolveInlineLocalContextRange(slot, range, inlineSites);
				if (context === null || context.path !== definition.path
					|| !sourcePositionInRange(context.start.line, context.start.column, slot.scope)) continue;
				if (binding.kind === 'declaration' && compareSourcePosition(context.start.line, context.start.column,
					binding.declaration.visibleFrom.line, binding.declaration.visibleFrom.column) <= 0) continue;
				const value = captured === undefined ? cpu.readFrameRegister(frameIndex, slot.registerIndex) : captured.registers[slot.registerIndex];
				return guest.readStringPath(value, parts, 1);
			}
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
