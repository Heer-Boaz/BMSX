import { INSTRUCTION_BYTES } from '../../../../machine/ts/spec/blua32/instruction_format';
import type { LuaSemanticFrontend, LuaSemanticFrontendFile } from '../semantic/frontend';
import type { SymbolID } from '../semantic/model';
import { isLuaStaticDeclaration, type LuaStaticDeclaration } from '../semantic/static_declarations';
import type { SourceRange } from '../source_range';
import { StaticDeclarationKind } from './declaration_kind';
import type { InlineCallSite, ProgramMetadata, Proto } from './program';
import { appendProgramWordRange, type ProgramWordRange } from './word_range';

export type StaticDeclarationDebug = {
	name: string;
	definition: SourceRange;
} & (
	| { kind: StaticDeclarationKind.Type }
	| { kind: StaticDeclarationKind.Bss | StaticDeclarationKind.Data | StaticDeclarationKind.Rodata; symbolIndex: number }
);

export type StaticBindingDebug = {
	declarationIndex: number;
	inlineDepth: number;
	visibleWordRanges: ProgramWordRange[];
};

export type ProgramStaticScopes = {
	declarations: readonly StaticDeclarationDebug[];
	globals: readonly number[];
	bindingsByProto: readonly (readonly StaticBindingDebug[])[];
};

