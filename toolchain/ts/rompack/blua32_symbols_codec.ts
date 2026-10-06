import { readLE32, writeLE32 } from '../../../machine/ts/common/endian';
import { decodeBinary, encodeBinary } from '../../../machine/ts/common/serializer/binencoder';
import { StaticDeclarationKind } from '../lua/compiler/declaration_kind';
import type { ProgramWordRange } from '../lua/compiler/word_range';
import { sourceRangeKey } from '../lua/semantic/source_range';
import type { SourceRange } from '../lua/source_range';
import type { Blua32InlineCallSite, Blua32SymbolsImage } from './blua32_symbols';

/** The private symbol graph has pooled values, not a serialized object tree.
 * See docs/blua32_symbols.md for the paired native record layout.
 */
type SymbolPayload = {
	strings: string[];
	ranges: Uint8Array;
	chains: Uint8Array;
	intervals: Uint8Array;
	registers: Uint8Array;
	records: Uint8Array;
};

class SymbolWords {
	public readonly words: number[] = [];

	public vector<T>(values: readonly T[], write: (value: T) => void): void {
		this.words.push(values.length);
		for (const value of values) write(value);
	}

	public numbers(values: readonly number[]): void {
		this.words.push(values.length);
		for (const value of values) this.words.push(value);
	}

	public bytes(): Uint8Array {
		const bytes = new Uint8Array(this.words.length * 4);
		for (let index = 0; index < this.words.length; index++) writeLE32(bytes, index * 4, this.words[index]);
		return bytes;
	}
}

class SymbolWordReader {
	private offset = 0;

	constructor(private readonly bytes: Uint8Array) {}

	public get position(): number { return this.offset; }

	public word(): number {
		const value = readLE32(this.bytes, this.offset);
		this.offset += 4;
		return value;
	}

	public vector<T>(read: () => T): T[] {
		const values = new Array<T>(this.word());
		for (let index = 0; index < values.length; index++) values[index] = read();
		return values;
	}

	public numbers(): number[] { return this.vector(() => this.word()); }
}

class SymbolTables {
	public readonly strings: string[] = [];
	public readonly ranges = new SymbolWords();
	public readonly chains = new SymbolWords();
	public readonly intervals = new SymbolWords();
	public readonly registers = new SymbolWords();
	private readonly stringIds = new Map<string, number>();
	private readonly rangeIds = new Map<string, number>();
	private readonly chainIds = new Map<string, number>();
	private readonly intervalIds = new Map<string, number>();
	private readonly registerIds = new Map<string, number>();
	private readonly rangeIdentity = new WeakMap<SourceRange, number>();
	private readonly chainIdentity = new WeakMap<readonly Blua32InlineCallSite[], number>();
	private readonly intervalIdentity = new WeakMap<readonly ProgramWordRange[], number>();
	private readonly registerIdentity = new WeakMap<readonly number[], number>();

	public text(value: string): number {
		let id = this.stringIds.get(value);
		if (id === undefined) {
			id = this.strings.length;
			this.strings.push(value);
			this.stringIds.set(value, id);
		}
		return id;
	}

	public range(value: SourceRange | null): number {
		if (value === null) return 0;
		let id = this.rangeIdentity.get(value);
		if (id !== undefined) return id;
		const path = this.text(value.path);
		const key = `${path}:${sourceRangeKey(value)}`;
		id = this.rangeIds.get(key);
		if (id === undefined) {
			id = this.rangeIds.size + 1;
			this.rangeIds.set(key, id);
			this.ranges.words.push(path, value.start.line, value.start.column, value.end.line, value.end.column);
		}
		this.rangeIdentity.set(value, id);
		return id;
	}

	public chain(value: readonly Blua32InlineCallSite[]): number {
		let id = this.chainIdentity.get(value);
		if (id !== undefined) return id;
		const words: number[] = [];
		for (const site of value) words.push(this.text(site.calleeFunctionId), this.range(site.callRange));
		const key = words.join(',');
		id = this.chainIds.get(key);
		if (id === undefined) {
			id = this.chainIds.size;
			this.chainIds.set(key, id);
			this.chains.words.push(value.length);
			for (const word of words) this.chains.words.push(word);
		}
		this.chainIdentity.set(value, id);
		return id;
	}

	public wordRanges(value: readonly ProgramWordRange[]): number {
		let id = this.intervalIdentity.get(value);
		if (id !== undefined) return id;
		const words: number[] = [];
		for (const range of value) words.push(range.start, range.end);
		const key = words.join(',');
		id = this.intervalIds.get(key);
		if (id === undefined) {
			id = this.intervalIds.size;
			this.intervalIds.set(key, id);
			this.intervals.words.push(value.length);
			for (const word of words) this.intervals.words.push(word);
		}
		this.intervalIdentity.set(value, id);
		return id;
	}

	public payload(records: SymbolWords): SymbolPayload {
		return { strings: this.strings,
			ranges: this.ranges.bytes(), chains: this.chains.bytes(), intervals: this.intervals.bytes(),
			registers: this.registers.bytes(), records: records.bytes() };
	}

