#include "machine/cpu/cpu.h"
#if defined(BMSX_NATIVE_COMPILER_WORKER)
#include "machine/cpu/native_compiler_worker.h"
#endif

#include "common/compiler.h"
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#include "machine/cpu/native_execution.h"
#endif
#include "common/endian.h"
#include "machine/common/numeric.h"
#include "spec/blua32/numeric.h"
#include "spec/blua32/pow.h"
#include "machine/devices/irq/controller.h"
#include "spec/blua32/builtin.h"
#include "spec/blua32/image_format.h"
#include "machine/memory/memory.h"
#include "common/utf8.h"
#include <algorithm>
#include <cctype>
#include <stdexcept>
#include <unordered_set>

namespace bmsx {

// start repeated-sequence-acceptable -- CPU interpreter hot paths keep duplicated opcode/register statements inline.

namespace {
constexpr size_t kClosureHeapBytes = 16;
constexpr size_t kClosureUpvalueSlotHeapBytes = 8;

} // namespace

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

CPU::LocalRootsScope::LocalRootsScope(CPU& cpu)
	: m_cpu(&cpu)
	, m_base(cpu.m_localRoots.size()) {
	cpu.m_stringPool.beginLocalRoots();
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
	: m_memory(memory)
	, m_irqController(irqController)
	, m_executionAddressSpace(executionAddressSpace)
	, m_luaHeap(*this, memory.ramByteCount())
	, m_stringPool(m_luaHeap)
	, m_indexKey(valueString(m_stringPool.intern("__index")))
	, m_heap(*this, m_luaHeap, m_stringPool, m_stringPool.intern("__mode"))
	, m_errorInErrorHandlingValue(valueString(m_stringPool.intern("error in error handling", false))) {
	m_cop0Words[COP0_STATUS] = CPU_STATUS_CART_ENTRY;
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
	m_luaFaultErrorValues[LUA_FAULT_REASON_INVALID_NEXT_KEY] = valueString(m_stringPool.intern("invalid key to 'next'", false));
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
	m_luaHeap.reserve(THREAD_HEAP_BYTES + 8 * THREAD_STACK_SLOT_BYTES);
	m_rootThread = m_heap.allocate<Thread>(ObjType::Thread);
	m_rootThread->status = ThreadStatus::Running;
	m_activeThread = m_rootThread;
	m_completionThread = m_rootThread;
	m_memory.attachMappedPageInvalidator(*this);
}

CPU::~CPU() {
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	m_nativeCompilerWorker.reset();
#endif
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	clearNativeContinuationBindings();
#endif
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
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	discardNativeCompilation();
#endif
	const Blua32ExecutionBoot systemBoot =
		m_executionAddressSpace.resolveSystemDomain();
	const u32 systemResetFunctionAddress = systemBoot.startupFunctionAddress;
	const u32 systemExceptionFunctionAddress = systemBoot.exceptionFunctionAddress;
	m_completionValues.clear();
	clearCallStack();
	m_stringIndexTable = nullptr;
	m_haltedUntilIrqFrameDepth = -1;
	m_haltedUntilIrqThread = nullptr;
	m_interruptEventPending = false;
	m_memoryWriteBlocked = false;
	m_memoryWriteBlockedAddress = 0u;
	m_pendingMemory.kind = PendingMemoryKind::None;
	m_hardHalted = false;
	m_programExecutionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	m_cop0Words[COP0_STATUS] = CPU_STATUS_SYSTEM_ENTRY;
	m_cop0Words[COP0_CAUSE] = 0u;
	m_cop0Words[COP0_EPC] = 0u;
	m_cop0Words[COP0_BAD_ADDRESS] = 0u;
	m_cop0Words[COP0_LUA_FAULT_REASON] = 0u;
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
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	clearNativeContinuationBindings();
#endif
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
	if (!readFunctionRecord(*m_systemImage, systemResetFunctionAddress, executionBusSignalsForDomain(SYSTEM_EXECUTION_DOMAIN_ID))) {
		hardHalt();
		return;
	}
	Closure* systemResetClosure = staticClosureForRecord(boundFunctionRecord(m_functionRecordLatch));
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
		scalarUtf8Text({m_executionReadView.data(), m_executionReadView.size()}),
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
				constPool[index] = valueNumber(readF64LE(
					record + BLUA32_CONSTANT_PAYLOAD_OFFSET));
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
			values.push_back(valueNil());
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
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	discardNativeCompilation();
#endif
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	clearNativeContinuationBindings();
#endif
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

Closure CPU::boundFunctionRecord(const Blua32FunctionRecordLatch& record) const {
	Closure result;
	result.functionAddress = record.address;
	result.codeAddress = record.codeAddress;
	result.numParams = record.numParams;
	result.maxStack = record.maxStack;
	result.flags = record.flags;
	result.upvalueTableAddress = record.upvalueTableAddress;
	result.recordUpvalueCount = record.upvalueCount;
	result.executionDomainId = record.image->executionDomainId;
	return result;
}

Closure* CPU::staticClosureForRecord(const Closure& record) {
	auto found = m_staticClosuresByAddress.find(record.functionAddress);
	Closure* first = nullptr;
	if (found != m_staticClosuresByAddress.end()) {
		for (Closure* closure : found->second) {
			if (closure->sameFunction(record) && (!first || closure->hashId < first->hashId)) first = closure;
		}
	}
	if (first) return first;
	m_luaHeap.reserve(kClosureHeapBytes);
	Closure* closure = allocateTrackedClosure(record.functionAddress, 0);
	closure->codeAddress = record.codeAddress;
	closure->numParams = record.numParams;
	closure->maxStack = record.maxStack;
	closure->flags = record.flags;
	closure->upvalueTableAddress = record.upvalueTableAddress;
	closure->recordUpvalueCount = record.recordUpvalueCount;
	closure->executionDomainId = record.executionDomainId;
	closure->canonical = true;
	m_staticClosuresByAddress[record.functionAddress].push_back(closure);
	return closure;
}

void CPU::pruneStaticClosures() {
	for (auto entry = m_staticClosuresByAddress.begin(); entry != m_staticClosuresByAddress.end();) {
		entry->second.remove_if([this](const Closure* closure) { return !m_heap.isAlive(closure); });
		if (entry->second.empty()) entry = m_staticClosuresByAddress.erase(entry);
		else ++entry;
	}
}

void CPU::clearExecutionEnvironment() {
	m_completionValues.clear();
	clearCallStack();
	clearGlobalSlots();
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
	const auto [slot, inserted] = m_globalSlotByKey.try_emplace(key, m_globalNames.size());
	if (inserted) {
		m_globalNames.push_back(key);
		m_globalValues.push_back(value);
	} else {
		m_globalValues[slot->second] = value;
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
	return valueNil();
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

void CPU::invalidateDecodedWords(u64 key, u32 firstWord, u32 endWord) {
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	if (m_nativeCompilerWorker && !m_nativeCompilerWorker->idle() && m_pendingNativeCompilation.key == key)
		m_pendingNativeCompilation.invalidated = true;
#endif
	const u32 firstPredecessor = firstWord >= DECODED_DEPENDENCY_PREDECESSOR_WORDS
		? firstWord - DECODED_DEPENDENCY_PREDECESSOR_WORDS : 0u;
	const u32 predecessorEnd = std::min(firstWord, static_cast<u32>(DECODED_PAGE_WORDS));
	for (const std::unique_ptr<Blua32ExecutionImage>& image : m_executionImagesByDomain) {
		if (!image) {
			continue;
		}
		auto page = image->decodedPages.find(key);
		if (page != image->decodedPages.end()) {
			auto& decodedPage = page->second;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			decodedPage.retireNativeBlocks(firstWord, endWord);
#endif
			for (u32 index = firstPredecessor; index < predecessorEnd; ++index) {
				u8& refresh = decodedPage.refreshState[index];
				if ((refresh & DECODED_REFRESH_DECODE) != 0u) continue;
				const auto& decoded = decodedPage.words[index];
				const u32 ownEnd = index + decoded.width;
				if (ownEnd > firstWord) {
					refresh = DECODED_REFRESH_DECODE;
				} else if (ownEnd + 2u > firstWord && decodedDispatchCanFuse(decoded.op)
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
					&& (!decodedPage.nativeBlocks || !decodedPage.nativeBlocks->entries[index])
#endif
				) {
					refresh |= DECODED_REFRESH_FUSION;
				}
			}
			if (firstWord < DECODED_PAGE_WORDS) {
				if (endWord == firstWord + 1u) {
					decodedPage.refreshState[firstWord] = DECODED_REFRESH_DECODE;
				} else {
					std::fill(
						decodedPage.refreshState.begin() + firstWord,
						decodedPage.refreshState.begin() + endWord,
						DECODED_REFRESH_DECODE
					);
				}
			}
		}
	}
}

void CPU::invalidateMappedWords(u64 key, u32 firstWord, u32 endWord) {
	invalidateDecodedWords(key, firstWord, endWord);
	if (firstWord < DECODED_DEPENDENCY_PREDECESSOR_WORDS && key >= MAPPED_PAGE_BYTE_SIZE) {
		invalidateDecodedWords(
			key - MAPPED_PAGE_BYTE_SIZE,
			DECODED_PAGE_WORDS + firstWord,
			DECODED_PAGE_WORDS + endWord
		);
	}
}

void CPU::invalidateMappedRange(u64 firstKey, u64 endKey) {
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	if (m_nativeCompilerWorker && !m_nativeCompilerWorker->idle()
		&& m_pendingNativeCompilation.key >= (firstKey >= MAPPED_PAGE_BYTE_SIZE ? firstKey - MAPPED_PAGE_BYTE_SIZE : 0u)
		&& m_pendingNativeCompilation.key < endKey)
		m_pendingNativeCompilation.invalidated = true;
#endif
	const u64 invalidationStart = firstKey >= MAPPED_PAGE_BYTE_SIZE
		? firstKey - MAPPED_PAGE_BYTE_SIZE
		: 0u;
	for (const std::unique_ptr<Blua32ExecutionImage>& image : m_executionImagesByDomain) {
		if (!image) {
			continue;
		}
		for (auto& [key, page] : image->decodedPages) {
			if (key >= invalidationStart && key < endKey) {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
				page.retireNativeBlocks();
#endif
				page.refreshState.fill(DECODED_REFRESH_DECODE);
			}
		}
	}
}

DecodedInstructionPage& CPU::decodedPageForFrame(CallFrame& frame, u32 pc) {
	const u32 pageAddress = pc & ~MAPPED_PAGE_BYTE_MASK;
	const auto busSignals = mappedBusSignalsForCartridgeSlot(m_memory.cartridgeController().selectedSlot(m_executionBusSignals));
	if (frame.decodedPage
		&& frame.decodedPageAddress == pageAddress && frame.decodedPageBusSignals == busSignals) {
		return *frame.decodedPage;
	}
	MappedPageBinding binding;
	m_memory.bindMappedPage(pageAddress, busSignals, binding);
	DecodedInstructionPage& page = decodedPageForAddress(
		*frame.executionImage,
		binding
	);
	frame.decodedPage = &page;
	frame.decodedPageAddress = pageAddress;
	frame.decodedPageBusSignals = busSignals;
	frame.compilationEntry = true;
	return page;
}


void CPU::skipNextInstruction(CallFrame& frame) {
	DecodedInstructionPage& page = decodedPageForFrame(frame, frame.pc);
	const u32 offset = (frame.pc & MAPPED_PAGE_BYTE_MASK) >> 2;
	if ((page.refreshState[offset] & DECODED_REFRESH_DECODE) != 0u
		&& !decodeInstruction(frame, page, offset, frame.pc, false)) {
		return;
	}
	const u32 nextPc = frame.pc + static_cast<u32>(page.words[offset].width) * INSTRUCTION_BYTES;
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
	m_functionRecordLatch.cacheableRead = false;
	Span<const u8> view;
	if (m_memory.bindMappedReadView(address, BLUA32_FUNCTION_RECORD_SIZE, busSignals, view)) {
		m_functionRecordLatch.cacheableRead = true;
		const u8* record = view.data();
		m_functionRecordLatch.codeAddress = readLE32(
			record + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET
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
	const u32 faultSequence = m_memory.readBusFaultSequence();
	m_functionRecordLatch.codeAddress = m_memory.readMappedBusU32LE(
		address + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET,
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
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	// Ordinary EXEC selection has established the image's constant/name banks.
	// Preparation changes only host code caches, before any target instruction.
	if (m_functionRecordLatch.image->executionDomainId >= 0) {
		const auto boot = m_executionAddressSpace.resolveDomain(m_functionRecordLatch.image->executionDomainId);
		prepareNativeImageCode(*m_functionRecordLatch.image, *boot);
	}
#endif
	clearCallStack();
	latchActiveExecutionImage(*m_functionRecordLatch.image);
	m_programExecutionDomainId = m_functionRecordLatch.image->executionDomainId;
	m_cop0Words[COP0_STATUS] = m_functionRecordLatch.image->executionDomainId >= 0
		? CPU_STATUS_CART_ENTRY
		: CPU_STATUS_SYSTEM_ENTRY;
	m_haltedUntilIrqFrameDepth = -1;
	m_haltedUntilIrqThread = nullptr;
	m_interruptEventPending = false;
	m_memoryWriteBlocked = false;
	m_memoryWriteBlockedAddress = 0u;
	m_pendingMemory.kind = PendingMemoryKind::None;
	m_hardHalted = false;
	m_yieldRequested = false;
	Closure* closure = staticClosureForRecord(boundFunctionRecord(m_functionRecordLatch));
	pushLatchedFrame(closure, nullptr, 0, 0, 0, false);
}

void CPU::beginCompletionCall(Closure& closure, BuiltinArgsView args) {
	// Call injection takes over the physical instruction stream. The suspended
	// frame retains its PC; an unaccepted endpoint access must not follow it.
	abortStalledMemoryWrite();
	auto roots = acquireLocalRoots();
	trackLocalRoot(valueClosure(&closure));
	for (size_t index = 0; index < args.size(); ++index) trackLocalRoot(args[index]);
	// The input span may borrow the completion latch being cleared below.
	args = BuiltinArgsView(m_localRoots.data() + m_localRoots.size() - args.size(), args.size());
	m_completionValues.clear();
	m_completionThread = m_activeThread;
	m_yieldRequested = false;
	pushFrame(&closure, args.data(), args.size(), 0, 0, true);
}

void CPU::beginCompletionCallInExecutionDomain(
	ExecutionDomainId executionDomainId,
	u32 functionAddress
) {
	if (!readFunctionRecord(*executionImageForDomain(executionDomainId), functionAddress, executionBusSignalsForDomain(executionDomainId))) {
		hardHalt();
		return;
	}
	beginCompletionCall(*staticClosureForRecord(boundFunctionRecord(m_functionRecordLatch)));
}

CpuRuntimeState CPU::captureRuntimeState(CpuSnapshot snapshot) const {
	snapshot.reset();
	std::unordered_map<const GCObject*, u32> objectIds;
	std::vector<const GCObject*> pendingObjects;
	const auto captureObject = [&](const GCObject* object) -> u32 {
		const auto it = objectIds.find(object);
		if (it != objectIds.end()) return it->second;
		const u32 id = snapshot.addObject();
		objectIds.emplace(object, id);
		pendingObjects.push_back(object);
		return id;
	};
	const CpuSnapshotValueWriter writeValue = [&](u32 offset, Value value) {
		if (valueIsNumber(value)) {
			snapshot.setWord(offset, static_cast<u32>(CpuSnapshotValueTag::Number));
			snapshot.setNumber(offset + 1, asNumber(value));
			return;
		}
		snapshot.setWord(offset + 2, 0);
		switch (valueTag(value)) {
			case ValueTag::Nil:
			case ValueTag::False:
			case ValueTag::True:
				// These three native tags already match the snapshot tag column.
				snapshot.setWord(offset, static_cast<u32>(valueTag(value)));
				snapshot.setWord(offset + 1, 0);
				break;
			case ValueTag::String:
				snapshot.setWord(offset, static_cast<u32>(CpuSnapshotValueTag::String));
				snapshot.setWord(offset + 1, asStringId(value));
				break;
			case ValueTag::BuiltinFunction:
				snapshot.setWord(offset, static_cast<u32>(CpuSnapshotValueTag::BuiltinFunction));
				snapshot.setWord(offset + 1, static_cast<u32>(asBuiltinFunction(value)->id));
				break;
			case ValueTag::Table:
				snapshot.setWord(offset, static_cast<u32>(CpuSnapshotValueTag::Table));
				snapshot.setWord(offset + 1, captureObject(asTable(value)));
				break;
			case ValueTag::Thread:
				snapshot.setWord(offset, static_cast<u32>(CpuSnapshotValueTag::Thread));
				snapshot.setWord(offset + 1, captureObject(asThread(value)));
				break;
			case ValueTag::Closure:
				snapshot.setWord(offset, static_cast<u32>(CpuSnapshotValueTag::Closure));
				snapshot.setWord(offset + 1, captureObject(asClosure(value)));
				break;
		}
	};
	const auto captureValueState = [&](Value value) -> u32 {
		const u32 offset = snapshot.reserveWords(CPU_SNAPSHOT_VALUE_WORDS);
		writeValue(offset, value);
		return offset;
	};

	CpuRuntimeState state;
	const auto captureThread = [&](const Thread* thread) -> u32 {
		CpuThreadState saved;
		saved.frames.reserve(thread->frameDepth);
		const CallFrame* framePtr = thread->firstFrame;
		for (size_t depth = 0; depth < thread->frameDepth; ++depth, framePtr = framePtr->next) {
			const CallFrame& frame = *framePtr;
			CpuFrameState frameState;
			frameState.functionAddress = frame.functionAddress;
			frameState.pc = frame.pc;
			frameState.closureRef = captureObject(frame.closure);
			frameState.returnBase = frame.returnBase;
			frameState.returnCount = frame.returnCount;
			frameState.top = frame.top;
			frameState.returnToCompletionLatch = frame.returnToCompletionLatch;
			frameState.callSitePc = frame.callSitePc;
			frameState.isExceptionFrame = frame.isExceptionFrame;
			frameState.isNonMaskableExceptionFrame = frame.isNonMaskableExceptionFrame;
			frameState.stackCapacity = frame.stackCapacity;
			frameState.stackBase = frame.stackBase;
			frameState.varargBase = frame.varargBase;
			frameState.varargCount = frame.varargCount;
			saved.frames.push_back(std::move(frameState));
		}
		saved.protectedCalls.reserve(thread->protectedCallDepth);
		for (size_t index = 0; index < thread->protectedCallDepth; ++index) {
			const ProtectedCallContinuation& continuation = thread->protectedCallContinuations.peek(index);
			CpuProtectedCallState continuationState;
			continuationState.kind = continuation.kind;
			continuationState.returnsToProtectedParent = continuation.returnsToProtectedParent;
			continuationState.callBase = continuation.callBase;
			continuationState.returnCount = continuation.returnCount;
			continuationState.handlerRegister = continuation.handlerRegister;
			const CallFrame* frame = thread->firstFrame;
			for (size_t frameIndex = 0; frameIndex < thread->frameDepth; ++frameIndex, frame = frame->next) {
				if (frame == continuation.caller) {
					continuationState.callerFrameIndex = static_cast<int>(frameIndex);
				}
				if (frame->protectedContinuationIndex == static_cast<i32>(index)) {
					continuationState.targetFrameIndex = static_cast<int>(frameIndex);
				}
			}
			saved.protectedCalls.push_back(continuationState);
		}
		const CallFrame* frame = thread->firstFrame;
		for (size_t depth = 0; depth < thread->frameDepth; ++depth, frame = frame->next) {
			for (Upvalue* upvalue = frame->openUpvalueHead; upvalue; upvalue = upvalue->nextOpen) {
				saved.openUpvalues.push_back(captureObject(upvalue));
			}
		}
		saved.status = thread->status;
		saved.entryRef = thread->entry == nullptr ? -1 : static_cast<int>(captureObject(thread->entry));
		saved.resumerRef = thread->resumer == nullptr ? -1 : static_cast<int>(captureObject(thread->resumer));
		saved.callBase = thread->callBase;
		saved.returnCount = thread->returnCount;
		saved.stackCapacity = thread->stackCapacity;
		saved.stack.reserve(static_cast<size_t>(thread->stackTop));
		for (int slot = 0; slot < thread->stackTop; ++slot) saved.stack.push_back(captureValueState(thread->stack[slot]));
		saved.error = captureValueState(thread->error);
		const u32 index = static_cast<u32>(state.threads.size());
		state.threads.push_back(std::move(saved));
		return index;
	};
	state.rootThreadRef = static_cast<int>(captureObject(m_rootThread));
	state.activeThreadRef = static_cast<int>(captureObject(m_activeThread));
	state.completionThreadRef = static_cast<int>(captureObject(m_completionThread));
	state.haltedUntilIrqThreadRef = m_haltedUntilIrqThread == nullptr ? -1 : static_cast<int>(captureObject(m_haltedUntilIrqThread));
	state.systemGlobals.reserve(m_systemGlobalNames.size());
	for (size_t index = 0; index < m_systemGlobalNames.size(); ++index) {
		const Value value = m_systemGlobalValues[index];
		state.systemGlobals.push_back(CpuRootValueState{
			m_systemGlobalNames[index],
			captureValueState(value),
		});
	}
	state.globalSlots.reserve(m_globalNames.size());
	for (size_t index = 0; index < m_globalNames.size(); ++index) {
		state.globalSlots.push_back(CpuRootValueState{
			m_globalNames[index],
			captureValueState(m_globalValues[index]),
		});
	}
	state.executionCartridgeSlot = m_activeExecutionImage->executionDomainId;
	state.programExecutionDomainId = m_programExecutionDomainId;
	state.completionValues.reserve(m_completionValues.size());
	for (const Value& value : m_completionValues) {
		state.completionValues.push_back(captureValueState(value));
	}
	state.stringIndexTable = captureValueState(
		m_stringIndexTable ? valueTable(m_stringIndexTable) : valueNil()
	);
	// Cache residency is allocation state even when a static closure is no
	// longer in a live register. Order the cold snapshot by physical address.
	std::vector<const Closure*> canonicalClosures;
	canonicalClosures.reserve(m_staticClosuresByAddress.size());
	for (const auto& [address, versions] : m_staticClosuresByAddress) {
		for (const Closure* closure : versions) canonicalClosures.push_back(closure);
	}
	std::stable_sort(canonicalClosures.begin(), canonicalClosures.end(), [](const Closure* left, const Closure* right) {
		return std::tie(left->functionAddress, left->executionDomainId, left->codeAddress, left->numParams, left->maxStack, left->flags, left->upvalueTableAddress, left->recordUpvalueCount, left->upvalueCount, left->hashId)
			< std::tie(right->functionAddress, right->executionDomainId, right->codeAddress, right->numParams, right->maxStack, right->flags, right->upvalueTableAddress, right->recordUpvalueCount, right->upvalueCount, right->hashId);
	});
	for (const Closure* closure : canonicalClosures) {
		captureObject(closure);
	}
	state.gc = m_heap.captureState(captureObject);
	// Reserve ordinals at each edge, then drain in ordinal order. Guest graph
	// depth must not consume the host call stack.
	for (u32 id = 0; id < pendingObjects.size(); ++id) {
		const auto* object = pendingObjects[id];
		u32 offset;
		if (m_heap.sweepGarbage(object)) {
			offset = snapshot.reserveWords(3);
			snapshot.setWord(offset, static_cast<u32>(CpuSnapshotObjectKind::Garbage));
			snapshot.setWord(offset + 1, object->hashId);
			snapshot.setWord(offset + 2, static_cast<u32>(m_heap.allocationBytes(object)));
			snapshot.setObjectWord(id, offset);
			continue;
		}
		switch (object->type) {
			case ObjType::Thread: {
				const auto* thread = static_cast<const Thread*>(object);
				offset = snapshot.reserveWords(SNAP_THREAD_SIZE);
				snapshot.setWord(offset + SNAP_THREAD_KIND, static_cast<u32>(CpuSnapshotObjectKind::Thread));
				snapshot.setWord(offset + SNAP_THREAD_HASH_ID, thread->hashId);
				snapshot.setWord(offset + SNAP_THREAD_INDEX, captureThread(thread));
				break;
			}
			case ObjType::Table:
				offset = static_cast<const Table*>(object)->captureSnapshot(snapshot, writeValue);
				break;
			case ObjType::Closure: {
				const auto* closure = static_cast<const Closure*>(object);
				offset = snapshot.reserveWords(SNAP_CLOSURE_DATA + static_cast<u32>(closure->upvalueCount));
				snapshot.setWord(offset + SNAP_CLOSURE_KIND, static_cast<u32>(CpuSnapshotObjectKind::Closure));
				snapshot.setWord(offset + SNAP_CLOSURE_HASH_ID, closure->hashId);
				snapshot.setWord(offset + SNAP_CLOSURE_FUNCTION_ADDRESS, closure->functionAddress);
				snapshot.setWord(offset + SNAP_CLOSURE_CANONICAL, closure->canonical);
				snapshot.setWord(offset + SNAP_CLOSURE_UPVALUE_COUNT, static_cast<u32>(closure->upvalueCount));
				snapshot.setWord(offset + SNAP_CLOSURE_CODE_ADDRESS, closure->codeAddress);
				snapshot.setWord(offset + SNAP_CLOSURE_NUM_PARAMS, closure->numParams);
				snapshot.setWord(offset + SNAP_CLOSURE_MAX_STACK, closure->maxStack);
				snapshot.setWord(offset + SNAP_CLOSURE_FLAGS, closure->flags);
				snapshot.setWord(offset + SNAP_CLOSURE_UPVALUE_TABLE_ADDRESS, closure->upvalueTableAddress);
				snapshot.setWord(offset + SNAP_CLOSURE_RECORD_UPVALUE_COUNT, closure->recordUpvalueCount);
				snapshot.setWord(offset + SNAP_CLOSURE_EXECUTION_DOMAIN_ID, static_cast<u32>(closure->executionDomainId));
				for (u32 index = 0; index < closure->upvalueCount; ++index) {
					snapshot.setWord(offset + SNAP_CLOSURE_DATA + index, captureObject(closure->upvalues[index]));
				}
				break;
			}
			case ObjType::Upvalue: {
				const auto* upvalue = static_cast<const Upvalue*>(object);
				offset = snapshot.reserveWords(SNAP_UPVALUE_VALUE + CPU_SNAPSHOT_VALUE_WORDS);
				snapshot.setWord(offset + SNAP_UPVALUE_KIND, static_cast<u32>(CpuSnapshotObjectKind::Upvalue));
				snapshot.setWord(offset + SNAP_UPVALUE_HASH_ID, upvalue->hashId);
				snapshot.setWord(offset + SNAP_UPVALUE_OPEN, upvalue->open);
				snapshot.setWord(offset + SNAP_UPVALUE_INDEX, static_cast<u32>(upvalue->index));
				int frameIndex = -1;
				if (upvalue->open) {
					frameIndex = 0;
					for (auto* frame = upvalue->frame->thread->firstFrame; frame != upvalue->frame; frame = frame->next) ++frameIndex;
				}
				snapshot.setWord(offset + SNAP_UPVALUE_THREAD_REF, upvalue->open ? captureObject(upvalue->frame->thread) : static_cast<u32>(-1));
				snapshot.setWord(offset + SNAP_UPVALUE_FRAME_INDEX, static_cast<u32>(frameIndex));
				writeValue(offset + SNAP_UPVALUE_VALUE, upvalue->open ? upvalue->frame->registers[upvalue->index] : upvalue->value);
				break;
			}
			default: BMSX_UNREACHABLE();
		}
		snapshot.setObjectWord(id, offset);
	}
	for (size_t index = 0; index < m_executionImagesByDomain.size(); ++index) {
		if (m_executionImagesByDomain[index]) {
			state.executionResidencyMask |= 1u << index;
		}
	}
	state.nextObjectHashId = m_heap.nextObjectHashId();
	state.hardHalted = m_hardHalted;
	state.luaHeap = m_luaHeap.captureState();
	state.snapshot = std::move(snapshot);
	state.lastExecutionDomainId = m_lastExecutionDomainId;
	state.lastPc = lastPc;
	state.haltedUntilIrqFrameDepth = m_haltedUntilIrqFrameDepth;
	state.interruptEventPending = m_interruptEventPending;
	state.memoryWriteBlocked = m_memoryWriteBlocked;
	state.memoryWriteBlockedAddress = m_memoryWriteBlockedAddress;
	state.pendingMemory = m_pendingMemory;
	state.statusWord = m_cop0Words[COP0_STATUS];
	state.causeWord = m_cop0Words[COP0_CAUSE];
	state.epcWord = m_cop0Words[COP0_EPC];
	state.badAddressWord = m_cop0Words[COP0_BAD_ADDRESS];
	state.luaFaultReasonWord = m_cop0Words[COP0_LUA_FAULT_REASON];
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
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	discardNativeCompilation();
#endif
	const auto& snapshot = state.snapshot;
	m_completionValues.clear();
	clearCallStack();
	auto previousCanonical = std::move(m_staticClosuresByAddress);
	m_staticClosuresByAddress.clear();
	auto savedClosure = [&](u32 offset) {
		Closure record;
		record.functionAddress = snapshot.word(offset + SNAP_CLOSURE_FUNCTION_ADDRESS);
		record.upvalueCount = snapshot.word(offset + SNAP_CLOSURE_UPVALUE_COUNT);
		record.codeAddress = snapshot.word(offset + SNAP_CLOSURE_CODE_ADDRESS);
		record.numParams = snapshot.word(offset + SNAP_CLOSURE_NUM_PARAMS);
		record.maxStack = snapshot.word(offset + SNAP_CLOSURE_MAX_STACK);
		record.flags = snapshot.word(offset + SNAP_CLOSURE_FLAGS);
		record.upvalueTableAddress = snapshot.word(offset + SNAP_CLOSURE_UPVALUE_TABLE_ADDRESS);
		record.recordUpvalueCount = snapshot.word(offset + SNAP_CLOSURE_RECORD_UPVALUE_COUNT);
		record.executionDomainId = snapshot.integer(offset + SNAP_CLOSURE_EXECUTION_DOMAIN_ID);
		return record;
	};
	std::vector<GCObject*> restoredObjects(snapshot.objectCount());
	for (size_t index = 0; index < snapshot.objectCount(); ++index) {
		const u32 offset = snapshot.objectWord(static_cast<u32>(index));
		switch (static_cast<CpuSnapshotObjectKind>(snapshot.word(offset))) {
			case CpuSnapshotObjectKind::Garbage: {
				const auto bytes = snapshot.word(offset + 2);
				m_luaHeap.restoreAllocate(bytes);
				auto* object = m_heap.allocate<GarbageAllocation>(ObjType::Garbage, bytes);
				object->restored = true;
				object->hashId = snapshot.word(offset + 1);
				restoredObjects[index] = object;
				break;
			}
			case CpuSnapshotObjectKind::Thread: {
				if (index != static_cast<size_t>(state.rootThreadRef)) {
					m_luaHeap.restoreAllocate(THREAD_HEAP_BYTES + state.threads[snapshot.word(offset + SNAP_THREAD_INDEX)].stackCapacity * THREAD_STACK_SLOT_BYTES);
				}
				Thread* thread = index == static_cast<size_t>(state.rootThreadRef) ? m_rootThread : m_heap.allocate<Thread>(ObjType::Thread);
				const auto& saved = state.threads[snapshot.word(offset + SNAP_THREAD_INDEX)];
				thread->restored = true;
				thread->hashId = snapshot.word(offset + SNAP_THREAD_HASH_ID);
				thread->resizeStack(saved.stackCapacity);
				thread->stackTop = 0;
				while (thread->currentFrame) thread->leaveFrame();
				thread->status = saved.status;
				thread->callBase = saved.callBase;
				thread->returnCount = saved.returnCount;
				restoredObjects[index] = thread;
				break;
			}
			case CpuSnapshotObjectKind::Table: {
				const u32 arrayCapacity = snapshot.word(offset + SNAP_TABLE_ARRAY_CAPACITY);
				const u32 hashSize = snapshot.word(offset + SNAP_TABLE_HASH_SIZE);
				m_luaHeap.restoreAllocate(Table::trackedHeapBytesForCapacities(arrayCapacity, hashSize));
				Table* table = m_heap.allocate<Table>(ObjType::Table, m_luaHeap, arrayCapacity, hashSize);
				table->restored = true;
				table->hashId = snapshot.word(offset + SNAP_TABLE_HASH_ID);
				restoredObjects[index] = table;
				break;
			}
			case CpuSnapshotObjectKind::Closure: {
				const Closure record = savedClosure(offset);
				const u32 functionAddress = record.functionAddress;
				const bool canonical = snapshot.word(offset + SNAP_CLOSURE_CANONICAL) != 0;
				Closure* closure;
				if (canonical) {
					const u32 hashId = snapshot.word(offset + SNAP_CLOSURE_HASH_ID);
					auto& versions = m_staticClosuresByAddress[functionAddress];
					auto previous = previousCanonical.find(functionAddress);
					closure = nullptr;
					if (previous != previousCanonical.end()) {
						auto& candidates = previous->second;
						auto existing = std::find_if(candidates.begin(), candidates.end(), [&](const Closure* item) {
							return item->hashId == hashId && item->sameFunction(record);
						});
						if (existing != candidates.end()) {
							closure = *existing;
							candidates.erase(existing);
						}
					}
					if (!closure) {
						m_luaHeap.restoreAllocate(kClosureHeapBytes + record.upvalueCount * kClosureUpvalueSlotHeapBytes);
						closure = allocateTrackedClosure(functionAddress, record.upvalueCount);
					}
					versions.push_back(closure);
				} else {
					m_luaHeap.restoreAllocate(kClosureHeapBytes + record.upvalueCount * kClosureUpvalueSlotHeapBytes);
					closure = allocateTrackedClosure(functionAddress, record.upvalueCount);
				}
				closure->codeAddress = record.codeAddress;
				closure->numParams = record.numParams;
				closure->maxStack = record.maxStack;
				closure->flags = record.flags;
				closure->upvalueTableAddress = record.upvalueTableAddress;
				closure->recordUpvalueCount = record.recordUpvalueCount;
				closure->canonical = canonical;
				closure->executionDomainId = record.executionDomainId;
				closure->restored = true;
				closure->hashId = snapshot.word(offset + SNAP_CLOSURE_HASH_ID);
				restoredObjects[index] = closure;
				break;
			}
			case CpuSnapshotObjectKind::Upvalue: {
				m_luaHeap.restoreAllocate(UPVALUE_HEAP_BYTES);
				auto* upvalue = m_heap.allocate<Upvalue>(ObjType::Upvalue);
				upvalue->restored = true;
				upvalue->open = false;
				upvalue->index = snapshot.integer(offset + SNAP_UPVALUE_INDEX);
				upvalue->frame = nullptr;
				upvalue->value = valueNil();
				upvalue->hashId = snapshot.word(offset + SNAP_UPVALUE_HASH_ID);
				restoredObjects[index] = upvalue;
				break;
			}
		}
	}
	const CpuSnapshotReader reader(snapshot, restoredObjects, m_builtinFunctions);
	for (size_t index = 0; index < snapshot.objectCount(); ++index) {
		const u32 offset = snapshot.objectWord(static_cast<u32>(index));
		switch (static_cast<CpuSnapshotObjectKind>(snapshot.word(offset))) {
			case CpuSnapshotObjectKind::Garbage: break;
			case CpuSnapshotObjectKind::Thread:
				break;
			case CpuSnapshotObjectKind::Table:
				static_cast<Table*>(restoredObjects[index])->restoreSnapshot(reader, offset);
				break;
			case CpuSnapshotObjectKind::Closure: {
				auto* closure = static_cast<Closure*>(restoredObjects[index]);
				for (u32 slot = 0; slot < closure->upvalueCount; ++slot) {
					closure->upvalues[slot] = static_cast<Upvalue*>(restoredObjects[snapshot.word(offset + SNAP_CLOSURE_DATA + slot)]);
				}
				break;
			}
			case CpuSnapshotObjectKind::Upvalue: {
				auto* upvalue = static_cast<Upvalue*>(restoredObjects[index]);
				upvalue->open = snapshot.word(offset + SNAP_UPVALUE_OPEN) != 0;
				upvalue->value = upvalue->open ? valueNil() : reader.readValue(offset + SNAP_UPVALUE_VALUE);
				break;
			}
		}
	}

	m_memory.clearMappedPageWriteWatches();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	clearNativeContinuationBindings();
#endif
	for (auto& image : m_executionImagesByDomain) {
		image.reset();
	}
	clearGlobalSlots();
	m_systemGlobalNames.reserve(state.systemGlobals.size());
	m_systemGlobalValues.reserve(state.systemGlobals.size());
	for (const CpuRootValueState& entry : state.systemGlobals) {
		m_systemGlobalSlotByKey.emplace(entry.key, m_systemGlobalNames.size());
		m_systemGlobalNames.push_back(entry.key);
		m_systemGlobalValues.push_back(reader.readValue(entry.value));
	}
	m_globalNames.reserve(state.globalSlots.size());
	m_globalValues.reserve(state.globalSlots.size());
	for (const CpuRootValueState& entry : state.globalSlots) {
		m_globalSlotByKey.emplace(entry.key, m_globalNames.size());
		m_globalNames.push_back(entry.key);
		m_globalValues.push_back(reader.readValue(entry.value));
	}
	for (size_t index = 0; index < m_executionImagesByDomain.size(); ++index) {
		if ((state.executionResidencyMask & (1u << index)) != 0u) {
			executionImageForDomain(static_cast<ExecutionDomainId>(index) - 1);
		}
	}
	m_systemImage = m_executionImagesByDomain[static_cast<size_t>(SYSTEM_EXECUTION_DOMAIN_ID + 1)].get();
	Blua32ExecutionImage* executionImage = m_executionImagesByDomain[static_cast<size_t>(state.executionCartridgeSlot + 1)].get();
	latchActiveExecutionImage(*executionImage);

	for (size_t objectIndex = 0; objectIndex < snapshot.objectCount(); ++objectIndex) {
		const u32 offset = snapshot.objectWord(static_cast<u32>(objectIndex));
		if (snapshot.word(offset) != static_cast<u32>(CpuSnapshotObjectKind::Thread)) continue;
		const auto& saved = state.threads[snapshot.word(offset + SNAP_THREAD_INDEX)];
		Thread* thread = static_cast<Thread*>(restoredObjects[objectIndex]);
		m_activeThread = thread;
		thread->entry = saved.entryRef < 0 ? nullptr : static_cast<Closure*>(restoredObjects[saved.entryRef]);
		thread->resumer = saved.resumerRef < 0 ? nullptr : static_cast<Thread*>(restoredObjects[saved.resumerRef]);
		thread->error = reader.readValue(saved.error);
		thread->stackTop = static_cast<int>(saved.stack.size());
		for (size_t slot = 0; slot < saved.stack.size(); ++slot) thread->stack[slot] = reader.readValue(saved.stack[slot]);
		std::fill(thread->stack + thread->stackTop, thread->stack + thread->stackCapacity, valueNil());
		for (const CpuFrameState& frameState : saved.frames) {
			auto* frame = m_activeThread->acquireFrame();
			frame->functionAddress = frameState.functionAddress;
			frame->closure = static_cast<Closure*>(restoredObjects[static_cast<size_t>(frameState.closureRef)]);
			frame->executionImage = executionImageForDomain(frame->closure->executionDomainId);
			frame->pc = frameState.pc;
			frame->returnBase = frameState.returnBase;
			frame->returnCount = frameState.returnCount;
			frame->returnToCompletionLatch = frameState.returnToCompletionLatch;
			frame->callSitePc = frameState.callSitePc;
			frame->isExceptionFrame = frameState.isExceptionFrame;
			frame->isNonMaskableExceptionFrame = frameState.isNonMaskableExceptionFrame;
			frame->varargBase = frameState.varargBase;
			frame->varargCount = frameState.varargCount;
			frame->stackBase = frameState.stackBase;
			frame->stackCapacity = frameState.stackCapacity;
			frame->registers = thread->stack + frame->stackBase;
			frame->top = frameState.top;
			m_activeThread->enterFrame(frame);
		}
		for (size_t index = 0; index < saved.protectedCalls.size(); ++index) {
			const CpuProtectedCallState& continuationState = saved.protectedCalls[index];
			ProtectedCallContinuation& continuation = m_activeThread->protectedCallContinuations.get(index);
			continuation.kind = continuationState.kind;
			continuation.caller = m_activeThread->frameAtDepth(static_cast<size_t>(continuationState.callerFrameIndex));
			if (continuationState.targetFrameIndex >= 0) {
				m_activeThread->frameAtDepth(static_cast<size_t>(continuationState.targetFrameIndex))->protectedContinuationIndex = static_cast<i32>(index);
			}
			continuation.returnsToProtectedParent = continuationState.returnsToProtectedParent;
			continuation.callBase = continuationState.callBase;
			continuation.returnCount = continuationState.returnCount;
			continuation.handlerRegister = continuationState.handlerRegister;
		}
		m_activeThread->protectedCallDepth = saved.protectedCalls.size();
	}
	for (size_t objectIndex = 0; objectIndex < snapshot.objectCount(); ++objectIndex) {
		const u32 offset = snapshot.objectWord(static_cast<u32>(objectIndex));
		if (snapshot.word(offset) != static_cast<u32>(CpuSnapshotObjectKind::Thread)) continue;
		const auto& saved = state.threads[snapshot.word(offset + SNAP_THREAD_INDEX)];
		for (int upvalueRef : saved.openUpvalues) {
			const u32 offset = snapshot.objectWord(static_cast<u32>(upvalueRef));
			Upvalue* upvalue = static_cast<Upvalue*>(restoredObjects[static_cast<size_t>(upvalueRef)]);
			Thread* owner = static_cast<Thread*>(restoredObjects[snapshot.word(offset + SNAP_UPVALUE_THREAD_REF)]);
			CallFrame* frame = owner->frameAtDepth(static_cast<size_t>(snapshot.integer(offset + SNAP_UPVALUE_FRAME_INDEX)));
			upvalue->open = true;
			upvalue->index = snapshot.integer(offset + SNAP_UPVALUE_INDEX);
			upvalue->frame = frame;
			upvalue->value = valueNil();
			linkOpenUpvalue(*frame, upvalue);
		}

	}
	m_activeThread = static_cast<Thread*>(restoredObjects[state.activeThreadRef]);
	m_completionThread = static_cast<Thread*>(restoredObjects[state.completionThreadRef]);
	m_threadSwitchRequested = false;

	const Value stringIndexTable = reader.readValue(state.stringIndexTable);
	m_stringIndexTable = isNil(stringIndexTable) ? nullptr : asTable(stringIndexTable);
	m_completionValues.reserve(state.completionValues.size());
	for (u32 valueState : state.completionValues) {
		m_completionValues.push_back(reader.readValue(valueState));
	}
	m_programExecutionDomainId = state.programExecutionDomainId;
	m_lastExecutionDomainId = state.lastExecutionDomainId;
	lastPc = state.lastPc;
	m_haltedUntilIrqFrameDepth = state.haltedUntilIrqFrameDepth;
	m_haltedUntilIrqThread = state.haltedUntilIrqThreadRef == -1 ? nullptr : static_cast<Thread*>(restoredObjects[state.haltedUntilIrqThreadRef]);
	m_interruptEventPending = state.interruptEventPending;
	m_memoryWriteBlocked = state.memoryWriteBlocked;
	m_memoryWriteBlockedAddress = state.memoryWriteBlockedAddress;
	m_pendingMemory = state.pendingMemory;
	m_cop0Words[COP0_STATUS] = state.statusWord;
	m_cop0Words[COP0_CAUSE] = state.causeWord;
	m_cop0Words[COP0_EPC] = state.epcWord;
	m_cop0Words[COP0_BAD_ADDRESS] = state.badAddressWord;
	m_cop0Words[COP0_LUA_FAULT_REASON] = state.luaFaultReasonWord;
	m_exceptionDomainWord = state.exceptionDomainWord;
	m_nmiReturnCauseWord = state.nmiReturnCauseWord;
	m_nmiReturnEpcWord = state.nmiReturnEpcWord;
	m_nmiReturnBadAddressWord = state.nmiReturnBadAddressWord;
	m_nmiReturnLuaFaultReasonWord = state.nmiReturnLuaFaultReasonWord;
	m_nmiReturnExceptionDomainWord = state.nmiReturnExceptionDomainWord;
	m_nonMaskableInterruptPending = state.nonMaskableInterruptPending;
	m_yieldRequested = state.yieldRequested;
	m_hardHalted = state.hardHalted;
	m_heap.finishRestore(state.nextObjectHashId);
	m_heap.restoreState(state.gc, restoredObjects);
	m_luaHeap.restoreState(state.luaHeap);
}

void CPU::requestYield() {
	m_yieldRequested = true;
}

void CPU::haltUntilIrq() {
	if (m_interruptEventPending) {
		m_interruptEventPending = false;
		return;
	}
	m_haltedUntilIrqFrameDepth = static_cast<int>(m_activeThread->frameDepth);
	m_haltedUntilIrqThread = m_activeThread;
	m_yieldRequested = false;
}

void CPU::hardHalt() {
	m_hardHalted = true;
	m_haltedUntilIrqFrameDepth = -1;
	m_haltedUntilIrqThread = nullptr;
	m_yieldRequested = false;
}


void CPU::callBuiltinFunction(BuiltinFunction& fn, BuiltinArgsView args, BuiltinResults& out, int resultLimit) {
	switch (fn.id) {
		case BuiltinFunctionId::Next:
			runBuiltinNextValue(args[0], args[1], out);
			break;
		case BuiltinFunctionId::Type:
			out.push_back(valueString(m_stringPool.intern(valueTypeNameForLua(args[0]))));
			break;
		case BuiltinFunctionId::SetMetatable:
		case BuiltinFunctionId::GetMetatable:
		case BuiltinFunctionId::StringByte: {
			Value result;
			if (!executeBuiltinLeaf(fn.id, args, result)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			out.push_back(result);
			break;
		}
		case BuiltinFunctionId::RawGet:
			runBuiltinRawGet(args, out);
			break;
		case BuiltinFunctionId::RawSet:
			runBuiltinRawSet(args, out);
			break;
		case BuiltinFunctionId::GetGlobal:
			if (!valueIsString(args[0])) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			out.push_back(getGlobalByKey(asStringId(args[0])));
			break;
		case BuiltinFunctionId::SetGlobal:
			if (!valueIsString(args[0])) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			setGlobalByKey(asStringId(args[0]), args[1]);
			break;
		case BuiltinFunctionId::Select:
			runBuiltinSelect(args, out, resultLimit);
			break;
		case BuiltinFunctionId::FrameCount:
			out.push_back(valueNumber(asThread(args[0])->frameDepth));
			break;
		case BuiltinFunctionId::FrameHeader: {
			const auto& frame = *asThread(args[0])->frameAtDepth(toI32(args[1]));
			out.push_back(valueNumber(frame.functionAddress));
			out.push_back(valueNumber(frame.pc));
			out.push_back(valueNumber(frame.callSitePc));
			out.push_back(valueBool(frame.returnToCompletionLatch));
			out.push_back(valueNumber(static_cast<u32>(frame.executionImage->executionDomainId)));
			out.push_back(valueBool(frame.isExceptionFrame));
			break;
		}
		case BuiltinFunctionId::GetFrameRegister:
		case BuiltinFunctionId::SetFrameRegister: {
			auto& frame = *asThread(args[0])->frameAtDepth(toI32(args[1]));
			const int index = toI32(args[2]);
			if (fn.id == BuiltinFunctionId::GetFrameRegister) out.push_back(frame.registers[index]);
			else frame.registers[index] = args[3];
			break;
		}
		case BuiltinFunctionId::GetFrameUpvalue:
		case BuiltinFunctionId::SetFrameUpvalue: {
			const auto& frame = *asThread(args[0])->frameAtDepth(toI32(args[1]));
			Upvalue* upvalue = frame.closure->upvalues[toI32(args[2])];
			if (fn.id == BuiltinFunctionId::SetFrameUpvalue) writeUpvalue(upvalue, args[3]);
			else out.push_back(upvalue->open ? upvalue->frame->registers[upvalue->index] : upvalue->value);
			break;
		}
		case BuiltinFunctionId::StringChar:
			runBuiltinStringChar(args, out);
			break;
		case BuiltinFunctionId::SetStringIndex:
			if (!valueIsTable(args[0])) {
				throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			}
			m_stringIndexTable = asTable(args[0]);
			break;
		case BuiltinFunctionId::CoroutineCreate:
			if (args.empty() || !valueIsClosure(args[0])) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			out.push_back(valueThread(createThread(asClosure(args[0]))));
			break;
		case BuiltinFunctionId::CoroutineRunning:
			out.push_back(valueThread(m_activeThread));
			out.push_back(valueBool(m_activeThread == m_rootThread));
			break;
		case BuiltinFunctionId::CoroutineStatus:
		case BuiltinFunctionId::CoroutineClose:
		case BuiltinFunctionId::CoroutineIsYieldable: {
			Thread* thread = args.empty() && fn.id == BuiltinFunctionId::CoroutineIsYieldable ? m_activeThread
				: !args.empty() && valueIsThread(args[0]) ? asThread(args[0]) : nullptr;
			if (thread == nullptr) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			if (fn.id == BuiltinFunctionId::CoroutineIsYieldable) out.push_back(valueBool(coroutineYieldable(*thread)));
			else if (fn.id == BuiltinFunctionId::CoroutineStatus) {
				out.push_back(valueNumber(static_cast<int>(thread->status)));
			} else {
				const bool failed = thread->status == ThreadStatus::Failed;
				out.push_back(valueBool(!failed));
				if (failed) out.push_back(thread->error);
				closeThread(*thread);
				thread->error = valueNil();
			}
			break;
		}
		case BuiltinFunctionId::CoroutineResume:
		case BuiltinFunctionId::CoroutineYield:
			throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		case BuiltinFunctionId::CollectGarbage: {
			if (!args.empty() && !valueIsNumber(args[0])) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			const double operation = args.empty() ? 0.0 : asNumber(args[0]);
			if (operation == static_cast<int>(GarbageCollectionOperation::Collect)) m_luaHeap.collectRuntime();
			else if (operation == static_cast<int>(GarbageCollectionOperation::Count)) {
				out.push_back(valueNumber(m_luaHeap.usedBytes()));
				out.push_back(valueNumber(m_luaHeap.capacity()));
			} else if (operation == static_cast<int>(GarbageCollectionOperation::Step)) out.push_back(valueBool(m_luaHeap.stepRuntime()));
			else throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			break;
		}
		case BuiltinFunctionId::Error:
			runBuiltinError(args);
			break;
		case BuiltinFunctionId::PCall:
		case BuiltinFunctionId::XPCall:
			throw std::runtime_error("Protected calls execute as Lua CPU microcode.");
	}
}

Thread* CPU::createThread(Closure* entry) {
	m_luaHeap.reserve(THREAD_HEAP_BYTES + 8 * THREAD_STACK_SLOT_BYTES, valueClosure(entry));
	auto* thread = m_heap.allocate<Thread>(ObjType::Thread);
	thread->entry = entry;
	trackLocalRoot(valueThread(thread));
	return thread;
}

bool CPU::coroutineYieldable(const Thread& thread) const {
	if (&thread == m_rootThread) return false;
	for (auto* frame = thread.currentFrame; frame; frame = frame->previous)
		if (frame->isExceptionFrame || frame->returnToCompletionLatch) return false;
	for (size_t i = 0; i < thread.protectedCallDepth; ++i) {
		if (thread.protectedCallContinuations.get(i).kind == ProtectedCallKind::XPCallHandler) return false;
	}
	return true;
}

void CPU::returnToResumer(int sourceBase, int sourceCount, bool succeeded) {
	Thread* thread = m_activeThread;
	Thread* resumer = thread->resumer;
	m_activeThread = resumer;
	resumer->status = ThreadStatus::Running;
	CallFrame& caller = *resumer->currentFrame;
	const int count = decodeValueCount(resumer->returnCount, sourceCount + 1);
	if (count > 0) {
		ensureRegisterCapacity(caller, resumer->callBase + count - 1);
		caller.registers[resumer->callBase] = valueBool(succeeded);
		const int copied = std::min(sourceCount, count - 1);
		for (int i = 0; i < copied; ++i)
			caller.registers[resumer->callBase + i + 1] = succeeded ? thread->stack[sourceBase + i] : thread->error;
		for (int i = copied + 1; i < count; ++i) caller.registers[resumer->callBase + i] = valueNil();
	}
	caller.top = resumer->callBase + count;
	thread->resumer = nullptr;
	m_threadSwitchRequested = true;
	m_yieldRequested = true;
	instructionBudgetRemaining -= count;
}

void CPU::runCoroutineTransfer(BuiltinFunctionId id, CallFrame& caller, int base, int count, int argc) {
	Thread* thread = m_activeThread;
	if (id == BuiltinFunctionId::CoroutineYield) {
		if (!coroutineYieldable(*thread)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		thread->callBase = base;
		thread->returnCount = count;
		thread->status = ThreadStatus::Suspended;
		returnToResumer(caller.stackBase + base + 1, argc, true);
		return;
	}
	if (argc == 0 || !valueIsThread(caller.registers[base + 1])) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	Thread* target = asThread(caller.registers[base + 1]);
	const bool exceptionActive = readExceptionReturnFrameDepth() != -1;
	if (exceptionActive || (target->status != ThreadStatus::New && target->status != ThreadStatus::Suspended)) {
		auto scratch = acquireBuiltinResultScratch();
		BuiltinResults& out = scratch.get();
		out.push_back(valueBool(false));
		out.push_back(valueString(m_stringPool.intern(exceptionActive ? "cannot resume coroutine across a hardware exception" : "cannot resume non-suspended coroutine")));
		writeReturnValuesFromBuiltinResults(caller, base, count, out);
		return;
	}
	const bool fresh = target->status == ThreadStatus::New;
	thread->callBase = base;
	thread->returnCount = count;
	thread->status = ThreadStatus::Normal;
	target->resumer = thread;
	target->status = ThreadStatus::Running;
	m_activeThread = target;
	if (fresh) {
		pushFrame(caller, target->entry, base + 2, argc - 1, 0, 0, false, 0);
		target->entry = nullptr;
	} else {
		CallFrame& frame = *target->currentFrame;
		writeReturnValuesFromRegisters(frame, target->callBase, target->returnCount, caller, base + 2, argc - 1);
	}
	m_threadSwitchRequested = true;
	m_yieldRequested = true;
}

bool CPU::handleThreadError(Value error) {
	if (handleProtectedCallError(error)) return true;
	Thread* thread = m_activeThread;
	if (thread->resumer == nullptr) return false;
	for (auto* frame = thread->currentFrame; frame; frame = frame->previous)
		if (frame->isExceptionFrame || frame->returnToCompletionLatch) return false;
	thread->status = ThreadStatus::Failed;
	thread->error = error;
	returnToResumer(0, 1, false);
	return true;
}

void CPU::closeThread(Thread& thread) {
	if (thread.status == ThreadStatus::Running || thread.status == ThreadStatus::Normal) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	while (thread.currentFrame) {
		instructionBudgetRemaining -= closeUpvalues(*thread.currentFrame);
		thread.leaveFrame();
	}
	thread.protectedCallDepth = 0;
	thread.protectedCallContinuations.clear();
	std::fill_n(thread.stack, thread.stackCapacity, valueNil());
	thread.stackTop = 0;
	thread.entry = nullptr;
	thread.status = ThreadStatus::Dead;
}

void CPU::runBuiltinFunction(BuiltinFunction& fn, CallFrame& frame, int callBase, int returnCount, int argCount) {
	instructionBudgetRemaining -= static_cast<int>(fn.cycleBase);
	if (fn.id == BuiltinFunctionId::PCall || fn.id == BuiltinFunctionId::XPCall) {
		startProtectedCall(fn.id, frame, callBase, returnCount, callBase + 1, argCount, false);
		return;
	}
	auto outScratch = acquireBuiltinResultScratch();
	BuiltinResults& out = outScratch.get();
	if (fn.id == BuiltinFunctionId::CoroutineResume || fn.id == BuiltinFunctionId::CoroutineYield) {
		runCoroutineTransfer(fn.id, frame, callBase, returnCount, argCount);
		return;
	}
	const BuiltinArgsView args(frame.registers + static_cast<size_t>(callBase + 1), static_cast<size_t>(argCount));
	callBuiltinFunction(fn, args, out, returnCount == 0 ? -1 : returnCount - 1);
	if (m_activeThread->frameDepth != 0 && m_activeThread->currentFrame == &frame) {
		writeReturnValuesFromBuiltinResults(frame, callBase, returnCount, out);
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
	const size_t continuationIndex = m_activeThread->protectedCallDepth;
	ProtectedCallContinuation& continuation = m_activeThread->protectedCallContinuations.get(continuationIndex);
	m_activeThread->protectedCallDepth = continuationIndex + 1;
	continuation.kind = id == BuiltinFunctionId::PCall ? ProtectedCallKind::PCall : ProtectedCallKind::XPCallBody;
	continuation.caller = &caller;
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
	ProtectedCallContinuation& continuation = m_activeThread->protectedCallContinuations.get(continuationIndex);
	CallFrame& caller = *continuation.caller;
	if (valueIsClosure(target)) {
		auto* frame = pushFrame(caller, asClosure(target), argumentBase, argumentCount, 0, 0, false, caller.pc - INSTRUCTION_BYTES);
		if (frame) frame->protectedContinuationIndex = static_cast<i32>(continuationIndex);
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
			results, -1
		);
		finishProtectedCall(continuationIndex, results.data(), static_cast<int>(results.size()));
		return;
	}
	throw LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
}

void CPU::finishProtectedCall(size_t continuationIndex, const Value* values, int valueCount) {
	ProtectedCallContinuation& continuation = m_activeThread->protectedCallContinuations.get(continuationIndex);
	if (continuation.kind == ProtectedCallKind::XPCallHandler) {
		finishProtectedCallWithError(continuationIndex, valueCount > 0 ? values[0] : valueNil());
		return;
	}
	const int resultCount = writeProtectedResults(continuation, true, values, valueCount);
	instructionBudgetRemaining -= resultCount;
	finishProtectedContinuation(continuationIndex, resultCount);
}

void CPU::finishProtectedCall(size_t continuationIndex, CallFrame& source, int sourceBase, int sourceCount) {
	ProtectedCallContinuation& continuation = m_activeThread->protectedCallContinuations.get(continuationIndex);
	if (continuation.kind == ProtectedCallKind::XPCallHandler) {
		finishProtectedCallWithError(
			continuationIndex,
			sourceCount > 0 ? source.registers[static_cast<size_t>(sourceBase)] : valueNil()
		);
		return;
	}
	const int resultCount = writeProtectedResults(continuation, true, source, sourceBase, sourceCount);
	instructionBudgetRemaining -= resultCount;
	finishProtectedContinuation(continuationIndex, resultCount);
}

void CPU::finishProtectedCallWithError(size_t continuationIndex, Value errorValue) {
	ProtectedCallContinuation& continuation = m_activeThread->protectedCallContinuations.get(continuationIndex);
	CallFrame& caller = *continuation.caller;
	const int resultCount = decodeValueCount(continuation.returnCount, 2);
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
	instructionBudgetRemaining -= resultCount;
	finishProtectedContinuation(continuationIndex, resultCount);
}

int CPU::writeProtectedResults(ProtectedCallContinuation& continuation, bool prefix, const Value* values, int valueCount) {
	CallFrame& caller = *continuation.caller;
	const int resultCount = decodeValueCount(continuation.returnCount, valueCount + 1);
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
	const int resultCount = decodeValueCount(continuation.returnCount, sourceCount + 1);
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
	ProtectedCallContinuation& continuation = m_activeThread->protectedCallContinuations.get(continuationIndex);
	CallFrame* caller = continuation.caller;
	const int callBase = continuation.callBase;
	const bool returnsToProtectedParent = continuation.returnsToProtectedParent;
	continuation.caller = nullptr;
	m_activeThread->protectedCallDepth = continuationIndex;
	if (returnsToProtectedParent) {
		finishProtectedCall(continuationIndex - 1, *caller, callBase, resultCount);
	}
}

bool CPU::handleProtectedCallError(Value errorValue) {
	for (;;) {
		if (m_activeThread->protectedCallDepth == 0) {
			return false;
		}
		const size_t continuationIndex = m_activeThread->protectedCallDepth - 1;
		ProtectedCallContinuation& continuation = m_activeThread->protectedCallContinuations.get(continuationIndex);
		int callerIndex = static_cast<int>(m_activeThread->frameDepth) - 1;
		for (auto* frame = m_activeThread->currentFrame; frame != continuation.caller; frame = frame->previous, --callerIndex) {
			// Completion roots return to their latch, not the interrupted caller.
			if (frame->isExceptionFrame || frame->returnToCompletionLatch) {
				return false;
			}
		}
		unwindToDepth(callerIndex + 1, true);
		if (continuation.kind != ProtectedCallKind::XPCallBody) {
			const Value result = continuation.kind == ProtectedCallKind::XPCallHandler
				? m_errorInErrorHandlingValue
				: errorValue;
			finishProtectedCallWithError(continuationIndex, result);
			return true;
		}

		continuation.kind = ProtectedCallKind::XPCallHandler;
		CallFrame& caller = *continuation.caller;
		const Value handler = caller.registers[static_cast<size_t>(continuation.handlerRegister)];
		setRegister(caller, continuation.callBase, errorValue);
		--instructionBudgetRemaining;
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
	instructionBudgetRemaining -= static_cast<int>(asTable(target)->nextEntry(key, nextKey, nextValue));
	out.push_back(nextKey);
	if (!isNil(nextKey)) out.push_back(nextValue);
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

void CPU::runBuiltinSelect(BuiltinArgsView args, BuiltinResults& out, int resultLimit) {
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
	start = std::max(start, 1);
	const int available = std::max(count - start + 1, 0);
	const int produced = resultLimit < 0 ? available : std::min(available, resultLimit);
	for (int index = 0; index < produced; ++index) {
		out.push_back(args[static_cast<size_t>(start + index)]);
	}
}

void CPU::runBuiltinStringChar(BuiltinArgsView args, BuiltinResults& out) {
	instructionBudgetRemaining -= static_cast<int>(args.size());
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
	out.push_back(valueString(m_stringPool.internOwned(std::move(result))));
}

void CPU::runBuiltinError(BuiltinArgsView args) {
	const Value value = args[0];
	throw LuaThrownValueError(value);
}

void CPU::clearHaltUntilIrq() {
	m_haltedUntilIrqFrameDepth = -1;
	m_haltedUntilIrqThread = nullptr;
	m_yieldRequested = false;
}

void CPU::requestNonMaskableInterrupt() {
	// NMI is an edge latch and can preempt the supervisor IRQ root reached
	// immediately before a system-request fence.
	m_nonMaskableInterruptPending = true;
}

bool CPU::canAcceptMaskableInterruptLine() const {
	return (m_cop0Words[COP0_STATUS] & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) != 0u
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
	if (m_pendingMemory.kind != PendingMemoryKind::None) return false;
	if (m_nonMaskableInterruptPending) {
		m_nonMaskableInterruptPending = false;
		const bool hadHaltLatch = m_haltedUntilIrqFrameDepth >= 0;
		const u32 returnCauseWord = m_cop0Words[COP0_CAUSE];
		const u32 returnEpcWord = m_cop0Words[COP0_EPC];
		const u32 returnBadAddressWord = m_cop0Words[COP0_BAD_ADDRESS];
		const u32 returnLuaFaultReasonWord = m_cop0Words[COP0_LUA_FAULT_REASON];
		const u32 returnExceptionDomainWord = m_exceptionDomainWord;
		enterException(
			*m_systemImage,
			m_systemExceptionFunctionAddress,
			CPU_CAUSE_NMI,
			m_activeThread->currentFrame->pc
		);
		m_activeThread->currentFrame->isNonMaskableExceptionFrame = true;
		m_nmiReturnCauseWord = returnCauseWord;
		m_nmiReturnEpcWord = returnEpcWord;
		m_nmiReturnBadAddressWord = returnBadAddressWord;
		m_nmiReturnLuaFaultReasonWord = returnLuaFaultReasonWord;
		m_nmiReturnExceptionDomainWord = returnExceptionDomainWord;
		if (!hadHaltLatch) m_interruptEventPending = true;
		return true;
	}
	if (canAcceptMaskableInterruptLine()) {
		Blua32ExecutionImage& image = isUserMode() ? *executionImageForDomain(m_programExecutionDomainId) : *m_systemImage;
		const bool hadHaltLatch = m_haltedUntilIrqFrameDepth >= 0;
		enterException(image, image.irqFunctionAddress, CPU_CAUSE_IRQ, m_activeThread->currentFrame->pc);
		if (!hadHaltLatch) m_interruptEventPending = true;
		return true;
	}
	return false;
}

void CPU::enterSynchronousException(CallFrame& interruptedFrame, u32 causeWord) {
	interruptedFrame.pc = m_currentInstructionPc;
	enterException(*m_systemImage, m_systemExceptionFunctionAddress, causeWord, m_currentInstructionPc);
}

void CPU::enterSynchronousAddressException(CallFrame& interruptedFrame, u32 causeWord, u32 address) {
	m_cop0Words[COP0_BAD_ADDRESS] = address;
	enterSynchronousException(interruptedFrame, causeWord);
}

void CPU::enterInstructionFetchException(CallFrame& interruptedFrame, u32 causeWord, u32 pc) {
	instructionBudgetRemaining -= 1;
	interruptedFrame.pc = pc;
	enterException(*m_systemImage, m_systemExceptionFunctionAddress, causeWord, pc);
}

void CPU::enterLuaFaultException(u32 reason, Value errorValue) {
	m_cop0Words[COP0_LUA_FAULT_REASON] = reason;
	enterSynchronousException(*m_activeThread->currentFrame, CPU_CAUSE_CODE_TRAP);
	m_activeThread->currentFrame->registers[0] = errorValue;
}

void CPU::returnFromException(CallFrame& frame) {
	if (isUserMode()) {
		enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
		return;
	}
	if (!frame.isExceptionFrame) {
		hardHalt();
		return;
	}
	const bool returnFromNmi = frame.isNonMaskableExceptionFrame;
	const u32 returnPc = m_cop0Words[COP0_EPC];
	instructionBudgetRemaining -= closeUpvalues(frame);
	m_activeThread->leaveFrame();
	m_cop0Words[COP0_STATUS] = (m_cop0Words[COP0_STATUS] & ~CPU_STATUS_RFE_RESTORE_MASK)
		| ((m_cop0Words[COP0_STATUS] >> 2u) & CPU_STATUS_RFE_RESTORE_MASK);
	if (m_activeThread->frameDepth != 0) {
		auto& caller = *m_activeThread->currentFrame;
		caller.pc = returnPc;
		caller.compilationEntry = true;
	}
	if (returnFromNmi) {
		m_cop0Words[COP0_CAUSE] = m_nmiReturnCauseWord;
		m_cop0Words[COP0_EPC] = m_nmiReturnEpcWord;
		m_cop0Words[COP0_BAD_ADDRESS] = m_nmiReturnBadAddressWord;
		m_cop0Words[COP0_LUA_FAULT_REASON] = m_nmiReturnLuaFaultReasonWord;
		m_exceptionDomainWord = m_nmiReturnExceptionDomainWord;
	}
}

void CPU::enterException(
	Blua32ExecutionImage& vectorImage,
	u32 functionAddress,
	u32 causeWord,
	u32 epcWord
) {
	m_exceptionDomainWord = static_cast<u32>(m_activeThread->currentFrame->executionImage->executionDomainId);
	m_cop0Words[COP0_EPC] = epcWord;
	m_cop0Words[COP0_CAUSE] = causeWord;
	m_cop0Words[COP0_STATUS] = (m_cop0Words[COP0_STATUS] & ~CPU_STATUS_MODE_STACK_MASK)
		| ((m_cop0Words[COP0_STATUS] << 2u) & CPU_STATUS_MODE_STACK_MASK);
	clearHaltAfterAcceptedInterrupt();
	if (!readFunctionRecordOnBus(vectorImage, functionAddress, executionBusSignalsForDomain(vectorImage.executionDomainId))) {
		hardHalt();
		return;
	}
	Closure* closure = staticClosureForRecord(boundFunctionRecord(m_functionRecordLatch));
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
	m_haltedUntilIrqThread = nullptr;
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

#include "machine/cpu/cpu_calls.inl"
#include "machine/cpu/cpu_memory.inl"
#include "machine/cpu/cpu_strings.inl"

template <bool RootBoundary, bool Instrumented>
RunResult CPU::runLoop(
	int targetDepth,
	int instructionBudget
) {
	instructionBudgetRemaining = instructionBudget;
	Thread& thread = *m_activeThread;
	ExecutionHookBinding hookBinding;
	if constexpr (Instrumented) {
		hookBinding = m_executionHookBinding;
	}
	CallFrame* frame = nullptr;
	Blua32ExecutionImage* image = nullptr;
	DecodedInstruction* decoded;
	DecodedInstructionPage* decodedPage = nullptr;
	u32 pageAddress = 0;
	u32 pc = 0;
	Value* registers = nullptr;
	bool canReuseFrame = false;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const NativeBlock* nativeBlock = nullptr;
	int nativeFirstDispatchCycles = 0;
	bool forceScalarOnce = false;
	NativeCpuRunState nativeState{.cpu = this, .targetDepth = targetDepth,
		.systemRom = &m_memory.systemRomStorage(),
		.ram = {m_memory.ramData(), m_memory.ramByteCount()}};
#endif
	for (;;) {
		try {
			if (static_cast<int>(thread.frameDepth) > targetDepth && instructionBudgetRemaining > 0
				&& !m_memoryWriteBlocked && !m_hardHalted && !m_yieldRequested
				&& !(m_haltedUntilIrqThread == m_activeThread && m_haltedUntilIrqFrameDepth == static_cast<int>(thread.frameDepth))) resumePendingMemoryOperation();
			if constexpr (RootBoundary) {
				if (thread.frameDepth == 0) {
					return RunResult::Halted;
				}
			} else {
				if (static_cast<int>(thread.frameDepth) <= targetDepth) {
					return RunResult::Halted;
				}
			}
			if (m_hardHalted
				|| (m_haltedUntilIrqThread == m_activeThread && m_haltedUntilIrqFrameDepth == static_cast<int>(thread.frameDepth))
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
			frame = thread.currentFrame;
			image = frame->executionImage;
			if (image != m_activeExecutionImage) latchActiveExecutionImage(*image);
			registers = frame->registers;
			if constexpr (Instrumented) {
				if (m_nonMaskableInterruptPending) {
					enterPendingInterrupt();
					continue;
				}
				if ((m_cop0Words[COP0_STATUS] & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) != 0u
					&& m_irqController.hasAssertedMaskableInterruptLine()) {
					CallFrame* interruptedFrame = thread.currentFrame;
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
					|| ((m_cop0Words[COP0_STATUS] & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) != 0u
						&& m_irqController.hasAssertedMaskableInterruptLine())) {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
					// The next instruction belongs to the interrupt handler; retry admission
					// for the suspended instruction after RFE instead.
					forceScalarOnce = false;
#endif
					enterPendingInterrupt();
					continue;
				}
			}
			goto dispatch_fetch;

dispatch_fetch:
			pc = frame->pc;
			if constexpr (Instrumented) {
				if ((hookBinding.domainMask & executionDomainBit(image->executionDomainId)) != 0u
					&& hookBinding.hook(hookBinding.context, image->executionDomainId, pc)) {
					return RunResult::ExecutionStopped;
				}
			}
			if ((pc & (INSTRUCTION_BYTES - 1u)) != 0u) {
				m_cop0Words[COP0_BAD_ADDRESS] = pc;
				enterInstructionFetchException(*frame, CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD, pc);
				continue;
			}
			pageAddress = pc & ~MAPPED_PAGE_BYTE_MASK;
			decodedPage = &decodedPageForFrame(*frame, pc);
			goto dispatch_decode;

dispatch_decode:
			const u32 pageOffset = (pc & MAPPED_PAGE_BYTE_MASK) >> 2;
			u8 refreshState = decodedPage->refreshState[pageOffset];
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			[[maybe_unused]] const bool rewritten = (refreshState & DECODED_REFRESH_DECODE) != 0u
				&& decodedPage->words[pageOffset].width != 0u;
#endif
			if ((Instrumented
					? (refreshState & DECODED_REFRESH_DECODE)
					: refreshState) != 0u) {
				if (!decodeInstruction(*frame, *decodedPage, pageOffset, pc, !Instrumented)) {
					continue;
				}
				refreshState = decodedPage->refreshState[pageOffset];
			}
			decoded = &decodedPage->words[pageOffset];
			m_currentInstructionPc = pc;
			frame->pc = pc + (static_cast<u32>(decoded->width) * INSTRUCTION_BYTES);
			m_lastExecutionDomainId = image->executionDomainId;
			lastPc = pc + ((static_cast<u32>(decoded->width) - 1u) * INSTRUCTION_BYTES);
			uint8_t dispatchOp;
			if constexpr (Instrumented) {
				dispatchOp = decoded->dispatchOp == static_cast<u8>(DecodedDispatchOp::Observe)
					? decoded->dispatchOp : decoded->op;
				instructionBudgetRemaining -= dispatchOp == static_cast<u8>(DecodedDispatchOp::Observe)
					? decoded->dispatchCycles : decoded->baseCycles;
			} else {
				dispatchOp = decoded->dispatchOp;
				// Cacheable instruction reads cannot raise a device edge during fetch.
				canReuseFrame = (refreshState & DECODED_REFRESH_DECODE) == 0u;
				instructionBudgetRemaining -= decoded->dispatchCycles;
			}

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
#define TABLE_CACHE_SLOT() (decoded->tableCacheSlot)
#define DISPATCH_LABEL(name) case static_cast<uint8_t>(OpCode::name):
#define DISPATCH_CONTINUE() do { goto dispatch_continue; } while (0)
#define DISPATCH_NEXT() do { \
	if constexpr (!Instrumented) { \
		if (canReuseFrame && instructionBudgetRemaining > 0) { \
			pc = frame->pc; \
			if ((pc & ~MAPPED_PAGE_BYTE_MASK) == pageAddress) goto dispatch_decode; \
			goto dispatch_fetch; \
		} \
	} \
	goto dispatch_continue; \
} while (0)
#define DISPATCH_BLOCKED() do { return RunResult::Halted; } while (0)
#define DISPATCH_REBIND_FRAME() do { \
	goto dispatch_rebind_frame; \
} while (0)

dispatch_instruction:
			if constexpr (Instrumented) {
				switch (dispatchOp) {
				case static_cast<u8>(DecodedDispatchOp::ReservedMemory):
					enterSynchronousException(FRAME, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
					DISPATCH_CONTINUE();
				case static_cast<u8>(DecodedDispatchOp::Observe):
					goto dispatch_observe;
#include "machine/cpu/cpu_dispatch.inl"
				}
			} else {
				switch (dispatchOp) {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
				case static_cast<u8>(DecodedDispatchOp::NativeWarm): {
					auto& visits = decodedPage->nativeVisits[pageOffset];
					if (visits < NATIVE_BLOCK_COMPILATION_THRESHOLD) ++visits;
					if (FRAME.compilationEntry && visits == NATIVE_BLOCK_COMPILATION_THRESHOLD) {
						prepareNativeBlock(IMAGE, *decodedPage, pc, m_executionBusSignals);
					}
					FRAME.compilationEntry = rewritten || nativeBlockEndsBlock(decoded->op, decoded->b);
					dispatchOp = decoded->dispatchOp == static_cast<u8>(DecodedDispatchOp::NativeBlock)
						? decoded->dispatchOp : decoded->op;
					goto dispatch_instruction;
				}
				case static_cast<u8>(DecodedDispatchOp::NativeBlock): {
					// The CPU thread owns code publication and source writes. With no
					// intervening guest instruction, this is the same published entry;
					// interrupt entry above cancels the retry before any handler runs.
					if (forceScalarOnce) {
						forceScalarOnce = false;
						FRAME.compilationEntry = rewritten || nativeBlockEndsBlock(decoded->op, decoded->b);
						dispatchOp = decoded->op;
						goto dispatch_instruction;
					}
					nativeBlock = decodedPage->nativeBlocks->entries[pageOffset].get();
					// The first instruction's ordinary charge/PC publication has
					// already happened with positive budget, admitting this segment.
					nativeFirstDispatchCycles = decoded->baseCycles;
					goto dispatch_native_block;
				}
#endif
				case static_cast<u8>(DecodedDispatchOp::ReservedMemory):
					enterSynchronousException(FRAME, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
					DISPATCH_CONTINUE();
				case static_cast<u8>(DecodedDispatchOp::Observe):
					goto dispatch_observe;
				case static_cast<uint8_t>(DecodedDispatchOp::FusedShlBxor):
				case static_cast<uint8_t>(DecodedDispatchOp::FusedShrBxor): {
					const int a = decoded->a;
					const int rkB = decoded->b;
					const int rkC = decoded->c;
					const Value& shiftLeftValue = readRK(IMAGE, registers, rkB);
					const Value& shiftRightValue = readRK(IMAGE, registers, rkC);
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
					DecodedInstructionPage& successorPage = decodedPageForFrame(FRAME, successorPc);
					const u32 successorOffset = (successorPc & MAPPED_PAGE_BYTE_MASK) >> 2;
					if ((successorPage.refreshState[successorOffset]
						& DECODED_REFRESH_DECODE) != 0u) {
						if (!decodeInstruction(
							FRAME,
							successorPage,
							successorOffset,
							successorPc,
							false
						)) {
							DISPATCH_CONTINUE();
						}
					}
					decoded = &successorPage.words[successorOffset];
					m_currentInstructionPc = successorPc;
					FRAME.pc = successorPc
						+ (static_cast<u32>(decoded->width) * INSTRUCTION_BYTES);
					m_lastExecutionDomainId = IMAGE.executionDomainId;
					lastPc = successorPc
						+ ((static_cast<u32>(decoded->width) - 1u) * INSTRUCTION_BYTES);
					instructionBudgetRemaining -= decoded->baseCycles;
					const Value& xorLeftValue = readRK(IMAGE, registers, decoded->b);
					const Value& xorRightValue = readRK(IMAGE, registers, decoded->c);
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
					const int a = decoded->a;
					const int rkB = decoded->b;
					const int rkC = decoded->c;
					const Value& addLeftValue = readRK(IMAGE, registers, rkB);
					const Value& addRightValue = readRK(IMAGE, registers, rkC);
					SET_REGISTER_FAST(
						a,
						valueNumber(asNumber(addLeftValue) + asNumber(addRightValue))
					);
					if (instructionBudgetRemaining <= 0) {
						DISPATCH_CONTINUE();
					}
					const u32 successorPc = FRAME.pc;
					DecodedInstructionPage& successorPage = decodedPageForFrame(FRAME, successorPc);
					const u32 successorOffset = (successorPc & MAPPED_PAGE_BYTE_MASK) >> 2;
					if ((successorPage.refreshState[successorOffset]
						& DECODED_REFRESH_DECODE) != 0u) {
						if (!decodeInstruction(
							FRAME,
							successorPage,
							successorOffset,
							successorPc,
							false
						)) {
							DISPATCH_CONTINUE();
						}
					}
					decoded = &successorPage.words[successorOffset];
					m_currentInstructionPc = successorPc;
					FRAME.pc = successorPc
						+ (static_cast<u32>(decoded->width) * INSTRUCTION_BYTES);
					m_lastExecutionDomainId = IMAGE.executionDomainId;
					lastPc = successorPc
						+ ((static_cast<u32>(decoded->width) - 1u) * INSTRUCTION_BYTES);
					instructionBudgetRemaining -= decoded->baseCycles;
					const Value& shiftLeftValue = readRK(IMAGE, registers, decoded->b);
					const Value& shiftRightValue = readRK(IMAGE, registers, decoded->c);
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
			goto dispatch_continue;

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
dispatch_native_block: {
				nativeState.cartridgeSlot = m_memory.cartridgeController().selectedSlot(m_executionBusSignals);
				nativeState.cartridgeRom = m_memory.cartridgeController().romStorage(nativeState.cartridgeSlot);
				nativeState.codeRoot = IMAGE.nativeCodeLookup->root(nativeState.cartridgeSlot);
				nativeState.state = {.registers = registers, .constants = IMAGE.constPool.data(), .frame = frame,
					.globalValues = m_globalValues.data(), .systemGlobalValues = m_systemGlobalValues.data(),
					.cop0Words = m_cop0Words.data(), .constantCount = static_cast<u32>(IMAGE.constPool.size()),
					.remainingCycles = instructionBudgetRemaining + nativeFirstDispatchCycles, .registerTop = FRAME.top,
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
					.diagnosticOpcodes = {},
#endif
				};
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
				const int nativeStartBudget = nativeState.state.remainingCycles;
#endif
				nativeBlock->execute(nativeState);
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
				// Helpers publish the authoritative CPU grant before returning or
				// reporting an error; the native state's copy can then be stale.
				m_diagnosticExecutionProfile.nativeOriginCycles += static_cast<i64>(nativeStartBudget) - instructionBudgetRemaining;
				const auto& counts = nativeState.state.diagnosticOpcodes;
				auto& total = m_diagnosticExecutionProfile.nativeOpcodes;
				total.newt += counts.newt;
				total.call += counts.call;
				total.setfield += counts.setfield;
				total.concat += counts.concat;
				total.concatn += counts.concatn;
#endif
				if (nativeState.forceScalar) { forceScalarOnce = true; nativeState.forceScalar = false; }
				if (nativeState.error) std::rethrow_exception(std::exchange(nativeState.error, {}));
				DISPATCH_CONTINUE();
			}
#endif

dispatch_rebind_frame:
			if constexpr (Instrumented) goto dispatch_continue;
			if (canReuseFrame && instructionBudgetRemaining > 0) {
				if constexpr (RootBoundary) {
					if (thread.frameDepth == 0) return RunResult::Halted;
				} else {
					if (static_cast<int>(thread.frameDepth) <= targetDepth) return RunResult::Halted;
				}
				// A pure frame transition can activate the depth-sensitive HALT latch.
				if (m_haltedUntilIrqThread == m_activeThread
					&& m_haltedUntilIrqFrameDepth == static_cast<int>(thread.frameDepth)) return RunResult::Halted;
				frame = thread.currentFrame;
				image = frame->executionImage;
				if (image != m_activeExecutionImage) latchActiveExecutionImage(*image);
				registers = frame->registers;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
				pc = frame->pc;
				// A function record can supply a raw unaligned code address. Leave
				// its address exception to the ordinary instruction-fetch boundary.
				if ((pc & (INSTRUCTION_BYTES - 1u)) == 0u) {
					pageAddress = pc & ~MAPPED_PAGE_BYTE_MASK;
					decodedPage = &decodedPageForFrame(FRAME, pc);
					if (decodedPage->nativeBlocks) {
						nativeBlock = decodedPage->nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES].get();
						if (nativeBlock && instructionBudgetRemaining > 0) {
							nativeFirstDispatchCycles = 0;
							goto dispatch_native_block;
						}
					}
				}
#endif
				goto dispatch_fetch;
			}
			goto dispatch_continue;

dispatch_observe:
			canReuseFrame = false;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			FRAME.compilationEntry = rewritten || nativeBlockEndsBlock(decoded->op, decoded->b);
#endif
			m_instructionObserver.observe(m_instructionObserver.context, image->executionDomainId, pc, registers);
			// Observe has zero base cost; execute and charge the original instruction once.
			dispatchOp = decoded->op;
			instructionBudgetRemaining -= decoded->baseCycles;
			goto dispatch_instruction;

dispatch_continue:
#undef DISPATCH_BLOCKED
#undef DISPATCH_REBIND_FRAME
#undef DISPATCH_NEXT
#undef DISPATCH_CONTINUE
#undef DISPATCH_LABEL
#undef SKIP_NEXT_INSTRUCTION
#undef TABLE_CACHE_SLOT
#undef SET_REGISTER_FAST
#undef CYCLES_ADD
#undef REG
#undef IMAGE
#undef FRAME
			continue;
		} catch (const LuaOutOfMemorySignal&) {
			if (!handleThreadError(m_luaFaultErrorValues[LUA_FAULT_REASON_OUT_OF_MEMORY])) {
				enterLuaFaultException(
					LUA_FAULT_REASON_OUT_OF_MEMORY,
					m_luaFaultErrorValues[LUA_FAULT_REASON_OUT_OF_MEMORY]
				);
			}
		} catch (const LuaThrownValueError& error) {
			if (!handleThreadError(error.value)) {
				enterLuaFaultException(LUA_FAULT_REASON_EXPLICIT_ERROR, error.value);
			}
		} catch (const LuaExecutionError& error) {
			const Value errorValue = m_luaFaultErrorValues[error.reason];
			if (!handleThreadError(errorValue)) {
				enterLuaFaultException(error.reason, errorValue);
			}
		}
	}
}

RunResult CPU::runUntilDepth(int targetDepth, int instructionBudget, const Thread* target) {
	if (!target) target = m_rootThread;
	for (;;) {
		const RunResult result = m_runUntilDepthEntry(*this, m_activeThread == target ? targetDepth : 0, instructionBudget);
		if (!m_threadSwitchRequested) return result;
		m_threadSwitchRequested = false;
		m_yieldRequested = false;
		instructionBudget = instructionBudgetRemaining;
		if (instructionBudget <= 0) return RunResult::Yielded;
	}
}

RunResult CPU::runUntilDepthNormal(CPU& cpu, int targetDepth, int instructionBudget) {
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	cpu.publishNativeCompilation();
#endif
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

void CPU::setInstructionObserver(InstructionObserverBinding binding) {
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	discardNativeCompilation();
#endif
	m_instructionObserver = std::move(binding);
	// Predecessors may have fused across a newly observed PC.
	for (auto& image : m_executionImagesByDomain) {
		if (!image) continue;
		for (auto& [key, page] : image->decodedPages) {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			page.retireNativeBlocks();
#endif
			page.refreshState.fill(DECODED_REFRESH_DECODE);
		}
	}
}

void CPU::setExecutionHook(ExecutionHookBinding binding) {
	m_executionHookBinding = binding;
	m_runUntilDepthEntry = binding.hook == nullptr
		? &CPU::runUntilDepthNormal
		: &CPU::runUntilDepthInstrumented;
}

void CPU::unwindToDepth(int targetDepth, bool chargeCaptures) {
	if (static_cast<int>(m_activeThread->frameDepth) > targetDepth) abortStalledMemoryWrite();
	while (static_cast<int>(m_activeThread->frameDepth) > targetDepth) {
		auto* finished = m_activeThread->currentFrame;
		const int closed = closeUpvalues(*finished);
		if (chargeCaptures) instructionBudgetRemaining -= closed;
		m_activeThread->leaveFrame();
	}
	while (m_activeThread->protectedCallDepth > 0) {
		ProtectedCallContinuation& continuation = m_activeThread->protectedCallContinuations.get(m_activeThread->protectedCallDepth - 1);
		bool callerActive = false;
		for (auto* frame = m_activeThread->currentFrame; frame; frame = frame->previous) {
			if (frame == continuation.caller) {
				callerActive = true;
				break;
			}
		}
		if (callerActive) {
			break;
		}
		continuation.caller = nullptr;
		m_activeThread->protectedCallDepth -= 1;
	}
}

size_t CPU::collectionRootWordCount() const {
	size_t words = 3 * (m_systemGlobalNames.size() + m_globalNames.size());
	for (const auto& image : m_executionImagesByDomain) {
		if (image) words += 2 * image->constPool.size();
	}
	return words;
}

size_t CPU::collectHeap(Value root0, Value root1, Value root2, Thread* growingStack) {
	return m_heap.collect(root0, root1, root2, growingStack);
}

size_t CPU::stepHeap(Value root0, Value root1, Value root2, Thread* growingStack) {
	return m_heap.step(root0, root1, root2, growingStack);
}

ExecutionDomainId CPU::readFrameExecutionDomain(int frameIndex) const {
	return m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex))->executionImage->executionDomainId;
}

ExecutionDomainId CPU::readLastExecutionDomain() const {
	return m_lastExecutionDomainId;
}

u32 CPU::readCurrentInstructionPc() const {
	return m_currentInstructionPc;
}

u32 CPU::readFrameFunctionAddress(int frameIndex) const {
	return m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex))->functionAddress;
}

u32 CPU::readFramePc(int frameIndex) const {
	return m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex))->pc;
}

u32 CPU::readFrameCallSitePc(int childFrameIndex) const {
	return m_activeThread->frameAtDepth(static_cast<size_t>(childFrameIndex))->callSitePc;
}

bool CPU::completionCallPending() const {
	for (auto* frame = m_completionThread->currentFrame; frame; frame = frame->previous) {
		if (frame->returnToCompletionLatch) {
			return true;
		}
	}
	return false;
}

bool CPU::readFrameReturnsToCompletionLatch(int frameIndex) const {
	return m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex))->returnToCompletionLatch;
}

void CPU::abortCompletionCall(int frameIndex) {
	unwindToDepth(frameIndex, false);
	m_completionValues.clear();
}

auto CPU::readCompletionValues() const -> std::span<const Value> {
	return m_completionValues;
}

bool CPU::isExceptionFrame(int frameIndex) const {
	return m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex))->isExceptionFrame;
}

// Frame depth reached after all currently active exception roots return.
int CPU::readExceptionReturnFrameDepth() const {
	const CallFrame* frame = m_activeThread->firstFrame;
	for (size_t frameIndex = 0; frameIndex < m_activeThread->frameDepth; ++frameIndex, frame = frame->next) {
		if (frame->isExceptionFrame) return static_cast<int>(frameIndex);
	}
	return -1;
}

bool CPU::isNonMaskableExceptionFrame(int frameIndex) const {
	return m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex))->isNonMaskableExceptionFrame;
}

int CPU::getFrameRegisterCount(int frameIndex) const {
	return m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex))->top;
}

Value CPU::readFrameRegister(int frameIndex, int registerIndex) const {
	const CallFrame& frame = *m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex));
	return frame.registers[static_cast<size_t>(registerIndex)];
}

int CPU::getFrameUpvalueCount(int frameIndex) const {
	const CallFrame& frame = *m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex));
	return static_cast<int>(frame.closure->upvalueCount);
}

