#include "machine/cpu/cpu.h"
#include "machine/common/numeric.h"
#include "lua/numeric.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/lua_heap_usage.h"
#include "machine/memory/map.h"
#include "machine/memory/memory.h"
#include "common/utf8.h"
#include <algorithm>
#include <cctype>
#include <stdexcept>
#include <unordered_set>

#if defined(__GNUC__) || defined(__clang__)
#define BMSX_USE_COMPUTED_GOTO 1
#else
#define BMSX_USE_COMPUTED_GOTO 0
#endif

namespace bmsx {

// start repeated-sequence-acceptable -- CPU interpreter hot paths keep duplicated opcode/register statements inline.

namespace {
static constexpr NativeFnCost kDefaultNativeCost { 1, 0, 0 };

constexpr size_t kClosureHeapBytes = 16;
constexpr size_t kClosureUpvalueSlotHeapBytes = 8;
constexpr ptrdiff_t kNativeFunctionHeapBytes = 16;
constexpr ptrdiff_t kNativeObjectHeapBytes = 24;
constexpr ptrdiff_t kUpvalueHeapBytes = 24;
static inline size_t trackedClosureBytes(const Closure& closure) {
	return closure.trackedHeapBytes;
}

static inline size_t closureAllocationBytes(size_t upvalueCount) {
	return sizeof(Closure) + (upvalueCount * sizeof(Upvalue*));
}

} // namespace

void GcHeap::markValue(Value v) {
	if (!valueIsTagged(v)) {
		return;
	}
	switch (valueTag(v)) {
		case ValueTag::Table:
			markObject(asTable(v));
			break;
		case ValueTag::Closure:
			markClosure(asClosure(v));
			break;
		case ValueTag::BuiltinFunction:
			break;
		case ValueTag::NativeFunction:
			markObject(asNativeFunction(v));
			break;
		case ValueTag::NativeObject:
			markObject(asNativeObject(v));
			break;
		case ValueTag::Upvalue:
			markObject(asUpvalue(v));
			break;
		case ValueTag::String:
			m_stringPool.markReachable(asStringId(v));
			break;
		default:
			break;
	}
}

void GcHeap::markClosure(Closure* closure) {
	if (closure->trackedHeapBytes == 0) {
		return;
	}
	markObject(closure);
}

Closure* GcHeap::allocateClosure(size_t upvalueCount) {
	const size_t byteCount = closureAllocationBytes(upvalueCount);
	void* storage = ::operator new(byteCount);
	auto* closure = new (storage) Closure();
	closure->type = ObjType::Closure;
	closure->marked = false;
	closure->hashId = allocateHashId();
	closure->next = m_objects;
	closure->upvalueCount = upvalueCount;
	closure->upvalues = reinterpret_cast<Upvalue**>(static_cast<uint8_t*>(storage) + sizeof(Closure));
	for (size_t index = 0; index < upvalueCount; ++index) {
		closure->upvalues[index] = nullptr;
	}
	m_objects = closure;
	m_bytesAllocated += byteCount;
	if (m_bytesAllocated > m_nextGC) {
		m_collectRequested = true;
	}
	return closure;
}

void GcHeap::markObject(GCObject* obj) {
	if (!obj || obj->marked) {
		return;
	}
	obj->marked = true;
	m_grayStack.push_back(obj);
}

void GcHeap::trace() {
	while (!m_grayStack.empty()) {
		GCObject* obj = m_grayStack.back();
		m_grayStack.pop_back();
		switch (obj->type) {
			case ObjType::Table: {
				auto* table = static_cast<Table*>(obj);
				if (table->metatable) {
					markObject(table->metatable);
				}
				table->forEachEntry([this](Value key, Value value) {
					markValue(key);
					markValue(value);
				});
				break;
			}
			case ObjType::Closure: {
				auto* closure = static_cast<Closure*>(obj);
				for (size_t index = 0; index < closure->upvalueCount; ++index) {
					markObject(closure->upvalues[index]);
				}
				break;
			}
			case ObjType::NativeFunction:
				break;
			case ObjType::NativeObject: {
				auto* native = static_cast<NativeObject*>(obj);
				if (native->metatable) {
					markObject(native->metatable);
				}
				break;
			}
			case ObjType::Upvalue: {
				auto* upvalue = static_cast<Upvalue*>(obj);
				if (!upvalue->open) {
					markValue(upvalue->value);
				}
				break;
			}
		}
	}
}

void GcHeap::sweep() {
	GCObject** current = &m_objects;
	while (*current) {
		GCObject* obj = *current;
		if (obj->marked) {
			obj->marked = false;
			current = &obj->next;
			continue;
		}
		GCObject* next = obj->next;
		switch (obj->type) {
			case ObjType::Table:
				m_bytesAllocated -= sizeof(Table);
				addTrackedLuaHeapBytes(-static_cast<ptrdiff_t>(static_cast<Table*>(obj)->trackedHeapBytes()));
				delete static_cast<Table*>(obj);
				break;
			case ObjType::Closure:
				m_bytesAllocated -= closureAllocationBytes(static_cast<Closure*>(obj)->upvalueCount);
				addTrackedLuaHeapBytes(-static_cast<ptrdiff_t>(trackedClosureBytes(*static_cast<Closure*>(obj))));
				static_cast<Closure*>(obj)->~Closure();
				::operator delete(obj);
				break;
			case ObjType::NativeFunction:
				m_bytesAllocated -= sizeof(NativeFunction);
				addTrackedLuaHeapBytes(-kNativeFunctionHeapBytes);
				delete static_cast<NativeFunction*>(obj);
				break;
			case ObjType::NativeObject:
				m_bytesAllocated -= sizeof(NativeObject);
				addTrackedLuaHeapBytes(-kNativeObjectHeapBytes);
				delete static_cast<NativeObject*>(obj);
				break;
			case ObjType::Upvalue:
				m_bytesAllocated -= sizeof(Upvalue);
				addTrackedLuaHeapBytes(-kUpvalueHeapBytes);
				delete static_cast<Upvalue*>(obj);
				break;
		}
		*current = next;
	}
}

void GcHeap::collect() {
	if (m_collectionSuspendDepth > 0) {
		m_collectRequested = true;
		return;
	}
	if (!m_collectRequested) {
		return;
	}
	m_collectRequested = false;
	m_stringPool.beginReachabilityEpoch();
	if (m_rootMarker) {
		m_rootMarker(*this);
	}
	trace();
	sweep();
	m_stringPool.reclaimUnreachableTracked();
	m_nextGC = m_bytesAllocated * 2;
}

NativeResultsScratchScope::NativeResultsScratchScope(CPU& cpu, NativeResults& out) noexcept
	: m_cpu(&cpu)
	, m_out(&out) {
}

NativeResultsScratchScope::NativeResultsScratchScope(NativeResultsScratchScope&& other) noexcept
	: m_cpu(other.m_cpu)
	, m_out(other.m_out) {
	other.m_cpu = nullptr;
	other.m_out = nullptr;
}

NativeResultsScratchScope::~NativeResultsScratchScope() {
	if (m_cpu) {
		m_cpu->releaseNativeReturnScratch(*m_out);
	}
}

CPU::NativeLocalRootsScope::NativeLocalRootsScope(CPU& cpu) noexcept
	: m_cpu(&cpu)
	, m_base(cpu.m_nativeLocalRoots.size()) {
	cpu.m_nativeLocalRootScopeDepth += 1;
}

CPU::NativeLocalRootsScope::NativeLocalRootsScope(NativeLocalRootsScope&& other) noexcept
	: m_cpu(other.m_cpu)
	, m_base(other.m_base) {
	other.m_cpu = nullptr;
	other.m_base = 0;
}

CPU::NativeLocalRootsScope::~NativeLocalRootsScope() {
	if (m_cpu) {
		m_cpu->releaseNativeLocalRoots(m_base);
	}
}

CPU::CPU(
	Memory& memory,
	IrqController& irqController,
	ExecutionAddressSpace& executionAddressSpace
)
	: m_protectedCallContinuations(MAX_POOLED_FRAMES)
	, m_memory(memory)
	, m_irqController(irqController)
	, m_executionAddressSpace(executionAddressSpace)
	, m_stringPool(true)
	, m_heap(m_stringPool) {
	m_executionImages.reserve(3);
	for (size_t index = 0; index < m_builtinFunctions.size(); ++index) {
		BuiltinFunction& builtin = m_builtinFunctions[index];
		const NativeFnCost cost = BUILTIN_FUNCTION_COSTS[index];
		builtin.id = static_cast<BuiltinFunctionId>(index);
		builtin.cycleBase = cost.base;
		builtin.cyclePerArg = cost.perArg;
		builtin.cyclePerRet = cost.perRet;
	}
	m_heap.setRootMarker([this](GcHeap& heap) { markRoots(heap); });
	globals = m_heap.allocate<Table>(ObjType::Table, 0, 0);
	m_stringIndexTable = createTable();
	m_indexKey = valueString(m_stringPool.intern("__index"));
}

Value CPU::createBuiltinFunction(BuiltinFunctionId id) {
	return valueBuiltinFunction(&m_builtinFunctions[static_cast<size_t>(id)]);
}

Value CPU::createNativeFunction(std::string_view name, NativeFunctionInvoke fn, std::optional<NativeFnCost> cost) {
	const NativeFnCost resolvedCost = cost ? *cost : kDefaultNativeCost;
	auto* native = m_heap.allocate<NativeFunction>(ObjType::NativeFunction);
	addTrackedLuaHeapBytes(kNativeFunctionHeapBytes);
	native->name = std::string(name);
	native->cycleBase = resolvedCost.base;
	native->cyclePerArg = resolvedCost.perArg;
	native->cyclePerRet = resolvedCost.perRet;
	native->invoke = [this, invoke = std::move(fn)](NativeArgsView args, NativeResults& out) {
		auto localRoots = acquireNativeLocalRoots();
		out.clear();
		invoke(args, out);
	};
	const Value value = valueNativeFunction(native);
	trackNativeLocalRoot(value);
	return value;
}

Value CPU::createNativeObject(
	void* raw,
	std::function<Value(const Value&)> get,
	std::function<void(const Value&, const Value&)> set,
	std::function<int()> len,
	std::function<std::optional<std::pair<Value, Value>>(const Value&)> nextEntry
) {
	auto* native = m_heap.allocate<NativeObject>(ObjType::NativeObject);
	addTrackedLuaHeapBytes(kNativeObjectHeapBytes);
	native->raw = raw;
	native->get = std::move(get);
	native->set = std::move(set);
	native->len = std::move(len);
	native->nextEntry = std::move(nextEntry);
	const Value value = valueNativeObject(native);
	trackNativeLocalRoot(value);
	return value;
}

Table* CPU::createTable(int arraySize, int hashSize) {
	Table* table = m_heap.allocate<Table>(ObjType::Table, arraySize, hashSize);
	trackNativeLocalRoot(valueTable(table));
	return table;
}

Closure* CPU::createTrackedClosure(
	u32 functionAddress,
	size_t upvalueCount
) {
	auto* closure = m_heap.allocateClosure(upvalueCount);
	closure->functionAddress = functionAddress;
	closure->trackedHeapBytes = kClosureHeapBytes + (upvalueCount * kClosureUpvalueSlotHeapBytes);
	addTrackedLuaHeapBytes(static_cast<ptrdiff_t>(trackedClosureBytes(*closure)));
	return closure;
}

void CPU::resetExecutionImages(Blua32DecodedExecutionImage&& systemImage) {
	m_staticClosuresByAddress.clear();
	m_executionImages.clear();
	std::unique_ptr<Blua32ExecutionImage> activatedSystemImage =
		activateExecutionImage(std::move(systemImage));
	m_systemImage = activatedSystemImage.get();
	m_executionImages.push_back(std::move(activatedSystemImage));
	m_systemExceptionFunctionAddress = m_systemImage->boot.exceptionFunctionAddress;
	m_activeExecutionImage = m_systemImage;
	m_hardHalted = false;
}

std::vector<u32> CPU::registerGlobalNames(const std::vector<std::string>& names, bool system) {
	auto& slotByKey = system ? m_systemGlobalSlotByKey : m_globalSlotByKey;
	auto& registeredNames = system ? m_systemGlobalNames : m_globalNames;
	auto& values = system ? m_systemGlobalValues : m_globalValues;
	std::vector<u32> slots(names.size());
	for (size_t index = 0; index < names.size(); ++index) {
		const StringId key = m_stringPool.intern(names[index], false);
		auto slot = slotByKey.find(key);
		if (slot == slotByKey.end()) {
			const size_t slotIndex = registeredNames.size();
			slot = slotByKey.emplace(key, slotIndex).first;
			registeredNames.push_back(key);
			values.push_back(system ? valueNil() : globals->get(valueString(key)));
		}
		slots[index] = static_cast<u32>(slot->second);
	}
	return slots;
}

std::unique_ptr<Blua32ExecutionImage> CPU::activateExecutionImage(
	Blua32DecodedExecutionImage&& decodedImage
) {
	auto image = std::make_unique<Blua32ExecutionImage>();
	image->layout = std::move(decodedImage.layout);
	image->boot = decodedImage.boot;
	image->executionDomainId = decodedImage.executionDomainId;
	image->constPool.reserve(image->layout.constants.size());
	for (const Blua32EncodedConstant& constant : image->layout.constants) {
		if (std::holds_alternative<std::monostate>(constant)) {
			image->constPool.push_back(valueNil());
		} else if (const auto* boolean = std::get_if<bool>(&constant)) {
			image->constPool.push_back(valueBool(*boolean));
		} else if (const auto* number = std::get_if<f64>(&constant)) {
			image->constPool.push_back(valueNumber(*number));
		} else {
			image->constPool.push_back(valueString(m_stringPool.intern(std::get<std::string>(constant), false)));
		}
	}
	image->globalSlots = registerGlobalNames(image->layout.globalNames, false);
	image->systemGlobalSlots = registerGlobalNames(image->layout.systemGlobalNames, true);
	decodeImageText(*image);

	image->functions.resize(image->layout.functions.size());
	image->staticClosures.resize(image->layout.functions.size());
	for (size_t index = 0; index < image->layout.functions.size(); ++index) {
		const Blua32FunctionRecord& source = image->layout.functions[index];
		Blua32RuntimeFunction& function = image->functions[index];
		function.address = source.address;
		function.codeAddress = source.codeAddress;
		function.codeByteCount = source.codeByteCount;
		function.numParams = source.numParams;
		function.maxStack = source.maxStack;
		function.isVararg = source.isVararg;
		function.staticClosure = source.staticClosure;
		function.upvalues = source.upvalues;
		function.image = image.get();
		function.index = static_cast<u32>(index);
		if (function.staticClosure) {
			image->staticClosures[index] = staticClosureAtAddress(function.address);
		}
	}

	Blua32RuntimeFunction* startup = functionRecordInImage(*image, decodedImage.boot.startupFunctionAddress);
	Blua32RuntimeFunction* irq = functionRecordInImage(*image, decodedImage.boot.irqFunctionAddress);
	Blua32RuntimeFunction* exception = functionRecordInImage(*image, decodedImage.boot.exceptionFunctionAddress);
	if (!startup || !irq || !exception
		|| !startup->staticClosure || !irq->staticClosure || !exception->staticClosure) {
		throw BMSX_RUNTIME_ERROR("BLua32 boot vector does not name a static function record.");
	}
	return image;
}

Blua32ExecutionImage* CPU::residentExecutionImage(int executionDomainId) const {
	for (const std::unique_ptr<Blua32ExecutionImage>& image : m_executionImages) {
		if (image->executionDomainId == executionDomainId) {
			return image.get();
		}
	}
	return nullptr;
}

Blua32ExecutionImage* CPU::executionImageForDomain(int executionDomainId) {
	if (Blua32ExecutionImage* image = residentExecutionImage(executionDomainId)) {
		return image;
	}
	std::optional<Blua32DecodedExecutionImage> decodedImage =
		m_executionAddressSpace.resolveDomain(executionDomainId);
	if (!decodedImage) {
		return nullptr;
	}
	std::unique_ptr<Blua32ExecutionImage> image =
		activateExecutionImage(std::move(*decodedImage));
	Blua32ExecutionImage* activatedImage = image.get();
	m_executionImages.push_back(std::move(image));
	return activatedImage;
}

void CPU::replaceExecutionImage(Blua32DecodedExecutionImage&& decodedImage) {
	auto imageEntry = m_executionImages.begin();
	while ((*imageEntry)->executionDomainId != decodedImage.executionDomainId) {
		++imageEntry;
	}
	Blua32ExecutionImage* previousImage = imageEntry->get();
	std::unique_ptr<Blua32ExecutionImage> image =
		activateExecutionImage(std::move(decodedImage));
	Blua32ExecutionImage* activatedImage = image.get();
	*imageEntry = std::move(image);
	if (activatedImage->executionDomainId == SYSTEM_EXECUTION_DOMAIN_ID) {
		m_systemImage = activatedImage;
		m_systemExceptionFunctionAddress = activatedImage->boot.exceptionFunctionAddress;
	}
	if (m_activeExecutionImage == previousImage) {
		m_activeExecutionImage = activatedImage;
	}
}

bool CPU::isExecutionDomainResident(int executionDomainId) const {
	return residentExecutionImage(executionDomainId) != nullptr;
}

Closure* CPU::staticClosureAtAddress(u32 address) {
	auto [entry, inserted] = m_staticClosuresByAddress.try_emplace(address);
	Closure& closure = entry->second;
	if (inserted) {
		closure.type = ObjType::Closure;
		closure.marked = false;
		closure.hashId = m_heap.allocateHashId();
		closure.next = nullptr;
		closure.functionAddress = address;
		closure.upvalueCount = 0;
		closure.upvalues = nullptr;
		closure.trackedHeapBytes = 0;
	}
	return &closure;
}

void CPU::clearExecutionEnvironment() {
	completionValues.clear();
	clearCallStack();
	clearGlobalSlots();
	globals->clear();
}

void CPU::clearGlobalSlots() {
	m_systemGlobalNames.clear();
	m_systemGlobalValues.clear();
	m_systemGlobalSlotByKey.clear();
	m_globalNames.clear();
	m_globalValues.clear();
	m_globalSlotByKey.clear();
}

void CPU::setGlobalByKey(const Value& key, const Value& value) {
	globals->set(key, value);
	const StringId keyId = asStringId(key);
	const auto globalIt = m_globalSlotByKey.find(keyId);
	if (globalIt != m_globalSlotByKey.end()) {
		m_globalValues[globalIt->second] = value;
	}
}

void CPU::setSystemGlobalByKey(const Value& key, const Value& value) {
	const StringId keyId = asStringId(key);
	const auto slot = m_systemGlobalSlotByKey.find(keyId);
	if (slot == m_systemGlobalSlotByKey.end()) {
		throw BMSX_RUNTIME_ERROR("System global '" + m_stringPool.toString(keyId) + "' has no register slot.");
	}
	m_systemGlobalValues[slot->second] = value;
}

Value CPU::getGlobalByKey(const Value& key) const {
	const StringId keyId = asStringId(key);
	const auto globalIt = m_globalSlotByKey.find(keyId);
	if (globalIt != m_globalSlotByKey.end()) {
		return m_globalValues[globalIt->second];
	}
	return globals->get(key);
}

void CPU::syncGlobalSlotsToTable() {
	for (size_t index = 0; index < m_globalNames.size(); ++index) {
		globals->set(valueString(m_globalNames[index]), m_globalValues[index]);
	}
}


void CPU::decodeImageText(Blua32ExecutionImage& image) {
	const size_t codeOffset = image.layout.header.textAddress - image.layout.address;
	const std::span<const u8> code = image.layout.bytes.subspan(
		codeOffset,
		image.layout.header.textByteCount
	);
	image.decodedWordCount = code.size() / INSTRUCTION_BYTES;
	const size_t pageCount = (image.decodedWordCount + DECODED_PAGE_WORDS - 1u) >> DECODED_PAGE_SHIFT;
	image.decodedPages.resize(pageCount);
	for (DecodedInstructionPage& page : image.decodedPages) {
		for (DecodedInstruction& decoded : page.words) {
			decoded.op = static_cast<uint8_t>(OpCode::WIDE);
			decoded.width = 1;
		}
	}
	for (size_t wordIndex = 0; wordIndex < image.decodedWordCount;) {
		int width = 1;
		uint8_t wideA = 0;
		uint8_t wideB = 0;
		uint8_t wideC = 0;
		uint32_t instr = readInstructionWord(code, static_cast<int>(wordIndex));
		uint8_t op = static_cast<uint8_t>((instr >> 18) & 0x3f);
		uint8_t ext = static_cast<uint8_t>(instr >> 24);
		if (static_cast<OpCode>(op) == OpCode::WIDE && wordIndex + 1u < image.decodedWordCount) {
			width = 2;
			wideA = static_cast<uint8_t>((instr >> 12) & 0x3f);
			wideB = static_cast<uint8_t>((instr >> 6) & 0x3f);
			wideC = static_cast<uint8_t>(instr & 0x3f);
			instr = readInstructionWord(code, static_cast<int>(wordIndex + 1));
			op = static_cast<uint8_t>((instr >> 18) & 0x3f);
			ext = static_cast<uint8_t>(instr >> 24);
		}
		const uint8_t aLow = static_cast<uint8_t>((instr >> 12) & 0x3f);
		const uint8_t bLow = static_cast<uint8_t>((instr >> 6) & 0x3f);
		const uint8_t cLow = static_cast<uint8_t>(instr & 0x3f);
		const bool usesDisp = OPCODE_USES_DISP[op] != 0u;
		const bool usesBx = !usesDisp && OPCODE_USES_BX[op] != 0u;
		const uint8_t extA = (usesBx || usesDisp) ? 0 : static_cast<uint8_t>((ext >> 6) & 0x3);
		const uint8_t extB = (usesBx || usesDisp) ? 0 : static_cast<uint8_t>((ext >> 3) & 0x7);
		const uint8_t extC = (usesBx || usesDisp) ? 0 : static_cast<uint8_t>(ext & 0x7);
		const int aShift = usesDisp ? MAX_OPERAND_BITS : MAX_OPERAND_BITS + (usesBx ? 0 : EXT_A_BITS);
		const int bShift = usesDisp ? MAX_OPERAND_BITS : MAX_OPERAND_BITS + EXT_B_BITS;
		const int cShift = usesDisp ? MAX_OPERAND_BITS : MAX_OPERAND_BITS + EXT_C_BITS;
		const uint32_t bxLow = (static_cast<uint32_t>(bLow) << MAX_OPERAND_BITS) | static_cast<uint32_t>(cLow);
		const uint32_t rkRawB = (static_cast<uint32_t>(wideB) << bShift)
			| (static_cast<uint32_t>(extB) << MAX_OPERAND_BITS)
			| static_cast<uint32_t>(bLow);
		const uint32_t rkRawC = (static_cast<uint32_t>(wideC) << cShift)
			| (static_cast<uint32_t>(extC) << MAX_OPERAND_BITS)
			| static_cast<uint32_t>(cLow);
		DecodedInstruction decoded;
		decoded.word = instr;
		decoded.op = op;
		decoded.width = static_cast<uint8_t>(width);
		decoded.a = static_cast<uint16_t>((static_cast<int>(wideA) << aShift) | (static_cast<int>(extA) << MAX_OPERAND_BITS) | aLow);
		decoded.b = static_cast<uint16_t>((static_cast<int>(wideB) << bShift) | (static_cast<int>(extB) << MAX_OPERAND_BITS) | bLow);
		decoded.c = static_cast<uint16_t>((static_cast<int>(wideC) << cShift) | (static_cast<int>(extC) << MAX_OPERAND_BITS) | cLow);
		const u32 decodedBx = (static_cast<uint32_t>(wideB) << (MAX_BX_BITS + EXT_BX_BITS))
			| (static_cast<uint32_t>(usesBx ? ext : 0) << MAX_BX_BITS)
			| bxLow;
		switch (static_cast<OpCode>(op)) {
			case OpCode::GETGL:
			case OpCode::SETGL:
				decoded.bx = image.globalSlots[decodedBx];
				break;
			case OpCode::GETSYS:
			case OpCode::SETSYS:
				decoded.bx = image.systemGlobalSlots[decodedBx];
				break;
			default:
				decoded.bx = decodedBx;
				break;
		}
		decoded.sbx = signExtend(decodedBx, MAX_BX_BITS + EXT_BX_BITS + ((width - 1) * MAX_OPERAND_BITS));
		decoded.rkB = signExtend(rkRawB, MAX_OPERAND_BITS + EXT_B_BITS + ((width - 1) * MAX_OPERAND_BITS));
		decoded.rkC = signExtend(rkRawC, MAX_OPERAND_BITS + EXT_C_BITS + ((width - 1) * MAX_OPERAND_BITS));
		decoded.disp = ext;
		if (static_cast<OpCode>(op) == OpCode::GETI
			|| static_cast<OpCode>(op) == OpCode::GETFIELD
			|| static_cast<OpCode>(op) == OpCode::SELF) {
			decoded.tableCacheIndex = static_cast<uint32_t>(image.tableLoadCaches.size());
			image.tableLoadCaches.push_back(TableLoadInlineCache{});
		}
		decodedSlotForWrite(image, wordIndex) = decoded;
		wordIndex += static_cast<size_t>(width);
	}
}

DecodedInstruction& CPU::decodedSlotForWrite(Blua32ExecutionImage& image, size_t wordIndex) {
	return image.decodedPages[wordIndex >> DECODED_PAGE_SHIFT].words[wordIndex & DECODED_PAGE_MASK];
}

void CPU::skipNextInstruction(CallFrame& frame) {
	Blua32ExecutionImage& image = *frame.functionRecord->image;
	const size_t wordIndex = (frame.pc - image.layout.header.textAddress) / INSTRUCTION_BYTES;
	if (wordIndex >= image.decodedWordCount) {
		hardHalt();
		return;
	}
	const DecodedInstruction& decoded = decodedAtWordIndex(image, wordIndex);
	const u32 nextPc = frame.pc + static_cast<u32>(decoded.width) * INSTRUCTION_BYTES;
	if (nextPc < frame.functionRecord->codeAddress
		|| nextPc >= frame.functionRecord->codeAddress + frame.functionRecord->codeByteCount) {
		hardHalt();
		return;
	}
	frame.pc = nextPc;
}

Blua32RuntimeFunction* CPU::functionRecordInImage(Blua32ExecutionImage& image, u32 address) const {
	if (address < image.layout.header.functionTableAddress) {
		return nullptr;
	}
	const u32 offset = address - image.layout.header.functionTableAddress;
	if ((offset & (BLUA32_FUNCTION_RECORD_SIZE - 1u)) != 0u
		|| offset >= image.functions.size() * BLUA32_FUNCTION_RECORD_SIZE) {
		return nullptr;
	}
	return &image.functions[offset / BLUA32_FUNCTION_RECORD_SIZE];
}

Blua32RuntimeFunction* CPU::functionRecordInExecutionDomain(
	Blua32ExecutionImage& executionImage,
	u32 address
) const {
	if (address >= CART_ROM_BASE) {
		return functionRecordInImage(executionImage, address);
	}
	if (address >= RAM_BASE) {
		return nullptr;
	}
	return functionRecordInImage(*m_systemImage, address);
}

Blua32RuntimeFunction* CPU::functionRecordOnSelectedBus(u32 address) {
	const std::optional<int> executionDomainId =
		m_executionAddressSpace.domainIdOnBus(address);
	if (!executionDomainId) {
		return nullptr;
	}
	Blua32ExecutionImage* image = executionImageForDomain(*executionDomainId);
	return image ? functionRecordInImage(*image, address) : nullptr;
}

void CPU::start(u32 functionAddress, NativeArgsView args, u32 statusWord) {
	completionValues.clear();
	clearCallStack();
	m_haltedUntilIrq = false;
	m_interruptEventPending = false;
	m_memoryWriteBlocked = false;
	m_memoryWriteBlockedAddress = 0;
	m_hardHalted = false;
	m_statusWord = statusWord;
	m_causeWord = 0u;
	m_epcWord = 0u;
	m_badAddressWord = 0u;
	m_luaFaultReasonWord = 0u;
	m_nmiReturnCauseWord = 0u;
	m_nmiReturnEpcWord = 0u;
	m_nmiReturnBadAddressWord = 0u;
	m_nmiReturnLuaFaultReasonWord = 0u;
	m_nonMaskableInterruptPending = false;
	m_yieldRequested = false;
	Blua32RuntimeFunction& function = *functionRecordOnSelectedBus(functionAddress);
	m_activeExecutionImage = function.image;
	Closure* closure = function.image->staticClosures[function.index];
	pushFrame(closure, args.data(), args.size(), 0, 0, false);
	runHousekeeping();
}

void CPU::executeFunctionAddress(u32 functionAddress) {
	Blua32RuntimeFunction* function = functionRecordOnSelectedBus(functionAddress);
	if (!function || !function->staticClosure) {
		hardHalt();
		return;
	}
	clearCallStack();
	m_activeExecutionImage = function->image;
	m_statusWord = function->image->executionDomainId >= 0
		? CPU_STATUS_CART_ENTRY
		: CPU_STATUS_SYSTEM_ENTRY;
	m_haltedUntilIrq = false;
	m_interruptEventPending = false;
	m_memoryWriteBlocked = false;
	m_memoryWriteBlockedAddress = 0u;
	m_hardHalted = false;
	m_yieldRequested = false;
	Closure* closure = function->image->staticClosures[function->index];
	pushFrame(closure, nullptr, 0, 0, 0, false);
}

void CPU::call(Closure& closure, NativeArgsView args, int returnCount) {
	completionValues.clear();
	m_yieldRequested = false;
	pushFrame(&closure, args.data(), args.size(), 0, returnCount, false);
}

void CPU::beginCompletionCall(Closure& closure, NativeArgsView args) {
	completionValues.clear();
	m_yieldRequested = false;
	pushFrame(&closure, args.data(), args.size(), 0, 0, true);
}

CpuRuntimeState CPU::captureRuntimeState() const {
	const_cast<CPU&>(*this).syncGlobalSlotsToTable();
	std::unordered_map<const void*, int> objectIds;
	std::vector<CpuObjectState> objects;
	std::function<CpuObjectState(GCObject*)> captureObjectState;
	std::function<int(GCObject*)> ensureObjectId;
	std::function<CpuValueState(Value)> captureValueState;

	ensureObjectId = [&](GCObject* object) -> int {
		const void* key = static_cast<const void*>(object);
		const auto it = objectIds.find(key);
		if (it != objectIds.end()) {
			return it->second;
		}
		const int id = static_cast<int>(objects.size());
		objectIds.emplace(key, id);
		objects.emplace_back();
		objects[static_cast<size_t>(id)] = captureObjectState(object);
		return id;
	};

	captureValueState = [&](Value value) -> CpuValueState {
		CpuValueState state;
		if (isNil(value)) {
			return state;
		}
		if (value == valueBool(false)) {
			state.tag = CpuValueStateTag::False;
			return state;
		}
		if (value == valueBool(true)) {
			state.tag = CpuValueStateTag::True;
			return state;
		}
		if (valueIsNumber(value)) {
			state.tag = CpuValueStateTag::Number;
			state.numberValue = asNumber(value);
			return state;
		}
		if (valueIsString(value)) {
			state.tag = CpuValueStateTag::String;
			state.stringId = asStringId(value);
			return state;
		}
		if (valueIsBuiltinFunction(value)) {
			state.tag = CpuValueStateTag::Builtin;
			state.builtinId = asBuiltinFunction(value)->id;
			return state;
		}
		state.tag = CpuValueStateTag::Ref;
		if (valueIsTable(value)) {
			state.refId = ensureObjectId(asTable(value));
			return state;
		}
		if (valueIsClosure(value)) {
			state.refId = ensureObjectId(asClosure(value));
			return state;
		}
		if (valueTag(value) == ValueTag::Upvalue) {
			state.refId = ensureObjectId(asUpvalue(value));
			return state;
		}
		throw BMSX_RUNTIME_ERROR("Runtime snapshot cannot preserve " + std::string(valueTypeName(value)) + " value.");
	};

	captureObjectState = [&](GCObject* object) -> CpuObjectState {
		CpuObjectState state;
		state.hashId = object->hashId;
		switch (object->type) {
			case ObjType::Table: {
				state.kind = CpuObjectState::Kind::Table;
				const TableRuntimeState tableState = static_cast<Table*>(object)->captureRuntimeState();
				state.arrayLength = tableState.arrayLength;
				state.metatable = captureValueState(tableState.metatable ? valueTable(tableState.metatable) : valueNil());
				state.array.reserve(tableState.array.size());
				for (const Value& value : tableState.array) {
					state.array.push_back(captureValueState(value));
				}
				state.hash.reserve(tableState.hash.size());
				for (const TableHashNodeState& node : tableState.hash) {
					state.hash.push_back(CpuTableHashNodeSnapshot{
						captureValueState(node.key),
						captureValueState(node.value),
						node.next,
					});
				}
				state.hashFree = tableState.hashFree;
				return state;
			}
			case ObjType::Closure: {
				state.kind = CpuObjectState::Kind::Closure;
				Closure* closure = static_cast<Closure*>(object);
				state.functionAddress = closure->functionAddress;
				const auto canonical = m_staticClosuresByAddress.find(closure->functionAddress);
				state.closureCanonical = canonical != m_staticClosuresByAddress.end()
					&& &canonical->second == closure;
				state.upvalues.reserve(closure->upvalueCount);
				for (size_t upvalueIndex = 0; upvalueIndex < closure->upvalueCount; ++upvalueIndex) {
					state.upvalues.push_back(ensureObjectId(closure->upvalues[upvalueIndex]));
				}
				return state;
			}
			case ObjType::Upvalue: {
				state.kind = CpuObjectState::Kind::Upvalue;
				Upvalue* upvalue = static_cast<Upvalue*>(object);
				state.upvalueOpen = upvalue->open;
				state.upvalueIndex = upvalue->index;
				if (upvalue->open) {
					int frameIndex = 0;
					while (m_frames[static_cast<size_t>(frameIndex)].get() != upvalue->frame) {
						frameIndex += 1;
					}
					state.frameIndex = frameIndex;
					state.upvalueValue = captureValueState(upvalue->frame->registers[static_cast<size_t>(upvalue->index)]);
				} else {
					state.frameIndex = -1;
					state.upvalueValue = captureValueState(upvalue->value);
				}
				return state;
			}
			default:
				throw std::runtime_error("Unsupported runtime snapshot object.");
		}
	};

	CpuRuntimeState state;
	state.systemGlobals.reserve(m_systemGlobalNames.size());
	for (size_t index = 0; index < m_systemGlobalNames.size(); ++index) {
		const Value value = m_systemGlobalValues[index];
		if (valueIsNativeFunction(value) || valueIsNativeObject(value)) {
			continue;
		}
		state.systemGlobals.push_back(CpuRootValueState{
			m_stringPool.toString(m_systemGlobalNames[index]),
			captureValueState(value),
		});
	}
	globals->forEachEntry([&](Value key, Value value) {
		if (!valueIsString(key)) {
			return;
		}
		if (valueIsNativeFunction(value) || valueIsNativeObject(value)) {
			return;
		}
		state.globals.push_back(CpuRootValueState{
			m_stringPool.toString(asStringId(key)),
			captureValueState(value),
		});
	});
	state.executionCartridgeSlot = m_activeExecutionImage->executionDomainId;
	state.frames.reserve(m_frames.size());
	for (const auto& framePtr : m_frames) {
		const CallFrame& frame = *framePtr;
		CpuFrameState frameState;
		frameState.functionAddress = frame.functionAddress;
		frameState.pc = frame.pc;
		frameState.closureRef = ensureObjectId(frame.closure);
		frameState.returnBase = frame.returnBase;
		frameState.returnCount = frame.returnCount;
		frameState.top = frame.top;
		frameState.returnToCompletionLatch = frame.returnToCompletionLatch;
		frameState.callSitePc = frame.callSitePc;
		frameState.isExceptionFrame = frame.isExceptionFrame;
		frameState.isNonMaskableExceptionFrame = frame.isNonMaskableExceptionFrame;
		frameState.registers.reserve(static_cast<size_t>(frame.top));
		for (int index = 0; index < frame.top; ++index) {
			frameState.registers.push_back(captureValueState(frame.registers[static_cast<size_t>(index)]));
		}
		frameState.varargs.reserve(static_cast<size_t>(frame.varargCount));
		for (int index = 0; index < frame.varargCount; ++index) {
			frameState.varargs.push_back(captureValueState(m_stack[static_cast<size_t>(frame.varargBase + index)]));
		}
		state.frames.push_back(std::move(frameState));
	}
	state.protectedCalls.reserve(m_protectedCallDepth);
	for (size_t index = 0; index < m_protectedCallDepth; ++index) {
		const ProtectedCallContinuation& continuation = m_protectedCallContinuations.peek(index);
		CpuProtectedCallState continuationState;
		continuationState.kind = continuation.kind;
		continuationState.returnsToProtectedParent = continuation.returnsToProtectedParent;
		continuationState.callBase = continuation.callBase;
		continuationState.returnCount = continuation.returnCount;
		continuationState.handlerRegister = continuation.handlerRegister;
		for (size_t frameIndex = 0; frameIndex < m_frames.size(); ++frameIndex) {
			CallFrame* frame = m_frames[frameIndex].get();
			if (frame == continuation.caller) {
				continuationState.callerFrameIndex = static_cast<int>(frameIndex);
			}
			if (frame == continuation.target) {
				continuationState.targetFrameIndex = static_cast<int>(frameIndex);
			}
		}
		state.protectedCalls.push_back(continuationState);
	}
	state.completionValues.reserve(completionValues.size());
	for (const Value& value : completionValues) {
		state.completionValues.push_back(captureValueState(value));
	}
	state.openUpvalues.reserve(m_openUpvalues.size());
	for (const OpenUpvalueSlot& entry : m_openUpvalues) {
		state.openUpvalues.push_back(ensureObjectId(entry.upvalue));
	}
	state.objects = std::move(objects);
	state.lastExecutionDomainId = m_lastExecutionDomainId;
	state.lastPc = lastPc;
	state.lastInstruction = lastInstruction;
	state.instructionBudgetRemaining = instructionBudgetRemaining;
	state.haltedUntilIrq = m_haltedUntilIrq;
	state.interruptEventPending = m_interruptEventPending;
	state.memoryWriteBlocked = m_memoryWriteBlocked;
	state.memoryWriteBlockedAddress = m_memoryWriteBlockedAddress;
	state.statusWord = m_statusWord;
	state.causeWord = m_causeWord;
	state.epcWord = m_epcWord;
	state.badAddressWord = m_badAddressWord;
	state.luaFaultReasonWord = m_luaFaultReasonWord;
	state.nmiReturnCauseWord = m_nmiReturnCauseWord;
	state.nmiReturnEpcWord = m_nmiReturnEpcWord;
	state.nmiReturnBadAddressWord = m_nmiReturnBadAddressWord;
	state.nmiReturnLuaFaultReasonWord = m_nmiReturnLuaFaultReasonWord;
	state.nonMaskableInterruptPending = m_nonMaskableInterruptPending;
	state.yieldRequested = m_yieldRequested;
	return state;
}

void CPU::restoreRuntimeState(const CpuRuntimeState& state) {
	m_heap.suspendCollection();

	struct RestoredObject {
		Table* table = nullptr;
		Closure* closure = nullptr;
		Upvalue* upvalue = nullptr;
	};

	Blua32ExecutionImage* executionImage = state.executionCartridgeSlot < 0
		? m_systemImage
		: executionImageForDomain(state.executionCartridgeSlot);
	std::vector<RestoredObject> restoredObjects(state.objects.size());
	for (size_t index = 0; index < state.objects.size(); ++index) {
		const CpuObjectState& objectState = state.objects[index];
		switch (objectState.kind) {
			case CpuObjectState::Kind::Table:
				restoredObjects[index].table = createTable(0, 0);
				restoredObjects[index].table->hashId = objectState.hashId;
				m_heap.observeHashId(objectState.hashId);
				break;
			case CpuObjectState::Kind::Closure: {
				const size_t upvalueCount = objectState.upvalues.size();
				restoredObjects[index].closure = objectState.closureCanonical
					? &m_staticClosuresByAddress.find(objectState.functionAddress)->second
					: createTrackedClosure(objectState.functionAddress, upvalueCount);
				restoredObjects[index].closure->hashId = objectState.hashId;
				m_heap.observeHashId(objectState.hashId);
				break;
			}
			case CpuObjectState::Kind::Upvalue: {
				auto* upvalue = m_heap.allocate<Upvalue>(ObjType::Upvalue);
				upvalue->open = false;
				upvalue->index = objectState.upvalueIndex;
				upvalue->frame = nullptr;
				upvalue->value = valueNil();
				upvalue->hashId = objectState.hashId;
				m_heap.observeHashId(objectState.hashId);
				addTrackedLuaHeapBytes(kUpvalueHeapBytes);
				restoredObjects[index].upvalue = upvalue;
				break;
			}
		}
	}

	std::function<Value(const CpuValueState&)> restoreValue = [&](const CpuValueState& valueState) -> Value {
		switch (valueState.tag) {
			case CpuValueStateTag::Nil:
				return valueNil();
			case CpuValueStateTag::False:
				return valueBool(false);
			case CpuValueStateTag::True:
				return valueBool(true);
			case CpuValueStateTag::Number:
				return valueNumber(valueState.numberValue);
			case CpuValueStateTag::String:
				return valueString(valueState.stringId);
			case CpuValueStateTag::Builtin:
				return createBuiltinFunction(valueState.builtinId);
			case CpuValueStateTag::Ref: {
				const size_t refId = static_cast<size_t>(valueState.refId);
				const RestoredObject& restored = restoredObjects[refId];
				switch (state.objects[refId].kind) {
					case CpuObjectState::Kind::Table:
						return valueTable(restored.table);
					case CpuObjectState::Kind::Closure:
						return valueClosure(restored.closure);
					case CpuObjectState::Kind::Upvalue:
						return valueUpvalue(restored.upvalue);
				}
				__builtin_unreachable();
			}
		}
		__builtin_unreachable();
	};

	for (size_t index = 0; index < state.objects.size(); ++index) {
		const CpuObjectState& objectState = state.objects[index];
		switch (objectState.kind) {
			case CpuObjectState::Kind::Table: {
				TableRuntimeState tableState;
				tableState.array.reserve(objectState.array.size());
				for (const CpuValueState& valueState : objectState.array) {
					tableState.array.push_back(restoreValue(valueState));
				}
				tableState.arrayLength = objectState.arrayLength;
				tableState.hash.reserve(objectState.hash.size());
				for (const CpuTableHashNodeSnapshot& node : objectState.hash) {
					tableState.hash.push_back(TableHashNodeState{
						restoreValue(node.key),
						restoreValue(node.value),
						node.next,
					});
				}
				tableState.hashFree = objectState.hashFree;
				const Value metatable = restoreValue(objectState.metatable);
				if (!isNil(metatable)) {
					tableState.metatable = asTable(metatable);
				}
				restoredObjects[index].table->restoreRuntimeState(tableState);
				break;
			}
			case CpuObjectState::Kind::Closure: {
				Closure* closure = restoredObjects[index].closure;
				closure->functionAddress = objectState.functionAddress;
				for (size_t upvalueIndex = 0; upvalueIndex < objectState.upvalues.size(); ++upvalueIndex) {
					closure->upvalues[upvalueIndex] = restoredObjects[static_cast<size_t>(objectState.upvalues[upvalueIndex])].upvalue;
				}
				break;
			}
			case CpuObjectState::Kind::Upvalue: {
				Upvalue* upvalue = restoredObjects[index].upvalue;
				upvalue->open = objectState.upvalueOpen;
				upvalue->index = objectState.upvalueIndex;
				upvalue->frame = nullptr;
				upvalue->value = objectState.upvalueOpen ? valueNil() : restoreValue(objectState.upvalueValue);
				break;
			}
		}
	}

	completionValues.clear();
	clearCallStack();
	globals->clear();
	m_activeExecutionImage = executionImage;
	for (Value& value : m_systemGlobalValues) {
		value = valueNil();
	}
	for (Value& value : m_globalValues) {
		value = valueNil();
	}

	for (const CpuFrameState& frameState : state.frames) {
		Blua32RuntimeFunction* functionRecord = functionRecordInExecutionDomain(
			*executionImage,
			frameState.functionAddress
		);
		auto frame = acquireFrame();
		frame->functionAddress = frameState.functionAddress;
		frame->functionRecord = functionRecord;
		frame->pc = frameState.pc;
		frame->closure = restoredObjects[static_cast<size_t>(frameState.closureRef)].closure;
		frame->returnBase = frameState.returnBase;
		frame->returnCount = frameState.returnCount;
		frame->returnToCompletionLatch = frameState.returnToCompletionLatch;
		frame->callSitePc = frameState.callSitePc;
		frame->isExceptionFrame = frameState.isExceptionFrame;
		frame->isNonMaskableExceptionFrame = frameState.isNonMaskableExceptionFrame;
		frame->varargBase = m_stackTop;
		frame->varargCount = static_cast<int>(frameState.varargs.size());
		frame->stackBase = frame->varargBase + frame->varargCount;
		size_t targetCapacity = nextPowerOfTwo(static_cast<size_t>(std::max(functionRecord->maxStack, 1u)));
		if (targetCapacity < 8) {
			targetCapacity = 8;
		}
		frame->stackCapacity = static_cast<int>(targetCapacity);
		m_stackTop = frame->stackBase + frame->stackCapacity;
		ensureStackSize(static_cast<size_t>(m_stackTop));
		frame->registers = m_stack.data() + frame->stackBase;
		for (int slot = 0; slot < frame->stackCapacity; ++slot) {
			frame->registers[static_cast<size_t>(slot)] = valueNil();
		}
		for (size_t registerIndex = 0; registerIndex < frameState.registers.size(); ++registerIndex) {
			frame->registers[registerIndex] = restoreValue(frameState.registers[registerIndex]);
		}
		for (size_t varargIndex = 0; varargIndex < frameState.varargs.size(); ++varargIndex) {
			m_stack[static_cast<size_t>(frame->varargBase) + varargIndex] = restoreValue(frameState.varargs[varargIndex]);
		}
		frame->top = frameState.top;
		m_frames.push_back(std::move(frame));
	}
	for (size_t index = 0; index < state.protectedCalls.size(); ++index) {
		const CpuProtectedCallState& continuationState = state.protectedCalls[index];
		ProtectedCallContinuation& continuation = m_protectedCallContinuations.get(index);
		continuation.kind = continuationState.kind;
		continuation.caller = m_frames[static_cast<size_t>(continuationState.callerFrameIndex)].get();
		continuation.target = continuationState.targetFrameIndex < 0
			? nullptr
			: m_frames[static_cast<size_t>(continuationState.targetFrameIndex)].get();
		continuation.returnsToProtectedParent = continuationState.returnsToProtectedParent;
		continuation.callBase = continuationState.callBase;
		continuation.returnCount = continuationState.returnCount;
		continuation.handlerRegister = continuationState.handlerRegister;
	}
	m_protectedCallDepth = state.protectedCalls.size();

	for (int upvalueRef : state.openUpvalues) {
		const CpuObjectState& objectState = state.objects[static_cast<size_t>(upvalueRef)];
		Upvalue* upvalue = restoredObjects[static_cast<size_t>(upvalueRef)].upvalue;
		CallFrame* frame = m_frames[static_cast<size_t>(objectState.frameIndex)].get();
		upvalue->open = true;
		upvalue->index = objectState.upvalueIndex;
		upvalue->frame = frame;
		upvalue->value = valueNil();
		m_openUpvalues.push_back(OpenUpvalueSlot{ frame, upvalue->index, upvalue });
	}

	for (const CpuRootValueState& entry : state.systemGlobals) {
		setSystemGlobalByKey(valueString(m_stringPool.intern(entry.name)), restoreValue(entry.value));
	}
	for (const CpuRootValueState& entry : state.globals) {
		setGlobalByKey(valueString(m_stringPool.intern(entry.name)), restoreValue(entry.value));
	}
	completionValues.reserve(state.completionValues.size());
	for (const CpuValueState& valueState : state.completionValues) {
		completionValues.push_back(restoreValue(valueState));
	}
	m_lastExecutionDomainId = state.lastExecutionDomainId;
	lastPc = state.lastPc;
	lastInstruction = state.lastInstruction;
	instructionBudgetRemaining = state.instructionBudgetRemaining;
	m_haltedUntilIrq = state.haltedUntilIrq;
	m_interruptEventPending = state.interruptEventPending;
	m_memoryWriteBlocked = state.memoryWriteBlocked;
	m_memoryWriteBlockedAddress = state.memoryWriteBlockedAddress;
	m_statusWord = state.statusWord;
	m_causeWord = state.causeWord;
	m_epcWord = state.epcWord;
	m_badAddressWord = state.badAddressWord;
	m_luaFaultReasonWord = state.luaFaultReasonWord;
	m_nmiReturnCauseWord = state.nmiReturnCauseWord;
	m_nmiReturnEpcWord = state.nmiReturnEpcWord;
	m_nmiReturnBadAddressWord = state.nmiReturnBadAddressWord;
	m_nmiReturnLuaFaultReasonWord = state.nmiReturnLuaFaultReasonWord;
	m_nonMaskableInterruptPending = state.nonMaskableInterruptPending;
	m_yieldRequested = state.yieldRequested;
	collectHeap();
	m_heap.resumeCollection();
}

void CPU::requestYield() {
	m_yieldRequested = true;
}

void CPU::haltUntilIrq() {
	if (m_interruptEventPending) {
		m_interruptEventPending = false;
		return;
	}
	m_haltedUntilIrq = true;
	m_yieldRequested = false;
}

void CPU::hardHalt() {
	m_hardHalted = true;
	m_haltedUntilIrq = false;
	m_yieldRequested = false;
}


void CPU::callBuiltinFunction(BuiltinFunction& fn, NativeArgsView args, NativeResults& out) {
	out.clear();
	switch (fn.id) {
		case BuiltinFunctionId::Next:
			runBuiltinNextValue(args[0], args[1], out);
			break;
		case BuiltinFunctionId::Type:
			out.push_back(valueString(m_stringPool.intern(valueTypeNameForLua(args[0]))));
			break;
		case BuiltinFunctionId::SetMetatable:
			runBuiltinSetMetatable(args, out);
			break;
		case BuiltinFunctionId::GetMetatable:
			runBuiltinGetMetatable(args, out);
			break;
		case BuiltinFunctionId::RawGet:
			runBuiltinRawGet(args, out);
			break;
		case BuiltinFunctionId::RawSet:
			runBuiltinRawSet(args, out);
			break;
		case BuiltinFunctionId::Select:
			runBuiltinSelect(args, out);
			break;
		case BuiltinFunctionId::StringByte:
			runBuiltinStringByte(args, out);
			break;
		case BuiltinFunctionId::StringChar:
			runBuiltinStringChar(args, out);
			break;
		case BuiltinFunctionId::Error:
			runBuiltinError(args);
			break;
		case BuiltinFunctionId::PCall:
		case BuiltinFunctionId::XPCall:
			throw std::runtime_error("Protected calls execute as Lua CPU microcode.");
	}
}

void CPU::runBuiltinFunction(BuiltinFunction& fn, CallFrame& frame, int callBase, int returnCount, int argCount) {
	instructionBudgetRemaining -= static_cast<int>(fn.cycleBase);
	if (fn.id == BuiltinFunctionId::PCall || fn.id == BuiltinFunctionId::XPCall) {
		startProtectedCall(fn.id, frame, callBase, returnCount, callBase + 1, argCount, false);
		return;
	}
	auto outScratch = acquireNativeReturnScratch();
	NativeResults& out = outScratch.get();
	const NativeArgsView args(frame.registers + static_cast<size_t>(callBase + 1), static_cast<size_t>(argCount));
	callBuiltinFunction(fn, args, out);
	if (!m_frames.empty() && m_frames.back().get() == &frame) {
		writeReturnValues(frame, callBase, returnCount, out.data(), static_cast<int>(out.size()));
	}
}

void CPU::startProtectedCall(BuiltinFunctionId id, CallFrame& caller, int callBase, int returnCount,
	int argumentBase, int argumentCount, bool returnsToProtectedParent) {
	if (id == BuiltinFunctionId::XPCall) {
		const Value handler = argumentCount > 1
			? caller.registers[static_cast<size_t>(argumentBase + 1)]
			: valueNil();
		if (!valueIsClosure(handler) && !valueIsBuiltinFunction(handler) && !valueIsNativeFunction(handler)) {
			throw LuaExecutionError("xpcall error handler must be a function.", LUA_FAULT_REASON_XPCALL_HANDLER_NOT_FUNCTION);
		}
	}
	const size_t continuationIndex = m_protectedCallDepth;
	ProtectedCallContinuation& continuation = m_protectedCallContinuations.get(continuationIndex);
	m_protectedCallDepth = continuationIndex + 1;
	continuation.kind = id == BuiltinFunctionId::PCall ? ProtectedCallKind::PCall : ProtectedCallKind::XPCallBody;
	continuation.caller = &caller;
	continuation.target = nullptr;
	continuation.returnsToProtectedParent = returnsToProtectedParent;
	continuation.callBase = callBase;
	continuation.returnCount = returnCount;
	continuation.handlerRegister = id == BuiltinFunctionId::XPCall ? argumentBase + 1 : -1;

	const int targetArgumentOffset = id == BuiltinFunctionId::PCall ? 1 : 2;
	invokeProtectedTarget(
		continuationIndex,
		argumentCount > 0 ? caller.registers[static_cast<size_t>(argumentBase)] : valueNil(),
		argumentBase + targetArgumentOffset,
		std::max(argumentCount - targetArgumentOffset, 0)
	);
}

void CPU::invokeProtectedTarget(size_t continuationIndex, Value target, int argumentBase, int argumentCount) {
	ProtectedCallContinuation& continuation = m_protectedCallContinuations.get(continuationIndex);
	CallFrame& caller = *continuation.caller;
	if (valueIsClosure(target)) {
		continuation.target = pushFrame(caller, asClosure(target), argumentBase, argumentCount, 0, 0, false, caller.pc - INSTRUCTION_BYTES);
		return;
	}
	if (valueIsBuiltinFunction(target)) {
		BuiltinFunction& builtin = *asBuiltinFunction(target);
		instructionBudgetRemaining -= static_cast<int>(builtin.cycleBase);
		if (builtin.id == BuiltinFunctionId::PCall || builtin.id == BuiltinFunctionId::XPCall) {
			startProtectedCall(builtin.id, caller, continuation.callBase, 0, argumentBase, argumentCount, true);
			return;
		}
		auto resultsScratch = acquireNativeReturnScratch();
		NativeResults& results = resultsScratch.get();
		callBuiltinFunction(
			builtin,
			NativeArgsView(caller.registers + static_cast<size_t>(argumentBase), static_cast<size_t>(argumentCount)),
			results
		);
		finishProtectedCall(continuationIndex, results.data(), static_cast<int>(results.size()));
		return;
	}
	if (valueIsNativeFunction(target)) {
		NativeFunction* function = asNativeFunction(target);
		instructionBudgetRemaining -= static_cast<int>(function->cycleBase);
		auto resultsScratch = acquireNativeReturnScratch();
		NativeResults& results = resultsScratch.get();
		function->invoke(
			NativeArgsView(caller.registers + static_cast<size_t>(argumentBase), static_cast<size_t>(argumentCount)),
			results
		);
		runHousekeeping();
		finishProtectedCall(continuationIndex, results.data(), static_cast<int>(results.size()));
		return;
	}
	throw LuaExecutionError("Attempted to call a non-function value.", LUA_FAULT_REASON_CALL_NON_FUNCTION);
}

void CPU::finishProtectedCall(size_t continuationIndex, const Value* values, int valueCount) {
	ProtectedCallContinuation& continuation = m_protectedCallContinuations.get(continuationIndex);
	if (continuation.kind == ProtectedCallKind::XPCallHandler) {
		finishProtectedCallWithError(continuationIndex, valueCount > 0 ? values[0] : valueNil());
		return;
	}
	const int resultCount = writeProtectedResults(continuation, true, values, valueCount);
	finishProtectedContinuation(continuationIndex, resultCount);
}

void CPU::finishProtectedCall(size_t continuationIndex, CallFrame& source, int sourceBase, int sourceCount) {
	ProtectedCallContinuation& continuation = m_protectedCallContinuations.get(continuationIndex);
	if (continuation.kind == ProtectedCallKind::XPCallHandler) {
		finishProtectedCallWithError(
			continuationIndex,
			sourceCount > 0 ? source.registers[static_cast<size_t>(sourceBase)] : valueNil()
		);
		return;
	}
	const int resultCount = writeProtectedResults(continuation, true, source, sourceBase, sourceCount);
	finishProtectedContinuation(continuationIndex, resultCount);
}

void CPU::finishProtectedCallWithError(size_t continuationIndex, Value errorValue) {
	ProtectedCallContinuation& continuation = m_protectedCallContinuations.get(continuationIndex);
	CallFrame& caller = *continuation.caller;
	const int resultCount = continuation.returnCount == 0 ? 2 : continuation.returnCount;
	if (resultCount > 0) {
		Value* registers = ensureRegisterCapacity(caller, continuation.callBase + resultCount - 1);
		registers[static_cast<size_t>(continuation.callBase)] = valueBool(false);
		if (resultCount > 1) {
			registers[static_cast<size_t>(continuation.callBase + 1)] = errorValue;
			for (int index = 2; index < resultCount; ++index) {
				registers[static_cast<size_t>(continuation.callBase + index)] = valueNil();
			}
		}
	}
	caller.top = continuation.callBase + resultCount;
	finishProtectedContinuation(continuationIndex, resultCount);
}

int CPU::writeProtectedResults(ProtectedCallContinuation& continuation, bool prefix, const Value* values, int valueCount) {
	CallFrame& caller = *continuation.caller;
	const int resultCount = continuation.returnCount == 0 ? valueCount + 1 : continuation.returnCount;
	if (resultCount > 0) {
		Value* registers = ensureRegisterCapacity(caller, continuation.callBase + resultCount - 1);
		registers[static_cast<size_t>(continuation.callBase)] = valueBool(prefix);
		const int copiedCount = std::min(valueCount, resultCount - 1);
		if (copiedCount > 0) {
			std::memcpy(
				registers + continuation.callBase + 1,
				values,
				static_cast<size_t>(copiedCount) * sizeof(Value)
			);
		}
		for (int index = copiedCount + 1; index < resultCount; ++index) {
			registers[static_cast<size_t>(continuation.callBase + index)] = valueNil();
		}
	}
	caller.top = continuation.callBase + resultCount;
	return resultCount;
}

int CPU::writeProtectedResults(ProtectedCallContinuation& continuation, bool prefix, CallFrame& source, int sourceBase, int sourceCount) {
	CallFrame& caller = *continuation.caller;
	const int resultCount = continuation.returnCount == 0 ? sourceCount + 1 : continuation.returnCount;
	if (resultCount > 0) {
		Value* registers = ensureRegisterCapacity(caller, continuation.callBase + resultCount - 1);
		const int copiedCount = std::min(sourceCount, resultCount - 1);
		if (copiedCount > 0) {
			std::memmove(
				registers + continuation.callBase + 1,
				source.registers + sourceBase,
				static_cast<size_t>(copiedCount) * sizeof(Value)
			);
		}
		registers[static_cast<size_t>(continuation.callBase)] = valueBool(prefix);
		for (int index = copiedCount + 1; index < resultCount; ++index) {
			registers[static_cast<size_t>(continuation.callBase + index)] = valueNil();
		}
	}
	caller.top = continuation.callBase + resultCount;
	return resultCount;
}

void CPU::finishProtectedContinuation(size_t continuationIndex, int resultCount) {
	ProtectedCallContinuation& continuation = m_protectedCallContinuations.get(continuationIndex);
	CallFrame* caller = continuation.caller;
	const int callBase = continuation.callBase;
	const bool returnsToProtectedParent = continuation.returnsToProtectedParent;
	continuation.caller = nullptr;
	continuation.target = nullptr;
	m_protectedCallDepth = continuationIndex;
	if (returnsToProtectedParent) {
		finishProtectedCall(continuationIndex - 1, *caller, callBase, resultCount);
	}
}

bool CPU::handleProtectedCallError(Value errorValue) {
	for (;;) {
		if (m_protectedCallDepth == 0) {
			return false;
		}
		const size_t continuationIndex = m_protectedCallDepth - 1;
		ProtectedCallContinuation& continuation = m_protectedCallContinuations.get(continuationIndex);
		int callerIndex = 0;
		while (m_frames[static_cast<size_t>(callerIndex)].get() != continuation.caller) {
			callerIndex += 1;
		}
		for (int frameIndex = static_cast<int>(m_frames.size()) - 1; frameIndex > callerIndex; --frameIndex) {
			if (m_frames[static_cast<size_t>(frameIndex)]->isExceptionFrame) {
				return false;
			}
		}
		unwindToDepth(callerIndex + 1);
		if (continuation.kind != ProtectedCallKind::XPCallBody) {
			const Value result = continuation.kind == ProtectedCallKind::XPCallHandler
				? valueString(m_stringPool.intern("error in error handling"))
				: errorValue;
			finishProtectedCallWithError(continuationIndex, result);
			return true;
		}

		continuation.kind = ProtectedCallKind::XPCallHandler;
		continuation.target = nullptr;
		CallFrame& caller = *continuation.caller;
		const Value handler = caller.registers[static_cast<size_t>(continuation.handlerRegister)];
		setRegister(caller, continuation.callBase, errorValue);
		try {
			invokeProtectedTarget(continuationIndex, handler, continuation.callBase, 1);
			return true;
		} catch (const LuaThrownValueError& handlerError) {
			errorValue = handlerError.value;
		} catch (const LuaExecutionError& handlerError) {
			errorValue = valueString(m_stringPool.intern(handlerError.what()));
		}
	}
}

void CPU::runBuiltinNextValue(Value target, Value key, NativeResults& out) {
	out.clear();
	if (valueIsTable(target)) {
		auto entry = asTable(target)->nextEntry(key);
		if (!entry.has_value()) {
			out.push_back(valueNil());
			return;
		}
		out.push_back(entry->first);
		out.push_back(entry->second);
		return;
	}
	if (!valueIsNativeObject(target)) {
		throw LuaExecutionError("Attempted to iterate a non-table value.", LUA_FAULT_REASON_ITERATE_NON_TABLE);
	}
	auto* obj = asNativeObject(target);
	auto entry = obj->nextEntry(key);
	if (!entry.has_value()) {
		out.push_back(valueNil());
		return;
	}
	out.push_back(entry->first);
	out.push_back(entry->second);
}

void CPU::runBuiltinSetMetatable(NativeArgsView args, NativeResults& out) {
	Table* metatable = asTable(args[1]);
	const Value target = args[0];
	if (valueIsTable(target)) {
		Table* table = asTable(target);
		table->metatable = metatable;
		table->bumpVersion();
		out.push_back(target);
		return;
	}
	asNativeObject(target)->metatable = metatable;
	out.push_back(target);
}

void CPU::runBuiltinGetMetatable(NativeArgsView args, NativeResults& out) {
	const Value target = args[0];
	if (valueIsTable(target)) {
		Table* metatable = asTable(target)->metatable;
		out.push_back(metatable ? valueTable(metatable) : valueNil());
		return;
	}
	Table* metatable = asNativeObject(target)->metatable;
	out.push_back(metatable ? valueTable(metatable) : valueNil());
}

void CPU::runBuiltinRawGet(NativeArgsView args, NativeResults& out) {
	Table* table = asTable(args[0]);
	out.push_back(table->get(args[1]));
}

void CPU::runBuiltinRawSet(NativeArgsView args, NativeResults& out) {
	Table* table = asTable(args[0]);
	table->set(args[1], args[2]);
	out.push_back(valueTable(table));
}

void CPU::runBuiltinSelect(NativeArgsView args, NativeResults& out) {
	const Value selector = args[0];
	if (valueIsString(selector) && m_stringPool.toString(asStringId(selector)) == "#") {
		out.push_back(valueNumber(static_cast<double>(args.size() - 1)));
		return;
	}
	const int count = static_cast<int>(args.size()) - 1;
	int start = static_cast<int>(asNumber(selector));
	if (start < 0) {
		start = count + start + 1;
	}
	for (int index = start; index <= count; ++index) {
		if (index >= 1 && static_cast<size_t>(index) < args.size()) {
			out.push_back(args[static_cast<size_t>(index)]);
		}
	}
}

void CPU::runBuiltinStringByte(NativeArgsView args, NativeResults& out) {
	const std::string& source = m_stringPool.toString(asStringId(args[0]));
	int position = 1;
	if (args.size() > 1) {
		const Value positionValue = args[1];
		if (!isNil(positionValue)) {
			position = static_cast<int>(std::trunc(asNumber(positionValue)));
		}
	}
	if (position < 1) {
		out.push_back(valueNil());
		return;
	}
	size_t byteIndex = 0;
	int current = 1;
	while (byteIndex < source.size()) {
		if (current == position) {
			out.push_back(valueNumber(static_cast<double>(readUtf8Codepoint(source, byteIndex))));
			return;
		}
		byteIndex = nextUtf8Index(source, byteIndex);
		current += 1;
	}
	out.push_back(valueNil());
}

void CPU::runBuiltinStringChar(NativeArgsView args, NativeResults& out) {
	std::string result;
	result.reserve(args.size());
	for (const auto& arg : args) {
		appendUtf8Codepoint(result, static_cast<uint32_t>(std::trunc(asNumber(arg))));
	}
	out.push_back(valueString(m_stringPool.intern(result)));
}

void CPU::runBuiltinError(NativeArgsView args) {
	const Value value = args[0];
	throw LuaThrownValueError(value, m_stringPool);
}

void CPU::clearHaltUntilIrq() {
	m_haltedUntilIrq = false;
	m_yieldRequested = false;
}

void CPU::requestNonMaskableInterrupt() {
	// NMI is an edge latch and can preempt the supervisor IRQ root reached
	// immediately before a system-request fence.
	m_nonMaskableInterruptPending = true;
}

bool CPU::canAcceptMaskableInterruptLine() const {
	return (m_statusWord & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) != 0u
		&& m_irqController.hasAssertedMaskableInterruptLine();
}

AcceptedInterruptKind CPU::peekPendingInterrupt() const {
	if (m_nonMaskableInterruptPending) {
		return AcceptedInterruptKind::NonMaskable;
	}
	if (canAcceptMaskableInterruptLine()) {
		return AcceptedInterruptKind::Maskable;
	}
	return AcceptedInterruptKind::None;
}

bool CPU::enterPendingInterrupt() {
	if (m_nonMaskableInterruptPending) {
		m_nonMaskableInterruptPending = false;
		const bool wasHalted = m_haltedUntilIrq;
		const u32 returnCauseWord = m_causeWord;
		const u32 returnEpcWord = m_epcWord;
		const u32 returnBadAddressWord = m_badAddressWord;
		const u32 returnLuaFaultReasonWord = m_luaFaultReasonWord;
		enterException(
			*m_systemImage,
			m_systemExceptionFunctionAddress,
			CPU_CAUSE_NMI,
			m_frames.back()->pc
		);
		m_frames.back()->isNonMaskableExceptionFrame = true;
		m_nmiReturnCauseWord = returnCauseWord;
		m_nmiReturnEpcWord = returnEpcWord;
		m_nmiReturnBadAddressWord = returnBadAddressWord;
		m_nmiReturnLuaFaultReasonWord = returnLuaFaultReasonWord;
		if (!wasHalted) m_interruptEventPending = true;
		return true;
	}
	if (canAcceptMaskableInterruptLine()) {
		Blua32ExecutionImage& image = isUserMode() ? *m_activeExecutionImage : *m_systemImage;
		const bool wasHalted = m_haltedUntilIrq;
		enterException(image, image.boot.irqFunctionAddress, CPU_CAUSE_IRQ, m_frames.back()->pc);
		if (!wasHalted) m_interruptEventPending = true;
		return true;
	}
	return false;
}

void CPU::enterSynchronousException(CallFrame& interruptedFrame, u32 causeWord) {
	interruptedFrame.pc = m_currentInstructionPc;
	enterException(*m_systemImage, m_systemExceptionFunctionAddress, causeWord, m_currentInstructionPc);
}

void CPU::enterSynchronousAddressException(CallFrame& interruptedFrame, u32 causeWord, u32 address) {
	m_badAddressWord = address;
	enterSynchronousException(interruptedFrame, causeWord);
}

void CPU::enterLuaFaultException(u32 reason) {
	m_luaFaultReasonWord = reason;
	enterSynchronousException(*m_frames.back(), CPU_CAUSE_CODE_TRAP);
}

void CPU::enterException(
	Blua32ExecutionImage& image,
	u32 functionAddress,
	u32 causeWord,
	u32 epcWord
) {
	m_epcWord = epcWord;
	m_causeWord = causeWord;
	m_statusWord = (m_statusWord & ~CPU_STATUS_MODE_STACK_MASK)
		| ((m_statusWord << 2u) & CPU_STATUS_MODE_STACK_MASK);
	clearHaltAfterAcceptedInterrupt();
	Blua32RuntimeFunction& functionRecord = *functionRecordInImage(image, functionAddress);
	Closure* closure = image.staticClosures[functionRecord.index];
	CallFrame* frame = pushFrame(
		closure,
		nullptr,
		0,
		0,
		0,
		false
	);
	frame->callSitePc = epcWord;
	frame->isExceptionFrame = true;
}

void CPU::clearHaltAfterAcceptedInterrupt() {
	m_haltedUntilIrq = false;
	m_yieldRequested = false;
}

void CPU::blockMappedWrite(CallFrame& frame, uint32_t address) {
	frame.pc = m_currentInstructionPc;
	m_memoryWriteBlocked = true;
	m_memoryWriteBlockedAddress = address;
	m_yieldRequested = false;
}

void CPU::resumeMemoryWrite(uint32_t address) {
	// A device-ready edge releases only the instruction stalled on that raw MMIO target.
	if (m_memoryWriteBlocked && m_memoryWriteBlockedAddress == address) {
		m_memoryWriteBlocked = false;
	}
}

template <bool RootBoundary>
RunResult CPU::runLoop(int targetDepth, int instructionBudget) {
	instructionBudgetRemaining = instructionBudget;
	auto& frames = m_frames;
	CallFrame* frame = nullptr;
	Blua32ExecutionImage* image = nullptr;
	const DecodedInstruction* decoded;
	u32 pc = 0;
	size_t wordIndex = 0;
	int a = 0;
	int b = 0;
	int c = 0;
	uint32_t bx = 0;
	int sbx = 0;
	int rkB = 0;
	int rkC = 0;
	int disp = 0;
	Value* registers = nullptr;
#if BMSX_USE_COMPUTED_GOTO
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wpedantic"
	static void* const kDispatchTargets[OPCODE_COUNT] = {
#define OP(name) &&dispatch_##name,
#include "machine/cpu/cpu_opcode_list.inl"
#undef OP
	};
#pragma GCC diagnostic pop
#endif
	for (;;) {
		try {
dispatch_loop_check:
	if constexpr (RootBoundary) {
		if (frames.empty()) {
			return RunResult::Halted;
		}
	} else {
		if (static_cast<int>(frames.size()) <= targetDepth) {
			return RunResult::Halted;
		}
	}
	if (m_hardHalted || m_haltedUntilIrq || m_memoryWriteBlocked) {
		return RunResult::Halted;
	}
	if (m_yieldRequested) {
		m_yieldRequested = false;
		return RunResult::Yielded;
	}
	if (instructionBudgetRemaining <= 0) {
		return RunResult::Yielded;
	}
	if (m_nonMaskableInterruptPending
		|| ((m_statusWord & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) != 0u
			&& m_irqController.hasAssertedMaskableInterruptLine())
	) {
		enterPendingInterrupt();
		goto dispatch_loop_check;
	}
		frame = frames.back().get();
		image = frame->functionRecord->image;
		registers = frame->registers;
		pc = frame->pc;
		wordIndex = (pc - image->layout.header.textAddress) / INSTRUCTION_BYTES;
		if (wordIndex >= image->decodedWordCount) {
			hardHalt();
			return RunResult::Halted;
		}
		decoded = &decodedAtWordIndex(*image, wordIndex);
		m_currentInstructionPc = pc;
		frame->pc = pc + (static_cast<u32>(decoded->width) * INSTRUCTION_BYTES);
		m_lastExecutionDomainId = image->executionDomainId;
		lastPc = pc + ((static_cast<u32>(decoded->width) - 1u) * INSTRUCTION_BYTES);
	lastInstruction = decoded->word;
	instructionBudgetRemaining -= static_cast<int>(BASE_CYCLES[decoded->op]);
	a = decoded->a;
	b = decoded->b;
	c = decoded->c;
	bx = decoded->bx;
	sbx = decoded->sbx;
	rkB = decoded->rkB;
	rkC = decoded->rkC;
	disp = decoded->disp;

	#define FRAME (*frame)
	#define IMAGE (*image)
	#define REG(index) registers[static_cast<size_t>(index)]
#define CYCLES_ADD(n) do { instructionBudgetRemaining -= (n); } while (0)
#define SET_REGISTER_FAST(index, valueExpr) do { \
	REG(index) = (valueExpr); \
	const int nextTop = (index) + 1; \
	if (nextTop > FRAME.top) { \
		FRAME.top = nextTop; \
	} \
} while (0)
#define SKIP_NEXT_INSTRUCTION() do { \
	skipNextInstruction(FRAME); \
} while (0)
#define TABLE_CACHE_INDEX() (decoded->tableCacheIndex)
#define DISPATCH_CONTINUE() do { goto dispatch_continue; } while (0)
#define DISPATCH_BLOCKED() do { return RunResult::Halted; } while (0)

#if BMSX_USE_COMPUTED_GOTO
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wpedantic"
	goto *kDispatchTargets[decoded->op];
#pragma GCC diagnostic pop
#else
	switch (static_cast<OpCode>(decoded->op)) {
#define DISPATCH_LABEL(name) case OpCode::name:
#include "machine/cpu/cpu_dispatch.inl"
#undef DISPATCH_LABEL
	}
#endif

dispatch_continue:
#undef DISPATCH_BLOCKED
#undef DISPATCH_CONTINUE
#undef SKIP_NEXT_INSTRUCTION
#undef TABLE_CACHE_INDEX
#undef SET_REGISTER_FAST
#undef CYCLES_ADD
	#undef REG
	#undef IMAGE
	#undef FRAME
	goto dispatch_loop_check;

#if BMSX_USE_COMPUTED_GOTO
	#define FRAME (*frame)
	#define IMAGE (*image)
	#define REG(index) registers[static_cast<size_t>(index)]
#define CYCLES_ADD(n) do { instructionBudgetRemaining -= (n); } while (0)
#define SET_REGISTER_FAST(index, valueExpr) do { \
	REG(index) = (valueExpr); \
	const int nextTop = (index) + 1; \
	if (nextTop > FRAME.top) { \
		FRAME.top = nextTop; \
	} \
} while (0)
#define SKIP_NEXT_INSTRUCTION() do { \
	skipNextInstruction(FRAME); \
} while (0)
#define TABLE_CACHE_INDEX() (decoded->tableCacheIndex)
#define DISPATCH_LABEL(name) dispatch_##name:
#define DISPATCH_CONTINUE() do { goto dispatch_continue; } while (0)
#define DISPATCH_BLOCKED() do { return RunResult::Halted; } while (0)
#include "machine/cpu/cpu_dispatch.inl"
#undef DISPATCH_BLOCKED
#undef DISPATCH_CONTINUE
#undef SKIP_NEXT_INSTRUCTION
#undef TABLE_CACHE_INDEX
#undef DISPATCH_LABEL
#undef SET_REGISTER_FAST
#undef CYCLES_ADD
	#undef REG
	#undef IMAGE
	#undef FRAME
