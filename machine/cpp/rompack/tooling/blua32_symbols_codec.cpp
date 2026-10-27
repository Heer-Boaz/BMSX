#include "rompack/tooling/blua32_symbols.h"
#include "common/endian.h"
#include "common/serializer/binencoder.h"

#include <algorithm>
#include <array>
#include <map>
#include <unordered_map>

namespace bmsx {
namespace {

// Paired with toolchain/ts/rompack/blua32_symbols_codec.ts. Symbol values are
// immutable shared nodes; decoding must not expand them back into a tree.
struct SymbolWords {
	std::vector<u32> words;

	template<typename T, typename Write>
	void vector(const std::vector<T>& values, Write write) {
		words.push_back(static_cast<u32>(values.size()));
		for (const T& value : values) write(value);
	}

	template<typename T>
	void numbers(const std::vector<T>& values) {
		words.push_back(static_cast<u32>(values.size()));
		for (T value : values) words.push_back(static_cast<u32>(value));
	}
};

class SymbolWordReader {
	std::span<const u8> m_bytes;
	size_t m_offset = 0;

public:
	explicit SymbolWordReader(std::span<const u8> bytes) : m_bytes(bytes) {}

	auto position() const -> size_t { return m_offset; }

	auto word() -> u32 {
		const u32 value = readLE32(m_bytes.data() + m_offset);
		m_offset += 4;
		return value;
	}

	template<typename Read>
	auto vector(Read read) {
		std::vector<decltype(read())> values;
		const u32 count = word();
		values.reserve(count);
		for (u32 index = 0; index < count; ++index) values.push_back(read());
		return values;
	}

	template<typename T = u32>
	auto numbers() -> std::vector<T> { return vector([&] { return static_cast<T>(word()); }); }
};

class SymbolTables {
	std::unordered_map<std::string, u32> m_textIds;
	std::map<std::array<u32, 5>, u32> m_rangeIds;
	std::map<std::vector<u32>, u32> m_chainIds;
	std::map<std::vector<u32>, u32> m_intervalIds;
	std::map<std::vector<i32>, u32> m_registerIds;
	std::unordered_map<const SourceRange*, u32> m_rangeIdentity;
	std::unordered_map<const std::vector<Blua32InlineCallSite>*, u32> m_chainIdentity;
	std::unordered_map<const std::vector<ProgramWordRange>*, u32> m_intervalIdentity;
	std::unordered_map<const std::vector<i32>*, u32> m_registerIdentity;

public:
	BinArray strings;
	SymbolWords ranges, chains, intervals, registers;

	auto text(const std::string& value) -> u32 {
		const auto [entry, inserted] = m_textIds.try_emplace(value, static_cast<u32>(strings.size()));
		if (inserted) strings.emplace_back(value);
		return entry->second;
	}

	auto range(const Blua32SourceRange& value) -> u32 {
		if (!value) return 0;
		const auto known = m_rangeIdentity.find(value.get());
		if (known != m_rangeIdentity.end()) return known->second;
		const std::array<u32, 5> key{text(value->path), static_cast<u32>(value->start.line),
			static_cast<u32>(value->start.column), static_cast<u32>(value->end.line), static_cast<u32>(value->end.column)};
		const auto [entry, inserted] = m_rangeIds.try_emplace(key, static_cast<u32>(m_rangeIds.size() + 1));
		if (inserted) ranges.words.insert(ranges.words.end(), key.begin(), key.end());
		m_rangeIdentity.emplace(value.get(), entry->second);
		return entry->second;
	}

	auto chain(const Blua32InlineCallSites& value) -> u32 {
		const auto known = m_chainIdentity.find(value.get());
		if (known != m_chainIdentity.end()) return known->second;
		std::vector<u32> key;
		key.reserve(value->size() * 2);
		for (const auto& site : *value) {
			key.push_back(text(site.calleeFunctionId));
			key.push_back(range(site.callRange));
		}
		const auto [entry, inserted] = m_chainIds.try_emplace(std::move(key), static_cast<u32>(m_chainIds.size()));
		if (inserted) {
			chains.words.push_back(static_cast<u32>(value->size()));
			chains.words.insert(chains.words.end(), entry->first.begin(), entry->first.end());
		}
		m_chainIdentity.emplace(value.get(), entry->second);
		return entry->second;
	}