Value CPU::readFrameUpvalue(int frameIndex, int upvalueIndex) const {
	const CallFrame& frame = *m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex));
	return readClosureUpvalue(frame.closure, upvalueIndex);
}

Value CPU::readClosureUpvalue(const Closure* closure, int upvalueIndex) const {
	return readUpvalue(closure->upvalues[static_cast<size_t>(upvalueIndex)]);
}

u32 CPU::readEpcWord() const {
	return m_cop0Words[COP0_EPC];
}

u32 CPU::readCauseWord() const {
	return m_cop0Words[COP0_CAUSE];
}

u32 CPU::readBadAddressWord() const {
	return m_cop0Words[COP0_BAD_ADDRESS];
}

u32 CPU::readLuaFaultReasonWord() const {
	return m_cop0Words[COP0_LUA_FAULT_REASON];
}

u32 CPU::readExceptionDomainWord() const {
	return m_exceptionDomainWord;
}

void CPU::writeEpcWord(u32 value) {
	m_cop0Words[COP0_EPC] = value;
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
	CallFrame& frame = *m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex));
	if (&frame == m_activeThread->currentFrame) abortStalledMemoryWrite();
	const u32 registerCount = std::max(functionRecord.maxStack, functionRecord.numParams);
	if (registerCount > static_cast<u32>(frame.stackCapacity)) {
		ensureRegisterCapacity(frame, static_cast<int>(registerCount) - 1);
	}
	if ((functionRecord.flags & BLUA32_FUNCTION_STATIC) != 0u
		&& functionRecord.upvalueCount == 0u) {
		frame.closure = staticClosureForRecord(boundFunctionRecord(functionRecord));
	} else {
		Closure* oldClosure = frame.closure;
		m_luaHeap.reserve(kClosureHeapBytes + oldClosure->upvalueCount * kClosureUpvalueSlotHeapBytes);
		Closure* replacement = allocateTrackedClosure(functionRecord.address, oldClosure->upvalueCount);
		const Closure record = boundFunctionRecord(functionRecord);
		replacement->codeAddress = record.codeAddress;
		replacement->numParams = record.numParams;
		replacement->maxStack = record.maxStack;
		replacement->flags = record.flags;
		replacement->upvalueTableAddress = record.upvalueTableAddress;
		replacement->recordUpvalueCount = record.recordUpvalueCount;
		replacement->executionDomainId = record.executionDomainId;
		std::copy_n(oldClosure->upvalues, oldClosure->upvalueCount, replacement->upvalues);
		frame.closure = replacement;
	}
	frame.functionAddress = functionRecord.address;
	frame.executionImage = functionRecord.image;
	frame.decodedPage = nullptr;
	frame.decodedPageAddress = 0;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	frame.nativeContinuationCells = {};