#endif
		} catch (const LuaThrownValueError& error) {
			if (!handleProtectedCallError(error.value)) {
				enterLuaFaultException(LUA_FAULT_REASON_EXPLICIT_ERROR);
			}
		} catch (const LuaExecutionError& error) {
			if (!handleProtectedCallError(valueString(m_stringPool.intern(error.what())))) {
				enterLuaFaultException(error.reason);
			}
		}
	}
}

RunResult CPU::runUntilDepth(int targetDepth, int instructionBudget) {
	if (targetDepth == 0) {
		return runLoop<true>(targetDepth, instructionBudget);
	}
	return runLoop<false>(targetDepth, instructionBudget);
}

void CPU::unwindToDepth(int targetDepth) {
	while (static_cast<int>(m_frames.size()) > targetDepth) {
		auto finished = std::move(m_frames.back());
		m_frames.pop_back();
		closeUpvalues(*finished);
		m_stackTop = finished->varargBase;
		m_stack.resize(static_cast<size_t>(m_stackTop));
		releaseFrame(std::move(finished));
	}
	while (m_protectedCallDepth > 0) {
		ProtectedCallContinuation& continuation = m_protectedCallContinuations.get(m_protectedCallDepth - 1);
		bool callerActive = false;
		for (const auto& frame : m_frames) {
			if (frame.get() == continuation.caller) {
				callerActive = true;
				break;
			}
		}
		if (callerActive) {
			break;
		}
		continuation.caller = nullptr;
		continuation.target = nullptr;
		m_protectedCallDepth -= 1;
	}
}

