import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { buildModuleExportSlotName } from '../../toolchain/ts/lua/module_path';
import { blua32FunctionIndexAtAddress, type Blua32UpvalueRecord } from '../../toolchain/ts/rompack/blua32_image';
import { blua32ToolingImageForDomain } from '../../toolchain/ts/rompack/blua32_media';
import { blua32InlineCallSitesAtPc, blua32SourceRangeAtPc, blua32SlotLiveAtPc } from '../../toolchain/ts/rompack/blua32_symbols';
import { resolveInlineLocalContextRange } from '../../toolchain/ts/lua/compiler/inline_debug';
import { StaticDeclarationKind } from '../../toolchain/ts/lua/compiler/declaration_kind';
import type { FileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { findLuaSemanticOccurrenceAt } from '../../toolchain/ts/lua/semantic/position_query';
import { findLuaLexicalBindingAt } from '../../toolchain/ts/lua/semantic/scope_query';
import { isLuaStaticDeclaration } from '../../toolchain/ts/lua/semantic/static_declarations';
import { sourcePositionInRange } from '../../toolchain/ts/lua/semantic/source_range';
import { sourceRangesEqual, type SourceRange } from '../../toolchain/ts/lua/source_range';
import { SYSTEM_RESOURCE_DOMAIN, type ResourceDomain, type ResourceIdentity } from '../common/resource';
import type { RuntimeFaultState } from './fault_state';
import { Blua32GlobalRegisterFile, resolveRuntimeLuaSource, type RuntimeSourceState } from './sources';
import type { SuspendedGuestRead, SuspendedGuestSession, SuspendedGuestValue } from './suspended_guest';
import type { RuntimeStackFrame } from './stack_trace';

export type RuntimeLuaFrameBinding = {
	readonly name: string;
	readonly isConst: boolean;
	readonly definition: SourceRange | null;
} & (
	| { readonly kind: 'slot'; readonly location: Blua32UpvalueRecord | null }
	| { readonly kind: 'address'; readonly address: number }
	| { readonly kind: 'type' }
);
export type RuntimeLuaFrameScope = {
	readonly kind: 'locals' | 'upvalues' | 'statics';
} & (
	| { readonly status: 'available'; readonly bindings: readonly RuntimeLuaFrameBinding[] }
	| { readonly status: 'symbols-unavailable' | 'function-unmapped' | 'source-unmapped' }
);

/** Installed locations for one logical frame, not a name lookup across recursive invocations. */
export function runtimeLuaFrameScopes(frame: RuntimeStackFrame, inlineDepth: number): RuntimeLuaFrameScope[] {
	const image = frame.toolingImage, symbols = image.symbols, functionIndex = frame.functionIndex;
	if (symbols === null || functionIndex < 0) {
		const status = symbols === null ? 'symbols-unavailable' : 'function-unmapped';
		return [{ kind: 'locals', status }, { kind: 'upvalues', status }, { kind: 'statics', status }];
	}
	const scopes: RuntimeLuaFrameScope[] = [];
	const range = blua32SourceRangeAtPc(symbols, image.layout.header.textAddress, frame.tracePc);
	const inlineSites = blua32InlineCallSitesAtPc(symbols, image.layout.header.textAddress, frame.tracePc);
	if (range === null) scopes.push({ kind: 'locals', status: 'source-unmapped' });
	else {
		const bindings: RuntimeLuaFrameBinding[] = [];
		for (const slot of symbols.metadata.localSlotsByFunction[functionIndex]) {
			if (slot.inlineCallSites.length !== inlineDepth) continue;
			const context = resolveInlineLocalContextRange(slot, range, inlineSites);
			if (context === null || context.path !== slot.scope.path
				|| !sourcePositionInRange(context.start.line, context.start.column, slot.scope)) continue;
			bindings.push({ kind: 'slot', name: slot.name, isConst: slot.isConst, definition: slot.definition,
				location: blua32SlotLiveAtPc(slot.liveWordRanges, image.layout.functions[functionIndex].codeAddress, frame.tracePc)
					? { inStack: true, index: slot.registerIndex } : null });
		}
		scopes.push({ kind: 'locals', status: 'available', bindings });
	}
	if (range === null && inlineDepth !== 0) scopes.push({ kind: 'upvalues', status: 'source-unmapped' });
	else {
		const bindings: RuntimeLuaFrameBinding[] = [];
		for (const slot of symbols.metadata.outerBindingsByFunction[functionIndex]) {
			if (slot.inlineCallSites.length !== inlineDepth) continue;
			if (range !== null && resolveInlineLocalContextRange(slot, range, inlineSites) === null) continue;
			const local = symbols.metadata.lexicalDeclarations[slot.declarationIndex];
			bindings.push({ kind: 'slot', name: local.name, isConst: local.isConst, definition: local.definition,
				location: blua32SlotLiveAtPc(slot.liveWordRanges, image.layout.functions[functionIndex].codeAddress, frame.tracePc) ? slot.location : null });
		}
		scopes.push({ kind: 'upvalues', status: 'available', bindings });
	}
	if (range === null) scopes.push({ kind: 'statics', status: 'source-unmapped' });
	else {
		const statics = symbols.metadata.staticScopes;
		const names = new Map(statics.globals.map(index => {
			const declaration = statics.declarations[index];
			return [declaration.name, declaration];
		}));
		for (const scope of scopes) if (scope.status === 'available') {
			for (const binding of scope.bindings) names.delete(binding.name);
		}
		for (const binding of statics.bindingsByFunction[functionIndex]) {
			if (binding.inlineDepth !== inlineDepth
				|| !blua32SlotLiveAtPc(binding.visibleWordRanges, image.layout.functions[functionIndex].codeAddress, frame.tracePc)) continue;
			const declaration = statics.declarations[binding.declarationIndex];
			names.set(declaration.name, declaration);
		}
		const bindings: RuntimeLuaFrameBinding[] = [];
		for (const declaration of names.values()) {
			const common = { name: declaration.name, definition: declaration.definition, isConst: true };
			bindings.push(declaration.kind === StaticDeclarationKind.Type ? { ...common, kind: 'type' }
				: { ...common, kind: 'address', address: declaration.address! });
		}
		scopes.push({ kind: 'statics', status: 'available', bindings });
	}
	return scopes;
}

export type RuntimeLuaInspectionValue = SuspendedGuestRead | {
	readonly kind: 'unavailable';
	readonly reason: 'source_changed' | 'not_loaded' | 'not_in_scope' | 'not_runtime_value';
};

const SOURCE_CHANGED: RuntimeLuaInspectionValue = { kind: 'unavailable', reason: 'source_changed' };
const NOT_LOADED: RuntimeLuaInspectionValue = { kind: 'unavailable', reason: 'not_loaded' };
const NOT_IN_SCOPE: RuntimeLuaInspectionValue = { kind: 'unavailable', reason: 'not_in_scope' };
const NOT_RUNTIME_VALUE: RuntimeLuaInspectionValue = { kind: 'unavailable', reason: 'not_runtime_value' };

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
	let upvalueIndex = -1;
	for (let index = 0; index < bindings.length; index += 1) {
		const local = symbols.metadata.lexicalDeclarations[bindings[index]];
		if (local.functionId !== moduleId || local.name !== name || local.definition === null) continue;
		// Preserved capture slots can outlive their use after Hot Resume. A name
		// query cannot choose between distinct bindings in the defining function.
		if (upvalueIndex !== -1) return NOT_IN_SCOPE;
		upvalueIndex = index;
	}
	return upvalueIndex === -1 ? NOT_IN_SCOPE : { kind: 'value', value: guest.readClosureUpvalue(closure, upvalueIndex) };
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
	const installedImage = domain === SYSTEM_RESOURCE_DOMAIN ? sources.currentBlua32Media.system : sources.currentBlua32Media.cartridgeSlots[domain];
	if (binding.kind === 'declaration' && isLuaStaticDeclaration(binding.declaration)) {
		if (binding.declaration.kind === 'type') return NOT_RUNTIME_VALUE;
		if (installedImage === null || installedImage.symbols === null) return NOT_LOADED;
		const definition = { ...analysis.chunk.locations.range(binding.declaration.span), path: record.module_path };
		const declaration = installedImage.symbols.metadata.staticScopes.declarations.find(entry => sourceRangesEqual(entry.definition, definition));
		if (declaration === undefined) return NOT_LOADED;
		return declaration.kind === StaticDeclarationKind.Type ? NOT_RUNTIME_VALUE : guest.readStringPath(declaration.address!, parts, 1);
	}
	if (binding.kind === 'global' || binding.kind === 'declaration' && binding.declaration.isGlobal) {
		if (installedImage === null) return NOT_LOADED;
		const statics = installedImage.symbols?.metadata.staticScopes;
		if (statics !== undefined) {
			const index = statics.globals.find(index => statics.declarations[index].name === name);
			if (index !== undefined) {
				const declaration = statics.declarations[index];
				return declaration.kind === StaticDeclarationKind.Type ? NOT_RUNTIME_VALUE : guest.readStringPath(declaration.address!, parts, 1);
			}
		}
		const registerFile = installedImage.globalRegisterFileByName.get(name);
		if (registerFile === undefined) return NOT_LOADED;
		const root = registerFile === Blua32GlobalRegisterFile.System ? guest.systemGlobal(name) : guest.global(name);
		return guest.readStringPath(root, parts, 1);
	}

	let declaration: SourceRange;
	if (binding.kind === 'receiver') {
		const receiver = analysis.scopesById.get(binding.scope)!.implicitSelfValue!;
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
				|| !blua32SlotLiveAtPc(slot.liveWordRanges, image.layout.functions[functionIndex].codeAddress, pc)) return NOT_IN_SCOPE;
			const value = captured === undefined ? cpu.readFrameRegister(frameIndex, slot.registerIndex) : captured.registers[slot.registerIndex];
			return guest.readStringPath(value, parts, 1);
		}
		for (const slot of symbols.metadata.outerBindingsByFunction[functionIndex]) {
			const local = symbols.metadata.lexicalDeclarations[slot.declarationIndex];
			if (local.definition === null || !sourceRangesEqual(local.definition, definition)) continue;
			if (slot.inlineCallSites.length !== 0 && (range === null || resolveInlineLocalContextRange(slot, range, inlineSites) === null)) continue;
			const location = slot.location;
			if (location === null || !blua32SlotLiveAtPc(slot.liveWordRanges, image.layout.functions[functionIndex].codeAddress, pc)) return NOT_IN_SCOPE;
			const value = location.inStack
				? captured === undefined ? cpu.readFrameRegister(frameIndex, location.index) : captured.registers[location.index]
				: captured === undefined ? cpu.readFrameUpvalue(frameIndex, location.index) : captured.upvalues[location.index];
			return guest.readStringPath(value, parts, 1);
		}
	}
	return NOT_IN_SCOPE;
}