	public registerList(value: readonly number[]): number {
		let id = this.registerIdentity.get(value);
		if (id !== undefined) return id;
		const key = value.join(',');
		id = this.registerIds.get(key);
		if (id === undefined) {
			id = this.registerIds.size;
			this.registerIds.set(key, id);
			this.registers.numbers(value);
		}
		this.registerIdentity.set(value, id);
		return id;
	}
}

export function encodeBlua32SymbolsImage(symbols: Blua32SymbolsImage): Uint8Array {
	const tables = new SymbolTables();
	const record = new SymbolWords();
	const words = record.words;
	const metadata = symbols.metadata;
	const text = (value: string) => { words.push(tables.text(value)); };
	words.push(symbols.imageAddress, symbols.initFunctionAddress, symbols.staticLayoutToken.lo, symbols.staticLayoutToken.hi);
	record.numbers(symbols.functionAddresses);
	record.vector(symbols.moduleFunctions, fn => { words.push(tables.text(fn.path), fn.address); });
	record.vector(symbols.initParticipants, fn => { words.push(tables.text(fn.functionId), tables.text(fn.slotName), +fn.system); });
	words.push(metadata.optLevel);
	switch (metadata.traceStatements) {
		case 'erase': words.push(0); break;
		case 'emit': words.push(1); break;
		default: words.push(2); record.vector(metadata.traceStatements, text); break;
	}
	record.vector(metadata.preloadModules, text);
	record.vector(metadata.functionIds, text);
	record.vector(metadata.functionDisplayNames, text);
	record.vector(metadata.functionDefinitions, range => { words.push(tables.range(range)); });
	record.vector(metadata.globalNames, text);
	record.vector(metadata.systemGlobalNames, text);
	record.vector(Object.keys(metadata.staticFunctionIdBySlot).sort(), slot => {
		words.push(tables.text(slot), tables.text(metadata.staticFunctionIdBySlot[slot]));
	});
	record.vector(metadata.debugRanges, range => { words.push(tables.range(range)); });
	record.vector(metadata.debugInlineCallSiteChains, chain => { words.push(tables.chain(chain)); });
	record.numbers(metadata.debugInlineCallSiteChainIds);
	record.vector(metadata.statementPointsByFunction, points => record.vector(points, point => {
		words.push(point.wordOffset, tables.range(point.range), tables.chain(point.inlineCallSites));
	}));
	record.vector(metadata.resumePointsByFunction, points => record.vector(points, point => {
		words.push(point.wordOffset, tables.range(point.range), point.op, tables.chain(point.inlineCallSites),
			point.resumeId === undefined ? 0 : tables.text(point.resumeId) + 1);
		words.push(tables.registerList(point.liveRegisters), tables.registerList(point.uses), tables.registerList(point.defs));
	}));
	record.vector(metadata.localSlotsByFunction, slots => record.vector(slots, slot => {
		words.push(slot.argumentIndex, tables.text(slot.name), +slot.isConst, slot.registerIndex,
			tables.range(slot.definition), tables.range(slot.scope), tables.chain(slot.inlineCallSites), tables.wordRanges(slot.liveWordRanges));
	}));
	record.vector(metadata.outerBindingsByFunction, slots => record.vector(slots, slot => {
		words.push(slot.declarationIndex);
		if (slot.location === null) words.push(0);
		else words.push(slot.location.inStack ? 1 : 2, slot.location.index);
		words.push(tables.chain(slot.inlineCallSites), tables.wordRanges(slot.liveWordRanges));
	}));
	record.vector(metadata.lexicalDeclarations, local => {
		words.push(tables.text(local.functionId), tables.text(local.name), local.kind, +local.isConst, tables.range(local.definition));
	});
	record.vector(metadata.upvalueBindingsByFunction, bindings => record.numbers(bindings));
	record.vector(metadata.staticScopes.declarations, declaration => {
		words.push(tables.text(declaration.name), tables.range(declaration.definition), declaration.kind);
		if (declaration.kind !== StaticDeclarationKind.Type) words.push(declaration.address!);
	});
	record.numbers(metadata.staticScopes.globals);
	record.vector(metadata.staticScopes.bindingsByFunction, bindings => record.vector(bindings, binding => {
		words.push(binding.declarationIndex, binding.inlineDepth, tables.wordRanges(binding.visibleWordRanges));
	}));
	return encodeBinary(tables.payload(record));
}