void CPU::collectHeap() {
	m_heap.requestCollection();
	m_heap.collect();
}

void CPU::runHousekeeping() {
	enforceLuaHeapBudget();
	if (m_heap.needsCollection()) {
		m_heap.collect();
	}
}

int CPU::readFrameExecutionDomain(int frameIndex) const {
	return m_frames[static_cast<size_t>(frameIndex)]->functionRecord->image->executionDomainId;
}

int CPU::readLastExecutionDomain() const {
	return m_lastExecutionDomainId;
}

u32 CPU::readFrameFunctionAddress(int frameIndex) const {
	return m_frames[static_cast<size_t>(frameIndex)]->functionAddress;
}

u32 CPU::readFramePc(int frameIndex) const {
	return m_frames[static_cast<size_t>(frameIndex)]->pc;
}

u32 CPU::readFrameCallSitePc(int childFrameIndex) const {
	return m_frames[static_cast<size_t>(childFrameIndex)]->callSitePc;
}

bool CPU::isExceptionFrame(int frameIndex) const {
	return m_frames[static_cast<size_t>(frameIndex)]->isExceptionFrame;
}

bool CPU::isNonMaskableExceptionFrame(int frameIndex) const {
	return m_frames[static_cast<size_t>(frameIndex)]->isNonMaskableExceptionFrame;
}