#endif
	frame.compilationEntry = true;
	frame.pc = pc;
}

void CPU::writeFrameCallSitePc(int childFrameIndex, u32 pc) {
	m_activeThread->frameAtDepth(static_cast<size_t>(childFrameIndex))->callSitePc = pc;
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
		return staticClosureForRecord(boundFunctionRecord(functionRecord));
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
	m_luaHeap.reserve(closureHeapBytes + (newUpvalueCount * UPVALUE_HEAP_BYTES));
	auto* closure = allocateTrackedClosure(
		functionRecord.address,
		functionRecord.upvalueCount
	);
	closure->codeAddress = functionRecord.codeAddress;
	closure->numParams = functionRecord.numParams;
	closure->maxStack = functionRecord.maxStack;
	closure->flags = functionRecord.flags;
	closure->upvalueTableAddress = functionRecord.upvalueTableAddress;
	closure->recordUpvalueCount = functionRecord.upvalueCount;
	closure->executionDomainId = functionRecord.image->executionDomainId;
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
	instructionBudgetRemaining -= static_cast<int>(functionRecord.upvalueCount);
	return closure;
}

int CPU::closeUpvalues(CallFrame& frame) {
	int closed = 0;
	Upvalue* upvalue = frame.openUpvalueHead;
	frame.openUpvalueHead = nullptr;
	while (upvalue) {
		Upvalue* next = upvalue->nextOpen;
		upvalue->writeBarrier();
		upvalue->value = frame.registers[static_cast<size_t>(upvalue->index)];
		upvalue->open = false;
		upvalue->frame = nullptr;
		upvalue->nextOpen = nullptr;
		upvalue = next;
		++closed;
	}
	return closed;
}