export function decodeBlua32SymbolsImage(bytes: Uint8Array): Blua32SymbolsImage {
	const payload = decodeBinary(bytes, { zeroCopyBin: true }) as SymbolPayload;
	const strings = payload.strings;
	const rangeReader = new SymbolWordReader(payload.ranges);
	const ranges: Array<SourceRange | null> = [null];
	while (rangeReader.position < payload.ranges.length) {
		ranges.push({ path: strings[rangeReader.word()],
			start: { line: rangeReader.word(), column: rangeReader.word() },
			end: { line: rangeReader.word(), column: rangeReader.word() } });
	}
	const chainReader = new SymbolWordReader(payload.chains);
	const chains: Blua32InlineCallSite[][] = [];
	while (chainReader.position < payload.chains.length) {
		chains.push(chainReader.vector(() => ({ calleeFunctionId: strings[chainReader.word()], callRange: ranges[chainReader.word()]! })));
	}
	const intervalReader = new SymbolWordReader(payload.intervals);
	const intervals: ProgramWordRange[][] = [];
	while (intervalReader.position < payload.intervals.length) {
		intervals.push(intervalReader.vector(() => ({ start: intervalReader.word(), end: intervalReader.word() })));
	}
	const record = new SymbolWordReader(payload.records);
	const registerReader = new SymbolWordReader(payload.registers);
	const registers: number[][] = [];
	while (registerReader.position < payload.registers.length) {
		registers.push(registerReader.numbers());
	}
	const text = () => strings[record.word()];
	const imageAddress = record.word(), initFunctionAddress = record.word();
	const staticLayoutToken = { lo: record.word(), hi: record.word() };
	const functionAddresses = record.numbers();
	const moduleFunctions = record.vector(() => ({ path: text(), address: record.word() }));
	const initParticipants = record.vector(() => ({ functionId: text(), slotName: text(), system: record.word() !== 0 }));
	const optLevel = record.word() as Blua32SymbolsImage['metadata']['optLevel'];
	const traceKind = record.word();
	const traceStatements = traceKind === 0 ? 'erase' : traceKind === 1 ? 'emit' : record.vector(text);
	const preloadModules = record.vector(text);
	const functionIds = record.vector(text), functionDisplayNames = record.vector(text);
	const functionDefinitions = record.vector(() => ranges[record.word()]);
	const globalNames = record.vector(text), systemGlobalNames = record.vector(text);
	const staticFunctionIdBySlot: Record<string, string> = {};
	const staticFunctionCount = record.word();
	for (let index = 0; index < staticFunctionCount; index++) {
		const slot = text();
		staticFunctionIdBySlot[slot] = text();
	}
	const debugRanges = record.vector(() => ranges[record.word()]);
	const debugInlineCallSiteChains = record.vector(() => chains[record.word()]);
	const debugInlineCallSiteChainIds = record.numbers();
	const statementPointsByFunction = record.vector(() => record.vector(() => ({
		wordOffset: record.word(), range: ranges[record.word()]!, inlineCallSites: chains[record.word()],
	})));
	const resumePointsByFunction = record.vector(() => record.vector(() => {
		const wordOffset = record.word(), range = ranges[record.word()]!, op = record.word();
		const inlineCallSites = chains[record.word()], resumeId = record.word();
		const liveRegisters = registers[record.word()], uses = registers[record.word()], defs = registers[record.word()];
		return { wordOffset, range, op, inlineCallSites, liveRegisters, uses, defs,
			...(resumeId === 0 ? {} : { resumeId: strings[resumeId - 1] }) };
	}));
	const localSlotsByFunction = record.vector(() => record.vector(() => ({
		argumentIndex: record.word() | 0, name: text(), isConst: record.word() !== 0, registerIndex: record.word(),
		definition: ranges[record.word()]!, scope: ranges[record.word()]!, inlineCallSites: chains[record.word()],
		liveWordRanges: intervals[record.word()],
	})));
	const outerBindingsByFunction = record.vector(() => record.vector(() => {
		const declarationIndex = record.word(), locationKind = record.word();
		const location = locationKind === 0 ? null : { inStack: locationKind === 1, index: record.word() };
		return { declarationIndex, location, inlineCallSites: chains[record.word()], liveWordRanges: intervals[record.word()] };
	}));
	const lexicalDeclarations = record.vector(() => ({ functionId: text(), name: text(), kind: record.word(),
		isConst: record.word() !== 0, definition: ranges[record.word()] }));
	const upvalueBindingsByFunction = record.vector(() => record.numbers());
	const declarations = record.vector(() => {
		const name = text(), definition = ranges[record.word()]!, kind = record.word();
		return kind === StaticDeclarationKind.Type ? { name, definition, kind } : { name, definition, kind, address: record.word() };
	});
	const globals = record.numbers();
	const bindingsByFunction = record.vector(() => record.vector(() => ({
		declarationIndex: record.word(), inlineDepth: record.word(), visibleWordRanges: intervals[record.word()],
	})));
	return { imageAddress, initFunctionAddress, staticLayoutToken, functionAddresses, moduleFunctions, initParticipants,
		metadata: { optLevel, traceStatements, preloadModules, functionIds, functionDisplayNames, functionDefinitions,
			globalNames, systemGlobalNames, staticFunctionIdBySlot, debugRanges, debugInlineCallSiteChains,
			debugInlineCallSiteChainIds, statementPointsByFunction, resumePointsByFunction, localSlotsByFunction,
			outerBindingsByFunction, lexicalDeclarations, upvalueBindingsByFunction,
			staticScopes: { declarations, globals, bindingsByFunction } } };
}