int CPU::getFrameRegisterCount(int frameIndex) const {
	return m_frames[static_cast<size_t>(frameIndex)]->top;
}

Value CPU::readFrameRegister(int frameIndex, int registerIndex) const {
	const CallFrame& frame = *m_frames[static_cast<size_t>(frameIndex)];
	return frame.registers[static_cast<size_t>(registerIndex)];
}

int CPU::getFrameUpvalueCount(int frameIndex) const {
	const CallFrame& frame = *m_frames[static_cast<size_t>(frameIndex)];
	return static_cast<int>(frame.closure->upvalueCount);
}

Value CPU::readFrameUpvalue(int frameIndex, int upvalueIndex) const {
	const CallFrame& frame = *m_frames[static_cast<size_t>(frameIndex)];
	return const_cast<CPU*>(this)->readUpvalue(frame.closure->upvalues[static_cast<size_t>(upvalueIndex)]);
}

u32 CPU::readEpcWord() const {
	return m_epcWord;
}

void CPU::writeEpcWord(u32 value) {
	m_epcWord = value;
}

u32 CPU::readNmiReturnEpcWord() const {
	return m_nmiReturnEpcWord;
}

void CPU::writeNmiReturnEpcWord(u32 value) {
	m_nmiReturnEpcWord = value;
}