const Value& CPU::readUpvalue(Upvalue* upvalue) const {
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
	upvalue->writeBarrier();
	upvalue->value = value;
}

CallFrame* CPU::pushFrame(CallFrame& caller, Closure* closure, int argBase, int argCount,
	int returnBase, int returnCount, bool returnToCompletionLatch, u32 callSitePc) {
	const Closure& functionRecord = *closure;
	const int callerArgBase = caller.stackBase + argBase;
	const bool sharedStack = caller.thread == m_activeThread;
	const int argumentBase = sharedStack ? callerArgBase : m_activeThread->stackTop;
	const bool vararg = (functionRecord.flags & BLUA32_FUNCTION_VARARG) != 0u;
	const int varargCount = vararg && static_cast<u32>(argCount) > functionRecord.numParams
		? static_cast<int>(static_cast<u32>(argCount) - functionRecord.numParams) : 0;
	const int stackBase = vararg ? argumentBase + argCount : argumentBase;
	const size_t targetCapacity = std::max({functionRecord.maxStack, functionRecord.numParams, 1u});
	auto* frame = m_activeThread->acquireFrame();
	ensureStackSize(static_cast<size_t>(stackBase) + targetCapacity, valueClosure(closure));
	frame->functionAddress = closure->functionAddress;
	frame->executionImage = executionImageForDomain(functionRecord.executionDomainId);
	frame->pc = functionRecord.codeAddress;
	frame->closure = closure;
	frame->returnBase = returnBase;
	frame->returnCount = returnCount;
	frame->returnToCompletionLatch = returnToCompletionLatch;
	frame->callSitePc = callSitePc;
	frame->varargBase = argumentBase + static_cast<int>(functionRecord.numParams);
	frame->varargCount = varargCount;
	frame->stackBase = stackBase;
	frame->stackCapacity = static_cast<int>(targetCapacity);
	frame->registers = m_activeThread->stack + stackBase;
	frame->top = static_cast<int>(functionRecord.numParams);
	const int copiedCount = std::min(frame->top, argCount);
	if (vararg || !sharedStack) {
		std::copy_n(caller.thread->stack + callerArgBase, copiedCount, frame->registers);
	}
	std::fill(frame->registers + copiedCount, frame->registers + frame->top, valueNil());
	if (vararg) {
		if (sharedStack) {
			// Fixed arguments now live in the relocated working frame. Keep only
			// the original extra arguments below it, as in a Lua vararg frame.
			std::fill_n(m_activeThread->stack + argumentBase, copiedCount, valueNil());
		} else {
			std::copy_n(caller.thread->stack + callerArgBase + frame->top,
				varargCount, m_activeThread->stack + frame->varargBase);
		}
	}
	instructionBudgetRemaining -= (vararg || !sharedStack ? frame->top : frame->top - copiedCount)
		+ (sharedStack ? 0 : varargCount);
	m_activeThread->stackTop = stackBase + frame->stackCapacity;
	m_activeThread->enterFrame(frame);
	return frame;
}