	auto wordRanges(const Blua32WordRanges& value) -> u32 {
		const auto known = m_intervalIdentity.find(value.get());
		if (known != m_intervalIdentity.end()) return known->second;
		std::vector<u32> key;
		key.reserve(value->size() * 2);
		for (const auto& interval : *value) {
			key.push_back(static_cast<u32>(interval.start));
			key.push_back(static_cast<u32>(interval.end));
		}
		const auto [entry, inserted] = m_intervalIds.try_emplace(std::move(key), static_cast<u32>(m_intervalIds.size()));
		if (inserted) {
			intervals.words.push_back(static_cast<u32>(value->size()));
			intervals.words.insert(intervals.words.end(), entry->first.begin(), entry->first.end());
		}
		m_intervalIdentity.emplace(value.get(), entry->second);
		return entry->second;
	}

	auto registerList(const Blua32RegisterList& value) -> u32 {
		const auto known = m_registerIdentity.find(value.get());
		if (known != m_registerIdentity.end()) return known->second;
		const auto [entry, inserted] = m_registerIds.try_emplace(*value, static_cast<u32>(m_registerIds.size()));
		if (inserted) registers.numbers(*value);
		m_registerIdentity.emplace(value.get(), entry->second);
		return entry->second;
	}
};

} // namespace

auto encodeBlua32SymbolsImage(const Blua32SymbolsImage& symbols) -> std::vector<u8> {
	SymbolTables tables;
	SymbolWords record;
	auto& words = record.words;
	const auto& metadata = symbols.metadata;
	const auto text = [&](const std::string& value) { words.push_back(tables.text(value)); };
	words.insert(words.end(), {symbols.imageAddress, symbols.staticLayoutToken.lo, symbols.staticLayoutToken.hi});
	record.numbers(symbols.functionAddresses);
	record.vector(symbols.moduleFunctions, [&](const auto& fn) { words.insert(words.end(), {tables.text(fn.path), fn.address}); });
	record.vector(symbols.initParticipants, [&](const auto& fn) {
		words.insert(words.end(), {tables.text(fn.functionId), tables.text(fn.slotName), static_cast<u32>(fn.system)});
	});
	words.push_back(metadata.optLevel);
	if (const auto* selection = std::get_if<std::string>(&metadata.traceStatements)) {
		words.push_back(*selection == "erase" ? 0 : 1);
	} else {
		words.push_back(2);
		record.vector(std::get<std::vector<std::string>>(metadata.traceStatements), text);
	}
	record.vector(metadata.preloadModules, text);
	record.vector(metadata.compiledModulePaths, text);
	record.vector(metadata.functionIds, text);
	record.vector(metadata.functionDisplayNames, text);
	record.vector(metadata.functionDefinitions, [&](const auto& range) { words.push_back(tables.range(range)); });
	record.vector(metadata.globalNames, text);
	record.vector(metadata.systemGlobalNames, text);
	std::vector<std::string> slots;
	slots.reserve(metadata.staticFunctionIdBySlot.size());
	for (const auto& [slot, id] : metadata.staticFunctionIdBySlot) slots.push_back(slot);
	std::sort(slots.begin(), slots.end());
	record.vector(slots, [&](const auto& slot) {
		words.insert(words.end(), {tables.text(slot), tables.text(metadata.staticFunctionIdBySlot.at(slot))});
	});
	record.vector(metadata.debugRanges, [&](const auto& range) { words.push_back(tables.range(range)); });
	record.vector(metadata.debugInlineCallSiteChains, [&](const auto& chain) { words.push_back(tables.chain(chain)); });
	record.numbers(metadata.debugInlineCallSiteChainIds);
	record.vector(metadata.statementPointsByFunction, [&](const auto& points) { record.vector(points, [&](const auto& point) {
		words.insert(words.end(), {static_cast<u32>(point.wordOffset), tables.range(point.range), tables.chain(point.inlineCallSites)});
	}); });
	record.vector(metadata.resumePointsByFunction, [&](const auto& points) { record.vector(points, [&](const auto& point) {
		words.insert(words.end(), {static_cast<u32>(point.wordOffset), tables.range(point.range), static_cast<u32>(point.op),
			tables.chain(point.inlineCallSites), point.resumeId ? tables.text(*point.resumeId) + 1 : 0});
		words.insert(words.end(), {tables.registerList(point.liveRegisters), tables.registerList(point.uses), tables.registerList(point.defs)});
	}); });
	record.vector(metadata.localSlotsByFunction, [&](const auto& slots) { record.vector(slots, [&](const auto& slot) {
		words.insert(words.end(), {static_cast<u32>(slot.argumentIndex), tables.text(slot.name), static_cast<u32>(slot.isConst),
			static_cast<u32>(slot.registerIndex), tables.range(slot.definition), tables.range(slot.scope),
			tables.chain(slot.inlineCallSites), tables.wordRanges(slot.liveWordRanges)});
	}); });
	record.vector(metadata.outerBindingsByFunction, [&](const auto& slots) { record.vector(slots, [&](const auto& slot) {
		words.push_back(slot.declarationIndex);
		if (slot.location) words.insert(words.end(), {slot.location->inStack ? 1u : 2u, static_cast<u32>(slot.location->index)});
		else words.push_back(0);
		words.insert(words.end(), {tables.chain(slot.inlineCallSites), tables.wordRanges(slot.liveWordRanges)});
	}); });
	record.vector(metadata.lexicalDeclarations, [&](const auto& local) {
		words.insert(words.end(), {tables.text(local.functionId), tables.text(local.name), static_cast<u32>(local.kind),
			static_cast<u32>(local.isConst), tables.range(local.definition)});
	});
	record.vector(metadata.upvalueBindingsByFunction, [&](const auto& bindings) { record.numbers(bindings); });
	record.vector(metadata.staticScopes.declarations, [&](const auto& declaration) {
		words.insert(words.end(), {tables.text(declaration.name), tables.range(declaration.definition), static_cast<u32>(declaration.kind)});
		if (declaration.kind != StaticDeclarationKind::Type) words.push_back(*declaration.address);
	});
	record.numbers(metadata.staticScopes.globals);
	record.vector(metadata.staticScopes.bindingsByFunction, [&](const auto& bindings) { record.vector(bindings, [&](const auto& binding) {
		words.insert(words.end(), {binding.declarationIndex, binding.inlineDepth, tables.wordRanges(binding.visibleWordRanges)});
	}); });
	BinObject payload;
	payload["strings"] = BinValue(std::move(tables.strings));
	payload["ranges"] = BinValue(writeLE32Array(tables.ranges.words));
	payload["chains"] = BinValue(writeLE32Array(tables.chains.words));
	payload["intervals"] = BinValue(writeLE32Array(tables.intervals.words));
	payload["registers"] = BinValue(writeLE32Array(tables.registers.words));
	payload["records"] = BinValue(writeLE32Array(words));
	return encodeBinary(BinValue(std::move(payload)));
}

auto decodeBlua32SymbolsImage(std::span<const u8> bytes) -> Blua32SymbolsImage {
	const BinValue payload = decodeBinary(bytes.data(), bytes.size());
	const auto& strings = payload.require("strings").asArray();
	const auto& rangeBytes = payload.require("ranges").asBinary();
	SymbolWordReader rangeReader(rangeBytes);
	std::vector<Blua32SourceRange> ranges{nullptr};
	ranges.reserve(1 + rangeBytes.size() / 20);
	while (rangeReader.position() < rangeBytes.size()) {
		ranges.push_back(std::make_shared<const SourceRange>(SourceRange{strings[rangeReader.word()].asString(),
			{static_cast<i32>(rangeReader.word()), static_cast<i32>(rangeReader.word())},
			{static_cast<i32>(rangeReader.word()), static_cast<i32>(rangeReader.word())}}));
	}
	const auto& chainBytes = payload.require("chains").asBinary();
	SymbolWordReader chainReader(chainBytes);
	std::vector<Blua32InlineCallSites> chains;
	while (chainReader.position() < chainBytes.size()) {
		chains.push_back(std::make_shared<const std::vector<Blua32InlineCallSite>>(chainReader.vector([&] {
			return Blua32InlineCallSite{strings[chainReader.word()].asString(), ranges[chainReader.word()]};
		})));
	}
	const auto& intervalBytes = payload.require("intervals").asBinary();
	SymbolWordReader intervalReader(intervalBytes);
	std::vector<Blua32WordRanges> intervals;
	while (intervalReader.position() < intervalBytes.size()) {
		intervals.push_back(std::make_shared<const std::vector<ProgramWordRange>>(intervalReader.vector([&] {
			return ProgramWordRange{static_cast<i32>(intervalReader.word()), static_cast<i32>(intervalReader.word())};
		})));
	}
	const auto& registerBytes = payload.require("registers").asBinary();
	SymbolWordReader registerReader(registerBytes);
	std::vector<Blua32RegisterList> registers;
	while (registerReader.position() < registerBytes.size()) {
		registers.push_back(std::make_shared<const std::vector<i32>>(registerReader.numbers<i32>()));
	}
	SymbolWordReader record(payload.require("records").asBinary());
	const auto text = [&]() -> const std::string& { return strings[record.word()].asString(); };
	Blua32SymbolsImage symbols;
	symbols.imageAddress = record.word();
	symbols.staticLayoutToken = {record.word(), record.word()};
	symbols.functionAddresses = record.numbers();
	symbols.moduleFunctions = record.vector([&] { return Blua32ModuleFunction{text(), record.word()}; });
	symbols.initParticipants = record.vector([&] { return Blua32InitParticipant{text(), text(), record.word() != 0}; });
	auto& metadata = symbols.metadata;
	metadata.optLevel = record.word();
	const u32 traceKind = record.word();
	switch (traceKind) {
		case 0: metadata.traceStatements = std::string("erase"); break;
		case 1: metadata.traceStatements = std::string("emit"); break;
		case 2: metadata.traceStatements = record.vector([&] { return std::string(text()); }); break;
	}
	metadata.preloadModules = record.vector([&] { return std::string(text()); });
	metadata.compiledModulePaths = record.vector([&] { return std::string(text()); });
	metadata.functionIds = record.vector([&] { return std::string(text()); });
	metadata.functionDisplayNames = record.vector([&] { return std::string(text()); });
	metadata.functionDefinitions = record.vector([&] { return ranges[record.word()]; });
	metadata.globalNames = record.vector([&] { return std::string(text()); });
	metadata.systemGlobalNames = record.vector([&] { return std::string(text()); });
	const u32 staticFunctionCount = record.word();
	for (u32 index = 0; index < staticFunctionCount; ++index) {
		const std::string& slot = text();
		metadata.staticFunctionIdBySlot.emplace(slot, text());
	}
	metadata.debugRanges = record.vector([&] { return ranges[record.word()]; });
	metadata.debugInlineCallSiteChains = record.vector([&] { return chains[record.word()]; });
	metadata.debugInlineCallSiteChainIds = record.numbers();
	metadata.statementPointsByFunction = record.vector([&] { return record.vector([&] {
		return Blua32StatementPoint{static_cast<i32>(record.word()), ranges[record.word()], chains[record.word()]};
	}); });
	metadata.resumePointsByFunction = record.vector([&] { return record.vector([&] {
		Blua32ResumePoint point;
		point.wordOffset = static_cast<i32>(record.word());
		point.range = ranges[record.word()];
		point.op = static_cast<OpCode>(record.word());
		point.inlineCallSites = chains[record.word()];
		const u32 resumeId = record.word();
		if (resumeId != 0) point.resumeId = strings[resumeId - 1].asString();
		point.liveRegisters = registers[record.word()];
		point.uses = registers[record.word()];
		point.defs = registers[record.word()];
		return point;
	}); });
	metadata.localSlotsByFunction = record.vector([&] { return record.vector([&] {
		return Blua32LocalSlotDebug{static_cast<i32>(record.word()), text(), record.word() != 0, static_cast<i32>(record.word()),
			ranges[record.word()], ranges[record.word()], chains[record.word()], intervals[record.word()]};
	}); });
	metadata.outerBindingsByFunction = record.vector([&] { return record.vector([&] {
		Blua32OuterBindingDebug slot;
		slot.declarationIndex = record.word();
		const u32 locationKind = record.word();
		if (locationKind != 0) slot.location = Blua32UpvalueRecord{locationKind == 1, record.word()};
		slot.inlineCallSites = chains[record.word()];
		slot.liveWordRanges = intervals[record.word()];
		return slot;
	}); });
	metadata.lexicalDeclarations = record.vector([&] {
		return Blua32LexicalDeclarationDebug{text(), text(), static_cast<LexicalDeclarationKind>(record.word()),
			record.word() != 0, ranges[record.word()]};
	});
	metadata.upvalueBindingsByFunction = record.vector([&] { return record.numbers(); });
	metadata.staticScopes.declarations = record.vector([&] {
		Blua32StaticDeclarationDebug declaration{text(), ranges[record.word()], static_cast<StaticDeclarationKind>(record.word()), std::nullopt};
		if (declaration.kind != StaticDeclarationKind::Type) declaration.address = record.word();
		return declaration;
	});
	metadata.staticScopes.globals = record.numbers();
	metadata.staticScopes.bindingsByFunction = record.vector([&] { return record.vector([&] {
		return Blua32StaticBindingDebug{record.word(), record.word(), intervals[record.word()]};
	}); });
	return symbols;
}

} // namespace bmsx