void CPU::writeFrameExecution(
	int frameIndex,
	int executionDomainId,
	u32 functionAddress,
	u32 pc
) {
	Blua32ExecutionImage& image = *executionImageForDomain(executionDomainId);
	Blua32RuntimeFunction& functionRecord = *functionRecordInImage(image, functionAddress);
	CallFrame& frame = *m_frames[static_cast<size_t>(frameIndex)];
	if (functionRecord.maxStack > static_cast<u32>(frame.stackCapacity)) {
		ensureRegisterCapacity(frame, static_cast<int>(functionRecord.maxStack) - 1);
	}
	if (functionRecord.staticClosure && functionRecord.upvalues.empty()) {
		frame.closure = image.staticClosures[functionRecord.index];
	} else {
		frame.closure->functionAddress = functionRecord.address;
	}
	frame.functionAddress = functionRecord.address;
	frame.functionRecord = &functionRecord;
	frame.pc = pc;
}

void CPU::writeFrameCallSitePc(int childFrameIndex, u32 pc) {
	m_frames[static_cast<size_t>(childFrameIndex)]->callSitePc = pc;
}

Upvalue* CPU::findOpenUpvalue(const CallFrame& frame, int index) const {
	for (const OpenUpvalueSlot& entry : m_openUpvalues) {
		if (entry.frame == &frame && entry.index == index) {
			return entry.upvalue;
		}
	}
	return nullptr;
}