CallFrame* CPU::pushFrame(Closure* closure, const Value* args, size_t argCount,
	int returnBase, int returnCount, bool returnToCompletionLatch) {
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
	const Closure& functionRecord = *closure;
	const uintptr_t stackBegin = reinterpret_cast<uintptr_t>(m_activeThread->stack);
	const uintptr_t stackEnd = stackBegin + m_activeThread->stackCapacity * sizeof(Value);
	const uintptr_t argsBegin = reinterpret_cast<uintptr_t>(args);
	const uintptr_t argsEnd = argsBegin + argCount * sizeof(Value);
	const bool argsInStack = argCount > 0 && stackBegin != 0 && argsBegin >= stackBegin && argsEnd <= stackEnd;
	const ptrdiff_t argsOffset = argsInStack ? static_cast<ptrdiff_t>((argsBegin - stackBegin) / sizeof(Value)) : 0;
	auto* frame = m_activeThread->acquireFrame();
	const int argumentBase = m_activeThread->stackTop;
	const bool vararg = (functionRecord.flags & BLUA32_FUNCTION_VARARG) != 0u;
	const int varargCount = vararg && argCount > functionRecord.numParams
		? static_cast<int>(argCount - functionRecord.numParams) : 0;
	const int stackBase = vararg ? argumentBase + static_cast<int>(argCount) : argumentBase;
	const size_t targetCapacity = std::max({functionRecord.maxStack, functionRecord.numParams, 1u});
	ensureStackSize(static_cast<size_t>(stackBase) + targetCapacity, valueClosure(closure));
	frame->functionAddress = closure->functionAddress;
	frame->executionImage = executionImageForDomain(functionRecord.executionDomainId);
	frame->pc = functionRecord.codeAddress;
	frame->closure = closure;
	frame->returnBase = returnBase;
	frame->returnCount = returnCount;
	frame->returnToCompletionLatch = returnToCompletionLatch;
	frame->callSitePc = functionRecord.codeAddress;
	frame->varargBase = argumentBase + static_cast<int>(functionRecord.numParams);
	frame->varargCount = varargCount;
	frame->stackBase = stackBase;
	frame->stackCapacity = static_cast<int>(targetCapacity);
	frame->registers = m_activeThread->stack + stackBase;
	frame->top = static_cast<int>(functionRecord.numParams);
	const Value* sourceArgs = argsInStack ? m_activeThread->stack + argsOffset : args;
	const int copiedCount = std::min(frame->top, static_cast<int>(argCount));
	std::copy_n(sourceArgs, copiedCount, frame->registers);
	std::fill(frame->registers + copiedCount, frame->registers + frame->top, valueNil());
	if (varargCount != 0) {
		std::copy_n(sourceArgs + frame->top, varargCount, m_activeThread->stack + frame->varargBase);
	}
	m_activeThread->stackTop = stackBase + frame->stackCapacity;
	m_activeThread->enterFrame(frame);
	return frame;
}