/** Final source/inline contexts select bound declarations, without creating slots or captures. */
export function buildStaticDebugScopes(protos: readonly Proto[], ranges: readonly (SourceRange | null)[],
	chains: readonly (readonly InlineCallSite[])[], frontend: LuaSemanticFrontend,
	lexical: Pick<ProgramMetadata, 'protoIds' | 'localSlotsByProto' | 'outerBindingsByProto' | 'lexicalDeclarations'>,
	semanticsByFunction: ReadonlyMap<string, LuaSemanticFrontendFile>,
	bss: ReadonlyMap<SymbolID, { symbolIndex: number }>, data: ReadonlyMap<SymbolID, { symbolIndex: number }>,
	rodata: ReadonlyMap<SymbolID, { symbolIndex: number }>): ProgramStaticScopes {
	if (bss.size === 0 && data.size === 0 && rodata.size === 0
		&& !frontend.snapshot.files.some(file => file.decls.some(declaration => declaration.kind === 'type'))) {
		return { declarations: [], globals: [], bindingsByProto: protos.map(() => []) };
	}
	const declarations: StaticDeclarationDebug[] = [];
	const indices = new Map<SymbolID, number>();
	const publish = (declaration: LuaStaticDeclaration): number => {
		const retained = indices.get(declaration.id);
		if (retained !== undefined) return retained;
		const file = frontend.snapshot.getFileData(declaration.file)!;
		const common = { name: declaration.name, definition: file.chunk.locations.range(declaration.span) };
		let record: StaticDeclarationDebug;
		switch (declaration.kind) {
			case 'type': record = { ...common, kind: StaticDeclarationKind.Type }; break;
			case 'bss': record = { ...common, kind: StaticDeclarationKind.Bss, symbolIndex: bss.get(declaration.id)!.symbolIndex }; break;
			case 'data': record = { ...common, kind: StaticDeclarationKind.Data, symbolIndex: data.get(declaration.id)!.symbolIndex }; break;
			case 'rodata': record = { ...common, kind: StaticDeclarationKind.Rodata, symbolIndex: rodata.get(declaration.id)!.symbolIndex }; break;
		}
		const index = declarations.length;
		indices.set(declaration.id, index);
		declarations.push(record);
		return index;
	};
	const globals = frontend.snapshot.symbolResolver.staticDeclarations.valueGlobals.map(publish);
	// Storage has image lifetime, including declarations without an executable source word.
	// Erased trace/function bodies have syntax but no allocated section symbol.
	for (const file of frontend.snapshot.files) for (const declaration of file.decls) {
		if (isLuaStaticDeclaration(declaration) && (declaration.kind === 'type'
			|| bss.has(declaration.id) || data.has(declaration.id) || rodata.has(declaration.id))) publish(declaration);
	}
	const globalIndices = new Set(globals);
	const globalNames = new Set(globals.map(index => declarations[index].name));
	const shadowedGlobalNames = new Set<string>();
	const shadowsByProto: Set<string>[][] = [];
	for (let protoIndex = 0; protoIndex < protos.length; protoIndex++) {
		const byDepth: Set<string>[] = [];
		for (const slot of lexical.localSlotsByProto[protoIndex]) {
			if (!globalNames.has(slot.name)) continue;
			const depth = slot.inlineCallSites.length;
			let names = byDepth[depth];
			if (names === undefined) { names = new Set(); byDepth[depth] = names; }
			names.add(slot.name);
			shadowedGlobalNames.add(slot.name);
		}
		for (const slot of lexical.outerBindingsByProto[protoIndex]) {
			const name = lexical.lexicalDeclarations[slot.declarationIndex].name;
			if (!globalNames.has(name)) continue;
			const depth = slot.inlineCallSites.length;
			let names = byDepth[depth];
			if (names === undefined) { names = new Set(); byDepth[depth] = names; }
			names.add(name);
			shadowedGlobalNames.add(name);
		}
		shadowsByProto.push(byDepth);
	}
	if (declarations.length === globals.length && shadowedGlobalNames.size === 0) {
		return { declarations, globals, bindingsByProto: protos.map(() => []) };
	}
	const visibleByFile = new Map<LuaSemanticFrontendFile, Map<number, readonly number[]>>();
	const visibleAt = (file: LuaSemanticFrontendFile, range: SourceRange): readonly number[] => {
		let positions = visibleByFile.get(file);
		if (positions === undefined) { positions = new Map(); visibleByFile.set(file, positions); }
		const offset = file.locations.offsetAt(range.start);
		const retained = positions.get(offset);
		if (retained !== undefined) return retained;
		const visible: number[] = [];
		for (const declaration of file.getVisibleDeclarationsAt(range.start.line, range.start.column)) {
			if (isLuaStaticDeclaration(declaration)) {
				const index = publish(declaration);
				if (!globalIndices.has(index) || shadowedGlobalNames.has(declaration.name)) visible.push(index);
			}
		}
		positions.set(offset, visible);
		return visible;
	};
	const bindingsByProto: StaticBindingDebug[][] = [];
	for (let protoIndex = 0; protoIndex < protos.length; protoIndex++) {
		const proto = protos[protoIndex];
		const bindings: StaticBindingDebug[] = [];
		const byDepth: Map<number, StaticBindingDebug>[] = [];
		const first = proto.entryPC / INSTRUCTION_BYTES, end = first + proto.codeLen / INSTRUCTION_BYTES;
		for (let word = first; word < end;) {
			const range = ranges[word], chain = chains[word];
			let next = word + 1;
			while (next < end && ranges[next] === range && chains[next] === chain) next++;
			if (range === null) { word = next; continue; }
			for (let depth = 0; depth <= chain.length; depth++) {
				const context = depth === chain.length ? range : chain[depth].callRange;
				const file = semanticsByFunction.get(depth === 0 ? lexical.protoIds[protoIndex] : chain[depth - 1].calleeFunctionId)!;
				for (const declarationIndex of visibleAt(file, context)) {
					// Global defaults are shared once; only a real frame-name collision needs an override.
					if (globalIndices.has(declarationIndex) && !shadowsByProto[protoIndex][depth]?.has(declarations[declarationIndex].name)) continue;
					let atDepth = byDepth[depth];
					if (atDepth === undefined) { atDepth = new Map(); byDepth[depth] = atDepth; }
					let binding = atDepth.get(declarationIndex);
					if (binding === undefined) {
						binding = { declarationIndex, inlineDepth: depth, visibleWordRanges: [] };
						atDepth.set(declarationIndex, binding);
						bindings.push(binding);
					}
					appendProgramWordRange(binding.visibleWordRanges, word - first, next - first);
				}
			}
			word = next;
		}
		bindingsByProto.push(bindings);
	}
	return { declarations, globals, bindingsByProto };
}