Closure* CPU::createClosure(CallFrame& frame, Blua32RuntimeFunction& functionRecord) {
	if (functionRecord.staticClosure && functionRecord.upvalues.empty()) {
		return functionRecord.image->staticClosures[functionRecord.index];
	}
	auto* closure = createTrackedClosure(
		functionRecord.address,
		functionRecord.upvalues.size()
	);
	for (size_t index = 0; index < functionRecord.upvalues.size(); ++index) {
		const Blua32UpvalueRecord& upvalueRecord = functionRecord.upvalues[index];
		if (upvalueRecord.inStack) {
			Upvalue* upvalue = findOpenUpvalue(frame, static_cast<int>(upvalueRecord.index));
			if (!upvalue) {
				upvalue = m_heap.allocate<Upvalue>(ObjType::Upvalue);
				addTrackedLuaHeapBytes(kUpvalueHeapBytes);
				upvalue->open = true;
				upvalue->index = static_cast<int>(upvalueRecord.index);
				upvalue->frame = &frame;
				m_openUpvalues.push_back(OpenUpvalueSlot{ &frame, upvalue->index, upvalue });
			}
			closure->upvalues[index] = upvalue;
		} else {
			closure->upvalues[index] = frame.closure->upvalues[upvalueRecord.index];
		}
	}
	return closure;
}