void CPU::writeReturnValuesFromRegisters(CallFrame& frame, int base, int count, const CallFrame& source, int sourceBase, int sourceCount) {
	const int targetCount = decodeValueCount(count, sourceCount);
	if (targetCount > 0) {
		Value* registers = ensureRegisterCapacity(frame, base + targetCount - 1);
		// Backing growth can relocate both views; their stack offsets stay fixed.
		const Value* values = source.registers + sourceBase;
		const int copiedCount = std::min(sourceCount, targetCount);
		for (int i = 0; i < copiedCount; ++i) {
			registers[base + i] = values[i];
		}
		for (int i = copiedCount; i < targetCount; ++i) {
			registers[base + i] = valueNil();
		}
	}
	frame.top = base + targetCount;
	instructionBudgetRemaining -= targetCount;
}

void CPU::writeReturnValuesFromBuiltinResults(CallFrame& frame, int base, int count, const BuiltinResults& values) {
	const int valueCount = static_cast<int>(values.size());
	const int targetCount = decodeValueCount(count, valueCount);
	if (targetCount > 0) {
		Value* registers = ensureRegisterCapacity(frame, base + targetCount - 1);
		const int copiedCount = std::min(valueCount, targetCount);
		for (int i = 0; i < copiedCount; ++i) {
			registers[base + i] = values[i];
		}
		for (int i = copiedCount; i < targetCount; ++i) {
			registers[base + i] = valueNil();
		}
	}
	frame.top = base + targetCount;
	instructionBudgetRemaining -= targetCount;
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
	const size_t needed = static_cast<size_t>(index) + 1;
	size_t bucket = nextPowerOfTwo(needed);
	if (bucket < 8) {
		bucket = 8;
	}
	ensureStackSize(static_cast<size_t>(frame.stackBase) + bucket);
	frame.stackCapacity = static_cast<int>(bucket);
	frame.registers = frame.thread->stack + frame.stackBase;
	if (&frame == frame.thread->currentFrame) {
		frame.thread->stackTop = frame.stackBase + frame.stackCapacity;
	}
	return frame.registers;
}

