#include "machine/cpu/cpu.h"
#include "common/endian.h"
#include "machine/common/numeric.h"
#include "spec/blua32/numeric.h"
#include "machine/devices/irq/controller.h"
#include "spec/blua32/builtin.h"
#include "spec/blua32/image_format.h"
#include "machine/memory/memory.h"
#include "common/utf8.h"
#include <algorithm>
#include <bit>
#include <cctype>
#include <stdexcept>
#include <unordered_set>

namespace bmsx {

// start repeated-sequence-acceptable -- CPU interpreter hot paths keep duplicated opcode/register statements inline.

namespace {
constexpr size_t kClosureHeapBytes = 16;
constexpr size_t kClosureUpvalueSlotHeapBytes = 8;
constexpr size_t kUpvalueHeapBytes = 24;
constexpr uint8_t kTableWeakKeys = 1;
constexpr uint8_t kTableWeakValues = 2;
static inline size_t trackedClosureBytes(const Closure& closure) {
	return closure.trackedHeapBytes;
}

static inline size_t closureAllocationBytes(size_t upvalueCount) {
	return sizeof(Closure) + (upvalueCount * sizeof(Upvalue*));
}

} // namespace

bool GcHeap::markValue(Value v) {
	if (!valueIsTagged(v)) {
		return false;
	}
	switch (valueTag(v)) {
		case ValueTag::Table:
			return markObject(asTable(v));
		case ValueTag::Closure:
			return markClosure(asClosure(v));
		case ValueTag::BuiltinFunction:
			return false;
		case ValueTag::String:
			m_stringPool.markReachable(asStringId(v));
			return false;
		default:
			return false;
	}
}

bool GcHeap::markClosure(Closure* closure) {
	if (closure->trackedHeapBytes == 0) {
		return false;
	}
	return markObject(closure);
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
	return closure;
}

GcHeap::~GcHeap() {
	while (m_objects) {
		GCObject* object = m_objects;
		m_objects = object->next;
		destroyObject(object);
	}
}

bool GcHeap::markObject(GCObject* obj) {
	if (!obj || obj->marked) {
		return false;
	}
	obj->marked = true;
	m_grayStack.push_back(obj);
	return true;
}

uint8_t GcHeap::tableWeakMode(const Table& table) const {
	if (!table.metatable) {
		return 0;
	}
	const Value modeValue = table.metatable->getStringKey(m_modeKey);
	if (!valueIsString(modeValue)) {
		return 0;
	}
	const std::string& mode = m_stringPool.toString(asStringId(modeValue));
	uint8_t weakMode = 0;
	for (char ch : mode) {
		switch (ch) {
			case 'k':
				weakMode |= kTableWeakKeys;
				break;
			case 'v':
				weakMode |= kTableWeakValues;
				break;
		}
	}
	return weakMode;
}

bool GcHeap::valueIsAlive(Value value) const {
	if (!valueIsTagged(value)) {
		return true;
	}
	switch (valueTag(value)) {
		case ValueTag::Table:
			return asTable(value)->marked;
		case ValueTag::Closure: {
			const Closure* closure = asClosure(value);
			return closure->trackedHeapBytes == 0 || closure->marked;
		}
		default:
			return true;
	}
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
				const uint8_t weakMode = tableWeakMode(*table);
				if (weakMode != 0) {
					m_weakTables.push_back(table);
					m_weakTableModes.push_back(weakMode);
					if (weakMode == kTableWeakKeys) {
						m_ephemeronTables.push_back(table);
					}
				}
				if ((weakMode & kTableWeakKeys) == 0) {
					table->forEachEntry([this, weakMode](Value key, Value value) {
						markValue(key);
						if (weakMode == 0) {
							markValue(value);
						}
					});
				}
				break;
			}
			case ObjType::Closure: {
				auto* closure = static_cast<Closure*>(obj);
				for (size_t index = 0; index < closure->upvalueCount; ++index) {
					markObject(closure->upvalues[index]);
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

void GcHeap::convergeEphemerons() {
	bool changed = false;
	do {
		changed = false;
		for (Table* table : m_ephemeronTables) {
			table->forEachEntry([this, &changed](Value key, Value value) {
				if (valueIsAlive(key) && markValue(value)) {
					changed = true;
				}
			});
		}
		trace();
	} while (changed);
}

void GcHeap::clearWeakTables() {
	for (size_t index = 0; index < m_weakTables.size(); ++index) {
		Table* table = m_weakTables[index];
		const uint8_t weakMode = m_weakTableModes[index];
		table->clearWeakEntries(
			(weakMode & kTableWeakKeys) != 0,
			(weakMode & kTableWeakValues) != 0,
			[this](Value value) { return valueIsAlive(value); }
		);
		table->forEachEntry([this](Value key, Value value) {
			if (valueIsString(key)) {
				m_stringPool.markReachable(asStringId(key));
			}
			if (valueIsString(value)) {
				m_stringPool.markReachable(asStringId(value));
			}
		});
	}
}

void GcHeap::destroyObject(GCObject* object) {
	switch (object->type) {
		case ObjType::Table:
			m_luaHeap.release(static_cast<Table*>(object)->trackedHeapBytes());
			delete static_cast<Table*>(object);
			break;
		case ObjType::Closure:
			m_luaHeap.release(trackedClosureBytes(*static_cast<Closure*>(object)));
			static_cast<Closure*>(object)->~Closure();
			::operator delete(object);
			break;
		case ObjType::Upvalue:
			m_luaHeap.release(kUpvalueHeapBytes);
			delete static_cast<Upvalue*>(object);
			break;
	}
}

void GcHeap::sweep() {
	GCObject** current = &m_objects;
	while (*current) {
		GCObject* object = *current;
		if (object->marked) {
			object->marked = false;
			current = &object->next;
			continue;
		}
		*current = object->next;
		destroyObject(object);
	}
}

void GcHeap::collect(
	Value root0,
	Value root1,
	Value root2
) {
	m_weakTables.clear();
	m_weakTableModes.clear();
	m_ephemeronTables.clear();
	m_stringPool.beginReachabilityEpoch();
	m_stringPool.markReachable(m_modeKey);
	m_cpu.markRoots(*this);
	markValue(root0);
	markValue(root1);
	markValue(root2);
	trace();
	convergeEphemerons();
	clearWeakTables();
	sweep();
	m_stringPool.reclaimUnreachableTracked();
	m_weakTables.clear();
	m_weakTableModes.clear();
	m_ephemeronTables.clear();
}

BuiltinResultsScratchScope::BuiltinResultsScratchScope(CPU& cpu, BuiltinResults& out) noexcept
	: m_cpu(&cpu)
	, m_out(&out) {
}

BuiltinResultsScratchScope::BuiltinResultsScratchScope(BuiltinResultsScratchScope&& other) noexcept
	: m_cpu(other.m_cpu)
	, m_out(other.m_out) {
	other.m_cpu = nullptr;
	other.m_out = nullptr;
}

BuiltinResultsScratchScope::~BuiltinResultsScratchScope() {
	if (m_cpu) {
		m_out->clear();
		m_cpu->m_builtinResultScratchIndex -= 1;
	}
}

CPU::LocalRootsScope::LocalRootsScope(CPU& cpu) noexcept
	: m_cpu(&cpu)
	, m_base(cpu.m_localRoots.size()) {
	cpu.m_localRootScopeDepth += 1;
}

CPU::LocalRootsScope::LocalRootsScope(LocalRootsScope&& other) noexcept
	: m_cpu(other.m_cpu)
	, m_base(other.m_base) {
	other.m_cpu = nullptr;
	other.m_base = 0;
}

CPU::LocalRootsScope::~LocalRootsScope() {
	if (m_cpu) {
		m_cpu->releaseLocalRoots(m_base);
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
	, m_luaHeap(*this, memory.ramByteCount())
	, m_stringPool(m_luaHeap)
	, m_indexKey(valueString(m_stringPool.intern("__index")))
	, m_heap(*this, m_luaHeap, m_stringPool, m_stringPool.intern("__mode"))
	, m_errorInErrorHandlingValue(valueString(m_stringPool.intern("error in error handling", false))) {
	m_luaFaultErrorValues.fill(valueNil());
	m_luaFaultErrorValues[LUA_FAULT_REASON_UNKNOWN] = valueString(m_stringPool.intern("Attempted to get length of an unsupported value.", false));
	m_luaFaultErrorValues[LUA_FAULT_REASON_CALL_NON_FUNCTION] = valueString(m_stringPool.intern("Attempted to call a non-function value.", false));
	m_luaFaultErrorValues[LUA_FAULT_REASON_INDEX_NON_TABLE] = valueString(m_stringPool.intern("Attempted to index field on a non-table value.", false));
	m_luaFaultErrorValues[LUA_FAULT_REASON_ASSIGN_NON_TABLE] = valueString(m_stringPool.intern("Attempted to assign to a non-table value.", false));
	m_luaFaultErrorValues[LUA_FAULT_REASON_INDEX_NIL] = valueString(m_stringPool.intern("Table index is nil.", false));
	m_luaFaultErrorValues[LUA_FAULT_REASON_METATABLE_LOOP] = valueString(m_stringPool.intern("Metatable __index loop detected.", false));
	m_luaFaultErrorValues[LUA_FAULT_REASON_ITERATE_NON_TABLE] = valueString(m_stringPool.intern("Attempted to iterate a non-table value.", false));
	m_luaFaultErrorValues[LUA_FAULT_REASON_XPCALL_HANDLER_NOT_FUNCTION] = valueString(m_stringPool.intern("xpcall error handler must be a function.", false));
	m_luaFaultErrorValues[LUA_FAULT_REASON_OUT_OF_MEMORY] = valueString(m_stringPool.intern("Out of memory.", false));
	m_luaFaultErrorValues[LUA_FAULT_REASON_INVALID_ARGUMENT] = valueString(m_stringPool.intern("Invalid argument.", false));
	m_builtinResultScratch.reserve(1);
	m_builtinResultScratch.get(0).ensureCapacity(8);
	m_builtinResultScratch.clear();
	for (size_t index = 0; index < m_builtinFunctions.size(); ++index) {
		BuiltinFunction& builtin = m_builtinFunctions[index];
		const BuiltinFunctionCost cost = BUILTIN_FUNCTION_COSTS[index];
		builtin.id = static_cast<BuiltinFunctionId>(index);
		builtin.cycleBase = cost.base;
		builtin.cyclePerArg = cost.perArg;
		builtin.cyclePerRet = cost.perRet;
	}
	globals = createTable();
	m_memory.attachMappedPageInvalidator(*this);
}

CPU::~CPU() {
	m_memory.detachMappedPageInvalidator();
}

Value CPU::createBuiltinFunction(BuiltinFunctionId id) {
	return valueBuiltinFunction(&m_builtinFunctions[static_cast<size_t>(id)]);
}

Table* CPU::createTable(int arraySize, int hashSize) {
	const size_t hashCapacity = Table::hashCapacity(hashSize);
	m_luaHeap.reserve(Table::trackedHeapBytesForCapacities(static_cast<size_t>(arraySize), hashCapacity));
	Table* table = m_heap.allocate<Table>(
		ObjType::Table,
		m_luaHeap,
		static_cast<size_t>(arraySize),
		hashCapacity
	);
	trackLocalRoot(valueTable(table));
	return table;
}

Closure* CPU::allocateTrackedClosure(
	u32 functionAddress,
	size_t upvalueCount
) {
	auto* closure = m_heap.allocateClosure(upvalueCount);
	closure->functionAddress = functionAddress;
	closure->trackedHeapBytes = kClosureHeapBytes + (upvalueCount * kClosureUpvalueSlotHeapBytes);
	return closure;
}

void CPU::reset() {
	const Blua32ExecutionBoot systemBoot =
		m_executionAddressSpace.resolveSystemDomain();
	const u32 systemResetFunctionAddress = systemBoot.startupFunctionAddress;
	const u32 systemExceptionFunctionAddress = systemBoot.exceptionFunctionAddress;
	m_completionValues.clear();
	clearCallStack();
	m_stringIndexTable = nullptr;
	m_haltedUntilIrqFrameDepth = -1;
	m_interruptEventPending = false;
	m_memoryWriteBlocked = false;
	m_memoryWriteBlockedAddress = 0u;
	m_hardHalted = false;
	m_statusWord = CPU_STATUS_SYSTEM_ENTRY;
	m_causeWord = 0u;
	m_epcWord = 0u;
	m_badAddressWord = 0u;
	m_luaFaultReasonWord = 0u;
	m_exceptionDomainWord = 0u;
	m_nmiReturnCauseWord = 0u;
	m_nmiReturnEpcWord = 0u;
	m_nmiReturnBadAddressWord = 0u;
	m_nmiReturnLuaFaultReasonWord = 0u;
	m_nmiReturnExceptionDomainWord = 0u;
	m_nonMaskableInterruptPending = false;
	m_yieldRequested = false;
	m_staticClosuresByAddress.clear();
	m_memory.clearMappedPageWriteWatches();
	for (std::unique_ptr<Blua32ExecutionImage>& image : m_executionImagesByDomain) {
		image.reset();
	}
	std::unique_ptr<Blua32ExecutionImage> activatedSystemImage =
		activateExecutionImage(systemBoot);
	m_systemImage = activatedSystemImage.get();
	m_executionImagesByDomain[static_cast<size_t>(SYSTEM_EXECUTION_DOMAIN_ID + 1)] =
		std::move(activatedSystemImage);
	m_systemExceptionFunctionAddress = systemExceptionFunctionAddress;
	latchActiveExecutionImage(*m_systemImage);
	Closure* systemResetClosure = staticClosureAtAddress(systemResetFunctionAddress);
	pushFrame(systemResetClosure, nullptr, 0u, 0, 0, false);
	collectHeap();
}

void CPU::installBootPrimitives() {
	for (const LuaBootPrimitive& primitive : LUA_BOOT_PRIMITIVES) {
		setSystemGlobalByKey(
			m_stringPool.intern(primitive.name),
			createBuiltinFunction(primitive.id)
		);
	}
}

StringId CPU::internExecutionString(
	ExecutionDomainId executionDomainId,
	u32 address,
	u32 byteCount
) {
	if (byteCount == 0u) {
		return m_stringPool.intern({}, false);
	}
	m_executionAddressSpace.bindReadOnlyView(
		executionDomainId,
		address,
		byteCount,
		m_executionReadView
	);
	return m_stringPool.intern(
		std::string_view(
			reinterpret_cast<const char*>(m_executionReadView.data()),
			m_executionReadView.size()
		),
		false
	);
}

std::vector<Value> CPU::decodeConstantPool(
	ExecutionDomainId executionDomainId,
	u32 tableAddress,
	u32 constantCount
) {
	std::vector<Value> constPool(constantCount);
	if (constantCount == 0u) {
		return constPool;
	}
	m_executionAddressSpace.bindReadOnlyView(
		executionDomainId,
		tableAddress,
		static_cast<size_t>(constantCount) * BLUA32_CONSTANT_RECORD_SIZE,
		m_executionTableView
	);
	for (u32 index = 0; index < constantCount; ++index) {
		const u8* record = m_executionTableView.data()
			+ static_cast<size_t>(index) * BLUA32_CONSTANT_RECORD_SIZE;
		switch (static_cast<Blua32ConstantTag>(
			readLE32(record + BLUA32_CONSTANT_TAG_OFFSET)
		)) {
			case Blua32ConstantTag::Nil:
				constPool[index] = valueNil();
				break;
			case Blua32ConstantTag::False:
				constPool[index] = valueBool(false);
				break;
			case Blua32ConstantTag::True:
				constPool[index] = valueBool(true);
				break;
			case Blua32ConstantTag::Number:
				constPool[index] = valueNumber(std::bit_cast<f64>(
					readLE64(record + BLUA32_CONSTANT_PAYLOAD_OFFSET)
				));
				break;
			case Blua32ConstantTag::String:
				constPool[index] = valueString(internExecutionString(
					executionDomainId,
					readLE32(record + BLUA32_CONSTANT_PAYLOAD_OFFSET),
					readLE32(record + BLUA32_CONSTANT_STRING_BYTE_COUNT_OFFSET)
				));
				break;
			default:
				throw BMSX_RUNTIME_ERROR("BLua32 constant tag is invalid.");
		}
	}
	return constPool;
}

std::vector<u32> CPU::registerGlobalNames(
	ExecutionDomainId executionDomainId,
	u32 tableAddress,
	u32 nameCount,
	bool system
) {
	auto& slotByKey = system ? m_systemGlobalSlotByKey : m_globalSlotByKey;
	auto& registeredNames = system ? m_systemGlobalNames : m_globalNames;
	auto& values = system ? m_systemGlobalValues : m_globalValues;
	std::vector<u32> slots(nameCount);
	if (nameCount == 0u) {
		return slots;
	}
	m_executionAddressSpace.bindReadOnlyView(
		executionDomainId,
		tableAddress,
		static_cast<size_t>(nameCount) * BLUA32_GLOBAL_NAME_RECORD_SIZE,
		m_executionTableView
	);
	for (u32 index = 0; index < nameCount; ++index) {
		const u8* record = m_executionTableView.data()
			+ static_cast<size_t>(index) * BLUA32_GLOBAL_NAME_RECORD_SIZE;
		const StringId key = internExecutionString(
			executionDomainId,
			readLE32(record + BLUA32_GLOBAL_NAME_ADDRESS_OFFSET),
			readLE32(record + BLUA32_GLOBAL_NAME_BYTE_COUNT_OFFSET)
		);
		auto slot = slotByKey.find(key);
		if (slot == slotByKey.end()) {
			const size_t slotIndex = registeredNames.size();
			slot = slotByKey.emplace(key, slotIndex).first;
			registeredNames.push_back(key);
			values.push_back(system ? valueNil() : globals->getStringKey(key));
		}
		slots[index] = static_cast<u32>(slot->second);
	}
	return slots;
}

std::unique_ptr<Blua32ExecutionImage> CPU::activateExecutionImage(
	Blua32ExecutionBoot executionBoot
) {
	const ExecutionDomainId executionDomainId = executionBoot.executionDomainId;
	auto image = std::make_unique<Blua32ExecutionImage>();
	image->executionDomainId = executionDomainId;
	image->irqFunctionAddress = executionBoot.irqFunctionAddress;
	m_executionAddressSpace.bindReadOnlyView(
		executionDomainId,
		executionBoot.imageAddress,
		BLUA32_IMAGE_HEADER_SIZE,
		m_executionReadView
	);
	const u8* header = m_executionReadView.data();
	const u32 constantTableAddress = readLE32(
		header + BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET
	);
	const u32 constantCount = readLE32(
		header + BLUA32_IMAGE_CONSTANT_COUNT_OFFSET
	);
	const u32 globalNameTableAddress = readLE32(
		header + BLUA32_IMAGE_GLOBAL_NAME_TABLE_ADDRESS_OFFSET
	);
	const u32 globalNameCount = readLE32(
		header + BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET
	);
	const u32 systemGlobalNameTableAddress = readLE32(
		header + BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_TABLE_ADDRESS_OFFSET
	);
	const u32 systemGlobalNameCount = readLE32(
		header + BLUA32_IMAGE_SYSTEM_GLOBAL_NAME_COUNT_OFFSET
	);
	image->constPool = decodeConstantPool(
		executionDomainId,
		constantTableAddress,
		constantCount
	);
	image->globalSlots = registerGlobalNames(
		executionDomainId,
		globalNameTableAddress,
		globalNameCount,
		false
	);
	image->systemGlobalSlots = registerGlobalNames(
		executionDomainId,
		systemGlobalNameTableAddress,
		systemGlobalNameCount,
		true
	);
	return image;
}

Blua32ExecutionImage* CPU::executionImageForDomain(
	ExecutionDomainId executionDomainId
) {
	const size_t imageIndex = static_cast<size_t>(executionDomainId + 1);
	if (Blua32ExecutionImage* image = m_executionImagesByDomain[imageIndex].get()) {
		return image;
	}
	std::optional<Blua32ExecutionBoot> executionBoot =
		m_executionAddressSpace.resolveDomain(executionDomainId);
	if (!executionBoot) {
		return nullptr;
	}
	std::unique_ptr<Blua32ExecutionImage> image =
		activateExecutionImage(*executionBoot);
	Blua32ExecutionImage* activatedImage = image.get();
	m_executionImagesByDomain[imageIndex] = std::move(image);
	return activatedImage;
}

MappedBusSignals CPU::executionBusSignalsForDomain(ExecutionDomainId executionDomainId) {
	return executionDomainId == SYSTEM_EXECUTION_DOMAIN_ID
		? MAPPED_BUS_MASTER_CPU
		: mappedBusSignalsForCartridgeSlot(static_cast<u32>(executionDomainId));
}

void CPU::latchActiveExecutionImage(Blua32ExecutionImage& image) {
	m_activeExecutionImage = &image;
	m_executionBusSignals = executionBusSignalsForDomain(image.executionDomainId);
}

void CPU::replaceExecutionImage(Blua32ExecutionBoot executionBoot) {
	std::unique_ptr<Blua32ExecutionImage>& imageEntry = m_executionImagesByDomain[
		static_cast<size_t>(executionBoot.executionDomainId + 1)
	];
	Blua32ExecutionImage* previousImage = imageEntry.get();
	std::unique_ptr<Blua32ExecutionImage> image =
		activateExecutionImage(executionBoot);
	Blua32ExecutionImage* activatedImage = image.get();
	imageEntry = std::move(image);
	if (activatedImage->executionDomainId == SYSTEM_EXECUTION_DOMAIN_ID) {
		m_systemImage = activatedImage;
		m_systemExceptionFunctionAddress = executionBoot.exceptionFunctionAddress;
	}
	if (m_activeExecutionImage == previousImage) {
		latchActiveExecutionImage(*activatedImage);
	}
}

bool CPU::isExecutionDomainResident(ExecutionDomainId executionDomainId) const {
	return m_executionImagesByDomain[
		static_cast<size_t>(executionDomainId + 1)
	] != nullptr;
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
	m_completionValues.clear();
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

void CPU::setGlobalByKey(StringId key, const Value& value) {
	globals->setStringKey(key, value);
	const auto globalIt = m_globalSlotByKey.find(key);
	if (globalIt != m_globalSlotByKey.end()) {
		m_globalValues[globalIt->second] = value;
	}
}

void CPU::setSystemGlobalByKey(StringId key, const Value& value) {
	const auto slot = m_systemGlobalSlotByKey.find(key);
	if (slot == m_systemGlobalSlotByKey.end()) {
		throw BMSX_RUNTIME_ERROR("System global '" + m_stringPool.toString(key) + "' has no register slot.");
	}
	m_systemGlobalValues[slot->second] = value;
}

Value CPU::getSystemGlobalByKey(StringId key) const {
	return m_systemGlobalValues[m_systemGlobalSlotByKey.find(key)->second];
}

Value CPU::getGlobalByKey(StringId key) const {
	const auto globalIt = m_globalSlotByKey.find(key);
	if (globalIt != m_globalSlotByKey.end()) {
		return m_globalValues[globalIt->second];
	}
	return globals->getStringKey(key);
}

void CPU::syncGlobalSlotsToTable() {
	for (size_t index = 0; index < m_globalNames.size(); ++index) {
		globals->setStringKey(m_globalNames[index], m_globalValues[index]);
	}
}


DecodedInstructionPage& CPU::decodedPageForAddress(
	Blua32ExecutionImage& image,
	const MappedPageBinding& binding
) {
	auto it = image.decodedPages.try_emplace(
		binding.key,
		binding.cacheable,
		binding.writeWatch
	).first;
	return it->second;
}

void CPU::invalidateDecodedPage(u64 key) {
	for (const std::unique_ptr<Blua32ExecutionImage>& image : m_executionImagesByDomain) {
		if (!image) {
			continue;
		}
		auto page = image->decodedPages.find(key);
		if (page != image->decodedPages.end()) {
			page->second.decodeRequired.fill(1u);
			page->second.fusionRequired.fill(0u);
		}
	}
}

void CPU::invalidateMappedPage(u64 key) {
	invalidateDecodedPage(key);
	if (key >= MAPPED_PAGE_BYTE_SIZE) {
		invalidateDecodedPage(key - MAPPED_PAGE_BYTE_SIZE);
	}
}

void CPU::invalidateMappedRange(u64 firstKey, u64 endKey) {
	const u64 invalidationStart = firstKey >= MAPPED_PAGE_BYTE_SIZE
		? firstKey - MAPPED_PAGE_BYTE_SIZE
		: 0u;
	for (const std::unique_ptr<Blua32ExecutionImage>& image : m_executionImagesByDomain) {
		if (!image) {
			continue;
		}
		for (auto& [key, page] : image->decodedPages) {
			if (key >= invalidationStart && key < endKey) {
				page.decodeRequired.fill(1u);
				page.fusionRequired.fill(0u);
			}
		}
	}
}

DecodedInstructionPage* CPU::decodedPageForFrame(CallFrame& frame, u32 pc) {
	if (pc - frame.codeAddress >= frame.codeByteCount) {
		hardHalt();
		return nullptr;
	}
	const u32 pageAddress = pc & ~MAPPED_PAGE_BYTE_MASK;
	if (frame.decodedPage
		&& frame.decodedPageAddress == pageAddress) {
		return frame.decodedPage;
	}
	MappedPageBinding binding;
	m_memory.bindMappedPage(pageAddress, m_executionBusSignals, binding);
	DecodedInstructionPage& page = decodedPageForAddress(
		*frame.executionImage,
		binding
	);
	frame.decodedPage = &page;
	frame.decodedPageAddress = pageAddress;
	return &page;
}

void CPU::decodeInstruction(
	CallFrame& frame, DecodedInstructionPage& page, u32 pageOffset, u32 pc, bool allowFusion
) {
	const u32 codeEnd = frame.codeAddress + frame.codeByteCount;
	DecodedInstruction& decoded = page.words[pageOffset];
	bool instructionCacheable = page.cacheable;
	DecodedInstructionPage* bodyPage = nullptr;
	int width = 1;
	uint8_t op;
	const u32 faultSequence = m_memory.readBusFaultSequence();
	uint8_t wideA = 0;
	uint8_t wideB = 0;
	uint8_t wideC = 0;
	const uint32_t sourceWord = m_memory.readMappedBusU32BE(pc, m_executionBusSignals);
	if (m_memory.readBusFaultSequence() != faultSequence) {
		hardHalt();
		return;
	}
	uint32_t bodyWord = sourceWord;
	op = static_cast<uint8_t>((sourceWord >> 18) & 0x3f);
	uint8_t ext = static_cast<uint8_t>(sourceWord >> 24);
	if (static_cast<OpCode>(op) == OpCode::WIDE
		&& pc + INSTRUCTION_BYTES < codeEnd) {
		width = 2;
		if (pageOffset == DECODED_PAGE_WORDS - 1u) {
			bodyPage = decodedPageForFrame(
				frame,
				pc + INSTRUCTION_BYTES
			);
			if (!bodyPage) {
				return;
			}
			instructionCacheable = instructionCacheable && bodyPage->cacheable;
		}
		wideA = static_cast<uint8_t>((sourceWord >> 12) & 0x3f);
		wideB = static_cast<uint8_t>((sourceWord >> 6) & 0x3f);
		wideC = static_cast<uint8_t>(sourceWord & 0x3f);
		bodyWord = m_memory.readMappedBusU32BE(
			pc + INSTRUCTION_BYTES,
			m_executionBusSignals
		);
		if (m_memory.readBusFaultSequence() != faultSequence) {
			hardHalt();
			return;
		}
		op = static_cast<uint8_t>((bodyWord >> 18) & 0x3f);
		ext = static_cast<uint8_t>(bodyWord >> 24);
	}
	const bool unchanged = decoded.width != 0u
		&& decoded.sourceWord == sourceWord
		&& decoded.bodyWord == bodyWord
		&& decoded.width == static_cast<uint8_t>(width);
	if (!unchanged) {
		const uint8_t aLow = static_cast<uint8_t>((bodyWord >> 12) & 0x3f);
		const uint8_t bLow = static_cast<uint8_t>((bodyWord >> 6) & 0x3f);
		const uint8_t cLow = static_cast<uint8_t>(bodyWord & 0x3f);
		const bool usesDisp = OPCODE_USES_DISP[op] != 0u;
		const bool usesBx = !usesDisp && OPCODE_USES_BX[op] != 0u;
		const uint8_t extA = usesBx || usesDisp
			? 0
			: static_cast<uint8_t>((ext >> 6) & 0x3);
		const uint8_t extB = usesBx || usesDisp
			? 0
			: static_cast<uint8_t>((ext >> 3) & 0x7);
		const uint8_t extC = usesBx || usesDisp
			? 0
			: static_cast<uint8_t>(ext & 0x7);
		const int aShift = usesDisp
			? MAX_OPERAND_BITS
			: MAX_OPERAND_BITS + (usesBx ? 0 : EXT_A_BITS);
		const int bShift = usesDisp
			? MAX_OPERAND_BITS
			: MAX_OPERAND_BITS + EXT_B_BITS;
		const int cShift = usesDisp
			? MAX_OPERAND_BITS
			: MAX_OPERAND_BITS + EXT_C_BITS;
		const uint32_t bxLow =
			(static_cast<uint32_t>(bLow) << MAX_OPERAND_BITS) | cLow;
		const uint32_t rawB = (static_cast<uint32_t>(wideB) << bShift)
			| (static_cast<uint32_t>(extB) << MAX_OPERAND_BITS)
			| bLow;
		const uint32_t rawC = (static_cast<uint32_t>(wideC) << cShift)
			| (static_cast<uint32_t>(extC) << MAX_OPERAND_BITS)
			| cLow;
		const uint32_t decodedBx =
			(static_cast<uint32_t>(wideB) << (MAX_BX_BITS + EXT_BX_BITS))
			| (static_cast<uint32_t>(usesBx ? ext : 0) << MAX_BX_BITS)
			| bxLow;
		const int32_t decodedSbx = signExtend(
			decodedBx,
			MAX_BX_BITS + EXT_BX_BITS + ((width - 1) * MAX_OPERAND_BITS)
		);
		decoded.sourceWord = sourceWord;
		decoded.bodyWord = bodyWord;
		decoded.op = op;
		decoded.width = static_cast<uint8_t>(width);
		decoded.a = static_cast<uint16_t>(
			(wideA << aShift) | (extA << MAX_OPERAND_BITS) | aLow
		);
		decoded.b = static_cast<uint16_t>(rawB);
		decoded.c = static_cast<uint16_t>(rawC);
		switch (static_cast<OpCode>(op)) {
			case OpCode::GETGL:
			case OpCode::SETGL:
				decoded.bx = frame.executionImage->globalSlots[decodedBx];
				break;
			case OpCode::GETSYS:
			case OpCode::SETSYS:
				decoded.bx = frame.executionImage->systemGlobalSlots[decodedBx];
				break;
			case OpCode::JMP:
			case OpCode::JMPIF:
			case OpCode::JMPIFNOT:
				decoded.bx = pc
					+ static_cast<u32>(width * INSTRUCTION_BYTES)
					+ static_cast<u32>(decodedSbx * INSTRUCTION_BYTES);
				break;
			default:
				decoded.bx = decodedBx;
				break;
		}
		decoded.sbx = decodedSbx;
		decoded.rkB = signExtend(
			rawB,
			MAX_OPERAND_BITS + EXT_B_BITS + ((width - 1) * MAX_OPERAND_BITS)
		);
		decoded.rkC = signExtend(
			rawC,
			MAX_OPERAND_BITS + EXT_C_BITS + ((width - 1) * MAX_OPERAND_BITS)
		);
		decoded.disp = ext;
		if (static_cast<OpCode>(op) == OpCode::GETI
			|| static_cast<OpCode>(op) == OpCode::GETFIELD
			|| static_cast<OpCode>(op) == OpCode::SELF) {
			if (decoded.tableCacheIndex == UINT32_MAX) {
				decoded.tableCacheIndex = static_cast<uint32_t>(
					page.tableLoadCaches.size()
				);
				page.tableLoadCaches.emplace_back();
			} else {
				page.tableLoadCaches[decoded.tableCacheIndex] = TableLoadInlineCache{};
			}
		}
	}
	decoded.dispatchOp = op;
	page.decodeRequired[pageOffset] = instructionCacheable ? 0u : 1u;
	if (instructionCacheable && page.writeWatch) {
		*page.writeWatch = 1u;
	}
	if (instructionCacheable && bodyPage && bodyPage->writeWatch) {
		*bodyPage->writeWatch = 1u;
	}
	const bool fusionCandidate = static_cast<OpCode>(op) == OpCode::SHL
		|| static_cast<OpCode>(op) == OpCode::ADD
		|| static_cast<OpCode>(op) == OpCode::SHR;
	if (!allowFusion) {
		page.fusionRequired[pageOffset] = fusionCandidate && instructionCacheable
			? 1u
			: 0u;
		return;
	}
	if (!fusionCandidate || !instructionCacheable) {
		page.fusionRequired[pageOffset] = 0u;
		return;
	}
	const u32 nextPc = pc + static_cast<u32>(width) * INSTRUCTION_BYTES;
	if (nextPc >= codeEnd) {
		page.fusionRequired[pageOffset] = 0u;
		return;
	}
	DecodedInstructionPage* nextPage = decodedPageForFrame(frame, nextPc);
	if (!nextPage) {
		return;
	}
	if (!nextPage->cacheable) {
		page.fusionRequired[pageOffset] = 0u;
		return;
	}
	const u32 nextOffset = (nextPc & MAPPED_PAGE_BYTE_MASK) >> 2;
	if (decodedInstructionNeedsRefresh(*nextPage, nextOffset, false)) {
		decodeInstruction(frame, *nextPage, nextOffset, nextPc, false);
	}
	if (m_hardHalted) {
		return;
	}
	if (nextPage->decodeRequired[nextOffset] != 0u) {
		page.fusionRequired[pageOffset] = 0u;
		return;
	}
	const DecodedInstruction& successor = nextPage->words[nextOffset];
	decoded.dispatchOp = decodedDispatchOp(op, successor.op);
	page.fusionRequired[pageOffset] = 0u;
}

void CPU::skipNextInstruction(CallFrame& frame) {
	DecodedInstructionPage* page = decodedPageForFrame(frame, frame.pc);
	if (!page) {
		return;
	}
	const u32 offset = (frame.pc & MAPPED_PAGE_BYTE_MASK) >> 2;
	if (decodedInstructionNeedsRefresh(*page, offset, false)) {
		decodeInstruction(frame, *page, offset, frame.pc, false);
	}
	if (m_hardHalted) {
		return;
	}
	const u32 nextPc = frame.pc + static_cast<u32>(page->words[offset].width) * INSTRUCTION_BYTES;
	if (nextPc < frame.codeAddress || nextPc >= frame.codeAddress + frame.codeByteCount) {
		hardHalt();
		return;
	}
	frame.pc = nextPc;
}

bool CPU::readFunctionRecord(
	Blua32ExecutionImage& image,
	u32 address,
	MappedBusSignals busSignals
) {
	m_functionRecordLatch.image = &image;
	m_functionRecordLatch.busSignals = busSignals;
	m_functionRecordLatch.address = address;
	const u32 pageOffset = address & MAPPED_PAGE_BYTE_MASK;
	if (pageOffset <= MAPPED_PAGE_BYTE_SIZE - BLUA32_FUNCTION_RECORD_SIZE) {
		MappedPageBinding binding;
		m_memory.bindMappedPage(address & ~MAPPED_PAGE_BYTE_MASK, busSignals, binding);
		if (binding.readBytes) {
			const u8* record = binding.readBytes + pageOffset;
			m_functionRecordLatch.codeAddress = readLE32(
				record + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET
			);
			m_functionRecordLatch.codeByteCount = readLE32(
				record + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET
			);
			m_functionRecordLatch.numParams = readLE32(
				record + BLUA32_FUNCTION_NUM_PARAMS_OFFSET
			);
			m_functionRecordLatch.maxStack = readLE32(
				record + BLUA32_FUNCTION_MAX_STACK_OFFSET
			);
			m_functionRecordLatch.flags = readLE32(
				record + BLUA32_FUNCTION_FLAGS_OFFSET
			);
			m_functionRecordLatch.upvalueTableAddress = readLE32(
				record + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET
			);
			m_functionRecordLatch.upvalueCount = readLE32(
				record + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET
			);
			return true;
		}
	}
	const u32 faultSequence = m_memory.readBusFaultSequence();
	m_functionRecordLatch.codeAddress = m_memory.readMappedBusU32LE(
		address + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET,
		busSignals
	);
	m_functionRecordLatch.codeByteCount = m_memory.readMappedBusU32LE(
		address + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET,
		busSignals
	);
	m_functionRecordLatch.numParams = m_memory.readMappedBusU32LE(
		address + BLUA32_FUNCTION_NUM_PARAMS_OFFSET,
		busSignals
	);
	m_functionRecordLatch.maxStack = m_memory.readMappedBusU32LE(
		address + BLUA32_FUNCTION_MAX_STACK_OFFSET,
		busSignals
	);
	m_functionRecordLatch.flags = m_memory.readMappedBusU32LE(
		address + BLUA32_FUNCTION_FLAGS_OFFSET,
		busSignals
	);
	m_functionRecordLatch.upvalueTableAddress = m_memory.readMappedBusU32LE(
		address + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET,
		busSignals
	);
	m_functionRecordLatch.upvalueCount = m_memory.readMappedBusU32LE(
		address + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET,
		busSignals
	);
	return m_memory.readBusFaultSequence() == faultSequence;
}

bool CPU::readFunctionRecordOnBus(
	Blua32ExecutionImage& ambientExecutionImage,
	u32 address,
	MappedBusSignals busSignals
) {
	const std::optional<ExecutionDomainId> executionDomainId =
		m_executionAddressSpace.domainIdOnBus(address, busSignals);
	Blua32ExecutionImage* image = executionDomainId
		? executionImageForDomain(*executionDomainId)
		: &ambientExecutionImage;
	return image && readFunctionRecord(*image, address, busSignals);
}

void CPU::executeFunctionAddress(u32 functionAddress) {
	if (!readFunctionRecordOnBus(
		*m_activeExecutionImage,
		functionAddress,
		MAPPED_BUS_MASTER_CPU
	)
		|| (m_functionRecordLatch.flags & BLUA32_FUNCTION_STATIC) == 0u) {
		hardHalt();
		return;
	}
	clearCallStack();
	latchActiveExecutionImage(*m_functionRecordLatch.image);
	m_statusWord = m_functionRecordLatch.image->executionDomainId >= 0
		? CPU_STATUS_CART_ENTRY
		: CPU_STATUS_SYSTEM_ENTRY;
	m_haltedUntilIrqFrameDepth = -1;
	m_interruptEventPending = false;
	m_memoryWriteBlocked = false;
	m_memoryWriteBlockedAddress = 0u;
	m_hardHalted = false;
	m_yieldRequested = false;
	Closure* closure = staticClosureAtAddress(functionAddress);
	pushLatchedFrame(closure, nullptr, 0, 0, 0, false);
}

void CPU::beginCompletionCall(Closure& closure, BuiltinArgsView args) {
	m_completionValues.clear();
	m_yieldRequested = false;
	pushFrame(&closure, args.data(), args.size(), 0, 0, true);
}

void CPU::beginCompletionCallInExecutionDomain(
	ExecutionDomainId executionDomainId,
	u32 functionAddress
) {
	m_completionValues.clear();
	m_yieldRequested = false;
	readFunctionRecord(
		*executionImageForDomain(executionDomainId),
		functionAddress,
		executionBusSignalsForDomain(executionDomainId)
	);
	pushLatchedFrame(
		staticClosureAtAddress(functionAddress),
		nullptr,
		0,
		0,
		0,
		true
	);
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
		if (valueIsTable(value)) {
			state.tag = CpuValueStateTag::Table;
			state.refId = ensureObjectId(asTable(value));
			return state;
		}
		if (valueIsClosure(value)) {
			state.tag = CpuValueStateTag::Closure;
			state.refId = ensureObjectId(asClosure(value));
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
		state.systemGlobals.push_back(CpuRootValueState{
			m_stringPool.toString(m_systemGlobalNames[index]),
			captureValueState(value),
		});
	}
	globals->forEachEntry([&](Value key, Value value) {
		if (!valueIsString(key)) {
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
	state.completionValues.reserve(m_completionValues.size());
	for (const Value& value : m_completionValues) {
		state.completionValues.push_back(captureValueState(value));
	}
	for (const auto& frame : m_frames) {
		for (Upvalue* upvalue = frame->openUpvalueHead; upvalue; upvalue = upvalue->nextOpen) {
			state.openUpvalues.push_back(ensureObjectId(upvalue));
		}
	}
	state.stringIndexTable = captureValueState(
		m_stringIndexTable ? valueTable(m_stringIndexTable) : valueNil()
	);
	state.objects = std::move(objects);
	state.lastExecutionDomainId = m_lastExecutionDomainId;
	state.lastPc = lastPc;
	state.instructionBudgetRemaining = instructionBudgetRemaining;
	state.haltedUntilIrqFrameDepth = m_haltedUntilIrqFrameDepth;
	state.interruptEventPending = m_interruptEventPending;
	state.memoryWriteBlocked = m_memoryWriteBlocked;
	state.memoryWriteBlockedAddress = m_memoryWriteBlockedAddress;
	state.statusWord = m_statusWord;
	state.causeWord = m_causeWord;
	state.epcWord = m_epcWord;
	state.badAddressWord = m_badAddressWord;
	state.luaFaultReasonWord = m_luaFaultReasonWord;
	state.exceptionDomainWord = m_exceptionDomainWord;
	state.nmiReturnCauseWord = m_nmiReturnCauseWord;
	state.nmiReturnEpcWord = m_nmiReturnEpcWord;
	state.nmiReturnBadAddressWord = m_nmiReturnBadAddressWord;
	state.nmiReturnLuaFaultReasonWord = m_nmiReturnLuaFaultReasonWord;
	state.nmiReturnExceptionDomainWord = m_nmiReturnExceptionDomainWord;
	state.nonMaskableInterruptPending = m_nonMaskableInterruptPending;
	state.yieldRequested = m_yieldRequested;
	return state;
}

void CPU::restoreRuntimeState(const CpuRuntimeState& state) {
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
				m_luaHeap.restoreAllocate(Table::trackedHeapBytesForCapacities(0, 0));
				restoredObjects[index].table = m_heap.allocate<Table>(ObjType::Table, m_luaHeap, 0, 0);
				restoredObjects[index].table->hashId = objectState.hashId;
				m_heap.observeHashId(objectState.hashId);
				break;
			case CpuObjectState::Kind::Closure: {
				const size_t upvalueCount = objectState.upvalues.size();
				if (objectState.closureCanonical) {
					restoredObjects[index].closure = staticClosureAtAddress(objectState.functionAddress);
				} else {
					const size_t heapBytes = kClosureHeapBytes + (upvalueCount * kClosureUpvalueSlotHeapBytes);
					m_luaHeap.restoreAllocate(heapBytes);
					restoredObjects[index].closure = allocateTrackedClosure(objectState.functionAddress, upvalueCount);
				}
				restoredObjects[index].closure->hashId = objectState.hashId;
				m_heap.observeHashId(objectState.hashId);
				break;
			}
			case CpuObjectState::Kind::Upvalue: {
				m_luaHeap.restoreAllocate(kUpvalueHeapBytes);
				auto* upvalue = m_heap.allocate<Upvalue>(ObjType::Upvalue);
				upvalue->open = false;
				upvalue->index = objectState.upvalueIndex;
				upvalue->frame = nullptr;
				upvalue->value = valueNil();
				upvalue->hashId = objectState.hashId;
				m_heap.observeHashId(objectState.hashId);
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
			case CpuValueStateTag::Table:
				return valueTable(restoredObjects[static_cast<size_t>(valueState.refId)].table);
			case CpuValueStateTag::Closure:
				return valueClosure(restoredObjects[static_cast<size_t>(valueState.refId)].closure);
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
				m_heap.observeHashId(restoredObjects[index].table->restoreRuntimeState(tableState));
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

	m_completionValues.clear();
	clearCallStack();
	globals->clear();
	globals->prepareRestoreStorage(0, Table::hashCapacity(static_cast<int>(state.globals.size())));
	latchActiveExecutionImage(*executionImage);
	for (Value& value : m_systemGlobalValues) {
		value = valueNil();
	}
	for (Value& value : m_globalValues) {
		value = valueNil();
	}

	for (const CpuFrameState& frameState : state.frames) {
		readFunctionRecordOnBus(
			*executionImage,
			frameState.functionAddress,
			m_executionBusSignals
		);
		const Blua32FunctionRecordLatch& functionRecord = m_functionRecordLatch;
		auto frame = acquireFrame();
		frame->functionAddress = frameState.functionAddress;
		frame->executionImage = functionRecord.image;
		frame->codeAddress = functionRecord.codeAddress;
		frame->codeByteCount = functionRecord.codeByteCount;
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
		size_t targetCapacity = nextPowerOfTwo(
			static_cast<size_t>(std::max(functionRecord.maxStack, 1u))
		);
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
		linkOpenUpvalue(*frame, upvalue);
	}

	for (const CpuRootValueState& entry : state.systemGlobals) {
		setSystemGlobalByKey(m_stringPool.intern(entry.name), restoreValue(entry.value));
	}
	for (const CpuRootValueState& entry : state.globals) {
		setGlobalByKey(m_stringPool.intern(entry.name), restoreValue(entry.value));
	}
	const Value stringIndexTable = restoreValue(state.stringIndexTable);
	m_stringIndexTable = isNil(stringIndexTable) ? nullptr : asTable(stringIndexTable);
	m_completionValues.reserve(state.completionValues.size());
	for (const CpuValueState& valueState : state.completionValues) {
		m_completionValues.push_back(restoreValue(valueState));
	}
	m_lastExecutionDomainId = state.lastExecutionDomainId;
	lastPc = state.lastPc;
	instructionBudgetRemaining = state.instructionBudgetRemaining;
	m_haltedUntilIrqFrameDepth = state.haltedUntilIrqFrameDepth;
	m_interruptEventPending = state.interruptEventPending;
	m_memoryWriteBlocked = state.memoryWriteBlocked;
	m_memoryWriteBlockedAddress = state.memoryWriteBlockedAddress;
	m_statusWord = state.statusWord;
	m_causeWord = state.causeWord;
	m_epcWord = state.epcWord;
	m_badAddressWord = state.badAddressWord;
	m_luaFaultReasonWord = state.luaFaultReasonWord;
	m_exceptionDomainWord = state.exceptionDomainWord;
	m_nmiReturnCauseWord = state.nmiReturnCauseWord;
	m_nmiReturnEpcWord = state.nmiReturnEpcWord;
	m_nmiReturnBadAddressWord = state.nmiReturnBadAddressWord;
	m_nmiReturnLuaFaultReasonWord = state.nmiReturnLuaFaultReasonWord;
	m_nmiReturnExceptionDomainWord = state.nmiReturnExceptionDomainWord;
	m_nonMaskableInterruptPending = state.nonMaskableInterruptPending;
	m_yieldRequested = state.yieldRequested;
	collectHeap();
}

void CPU::requestYield() {
	m_yieldRequested = true;
}

void CPU::haltUntilIrq() {
	if (m_interruptEventPending) {
		m_interruptEventPending = false;
		return;
	}
	m_haltedUntilIrqFrameDepth = static_cast<int>(m_frames.size());
	m_yieldRequested = false;
}

void CPU::hardHalt() {
	m_hardHalted = true;
	m_haltedUntilIrqFrameDepth = -1;
	m_yieldRequested = false;
}


void CPU::callBuiltinFunction(BuiltinFunction& fn, BuiltinArgsView args, BuiltinResults& out) {
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
		case BuiltinFunctionId::SetStringIndex:
			if (!valueIsTable(args[0])) {
				throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			}
			m_stringIndexTable = asTable(args[0]);
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
	auto outScratch = acquireBuiltinResultScratch();
	BuiltinResults& out = outScratch.get();
	const BuiltinArgsView args(frame.registers + static_cast<size_t>(callBase + 1), static_cast<size_t>(argCount));
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
		if (!valueIsClosure(handler) && !valueIsBuiltinFunction(handler)) {
			throw LuaExecutionError(LUA_FAULT_REASON_XPCALL_HANDLER_NOT_FUNCTION);
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
		auto resultsScratch = acquireBuiltinResultScratch();
		BuiltinResults& results = resultsScratch.get();
		callBuiltinFunction(
			builtin,
			BuiltinArgsView(caller.registers + static_cast<size_t>(argumentBase), static_cast<size_t>(argumentCount)),
			results
		);
		finishProtectedCall(continuationIndex, results.data(), static_cast<int>(results.size()));
		return;
	}
	throw LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
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
				? m_errorInErrorHandlingValue
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
			errorValue = m_luaFaultErrorValues[handlerError.reason];
		}
	}
}

void CPU::runBuiltinNextValue(Value target, Value key, BuiltinResults& out) {
	if (!valueIsTable(target)) {
		throw LuaExecutionError(LUA_FAULT_REASON_ITERATE_NON_TABLE);
	}
	Value nextKey;
	Value nextValue;
	if (!asTable(target)->nextEntry(key, nextKey, nextValue)) {
		out.push_back(valueNil());
		return;
	}
	out.push_back(nextKey);
	out.push_back(nextValue);
}

void CPU::runBuiltinSetMetatable(BuiltinArgsView args, BuiltinResults& out) {
	const Value target = args[0];
	if (!valueIsTable(target)) {
		throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	}
	const Value metatableValue = args[1];
	Table* metatable = nullptr;
	if (valueIsTable(metatableValue)) {
		metatable = asTable(metatableValue);
	} else if (!isNil(metatableValue)) {
		throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	}
	Table* table = asTable(target);
	table->metatable = metatable;
	table->bumpVersion();
	out.push_back(target);
}

void CPU::runBuiltinGetMetatable(BuiltinArgsView args, BuiltinResults& out) {
	const Value target = args[0];
	if (!valueIsTable(target)) {
		throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	}
	Table* metatable = asTable(target)->metatable;
	out.push_back(metatable ? valueTable(metatable) : valueNil());
}

void CPU::runBuiltinRawGet(BuiltinArgsView args, BuiltinResults& out) {
	const Value target = args[0];
	if (!valueIsTable(target)) {
		throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	}
	Table* table = asTable(target);
	out.push_back(table->get(args[1]));
}

void CPU::runBuiltinRawSet(BuiltinArgsView args, BuiltinResults& out) {
	const Value target = args[0];
	if (!valueIsTable(target)) {
		throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	}
	Table* table = asTable(target);
	table->set(args[1], args[2]);
	out.push_back(valueTable(table));
}

void CPU::runBuiltinSelect(BuiltinArgsView args, BuiltinResults& out) {
	const Value selector = args[0];
	if (valueIsString(selector)) {
		if (m_stringPool.toString(asStringId(selector)) == "#") {
			out.push_back(valueNumber(static_cast<double>(args.size() - 1)));
			return;
		}
		throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	}
	if (!valueIsNumber(selector)) {
		throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	}
	const int count = static_cast<int>(args.size()) - 1;
	int start = toI32(selector);
	if (start < 0) {
		start = count + start + 1;
	}
	for (int index = start; index <= count; ++index) {
		if (index >= 1 && static_cast<size_t>(index) < args.size()) {
			out.push_back(args[static_cast<size_t>(index)]);
		}
	}
}

void CPU::runBuiltinStringByte(BuiltinArgsView args, BuiltinResults& out) {
	const Value sourceValue = args[0];
	if (!valueIsString(sourceValue)) {
		throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	}
	const std::string& source = m_stringPool.toString(asStringId(sourceValue));
	int position = 1;
	if (args.size() > 1) {
		const Value positionValue = args[1];
		if (!isNil(positionValue)) {
			if (!valueIsNumber(positionValue)) {
				throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			}
			position = toI32(positionValue);
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

void CPU::runBuiltinStringChar(BuiltinArgsView args, BuiltinResults& out) {
	std::string result;
	result.reserve(args.size());
	for (const auto& arg : args) {
		if (!valueIsNumber(arg)) {
			throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		}
		const uint32_t codepoint = toU32(arg);
		if (codepoint > 0x10ffffu || (codepoint >= 0xd800u && codepoint <= 0xdfffu)) {
			throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		}
		appendUtf8Codepoint(result, codepoint);
	}
	out.push_back(valueString(m_stringPool.intern(result)));
}

void CPU::runBuiltinError(BuiltinArgsView args) {
	const Value value = args[0];
	throw LuaThrownValueError(value);
}

void CPU::clearHaltUntilIrq() {
	m_haltedUntilIrqFrameDepth = -1;
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
		const bool hadHaltLatch = m_haltedUntilIrqFrameDepth >= 0;
		const u32 returnCauseWord = m_causeWord;
		const u32 returnEpcWord = m_epcWord;
		const u32 returnBadAddressWord = m_badAddressWord;
		const u32 returnLuaFaultReasonWord = m_luaFaultReasonWord;
		const u32 returnExceptionDomainWord = m_exceptionDomainWord;
		enterException(
			m_systemExceptionFunctionAddress,
			CPU_CAUSE_NMI,
			m_frames.back()->pc
		);
		m_frames.back()->isNonMaskableExceptionFrame = true;
		m_nmiReturnCauseWord = returnCauseWord;
		m_nmiReturnEpcWord = returnEpcWord;
		m_nmiReturnBadAddressWord = returnBadAddressWord;
		m_nmiReturnLuaFaultReasonWord = returnLuaFaultReasonWord;
		m_nmiReturnExceptionDomainWord = returnExceptionDomainWord;
		if (!hadHaltLatch) m_interruptEventPending = true;
		return true;
	}
	if (canAcceptMaskableInterruptLine()) {
		Blua32ExecutionImage& image = isUserMode() ? *m_activeExecutionImage : *m_systemImage;
		const bool hadHaltLatch = m_haltedUntilIrqFrameDepth >= 0;
		enterException(image.irqFunctionAddress, CPU_CAUSE_IRQ, m_frames.back()->pc);
		if (!hadHaltLatch) m_interruptEventPending = true;
		return true;
	}
	return false;
}

void CPU::enterSynchronousException(CallFrame& interruptedFrame, u32 causeWord) {
	interruptedFrame.pc = m_currentInstructionPc;
	enterException(m_systemExceptionFunctionAddress, causeWord, m_currentInstructionPc);
}

void CPU::enterSynchronousAddressException(CallFrame& interruptedFrame, u32 causeWord, u32 address) {
	m_badAddressWord = address;
	enterSynchronousException(interruptedFrame, causeWord);
}

void CPU::enterLuaFaultException(u32 reason, Value errorValue) {
	m_luaFaultReasonWord = reason;
	enterSynchronousException(*m_frames.back(), CPU_CAUSE_CODE_TRAP);
	m_frames.back()->registers[0] = errorValue;
}

void CPU::enterException(
	u32 functionAddress,
	u32 causeWord,
	u32 epcWord
) {
	m_exceptionDomainWord = static_cast<u32>(m_frames.back()->executionImage->executionDomainId);
	m_epcWord = epcWord;
	m_causeWord = causeWord;
	m_statusWord = (m_statusWord & ~CPU_STATUS_MODE_STACK_MASK)
		| ((m_statusWord << 2u) & CPU_STATUS_MODE_STACK_MASK);
	clearHaltAfterAcceptedInterrupt();
	Closure* closure = staticClosureAtAddress(functionAddress);
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
	m_haltedUntilIrqFrameDepth = -1;
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

template <bool RootBoundary, bool Instrumented>
RunResult CPU::runLoop(
	int targetDepth,
	int instructionBudget
) {
	instructionBudgetRemaining = instructionBudget;
	auto& frames = m_frames;
	ExecutionHookBinding hookBinding;
	if constexpr (Instrumented) {
		hookBinding = m_executionHookBinding;
	}
	CallFrame* frame = nullptr;
	Blua32ExecutionImage* image = nullptr;
	const DecodedInstruction* decoded;
	u32 pc = 0;
	int a = 0;
	int b = 0;
	int c = 0;
	uint32_t bx = 0;
	int sbx = 0;
	int rkB = 0;
	int rkC = 0;
	int disp = 0;
	Value* registers = nullptr;
	for (;;) {
		try {
			if constexpr (RootBoundary) {
				if (frames.empty()) {
					return RunResult::Halted;
				}
			} else {
				if (static_cast<int>(frames.size()) <= targetDepth) {
					return RunResult::Halted;
				}
			}
			if (m_hardHalted
				|| m_haltedUntilIrqFrameDepth == static_cast<int>(frames.size())
				|| m_memoryWriteBlocked) {
				return RunResult::Halted;
			}
			if (m_yieldRequested) {
				m_yieldRequested = false;
				return RunResult::Yielded;
			}
			if (instructionBudgetRemaining <= 0) {
				return RunResult::Yielded;
			}
			if constexpr (Instrumented) {
				if (m_nonMaskableInterruptPending) {
					enterPendingInterrupt();
					continue;
				}
				if ((m_statusWord & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) != 0u
					&& m_irqController.hasAssertedMaskableInterruptLine()) {
					CallFrame* interruptedFrame = frames.back().get();
					Blua32ExecutionImage* interruptedImage = interruptedFrame->executionImage;
					if ((hookBinding.preMaskableInterruptDomainMask
						& executionDomainBit(interruptedImage->executionDomainId)) != 0u
						&& hookBinding.hook(
							hookBinding.context,
							interruptedImage->executionDomainId,
							interruptedFrame->pc
						)) {
						return RunResult::ExecutionStopped;
					}
					enterPendingInterrupt();
					continue;
				}
			} else {
				if (m_nonMaskableInterruptPending
					|| ((m_statusWord & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) != 0u
						&& m_irqController.hasAssertedMaskableInterruptLine())) {
					enterPendingInterrupt();
					continue;
				}
			}
			frame = frames.back().get();
			image = frame->executionImage;
			registers = frame->registers;
			pc = frame->pc;
			if (pc - frame->codeAddress >= frame->codeByteCount) {
				hardHalt();
				return RunResult::Halted;
			}
			const u32 pageAddress = pc & ~MAPPED_PAGE_BYTE_MASK;
			DecodedInstructionPage* decodedPage = frame->decodedPage;
			if (!decodedPage || frame->decodedPageAddress != pageAddress) {
				decodedPage = decodedPageForFrame(*frame, pc);
				if (!decodedPage) return RunResult::Halted;
			}
			if constexpr (Instrumented) {
				if ((hookBinding.domainMask & executionDomainBit(image->executionDomainId)) != 0u
					&& hookBinding.hook(hookBinding.context, image->executionDomainId, pc)) {
					return RunResult::ExecutionStopped;
				}
			}
			const u32 pageOffset = (pc & MAPPED_PAGE_BYTE_MASK) >> 2;
			if (decodedInstructionNeedsRefresh(
				*decodedPage,
				pageOffset,
				!Instrumented
			)) {
				decodeInstruction(
					*frame,
					*decodedPage,
					pageOffset,
					pc,
					!Instrumented
				);
			}
			if (m_hardHalted) return RunResult::Halted;
			decoded = &decodedPage->words[pageOffset];
			m_currentInstructionPc = pc;
			frame->pc = pc + (static_cast<u32>(decoded->width) * INSTRUCTION_BYTES);
			m_lastExecutionDomainId = image->executionDomainId;
			lastPc = pc + ((static_cast<u32>(decoded->width) - 1u) * INSTRUCTION_BYTES);
			uint8_t dispatchOp;
			if constexpr (Instrumented) {
				dispatchOp = decoded->op;
				instructionBudgetRemaining -= static_cast<int>(BASE_CYCLES[dispatchOp]);
			} else {
				dispatchOp = decoded->dispatchOp;
				instructionBudgetRemaining -= static_cast<int>(
					DECODED_DISPATCH_BASE_CYCLES[dispatchOp]
				);
			}
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
#define DISPATCH_LABEL(name) case static_cast<uint8_t>(OpCode::name):
#define DISPATCH_CONTINUE() do { goto dispatch_continue; } while (0)
#define DISPATCH_BLOCKED() do { return RunResult::Halted; } while (0)

			if constexpr (Instrumented) {
				switch (dispatchOp) {
#include "machine/cpu/cpu_dispatch.inl"
				}
			} else {
				switch (dispatchOp) {
				case static_cast<uint8_t>(DecodedDispatchOp::FusedShlBxor):
				case static_cast<uint8_t>(DecodedDispatchOp::FusedShrBxor): {
					const Value& shiftLeftValue = readRK(FRAME, rkB);
					const Value& shiftRightValue = readRK(FRAME, rkC);
					const int32_t shifted = dispatchOp
						== static_cast<uint8_t>(DecodedDispatchOp::FusedShlBxor)
						? static_cast<int32_t>(
							toU32(shiftLeftValue) << (toU32(shiftRightValue) & 31u)
						)
						: toI32(shiftLeftValue) >> (toU32(shiftRightValue) & 31u);
					SET_REGISTER_FAST(
						a,
						valueNumber(static_cast<double>(shifted))
					);
					if (instructionBudgetRemaining <= 0) {
						DISPATCH_CONTINUE();
					}
					const u32 successorPc = FRAME.pc;
					DecodedInstructionPage* successorPage = decodedPageForFrame(FRAME, successorPc);
					if (!successorPage) {
						return RunResult::Halted;
					}
					const u32 successorOffset = (successorPc & MAPPED_PAGE_BYTE_MASK) >> 2;
					if (decodedInstructionNeedsRefresh(
						*successorPage,
						successorOffset,
						false
					)) {
						decodeInstruction(
							FRAME,
							*successorPage,
							successorOffset,
							successorPc,
							false
						);
					}
					if (m_hardHalted) {
						return RunResult::Halted;
					}
					decoded = &successorPage->words[successorOffset];
					m_currentInstructionPc = successorPc;
					FRAME.pc = successorPc
						+ (static_cast<u32>(decoded->width) * INSTRUCTION_BYTES);
					m_lastExecutionDomainId = IMAGE.executionDomainId;
					lastPc = successorPc
						+ ((static_cast<u32>(decoded->width) - 1u) * INSTRUCTION_BYTES);
					instructionBudgetRemaining -= static_cast<int>(
						BASE_CYCLES[static_cast<size_t>(OpCode::BXOR)]
					);
					const Value& xorLeftValue = readRK(FRAME, decoded->rkB);
					const Value& xorRightValue = readRK(FRAME, decoded->rkC);
					const int32_t xorResult = static_cast<int32_t>(
						toU32(xorLeftValue) ^ toU32(xorRightValue)
					);
					SET_REGISTER_FAST(
						decoded->a,
						valueNumber(static_cast<double>(xorResult))
					);
					DISPATCH_CONTINUE();
				}
				case static_cast<uint8_t>(DecodedDispatchOp::FusedAddShl): {
					const Value& addLeftValue = readRK(FRAME, rkB);
					const Value& addRightValue = readRK(FRAME, rkC);
					SET_REGISTER_FAST(
						a,
						valueNumber(asNumber(addLeftValue) + asNumber(addRightValue))
					);
					if (instructionBudgetRemaining <= 0) {
						DISPATCH_CONTINUE();
					}
					const u32 successorPc = FRAME.pc;
					DecodedInstructionPage* successorPage = decodedPageForFrame(FRAME, successorPc);
					if (!successorPage) {
						return RunResult::Halted;
					}
					const u32 successorOffset = (successorPc & MAPPED_PAGE_BYTE_MASK) >> 2;
					if (decodedInstructionNeedsRefresh(
						*successorPage,
						successorOffset,
						false
					)) {
						decodeInstruction(
							FRAME,
							*successorPage,
							successorOffset,
							successorPc,
							false
						);
					}
					if (m_hardHalted) {
						return RunResult::Halted;
					}
					decoded = &successorPage->words[successorOffset];
					m_currentInstructionPc = successorPc;
					FRAME.pc = successorPc
						+ (static_cast<u32>(decoded->width) * INSTRUCTION_BYTES);
					m_lastExecutionDomainId = IMAGE.executionDomainId;
					lastPc = successorPc
						+ ((static_cast<u32>(decoded->width) - 1u) * INSTRUCTION_BYTES);
					instructionBudgetRemaining -= static_cast<int>(
						BASE_CYCLES[static_cast<size_t>(OpCode::SHL)]
					);
					const Value& shiftLeftValue = readRK(FRAME, decoded->rkB);
					const Value& shiftRightValue = readRK(FRAME, decoded->rkC);
					const uint32_t shifted = toU32(shiftLeftValue)
						<< (toU32(shiftRightValue) & 31u);
					SET_REGISTER_FAST(
						decoded->a,
						valueNumber(static_cast<double>(static_cast<int32_t>(shifted)))
					);
					DISPATCH_CONTINUE();
				}
#include "machine/cpu/cpu_dispatch.inl"
				}
			}

dispatch_continue:
#undef DISPATCH_BLOCKED
#undef DISPATCH_CONTINUE
#undef DISPATCH_LABEL
#undef SKIP_NEXT_INSTRUCTION
#undef TABLE_CACHE_INDEX
#undef SET_REGISTER_FAST
#undef CYCLES_ADD
#undef REG
#undef IMAGE
#undef FRAME
			continue;
		} catch (const LuaOutOfMemorySignal&) {
			if (!handleProtectedCallError(m_luaFaultErrorValues[LUA_FAULT_REASON_OUT_OF_MEMORY])) {
				enterLuaFaultException(
					LUA_FAULT_REASON_OUT_OF_MEMORY,
					m_luaFaultErrorValues[LUA_FAULT_REASON_OUT_OF_MEMORY]
				);
			}
		} catch (const LuaThrownValueError& error) {
			if (!handleProtectedCallError(error.value)) {
				enterLuaFaultException(LUA_FAULT_REASON_EXPLICIT_ERROR, error.value);
			}
		} catch (const LuaExecutionError& error) {
			const Value errorValue = m_luaFaultErrorValues[error.reason];
			if (!handleProtectedCallError(errorValue)) {
				enterLuaFaultException(error.reason, errorValue);
			}
		}
	}
}

RunResult CPU::runUntilDepthNormal(CPU& cpu, int targetDepth, int instructionBudget) {
	if (targetDepth == 0) {
		return cpu.runLoop<true, false>(targetDepth, instructionBudget);
	}
	return cpu.runLoop<false, false>(targetDepth, instructionBudget);
}

RunResult CPU::runUntilDepthInstrumented(CPU& cpu, int targetDepth, int instructionBudget) {
	if (targetDepth == 0) {
		return cpu.runLoop<true, true>(targetDepth, instructionBudget);
	}
	return cpu.runLoop<false, true>(targetDepth, instructionBudget);
}

void CPU::setExecutionHook(ExecutionHookBinding binding) {
	m_executionHookBinding = binding;
	m_runUntilDepthEntry = binding.hook == nullptr
		? &CPU::runUntilDepthNormal
		: &CPU::runUntilDepthInstrumented;
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
	collectHeap(valueNil(), valueNil(), valueNil());
}

void CPU::collectHeap(Value root0, Value root1, Value root2) {
	m_heap.collect(root0, root1, root2);
	m_luaHeap.finishCollection(m_luaHeap.usedBytes());
}

ExecutionDomainId CPU::readFrameExecutionDomain(int frameIndex) const {
	return m_frames[static_cast<size_t>(frameIndex)]->executionImage->executionDomainId;
}

ExecutionDomainId CPU::readLastExecutionDomain() const {
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

bool CPU::completionCallPending() const {
	for (auto frame = m_frames.rbegin(); frame != m_frames.rend(); ++frame) {
		if ((*frame)->returnToCompletionLatch) {
			return true;
		}
	}
	return false;
}

bool CPU::readFrameReturnsToCompletionLatch(int frameIndex) const {
	return m_frames[static_cast<size_t>(frameIndex)]->returnToCompletionLatch;
}

void CPU::abortCompletionCall(int frameIndex) {
	unwindToDepth(frameIndex);
	m_completionValues.clear();
}

auto CPU::readCompletionValues() const -> std::span<const Value> {
	return m_completionValues;
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

u32 CPU::readCauseWord() const {
	return m_causeWord;
}

u32 CPU::readBadAddressWord() const {
	return m_badAddressWord;
}

u32 CPU::readLuaFaultReasonWord() const {
	return m_luaFaultReasonWord;
}

u32 CPU::readExceptionDomainWord() const {
	return m_exceptionDomainWord;
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
	ExecutionDomainId executionDomainId,
	u32 functionAddress,
	u32 pc
) {
	Blua32ExecutionImage& image = *executionImageForDomain(executionDomainId);
	readFunctionRecord(
		image,
		functionAddress,
		executionBusSignalsForDomain(executionDomainId)
	);
	const Blua32FunctionRecordLatch& functionRecord = m_functionRecordLatch;
	CallFrame& frame = *m_frames[static_cast<size_t>(frameIndex)];
	if (functionRecord.maxStack > static_cast<u32>(frame.stackCapacity)) {
		ensureRegisterCapacity(frame, static_cast<int>(functionRecord.maxStack) - 1);
	}
	if ((functionRecord.flags & BLUA32_FUNCTION_STATIC) != 0u
		&& functionRecord.upvalueCount == 0u) {
		frame.closure = staticClosureAtAddress(functionRecord.address);
	} else {
		frame.closure->functionAddress = functionRecord.address;
	}
	frame.functionAddress = functionRecord.address;
	frame.executionImage = functionRecord.image;
	frame.decodedPage = nullptr;
	frame.decodedPageAddress = 0;
	frame.codeAddress = functionRecord.codeAddress;
	frame.codeByteCount = functionRecord.codeByteCount;
	frame.pc = pc;
}

void CPU::writeFrameCallSitePc(int childFrameIndex, u32 pc) {
	m_frames[static_cast<size_t>(childFrameIndex)]->callSitePc = pc;
}

Upvalue* CPU::findOpenUpvalue(const CallFrame& frame, int index) const {
	Upvalue* upvalue = frame.openUpvalueHead;
	while (upvalue && upvalue->index >= index) {
		if (upvalue->index == index) {
			return upvalue;
		}
		upvalue = upvalue->nextOpen;
	}
	return nullptr;
}

void CPU::linkOpenUpvalue(CallFrame& frame, Upvalue* upvalue) {
	Upvalue** link = &frame.openUpvalueHead;
	while (*link && (*link)->index > upvalue->index) {
		link = &(*link)->nextOpen;
	}
	upvalue->nextOpen = *link;
	*link = upvalue;
}

Closure* CPU::createClosure(CallFrame& frame) {
	const Blua32FunctionRecordLatch& functionRecord = m_functionRecordLatch;
	if ((functionRecord.flags & BLUA32_FUNCTION_STATIC) != 0u
		&& functionRecord.upvalueCount == 0u) {
		return staticClosureAtAddress(functionRecord.address);
	}
	m_closureUpvalueScratch.resize(functionRecord.upvalueCount);
	std::fill(m_closureUpvalueScratch.begin(), m_closureUpvalueScratch.end(), nullptr);
	m_closureUpvalueWordScratch.resize(functionRecord.upvalueCount);
	const u32 faultSequence = m_memory.readBusFaultSequence();
	size_t newUpvalueCount = 0;
	for (u32 index = 0; index < functionRecord.upvalueCount; ++index) {
		const u32 upvalueWord = m_memory.readMappedBusU32LE(
			functionRecord.upvalueTableAddress + index * BLUA32_UPVALUE_RECORD_SIZE,
			functionRecord.busSignals
		);
		if (m_memory.readBusFaultSequence() != faultSequence) {
			m_closureUpvalueScratch.clear();
			m_closureUpvalueWordScratch.clear();
			hardHalt();
			return nullptr;
		}
		m_closureUpvalueWordScratch[index] = upvalueWord;
		const u32 upvalueIndex = upvalueWord & BLUA32_UPVALUE_INDEX_MASK;
		if ((upvalueWord & BLUA32_UPVALUE_IN_STACK_MASK) != 0u) {
			Upvalue* upvalue = findOpenUpvalue(frame, static_cast<int>(upvalueIndex));
			if (upvalue) {
				m_closureUpvalueScratch[index] = upvalue;
			} else {
				newUpvalueCount += 1;
			}
		} else {
			m_closureUpvalueScratch[index] = frame.closure->upvalues[upvalueIndex];
		}
	}
	const size_t closureHeapBytes = kClosureHeapBytes
		+ (static_cast<size_t>(functionRecord.upvalueCount) * kClosureUpvalueSlotHeapBytes);
	m_luaHeap.reserve(closureHeapBytes + (newUpvalueCount * kUpvalueHeapBytes));
	auto* closure = allocateTrackedClosure(
		functionRecord.address,
		functionRecord.upvalueCount
	);
	for (u32 index = 0; index < functionRecord.upvalueCount; ++index) {
		Upvalue* upvalue = m_closureUpvalueScratch[index];
		if (!upvalue) {
			upvalue = m_heap.allocate<Upvalue>(ObjType::Upvalue);
			upvalue->open = true;
			upvalue->index = static_cast<int>(
				m_closureUpvalueWordScratch[index] & BLUA32_UPVALUE_INDEX_MASK
			);
			upvalue->frame = &frame;
			linkOpenUpvalue(frame, upvalue);
		}
		closure->upvalues[index] = upvalue;
	}
	m_closureUpvalueScratch.clear();
	m_closureUpvalueWordScratch.clear();
	return closure;
}

void CPU::closeUpvalues(CallFrame& frame) {
	Upvalue* upvalue = frame.openUpvalueHead;
	frame.openUpvalueHead = nullptr;
	while (upvalue) {
		Upvalue* next = upvalue->nextOpen;
		upvalue->value = frame.registers[static_cast<size_t>(upvalue->index)];
		upvalue->open = false;
		upvalue->frame = nullptr;
		upvalue->nextOpen = nullptr;
		upvalue = next;
	}
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
	if (!readFunctionRecordOnBus(
		*m_activeExecutionImage,
		closure->functionAddress,
		m_executionBusSignals
	)) {
		hardHalt();
		return nullptr;
	}
	const Blua32FunctionRecordLatch& functionRecord = m_functionRecordLatch;
	const int callerArgBase = caller.stackBase + argBase;
	auto frame = acquireFrame();
	frame->functionAddress = closure->functionAddress;
	frame->executionImage = functionRecord.image;
	frame->codeAddress = functionRecord.codeAddress;
	frame->codeByteCount = functionRecord.codeByteCount;
	frame->pc = functionRecord.codeAddress;
	frame->closure = closure;
	frame->returnBase = returnBase;
	frame->returnCount = returnCount;
	frame->returnToCompletionLatch = returnToCompletionLatch;
	frame->callSitePc = callSitePc;
	frame->varargBase = m_stackTop;
	frame->varargCount = (functionRecord.flags & BLUA32_FUNCTION_VARARG) != 0u
		? std::max(argCount - static_cast<int>(functionRecord.numParams), 0)
		: 0;
	frame->stackBase = frame->varargBase + frame->varargCount;
	size_t targetCapacity = nextPowerOfTwo(
		static_cast<size_t>(std::max(functionRecord.maxStack, 1u))
	);
	if (targetCapacity < 8) {
		targetCapacity = 8;
	}
	frame->stackCapacity = static_cast<int>(targetCapacity);
	m_stackTop = frame->stackBase + frame->stackCapacity;
	ensureStackSize(static_cast<size_t>(m_stackTop));
	frame->registers = m_stack.data() + frame->stackBase;
	frame->top = static_cast<int>(functionRecord.numParams);

	for (int i = 0; i < static_cast<int>(functionRecord.numParams); ++i) {
		if (i < argCount) {
			frame->registers[static_cast<size_t>(i)] = m_stack[static_cast<size_t>(callerArgBase + i)];
		} else {
			frame->registers[static_cast<size_t>(i)] = valueNil();
		}
	}
	if ((functionRecord.flags & BLUA32_FUNCTION_VARARG) != 0u) {
		for (int i = 0; i < frame->varargCount; ++i) {
			m_stack[static_cast<size_t>(frame->varargBase + i)] = m_stack[
				static_cast<size_t>(callerArgBase + static_cast<int>(functionRecord.numParams) + i)
			];
		}
	}
	CallFrame* pushed = frame.get();
	m_frames.push_back(std::move(frame));
	return pushed;
}

CallFrame* CPU::pushFrame(Closure* closure, const Value* args, size_t argCount,
	int returnBase, int returnCount, bool returnToCompletionLatch) {
	if (!readFunctionRecordOnBus(
		*m_activeExecutionImage,
		closure->functionAddress,
		m_executionBusSignals
	)) {
		hardHalt();
		return nullptr;
	}
	return pushLatchedFrame(
		closure,
		args,
		argCount,
		returnBase,
		returnCount,
		returnToCompletionLatch
	);
}

CallFrame* CPU::pushLatchedFrame(
	Closure* closure,
	const Value* args,
	size_t argCount,
	int returnBase,
	int returnCount,
	bool returnToCompletionLatch
) {
	const Blua32FunctionRecordLatch& functionRecord = m_functionRecordLatch;
	const uintptr_t stackBegin = reinterpret_cast<uintptr_t>(m_stack.data());
	const uintptr_t stackEnd = stackBegin + m_stack.size() * sizeof(Value);
	const uintptr_t argsBegin = reinterpret_cast<uintptr_t>(args);
	const uintptr_t argsEnd = argsBegin + argCount * sizeof(Value);
	const bool argsInStack = argCount > 0 && stackBegin != 0 && argsBegin >= stackBegin && argsEnd <= stackEnd;
	const ptrdiff_t argsOffset = argsInStack ? static_cast<ptrdiff_t>((argsBegin - stackBegin) / sizeof(Value)) : 0;
	auto frame = acquireFrame();
	frame->functionAddress = closure->functionAddress;
	frame->executionImage = functionRecord.image;
	frame->codeAddress = functionRecord.codeAddress;
	frame->codeByteCount = functionRecord.codeByteCount;
	frame->pc = functionRecord.codeAddress;
	frame->closure = closure;
	frame->returnBase = returnBase;
	frame->returnCount = returnCount;
	frame->returnToCompletionLatch = returnToCompletionLatch;
	frame->callSitePc = functionRecord.codeAddress;
	frame->varargBase = m_stackTop;
	frame->varargCount = (functionRecord.flags & BLUA32_FUNCTION_VARARG) != 0u
		? std::max(static_cast<int>(argCount) - static_cast<int>(functionRecord.numParams), 0)
		: 0;
	frame->stackBase = frame->varargBase + frame->varargCount;
	size_t targetCapacity = nextPowerOfTwo(
		static_cast<size_t>(std::max(functionRecord.maxStack, 1u))
	);
	if (targetCapacity < 8) {
		targetCapacity = 8;
	}
	frame->stackCapacity = static_cast<int>(targetCapacity);
	m_stackTop = frame->stackBase + frame->stackCapacity;
	ensureStackSize(static_cast<size_t>(m_stackTop));
	frame->registers = m_stack.data() + frame->stackBase;
	frame->top = static_cast<int>(functionRecord.numParams);
	const Value* sourceArgs = argsInStack ? m_stack.data() + argsOffset : args;

	for (int i = 0; i < static_cast<int>(functionRecord.numParams); ++i) {
		if (i < static_cast<int>(argCount)) {
			frame->registers[static_cast<size_t>(i)] = sourceArgs[i];
		} else {
			frame->registers[static_cast<size_t>(i)] = valueNil();
		}
	}
	if ((functionRecord.flags & BLUA32_FUNCTION_VARARG) != 0u) {
		for (int i = 0; i < frame->varargCount; ++i) {
			m_stack[static_cast<size_t>(frame->varargBase + i)] = sourceArgs[
				static_cast<size_t>(functionRecord.numParams) + static_cast<size_t>(i)
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
		m_memory.writeMappedWord(writeAddr, toU32(frame.registers[static_cast<size_t>(valueBase + offset)]));
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
		return frame.executionImage->constPool[static_cast<size_t>(index)];
	}
	return frame.registers[static_cast<size_t>(rk)];
}

Value CPU::resolveTableIndex(Table* table, const Value& key) {
	Value value;
	if (table->resolveIndex(
		asStringId(m_indexKey),
		key,
		value
	)) {
		return value;
	}
	throw LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
}

Value CPU::resolveTableIntegerIndex(Table* table, int index) {
	Value value;
	if (table->resolveIntegerIndex(
		asStringId(m_indexKey),
		index,
		value
	)) {
		return value;
	}
	throw LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
}

Value CPU::resolveTableFieldIndex(Table* table, StringId key) {
	Value value;
	if (table->resolveStringIndex(
		asStringId(m_indexKey),
		key,
		value
	)) {
		return value;
	}
	throw LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
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
	throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NON_TABLE);
}

Value CPU::loadTableIntegerIndexCached(
	DecodedInstructionPage& page,
	int cacheIndex,
	const Value& base,
	int index
) {
	if (valueIsTable(base)) {
		Table* table = asTable(base);
		if (!table->metatable) {
			TableLoadInlineCache& cache = page.tableLoadCaches[static_cast<size_t>(cacheIndex)];
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
			TableLoadInlineCache& cache = page.tableLoadCaches[static_cast<size_t>(cacheIndex)];
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
	throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NON_TABLE);
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
	throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NON_TABLE);
}

Value CPU::loadTableFieldIndexCached(
	DecodedInstructionPage& page,
	int cacheIndex,
	const Value& base,
	StringId key
) {
	if (valueIsTable(base)) {
		Table* table = asTable(base);
		if (!table->metatable) {
			TableLoadInlineCache& cache = page.tableLoadCaches[static_cast<size_t>(cacheIndex)];
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
			TableLoadInlineCache& cache = page.tableLoadCaches[static_cast<size_t>(cacheIndex)];
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
	throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NON_TABLE);
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
	throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NON_TABLE);
}

void CPU::storeTableIndex(const Value& base, const Value& key, const Value& value) {
	if (valueIsTable(base)) {
		asTable(base)->set(key, value);
		return;
	}
	throw LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
}

void CPU::storeTableIntegerIndex(const Value& base, int index, const Value& value) {
	if (valueIsTable(base)) {
		asTable(base)->setInteger(index, value);
		return;
	}
	throw LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
}

void CPU::storeTableFieldIndex(const Value& base, StringId key, const Value& value) {
	if (valueIsTable(base)) {
		asTable(base)->setStringKey(key, value);
		return;
	}
	throw LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
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
	frame->decodedPage = nullptr;
	frame->decodedPageAddress = 0;
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

BuiltinResultsScratchScope CPU::acquireBuiltinResultScratch() {
	BuiltinResults& out = m_builtinResultScratch.get(m_builtinResultScratchIndex);
	m_builtinResultScratchIndex += 1;
	return BuiltinResultsScratchScope(*this, out);
}

CPU::LocalRootsScope CPU::acquireLocalRoots() {
	return LocalRootsScope(*this);
}

void CPU::releaseLocalRoots(size_t base) {
	m_localRoots.resize(base);
	m_localRootScopeDepth -= 1;
}

void CPU::trackLocalRoot(Value value) {
	if (m_localRootScopeDepth > 0) {
		m_localRoots.push_back(value);
	}
}

void CPU::markRoots(GcHeap& heap) {
	heap.markObject(globals);
	// Keep the interned "__index" key tracked even while no live metatable uses it.
	heap.markValue(m_indexKey);
	heap.markObject(m_stringIndexTable);
	for (const auto& value : m_completionValues) {
		heap.markValue(value);
	}
	for (size_t scratchIndex = 0; scratchIndex < m_builtinResultScratchIndex; ++scratchIndex) {
		BuiltinResults& scratch = m_builtinResultScratch.get(scratchIndex);
		for (size_t valueIndex = 0; valueIndex < scratch.size(); ++valueIndex) {
			heap.markValue(scratch[valueIndex]);
		}
	}
	for (const Value value : m_localRoots) {
		heap.markValue(value);
	}
	for (const auto& value : m_systemGlobalValues) {
		heap.markValue(value);
	}
	for (const auto& value : m_globalValues) {
		heap.markValue(value);
	}
	for (const std::unique_ptr<Blua32ExecutionImage>& executionImage : m_executionImagesByDomain) {
		if (!executionImage) {
			continue;
		}
		Blua32ExecutionImage* image = executionImage.get();
		for (Value value : image->constPool) {
			heap.markValue(value);
		}
		for (auto& entry : image->decodedPages) {
			for (TableLoadInlineCache& cache : entry.second.tableLoadCaches) {
				cache.table = nullptr;
				cache.version = 0;
				cache.value = valueNil();
			}
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
		for (Upvalue* upvalue = frame->openUpvalueHead; upvalue; upvalue = upvalue->nextOpen) {
			heap.markObject(upvalue);
			heap.markValue(frame->registers[static_cast<size_t>(upvalue->index)]);
		}
	}
}

// end repeated-sequence-acceptable

} // namespace bmsx