void CPU::closeUpvalues(CallFrame& frame) {
	size_t write = 0;
	for (size_t index = 0; index < m_openUpvalues.size(); ++index) {
		OpenUpvalueSlot entry = m_openUpvalues[index];
		if (entry.frame == &frame) {
			Upvalue* upvalue = entry.upvalue;
			upvalue->value = frame.registers[static_cast<size_t>(upvalue->index)];
			upvalue->open = false;
			upvalue->frame = nullptr;
			continue;
		}
		m_openUpvalues[write++] = entry;
	}
	m_openUpvalues.resize(write);
}

const Value& CPU::readUpvalue(Upvalue* upvalue) {
	if (upvalue->open) {
		return upvalue->frame->registers[upvalue->index];
	}
	return upvalue->value;
}

void CPU::writeUpvalue(Upvalue* upvalue, const Value& value) {
	if (upvalue->open) {
		upvalue->frame->registers[upvalue->index] = value;
		return;
	}
	upvalue->value = value;
}

CallFrame* CPU::pushFrame(CallFrame& caller, Closure* closure, int argBase, int argCount,
	int returnBase, int returnCount, bool returnToCompletionLatch, u32 callSitePc) {
	Blua32RuntimeFunction* functionRecord = functionRecordInExecutionDomain(
		*m_activeExecutionImage,
		closure->functionAddress
	);
	if (!functionRecord) {
		hardHalt();
		return nullptr;
	}
	const int callerArgBase = caller.stackBase + argBase;
	auto frame = acquireFrame();
	frame->functionAddress = closure->functionAddress;
	frame->functionRecord = functionRecord;
	frame->pc = functionRecord->codeAddress;
	frame->closure = closure;
	frame->returnBase = returnBase;
	frame->returnCount = returnCount;
	frame->returnToCompletionLatch = returnToCompletionLatch;
	frame->callSitePc = callSitePc;
	frame->varargBase = m_stackTop;
	frame->varargCount = functionRecord->isVararg
		? std::max(argCount - static_cast<int>(functionRecord->numParams), 0)
		: 0;
	frame->stackBase = frame->varargBase + frame->varargCount;
	size_t targetCapacity = nextPowerOfTwo(static_cast<size_t>(std::max(functionRecord->maxStack, 1u)));
	if (targetCapacity < 8) {
		targetCapacity = 8;
	}
	frame->stackCapacity = static_cast<int>(targetCapacity);
	m_stackTop = frame->stackBase + frame->stackCapacity;
	ensureStackSize(static_cast<size_t>(m_stackTop));
	frame->registers = m_stack.data() + frame->stackBase;
	frame->top = static_cast<int>(functionRecord->numParams);

	for (int i = 0; i < static_cast<int>(functionRecord->numParams); ++i) {
		if (i < argCount) {
			frame->registers[static_cast<size_t>(i)] = m_stack[static_cast<size_t>(callerArgBase + i)];
		} else {
			frame->registers[static_cast<size_t>(i)] = valueNil();
		}
	}
	if (functionRecord->isVararg) {
		for (int i = 0; i < frame->varargCount; ++i) {
			m_stack[static_cast<size_t>(frame->varargBase + i)] = m_stack[
				static_cast<size_t>(callerArgBase + static_cast<int>(functionRecord->numParams) + i)
			];
		}
	}
	CallFrame* pushed = frame.get();
	m_frames.push_back(std::move(frame));
	return pushed;
}

CallFrame* CPU::pushFrame(Closure* closure, const Value* args, size_t argCount,
	int returnBase, int returnCount, bool returnToCompletionLatch) {
	Blua32RuntimeFunction* functionRecord = functionRecordInExecutionDomain(
		*m_activeExecutionImage,
		closure->functionAddress
	);
	if (!functionRecord) {
		hardHalt();
		return nullptr;
	}
	const uintptr_t stackBegin = reinterpret_cast<uintptr_t>(m_stack.data());
	const uintptr_t stackEnd = stackBegin + m_stack.size() * sizeof(Value);
	const uintptr_t argsBegin = reinterpret_cast<uintptr_t>(args);
	const uintptr_t argsEnd = argsBegin + argCount * sizeof(Value);
	const bool argsInStack = argCount > 0 && stackBegin != 0 && argsBegin >= stackBegin && argsEnd <= stackEnd;
	const ptrdiff_t argsOffset = argsInStack ? static_cast<ptrdiff_t>((argsBegin - stackBegin) / sizeof(Value)) : 0;
	auto frame = acquireFrame();
	frame->functionAddress = closure->functionAddress;
	frame->functionRecord = functionRecord;
	frame->pc = functionRecord->codeAddress;
	frame->closure = closure;
	frame->returnBase = returnBase;
	frame->returnCount = returnCount;
	frame->returnToCompletionLatch = returnToCompletionLatch;
	frame->callSitePc = functionRecord->codeAddress;
	frame->varargBase = m_stackTop;
	frame->varargCount = functionRecord->isVararg
		? std::max(static_cast<int>(argCount) - static_cast<int>(functionRecord->numParams), 0)
		: 0;
	frame->stackBase = frame->varargBase + frame->varargCount;
	size_t targetCapacity = nextPowerOfTwo(static_cast<size_t>(std::max(functionRecord->maxStack, 1u)));
	if (targetCapacity < 8) {
		targetCapacity = 8;
	}
	frame->stackCapacity = static_cast<int>(targetCapacity);
	m_stackTop = frame->stackBase + frame->stackCapacity;
	ensureStackSize(static_cast<size_t>(m_stackTop));
	frame->registers = m_stack.data() + frame->stackBase;
	frame->top = static_cast<int>(functionRecord->numParams);
	const Value* sourceArgs = argsInStack ? m_stack.data() + argsOffset : args;

	for (int i = 0; i < static_cast<int>(functionRecord->numParams); ++i) {
		if (i < static_cast<int>(argCount)) {
			frame->registers[static_cast<size_t>(i)] = sourceArgs[i];
		} else {
			frame->registers[static_cast<size_t>(i)] = valueNil();
		}
	}
	if (functionRecord->isVararg) {
		for (int i = 0; i < frame->varargCount; ++i) {
			m_stack[static_cast<size_t>(frame->varargBase + i)] = sourceArgs[
				static_cast<size_t>(functionRecord->numParams) + static_cast<size_t>(i)
			];
		}
	}
	CallFrame* pushed = frame.get();
	m_frames.push_back(std::move(frame));
	return pushed;
}

void CPU::writeReturnValues(CallFrame& frame, int base, int count, const Value* values, int valueCount) {
	if (count == 0) {
		for (int i = 0; i < valueCount; ++i) {
			setRegister(frame, base + i, values[i]);
		}
		frame.top = base + valueCount;
		return;
	}
	for (int i = 0; i < count; ++i) {
		const Value value = i < valueCount ? values[i] : valueNil();
		setRegister(frame, base + i, value);
	}
	frame.top = base + count;
}

void CPU::setRegister(CallFrame& frame, int index, Value value) {
	Value* registers = ensureRegisterCapacity(frame, index);
	registers[static_cast<size_t>(index)] = value;
	const int nextTop = index + 1;
	if (nextTop > frame.top) {
		frame.top = nextTop;
	}
}

Value* CPU::ensureRegisterCapacity(CallFrame& frame, int index) {
	if (index < frame.stackCapacity) {
		return frame.registers;
	}
	int frameIndex = -1;
	for (size_t i = 0; i < m_frames.size(); ++i) {
		if (m_frames[i].get() == &frame) {
			frameIndex = static_cast<int>(i);
			break;
		}
	}
	if (frameIndex < 0) {
		throw BMSX_RUNTIME_ERROR("Attempted to grow registers for a non-top frame.");
	}
	const size_t needed = static_cast<size_t>(index) + 1;
	size_t bucket = nextPowerOfTwo(needed);
	if (bucket < 8) {
		bucket = 8;
	}
	const int previousCapacity = frame.stackCapacity;
	frame.stackCapacity = static_cast<int>(bucket);
	const int delta = frame.stackCapacity - previousCapacity;
	ensureStackSize(static_cast<size_t>(m_stackTop + delta));
	if (delta > 0) {
		for (int i = static_cast<int>(m_frames.size()) - 1; i > frameIndex; --i) {
			CallFrame* shifted = m_frames[static_cast<size_t>(i)].get();
			const int rangeBase = shifted->varargBase;
			const int rangeCount = shifted->varargCount + shifted->stackCapacity;
			for (int slot = rangeCount - 1; slot >= 0; --slot) {
				m_stack[static_cast<size_t>(rangeBase + delta + slot)] = m_stack[static_cast<size_t>(rangeBase + slot)];
			}
			shifted->varargBase += delta;
			shifted->stackBase += delta;
		}
	}
	m_stackTop += delta;
	refreshFrameRegisterPointers();
	for (int i = previousCapacity; i < frame.stackCapacity; ++i) {
		frame.registers[static_cast<size_t>(i)] = valueNil();
	}
	return frame.registers;
}

void CPU::writeMappedWordSequence(CallFrame& frame, uint32_t addr, int valueBase, int valueCount) {
	const uint32_t faultSequence = m_memory.readBusFaultSequence();
	uint32_t writeAddr = addr;
	for (int offset = 0; offset < valueCount; ++offset) {
		m_memory.writeMappedValue(writeAddr, frame.registers[static_cast<size_t>(valueBase + offset)]);
		if (m_memory.readBusFaultSequence() != faultSequence) {
			enterSynchronousException(frame, CPU_CAUSE_CODE_DATA_BUS_ERROR);
			return;
		}
		writeAddr += 4;
	}
}

const Value& CPU::readRK(CallFrame& frame, int rk) {
	if (rk < 0) {
		const int index = -1 - rk;
		return frame.functionRecord->image->constPool[static_cast<size_t>(index)];
	}
	return frame.registers[static_cast<size_t>(rk)];
}

template <typename Getter>
Value CPU::resolveTableIndexChain(Table* table, Getter get) {
	Table* current = table;
	for (int depth = 0; depth < 32; depth += 1) {
		const Value value = get(current);
		if (!isNil(value)) {
			return value;
		}
		Table* metatable = current->metatable;
		if (!metatable) {
			return valueNil();
		}
		const Value indexerValue = metatable->getStringKey(asStringId(m_indexKey));
		if (!valueIsTable(indexerValue)) {
			return valueNil();
		}
		current = asTable(indexerValue);
	}
	throw LuaExecutionError("Metatable __index loop detected.", LUA_FAULT_REASON_METATABLE_LOOP);
}