// TODO: Admit function-valued __index through VM call/return continuations in
// all indexed-read forms. Table-only resolution is an implementation limitation,
// not the intended BLua contract; raw Table storage must not execute guest code.
Value CPU::resolveTableIndex(Table* table, const Value& key) {
	TableLookupResult result;
	table->resolveIndex(asStringId(m_indexKey), key, result);
	instructionBudgetRemaining -= static_cast<int>(result.extraVisits) * TABLE_INDEX_VISIT_CYCLES;
	if (result.status == TableLookupStatus::ChainExhausted) throw LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
	return result.value;
}

Value CPU::resolveTableIntegerIndex(Table* table, int index) {
	TableLookupResult result;
	table->resolveIntegerIndex(asStringId(m_indexKey), index, result);
	instructionBudgetRemaining -= static_cast<int>(result.extraVisits) * TABLE_INDEX_VISIT_CYCLES;
	if (result.status == TableLookupStatus::ChainExhausted) throw LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
	return result.value;
}

Value CPU::resolveTableFieldIndex(Table* table, StringId key) {
	TableLookupResult result;
	table->resolveStringIndex(asStringId(m_indexKey), key, result);
	instructionBudgetRemaining -= static_cast<int>(result.extraVisits) * TABLE_INDEX_VISIT_CYCLES;
	if (result.status == TableLookupStatus::ChainExhausted) throw LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
	return result.value;
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

Value CPU::loadTableFieldIndexCached(int& predictedSlot, const Value& base, StringId key) {
	Table* table;
	if (valueIsTable(base)) table = asTable(base);
	else if (valueIsString(base)) table = m_stringIndexTable;
	else throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NON_TABLE);
	if (!table->metatable) return table->getStringKeyCached(key, predictedSlot);
	TableLookupResult result;
	table->resolveStringIndexCached(asStringId(m_indexKey), key, predictedSlot, result);
	instructionBudgetRemaining -= static_cast<int>(result.extraVisits) * TABLE_INDEX_VISIT_CYCLES;
	if (result.status == TableLookupStatus::ChainExhausted) throw LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
	predictedSlot = result.slot;
	return result.value;
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

void CPU::storeTableFieldIndexCached(
	int& predictedSlot,
	const Value& base,
	StringId key,
	const Value& value
) {
	if (valueIsTable(base)) {
		asTable(base)->setStringKeyCached(key, value, predictedSlot);
		return;
	}
	throw LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
}

void CPU::clearCallStack() {
	abortStalledMemoryWrite();
	for (;;) {
		for (size_t index = 0; index < m_activeThread->protectedCallDepth; ++index) {
			ProtectedCallContinuation& continuation = m_activeThread->protectedCallContinuations.get(index);
			continuation.caller = nullptr;
		}
		m_activeThread->protectedCallDepth = 0;
		while (m_activeThread->frameDepth != 0) {
			CallFrame* frame = m_activeThread->currentFrame;
			closeUpvalues(*frame);
			m_activeThread->leaveFrame();
		}
		std::fill_n(m_activeThread->stack, m_activeThread->stackCapacity, valueNil());
		m_activeThread->stackTop = 0;
		Thread* thread = m_activeThread;
		thread->status = ThreadStatus::Dead;
		thread->entry = nullptr;
		thread->error = valueNil();
		if (thread == m_rootThread) break;
		m_activeThread = thread->resumer == nullptr ? m_rootThread : thread->resumer;
		thread->resumer = nullptr;
	}
	m_rootThread->status = ThreadStatus::Running;
	m_completionThread = m_rootThread;
	m_threadSwitchRequested = false;
}


void CPU::ensureStackSize(size_t size, Value root) {
	if (size <= m_activeThread->stackCapacity) return;
	size_t capacity = 8;
	while (capacity < size) capacity *= 2;
	// Admission must not shrink the allocation whose growth it is admitting.
	m_luaHeap.reserve((capacity - m_activeThread->stackCapacity) * THREAD_STACK_SLOT_BYTES,
		root, valueNil(), valueNil(), m_activeThread);
	m_activeThread->resizeStack(capacity);
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
	m_stringPool.endLocalRoots();
}

void CPU::trackLocalRoot(Value value) {
	if (m_localRootScopeDepth > 0) {
		m_localRoots.push_back(value);
	}
}

void CPU::markRoots(GcHeap& heap) {
	// Keep the interned "__index" key tracked even while no live metatable uses it.
	heap.markValue(m_indexKey);
	heap.markValue(m_errorInErrorHandlingValue);
	for (const Value value : m_luaFaultErrorValues) heap.markValue(value);
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
	for (size_t slot = 0; slot < m_systemGlobalNames.size(); ++slot) {
		m_stringPool.markReachable(m_systemGlobalNames[slot]);
		heap.markValue(m_systemGlobalValues[slot]);
	}
	for (size_t slot = 0; slot < m_globalNames.size(); ++slot) {
		m_stringPool.markReachable(m_globalNames[slot]);
		heap.markValue(m_globalValues[slot]);
	}
	for (const std::unique_ptr<Blua32ExecutionImage>& executionImage : m_executionImagesByDomain) {
		if (!executionImage) {
			continue;
		}
		Blua32ExecutionImage* image = executionImage.get();
		for (Value value : image->constPool) {
			heap.markValue(value);
		}
	}
	heap.markObject(m_rootThread);
	heap.markObject(m_activeThread);
	heap.markObject(m_completionThread);
	heap.markObject(m_haltedUntilIrqThread);
}

// end repeated-sequence-acceptable

} // namespace bmsx