Value CPU::resolveTableIndex(Table* table, const Value& key) {
	return resolveTableIndexChain(table, [&](Table* current) {
		return current->get(key);
	});
}

Value CPU::resolveTableIntegerIndex(Table* table, int index) {
	return resolveTableIndexChain(table, [index](Table* current) {
		return current->getInteger(index);
	});
}

Value CPU::resolveTableFieldIndex(Table* table, StringId key) {
	return resolveTableIndexChain(table, [key](Table* current) {
		return current->getStringKey(key);
	});
}

Value CPU::loadTableIndex(const Value& base, const Value& key) {
	if (valueIsTable(base)) {
		Table* table = asTable(base);
		if (!table->metatable) {
			return table->get(key);
		}
		return resolveTableIndex(table, key);
	}
	if (valueIsString(base)) {
		if (!m_stringIndexTable->metatable) {
			return m_stringIndexTable->get(key);
		}
		return resolveTableIndex(m_stringIndexTable, key);
	}
	if (valueIsNativeObject(base)) {
		auto* native = asNativeObject(base);
		Value directValue = native->get(key);
		if (!isNil(directValue) || !native->metatable) {
			return directValue;
		}
		Value indexerValue = native->metatable->getStringKey(asStringId(m_indexKey));
		if (valueIsTable(indexerValue)) {
			return resolveTableIndex(asTable(indexerValue), key);
		}
		return directValue;
	}
	throw LuaExecutionError("Attempted to index field on a non-table value.", LUA_FAULT_REASON_INDEX_NON_TABLE);
}

Value CPU::loadTableIntegerIndexCached(
	Blua32ExecutionImage& image,
	int cacheIndex,
	const Value& base,
	int index
) {
	if (valueIsTable(base)) {
		Table* table = asTable(base);
		if (!table->metatable) {
			TableLoadInlineCache& cache = image.tableLoadCaches[static_cast<size_t>(cacheIndex)];
			if (cache.table == table && cache.version == table->version()) {
				return cache.value;
			}
			const Value value = table->getInteger(index);
			cache.table = table;
			cache.version = table->version();
			cache.value = value;
			return value;
		}
		return resolveTableIntegerIndex(table, index);
	}
	if (valueIsString(base)) {
		if (!m_stringIndexTable->metatable) {
			TableLoadInlineCache& cache = image.tableLoadCaches[static_cast<size_t>(cacheIndex)];
			if (cache.table == m_stringIndexTable && cache.version == m_stringIndexTable->version()) {
				return cache.value;
			}
			const Value value = m_stringIndexTable->getInteger(index);
			cache.table = m_stringIndexTable;
			cache.version = m_stringIndexTable->version();
			cache.value = value;
			return value;
		}
		return resolveTableIntegerIndex(m_stringIndexTable, index);
	}
	if (valueIsNativeObject(base)) {
		auto* native = asNativeObject(base);
		Value directValue = native->get(valueNumber(static_cast<double>(index)));
		if (!isNil(directValue) || !native->metatable) {
			return directValue;
		}
		Value indexerValue = native->metatable->getStringKey(asStringId(m_indexKey));
		if (valueIsTable(indexerValue)) {
			return resolveTableIntegerIndex(asTable(indexerValue), index);
		}
		return directValue;
	}
	throw LuaExecutionError("Attempted to index field on a non-table value.", LUA_FAULT_REASON_INDEX_NON_TABLE);
}

Value CPU::loadTableIntegerIndex(const Value& base, int index) {
	if (valueIsTable(base)) {
		Table* table = asTable(base);
		if (!table->metatable) {
			return table->getInteger(index);
		}
		return resolveTableIntegerIndex(table, index);
	}
	if (valueIsString(base)) {
		if (!m_stringIndexTable->metatable) {
			return m_stringIndexTable->getInteger(index);
		}
		return resolveTableIntegerIndex(m_stringIndexTable, index);
	}
	if (valueIsNativeObject(base)) {
		auto* native = asNativeObject(base);
		Value directValue = native->get(valueNumber(static_cast<double>(index)));
		if (!isNil(directValue) || !native->metatable) {
			return directValue;
		}
		Value indexerValue = native->metatable->getStringKey(asStringId(m_indexKey));
		if (valueIsTable(indexerValue)) {
			return resolveTableIntegerIndex(asTable(indexerValue), index);
		}
		return directValue;
	}
	throw LuaExecutionError("Attempted to index field on a non-table value.", LUA_FAULT_REASON_INDEX_NON_TABLE);
}

Value CPU::loadTableFieldIndexCached(
	Blua32ExecutionImage& image,
	int cacheIndex,
	const Value& base,
	StringId key
) {
	if (valueIsTable(base)) {
		Table* table = asTable(base);
		if (!table->metatable) {
			TableLoadInlineCache& cache = image.tableLoadCaches[static_cast<size_t>(cacheIndex)];
			if (cache.table == table && cache.version == table->version()) {
				return cache.value;
			}
			const Value value = table->getStringKey(key);
			cache.table = table;
			cache.version = table->version();
			cache.value = value;
			return value;
		}
		return resolveTableFieldIndex(table, key);
	}
	if (valueIsString(base)) {
		if (!m_stringIndexTable->metatable) {
			TableLoadInlineCache& cache = image.tableLoadCaches[static_cast<size_t>(cacheIndex)];
			if (cache.table == m_stringIndexTable && cache.version == m_stringIndexTable->version()) {
				return cache.value;
			}
			const Value value = m_stringIndexTable->getStringKey(key);
			cache.table = m_stringIndexTable;
			cache.version = m_stringIndexTable->version();
			cache.value = value;
			return value;
		}
		return resolveTableFieldIndex(m_stringIndexTable, key);
	}
	if (valueIsNativeObject(base)) {
		auto* native = asNativeObject(base);
		Value directValue = native->get(valueString(key));
		if (!isNil(directValue) || !native->metatable) {
			return directValue;
		}
		Value indexerValue = native->metatable->getStringKey(asStringId(m_indexKey));
		if (valueIsTable(indexerValue)) {
			return resolveTableFieldIndex(asTable(indexerValue), key);
		}
		return directValue;
	}
	throw LuaExecutionError("Attempted to index field on a non-table value.", LUA_FAULT_REASON_INDEX_NON_TABLE);
}

Value CPU::loadTableFieldIndex(const Value& base, StringId key) {
	if (valueIsTable(base)) {
		Table* table = asTable(base);
		if (!table->metatable) {
			return table->getStringKey(key);
		}
		return resolveTableFieldIndex(table, key);
	}
	if (valueIsString(base)) {
		if (!m_stringIndexTable->metatable) {
			return m_stringIndexTable->getStringKey(key);
		}
		return resolveTableFieldIndex(m_stringIndexTable, key);
	}
	if (valueIsNativeObject(base)) {
		auto* native = asNativeObject(base);
		Value directValue = native->get(valueString(key));
		if (!isNil(directValue) || !native->metatable) {
			return directValue;
		}
		Value indexerValue = native->metatable->getStringKey(asStringId(m_indexKey));
		if (valueIsTable(indexerValue)) {
			return resolveTableFieldIndex(asTable(indexerValue), key);
		}
		return directValue;
	}
	throw LuaExecutionError("Attempted to index field on a non-table value.", LUA_FAULT_REASON_INDEX_NON_TABLE);
}

void CPU::storeTableIndex(const Value& base, const Value& key, const Value& value) {
	if (valueIsTable(base)) {
		asTable(base)->set(key, value);
		return;
	}
	if (valueIsNativeObject(base)) {
		asNativeObject(base)->set(key, value);
		return;
	}
	throw LuaExecutionError("Attempted to assign to a non-table value.", LUA_FAULT_REASON_ASSIGN_NON_TABLE);
}

void CPU::storeTableIntegerIndex(const Value& base, int index, const Value& value) {
	if (valueIsTable(base)) {
		asTable(base)->setInteger(index, value);
		return;
	}
	if (valueIsNativeObject(base)) {
		asNativeObject(base)->set(valueNumber(static_cast<double>(index)), value);
		return;
	}
	throw LuaExecutionError("Attempted to assign to a non-table value.", LUA_FAULT_REASON_ASSIGN_NON_TABLE);
}

void CPU::storeTableFieldIndex(const Value& base, StringId key, const Value& value) {
	if (valueIsTable(base)) {
		asTable(base)->setStringKey(key, value);
		return;
	}
	if (valueIsNativeObject(base)) {
		asNativeObject(base)->set(valueString(key), value);
		return;
	}
	throw LuaExecutionError("Attempted to assign to a non-table value.", LUA_FAULT_REASON_ASSIGN_NON_TABLE);
}

std::unique_ptr<CallFrame> CPU::acquireFrame() {
	if (!m_framePool.empty()) {
		auto frame = std::move(m_framePool.back());
		m_framePool.pop_back();
		return frame;
	}
	return std::make_unique<CallFrame>();
}

void CPU::releaseFrame(std::unique_ptr<CallFrame> frame) {
	frame->varargBase = 0;
	frame->varargCount = 0;
	frame->registers = nullptr;
	frame->stackBase = 0;
	frame->stackCapacity = 0;
	frame->isExceptionFrame = false;
	frame->isNonMaskableExceptionFrame = false;
	if (m_framePool.size() < static_cast<size_t>(MAX_POOLED_FRAMES)) {
		m_framePool.push_back(std::move(frame));
	}
}

void CPU::clearCallStack() {
	for (size_t index = 0; index < m_protectedCallDepth; ++index) {
		ProtectedCallContinuation& continuation = m_protectedCallContinuations.get(index);
		continuation.caller = nullptr;
		continuation.target = nullptr;
	}
	m_protectedCallDepth = 0;
	while (!m_frames.empty()) {
		CallFrame* frame = m_frames.back().get();
		closeUpvalues(*frame);
		auto finished = std::move(m_frames.back());
		m_frames.pop_back();
		releaseFrame(std::move(finished));
	}
	m_openUpvalues.clear();
	m_stack.clear();
	m_stackTop = 0;
}

void CPU::ensureStackSize(size_t size) {
	Value* previousBase = m_stack.data();
	if (size > m_stack.size()) {
		m_stack.resize(size, valueNil());
	}
	if (m_stack.data() != previousBase) {
		refreshFrameRegisterPointers();
	}
}

void CPU::refreshFrameRegisterPointers() {
	Value* base = m_stack.data();
	for (const auto& framePtr : m_frames) {
		framePtr->registers = base + framePtr->stackBase;
	}
}

NativeResultsScratchScope CPU::acquireNativeReturnScratch() {
	NativeResults& out = m_nativeReturnScratch.get(m_nativeReturnScratchIndex);
	m_nativeReturnScratchIndex += 1;
	out.clear();
	return NativeResultsScratchScope(*this, out);
}

void CPU::releaseNativeReturnScratch(NativeResults& out) {
	out.clear();
	m_nativeReturnScratchIndex -= 1;
}

CPU::NativeLocalRootsScope CPU::acquireNativeLocalRoots() {
	return NativeLocalRootsScope(*this);
}

void CPU::releaseNativeLocalRoots(size_t base) {
	m_nativeLocalRoots.resize(base);
	m_nativeLocalRootScopeDepth -= 1;
}

void CPU::trackNativeLocalRoot(Value value) {
	if (m_nativeLocalRootScopeDepth > 0) {
		m_nativeLocalRoots.push_back(value);
	}
}

void CPU::markRoots(GcHeap& heap) {
	heap.markObject(globals);
	// Keep the interned "__index" key tracked even while no live metatable uses it.
	heap.markValue(m_indexKey);
	heap.markObject(m_stringIndexTable);
	m_memory.markRoots(heap);
	for (const auto& value : completionValues) {
		heap.markValue(value);
	}
	for (size_t scratchIndex = 0; scratchIndex < m_nativeReturnScratchIndex; ++scratchIndex) {
		NativeResults& scratch = m_nativeReturnScratch.get(scratchIndex);
		for (size_t valueIndex = 0; valueIndex < scratch.size(); ++valueIndex) {
			heap.markValue(scratch[valueIndex]);
		}
	}
	for (const Value value : m_nativeLocalRoots) {
		heap.markValue(value);
	}
	for (const auto& value : m_systemGlobalValues) {
		heap.markValue(value);
	}
	for (const auto& value : m_globalValues) {
		heap.markValue(value);
	}
	for (const std::unique_ptr<Blua32ExecutionImage>& executionImage : m_executionImages) {
		Blua32ExecutionImage* image = executionImage.get();
		for (Value value : image->constPool) {
			heap.markValue(value);
		}
		for (const TableLoadInlineCache& cache : image->tableLoadCaches) {
			if (cache.table) {
				heap.markObject(cache.table);
			}
			heap.markValue(cache.value);
		}
	}
	for (const auto& framePtr : m_frames) {
		CallFrame* frame = framePtr.get();
		heap.markClosure(frame->closure);
		for (int i = 0; i < frame->top; ++i) {
			heap.markValue(frame->registers[static_cast<size_t>(i)]);
		}
		for (int i = 0; i < frame->varargCount; ++i) {
			heap.markValue(m_stack[static_cast<size_t>(frame->varargBase + i)]);
		}
	}
	for (const auto& entry : m_openUpvalues) {
		heap.markObject(entry.upvalue);
		heap.markValue(entry.frame->registers[static_cast<size_t>(entry.index)]);
	}
}

// end repeated-sequence-acceptable

} // namespace bmsx
