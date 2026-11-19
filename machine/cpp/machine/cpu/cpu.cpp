#include "machine/cpu/cpu.h"

#include <bit>
#include "machine/cpu/value_arithmetic.h"
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
#include <algorithm>
#include <cctype>
#include <stdexcept>
#include <unordered_set>

namespace bmsx {

// start repeated-sequence-acceptable -- CPU interpreter hot paths keep duplicated opcode/register statements inline.

namespace {

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
	, m_heapAllocator(memory)
	, m_luaHeap(*this)
	, m_stringPool(m_luaHeap, memory, m_heapAllocator)
	, m_indexKey(valueString(m_stringPool.intern("__index")))
	, m_heap(*this, m_luaHeap, m_memory, m_heapAllocator, m_stringPool, m_stringPool.intern("__mode"))
	, m_errorInErrorHandlingValue(valueString(m_stringPool.intern("error in error handling"))) {
	m_cop0Words[COP0_STATUS] = CPU_STATUS_CART_ENTRY;
	m_luaFaultErrorValues.fill(valueNil());
	m_luaFaultErrorValues[LUA_FAULT_REASON_UNKNOWN] = valueString(m_stringPool.intern("Attempted to get length of an unsupported value."));
	m_luaFaultErrorValues[LUA_FAULT_REASON_CALL_NON_FUNCTION] = valueString(m_stringPool.intern("Attempted to call a non-function value."));
	m_luaFaultErrorValues[LUA_FAULT_REASON_INDEX_NON_TABLE] = valueString(m_stringPool.intern("Attempted to index field on a non-table value."));
	m_luaFaultErrorValues[LUA_FAULT_REASON_ASSIGN_NON_TABLE] = valueString(m_stringPool.intern("Attempted to assign to a non-table value."));
	m_luaFaultErrorValues[LUA_FAULT_REASON_INDEX_NIL] = valueString(m_stringPool.intern("Table index is nil."));
	m_luaFaultErrorValues[LUA_FAULT_REASON_METATABLE_LOOP] = valueString(m_stringPool.intern("Metatable __index loop detected."));
	m_luaFaultErrorValues[LUA_FAULT_REASON_ITERATE_NON_TABLE] = valueString(m_stringPool.intern("Attempted to iterate a non-table value."));
	m_luaFaultErrorValues[LUA_FAULT_REASON_XPCALL_HANDLER_NOT_FUNCTION] = valueString(m_stringPool.intern("xpcall error handler must be a function."));
	m_luaFaultErrorValues[LUA_FAULT_REASON_OUT_OF_MEMORY] = valueString(m_stringPool.intern("Out of memory."));
	m_luaFaultErrorValues[LUA_FAULT_REASON_INVALID_ARGUMENT] = valueString(m_stringPool.intern("Invalid argument."));
	m_luaFaultErrorValues[LUA_FAULT_REASON_INVALID_NEXT_KEY] = valueString(m_stringPool.intern("invalid key to 'next'"));
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
	m_rootThread = createThread(nullptr);
	m_rootThread->setStatus(ThreadStatus::Running);
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
	return valueBuiltinFunction(id);
}

Table* CPU::createTable(int arraySize, int hashSize) {
	const size_t hashCapacity = Table::hashCapacity(hashSize);
	const u32 address = m_luaHeap.allocateRecord(Table::HEADER_BYTES, false, Table::storageBytes(arraySize, hashCapacity),
		static_cast<u32>(TableHeader::Storage));
	Table* table = m_heap.allocate<Table>(ObjType::Table, m_heap, address);
	table->initialize(arraySize, hashCapacity);
	trackLocalRoot(valueTable(m_heap.reference(table)));
	return table;
}

Closure* CPU::allocateClosure(const FunctionPrototype& prototype, u32 count, bool canonical, std::span<u32> cells) {
	const u32 address = m_luaHeap.allocateClosureRecord(count, cells);
	Closure* closure = m_heap.bindClosureRecord(address, prototype, count, canonical);
	closure->initializeRecord();
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
	m_completionValues.clear(0, m_completionValueCount); m_completionValueCount = 0;
	clearCallStack();
	m_stringIndexTable = valueNil();
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
	m_heap.armThreadStackWatches();
	if (!setProgramHeapFloor(systemBoot.staticEnd)) { hardHalt(); return; }
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	clearNativeContinuationBindings();
#endif
	for (std::unique_ptr<Blua32ExecutionImage>& image : m_executionImagesByDomain) {
		image.reset();
	}
	m_stringPool.clearRomTables();
	std::unique_ptr<Blua32ExecutionImage> activatedSystemImage =
		activateExecutionImage(systemBoot);
	m_systemImage = activatedSystemImage.get();
	m_executionImagesByDomain[static_cast<size_t>(SYSTEM_EXECUTION_DOMAIN_ID + 1)] =
		std::move(activatedSystemImage);
	m_systemExceptionFunctionAddress = systemExceptionFunctionAddress;
	latchActiveExecutionImage(SYSTEM_EXECUTION_DOMAIN_ID, m_systemImage);
	if (!readFunctionRecord(*m_systemImage, systemResetFunctionAddress, executionBusSignalsForDomain(SYSTEM_EXECUTION_DOMAIN_ID))) {
		hardHalt();
		return;
	}
	Closure* systemResetClosure = staticClosureForRecord(decodePrototype(m_functionRecordLatch));
	pushFrame(systemResetClosure, {}, 0, 0, false);
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

ValueSlots CPU::decodeConstantPool(
	ExecutionDomainId executionDomainId,
	u32 tableAddress,
	u32 constantCount,
	bool restoring
) {
	ValueSlots constPool(constantCount);
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
				constPool.set(index, valueNil());
				break;
			case Blua32ConstantTag::False:
				constPool.set(index, valueBool(false));
				break;
			case Blua32ConstantTag::True:
				constPool.set(index, valueBool(true));
				break;
			case Blua32ConstantTag::Integer:
				constPool.set(index, valueInteger(static_cast<i32>(readLE32(record + BLUA32_CONSTANT_PAYLOAD_OFFSET))));
				break;
			case Blua32ConstantTag::Float:
				constPool.set(index, valueFloatBits(readLE32(record + BLUA32_CONSTANT_PAYLOAD_OFFSET)));
				break;
			case Blua32ConstantTag::String:
				constPool.set(index, valueString(m_stringPool.resolveImageRecord(
					executionDomainId,
					readLE32(record + BLUA32_CONSTANT_PAYLOAD_OFFSET),
					restoring
				)));
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
	bool system,
	bool restoring
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
		const StringId key = m_stringPool.resolveImageRecord(
			executionDomainId,
			readLE32(record + BLUA32_GLOBAL_NAME_ADDRESS_OFFSET),
			restoring
		);
		auto slot = slotByKey.find(key);
		if (slot == slotByKey.end()) {
			const size_t slotIndex = registeredNames.size();
			slot = slotByKey.emplace(key, slotIndex).first;
			registeredNames.push_back(key);
			values.reserveCapacity(registeredNames.size());
		}
		slots[index] = static_cast<u32>(slot->second);
	}
	return slots;
}

std::unique_ptr<Blua32ExecutionImage> CPU::activateExecutionImage(
	Blua32ExecutionBoot executionBoot, bool restoring
) {
	const ExecutionDomainId executionDomainId = executionBoot.executionDomainId;
	auto image = std::make_unique<Blua32ExecutionImage>();
	image->executionDomainId = executionDomainId;
	image->irqFunctionAddress = executionBoot.irqFunctionAddress;
	image->staticEnd = executionBoot.staticEnd;
	m_executionAddressSpace.bindReadOnlyView(
		executionDomainId,
		executionBoot.imageAddress,
		BLUA32_IMAGE_HEADER_SIZE,
		m_executionReadView
	);
	const u8* header = m_executionReadView.data();
	if (readLE32(header + BLUA32_IMAGE_MAGIC_OFFSET) != BLUA32_IMAGE_MAGIC
		|| readLE32(header + BLUA32_IMAGE_VERSION_OFFSET) != BLUA32_IMAGE_VERSION) {
		throw BMSX_RUNTIME_ERROR("BLua32 image format is unsupported.");
	}
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
	if (!restoring) m_stringPool.activateRomTable(executionDomainId,
		readLE32(header + BLUA32_IMAGE_STRING_BUCKET_ADDRESS_OFFSET),
		readLE32(header + BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET));
	image->constPool = decodeConstantPool(
		executionDomainId,
		constantTableAddress,
		constantCount, restoring
	);
	image->globalSlots = registerGlobalNames(
		executionDomainId,
		globalNameTableAddress,
		globalNameCount,
		false, restoring
	);
	image->systemGlobalSlots = registerGlobalNames(
		executionDomainId,
		systemGlobalNameTableAddress,
		systemGlobalNameCount,
		true, restoring
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

void CPU::latchActiveExecutionImage(ExecutionDomainId domain, Blua32ExecutionImage* image) {
	m_activeExecutionDomainId = domain;
	m_activeExecutionImage = image;
	m_executionBusSignals = executionBusSignalsForDomain(domain);
}

void CPU::resumeFrameBank() {
	if (auto* frame = m_activeThread->currentFrame) {
		const auto domain = frame->savedExecutionBank();
		if (domain == m_activeExecutionDomainId && frame->executionImage == m_activeExecutionImage) return;
		auto* image = executionImageForDomain(domain);
		if (image != frame->executionImage) {
			frame->executionImage = image;
			frame->decodedPage = nullptr;
			frame->decodedPageAddress = 0;
			frame->compilationEntry = true;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			frame->nativeContinuationCells = {};
#endif
		}
		latchActiveExecutionImage(domain, image);
	}
}

void CPU::replaceExecutionImage(Blua32ExecutionBoot executionBoot) {
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	discardNativeCompilation();
#endif
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	clearNativeContinuationBindings();
#endif
	if (executionBoot.executionDomainId == m_programExecutionDomainId && !m_heapAllocator.setFloor(executionBoot.staticEnd)) {
		throw BMSX_RUNTIME_ERROR("Replacement program static storage overlaps live language-heap pages.");
	}
	std::unique_ptr<Blua32ExecutionImage>& imageEntry = m_executionImagesByDomain[
		static_cast<size_t>(executionBoot.executionDomainId + 1)
	];
	std::unique_ptr<Blua32ExecutionImage> image =
		activateExecutionImage(executionBoot);
	auto previousImage = std::move(imageEntry);
	Blua32ExecutionImage* activatedImage = image.get();
	imageEntry = std::move(image);
	if (activatedImage->executionDomainId == SYSTEM_EXECUTION_DOMAIN_ID) {
		m_systemImage = activatedImage;
		m_systemExceptionFunctionAddress = executionBoot.exceptionFunctionAddress;
	}
	if (previousImage) {
		m_heap.visitThreads([&](Thread& thread) {
			for (auto* frame = thread.firstFrame; frame; frame = frame->next) {
				if (frame->executionImage != previousImage.get()) continue;
				frame->executionImage = activatedImage;
				frame->decodedPage = nullptr;
				frame->decodedPageAddress = 0;
				frame->compilationEntry = true;
			}
		});
	}
	if (m_activeExecutionDomainId == activatedImage->executionDomainId) {
		latchActiveExecutionImage(m_activeExecutionDomainId, activatedImage);
		auto* frame = m_activeThread->currentFrame;
		if (frame && !frame->executionImage) frame->executionImage = activatedImage;
	}
}

bool CPU::isExecutionDomainResident(ExecutionDomainId executionDomainId) const {
	return m_executionImagesByDomain[
		static_cast<size_t>(executionDomainId + 1)
	] != nullptr;
}

FunctionPrototype CPU::decodePrototype(const Blua32FunctionRecordLatch& record) const {
	FunctionPrototype result;
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

Closure* CPU::staticClosureForRecord(const FunctionPrototype& record) {
	auto found = m_staticClosuresByAddress.find(record.functionAddress);
	Closure* first = nullptr;
	if (found != m_staticClosuresByAddress.end()) {
		for (Closure* closure : found->second) {
			if (*closure->prototype == record && (!first || closure->hashId < first->hashId)) first = closure;
		}
	}
	if (first) return first;
	Closure* closure = allocateClosure(record, 0, true);
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
	m_completionValues.clear(0, m_completionValueCount); m_completionValueCount = 0;
	clearCallStack();
	clearGlobalSlots();
}

void CPU::clearGlobalSlots() {
	m_systemGlobalNames.clear();
	m_systemGlobalValues.resize(0);
	m_systemGlobalSlotByKey.clear();
	m_globalNames.clear();
	m_globalValues.resize(0);
	m_globalSlotByKey.clear();
}

void CPU::setGlobalByKey(StringId key, const Value& value) {
	const auto [slot, inserted] = m_globalSlotByKey.try_emplace(key, m_globalNames.size());
	if (inserted) {
		m_globalNames.push_back(key);
		m_globalValues.reserveCapacity(m_globalNames.size());
		m_globalValues.set(slot->second, value);
	} else {
		m_globalValues.set(slot->second, value);
	}
}

void CPU::setSystemGlobalByKey(StringId key, const Value& value) {
	const auto slot = m_systemGlobalSlotByKey.find(key);
	if (slot == m_systemGlobalSlotByKey.end()) {
		throw BMSX_RUNTIME_ERROR("System global '" + m_stringPool.toString(key) + "' has no register slot.");
	}
	m_systemGlobalValues.set(slot->second, value);
}

Value CPU::getSystemGlobalByKey(StringId key) const {
	return m_systemGlobalValues.get(m_systemGlobalSlotByKey.find(key)->second);
}

Value CPU::getGlobalByKey(StringId key) const {
	const auto globalIt = m_globalSlotByKey.find(key);
	if (globalIt != m_globalSlotByKey.end()) {
		return m_globalValues.get(globalIt->second);
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

void CPU::invalidateMappedViews(u64 key, u32 firstWord, u32 endWord) {
	const auto address = static_cast<u32>(key);
	m_activeStackRebound |= m_heap.observeStackWrites(address + firstWord * 4u,
		address + endWord * 4u, m_activeThread);
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
	const u32 pc = frame.readControl(FrameField::Pc);
	DecodedInstructionPage& page = decodedPageForFrame(frame, pc);
	const u32 offset = (pc & MAPPED_PAGE_BYTE_MASK) >> 2;
	if ((page.refreshState[offset] & DECODED_REFRESH_DECODE) != 0u
		&& !decodeInstruction(frame, page, offset, pc, false)) {
		return;
	}
	const u32 nextPc = pc + static_cast<u32>(page.words[offset].width) * INSTRUCTION_BYTES;
	frame.writeControl(FrameField::Pc, nextPc);
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

bool CPU::setProgramHeapFloor(u32 staticEnd) {
	if (m_heapAllocator.setFloor(staticEnd)) return true;
	m_luaHeap.collectRuntime();
	return m_heapAllocator.setFloor(staticEnd);
}

void CPU::executeFunctionAddress(u32 functionAddress) {
	// The target image's static storage must be free of live heap pages before
	// its activation or startup can write there.
	const auto targetDomainId = m_executionAddressSpace.domainIdOnBus(functionAddress, MAPPED_BUS_MASTER_CPU);
	std::optional<u32> staticEnd;
	if (!targetDomainId) {
		staticEnd = m_activeExecutionImage->staticEnd;
	} else if (const auto targetBoot = m_executionAddressSpace.resolveDomain(*targetDomainId)) {
		staticEnd = targetBoot->staticEnd;
	}
	if (staticEnd && !setProgramHeapFloor(*staticEnd)) {
		hardHalt();
		return;
	}
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
	latchActiveExecutionImage(m_functionRecordLatch.image->executionDomainId, m_functionRecordLatch.image);
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
	Closure* closure = staticClosureForRecord(decodePrototype(m_functionRecordLatch));
	pushFrame(closure, {}, 0, 0, false);
}

void CPU::beginCompletionCall(Closure& closure, BuiltinArgsView args) {
	// Call injection takes over the physical instruction stream. The suspended
	// frame retains its PC; an unaccepted endpoint access must not follow it.
	abortStalledMemoryWrite();
	auto roots = acquireLocalRoots();
	trackLocalRoot(valueClosure(m_heap.reference(&closure)));
	for (size_t index = 0; index < args.size(); ++index) trackLocalRoot(args[index]);
	// The input span may borrow the completion latch being cleared below.
	args = BuiltinArgsView(m_localRoots.data() + m_localRoots.size() - args.size(), args.size());
	m_completionValues.clear(0, m_completionValueCount); m_completionValueCount = 0;
	m_completionThread = m_activeThread;
	m_yieldRequested = false;
	pushFrame(&closure, args, 0, 0, true);
}

void CPU::beginCompletionCallInExecutionDomain(
	ExecutionDomainId executionDomainId,
	u32 functionAddress
) {
	if (!readFunctionRecord(*executionImageForDomain(executionDomainId), functionAddress, executionBusSignalsForDomain(executionDomainId))) {
		hardHalt();
		return;
	}
	beginCompletionCall(*staticClosureForRecord(decodePrototype(m_functionRecordLatch)));
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
		snapshot.setWord(offset, static_cast<u32>(valueTag(value)));
		snapshot.setWord(offset + 1, valuePayload(value));
	};
	const auto captureValueState = [&](Value value) -> u32 {
		const u32 offset = snapshot.reserveWords(CPU_SNAPSHOT_VALUE_WORDS);
		writeValue(offset, value);
		return offset;
	};

	CpuRuntimeState state;
	const auto captureThread = [&](const Thread* thread) -> u32 {
		CpuThreadState saved;
		if (m_heap.sweepGarbage(thread)) {
			const u32 index = static_cast<u32>(state.threads.size());
			state.threads.push_back(std::move(saved));
			return index;
		}
		saved.frameDepth = static_cast<u32>(thread->frameDepth);
		saved.stackTop = thread->stackTop;
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
		const Value value = m_systemGlobalValues.get(index);
		state.systemGlobals.push_back(CpuRootValueState{
			m_systemGlobalNames[index],
			captureValueState(value),
		});
	}
	state.globalSlots.reserve(m_globalNames.size());
	for (size_t index = 0; index < m_globalNames.size(); ++index) {
		state.globalSlots.push_back(CpuRootValueState{
			m_globalNames[index],
			captureValueState(m_globalValues.get(index)),
		});
	}
	state.executionCartridgeSlot = m_activeExecutionDomainId;
	state.programExecutionDomainId = m_programExecutionDomainId;
	state.completionValues.reserve(m_completionValueCount);
	for (size_t i = 0; i < m_completionValueCount; ++i) {
		state.completionValues.push_back(captureValueState(m_completionValues.get(i)));
	}
	state.stringIndexTable = captureValueState(
		m_stringIndexTable
	);
	// Cache residency is allocation state even when a static closure is no
	// longer in a live register. Order the cold snapshot by physical address.
	std::vector<const Closure*> canonicalClosures;
	canonicalClosures.reserve(m_staticClosuresByAddress.size());
	for (const auto& [address, versions] : m_staticClosuresByAddress) {
		for (const Closure* closure : versions) canonicalClosures.push_back(closure);
	}
	std::stable_sort(canonicalClosures.begin(), canonicalClosures.end(), [](const Closure* left, const Closure* right) {
		return std::tie(left->prototype->functionAddress, left->prototype->executionDomainId, left->prototype->codeAddress, left->prototype->numParams, left->prototype->maxStack, left->prototype->flags, left->prototype->upvalueTableAddress, left->prototype->recordUpvalueCount, left->upvalueCount, left->hashId)
			< std::tie(right->prototype->functionAddress, right->prototype->executionDomainId, right->prototype->codeAddress, right->prototype->numParams, right->prototype->maxStack, right->prototype->flags, right->prototype->upvalueTableAddress, right->prototype->recordUpvalueCount, right->upvalueCount, right->hashId);
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
		if (object->type == ObjType::Garbage) {
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
				snapshot.setWord(offset + SNAP_THREAD_RECORD, thread->address);
				break;
			}
			case ObjType::Table:
				offset = static_cast<const Table*>(object)->captureSnapshot(snapshot);
				break;
			case ObjType::Closure: {
				const auto* closure = static_cast<const Closure*>(object);
				offset = snapshot.reserveWords(SNAP_CLOSURE_SIZE);
				snapshot.setWord(offset + SNAP_CLOSURE_KIND, static_cast<u32>(CpuSnapshotObjectKind::Closure));
				snapshot.setWord(offset + SNAP_CLOSURE_HASH_ID, closure->hashId);
				snapshot.setWord(offset + SNAP_CLOSURE_FUNCTION_ADDRESS, closure->prototype->functionAddress);
				snapshot.setWord(offset + SNAP_CLOSURE_CANONICAL, closure->canonical);
				snapshot.setWord(offset + SNAP_CLOSURE_UPVALUE_COUNT, static_cast<u32>(closure->upvalueCount));
				snapshot.setWord(offset + SNAP_CLOSURE_CODE_ADDRESS, closure->prototype->codeAddress);
				snapshot.setWord(offset + SNAP_CLOSURE_NUM_PARAMS, closure->prototype->numParams);
				snapshot.setWord(offset + SNAP_CLOSURE_MAX_STACK, closure->prototype->maxStack);
				snapshot.setWord(offset + SNAP_CLOSURE_FLAGS, closure->prototype->flags);
				snapshot.setWord(offset + SNAP_CLOSURE_UPVALUE_TABLE_ADDRESS, closure->prototype->upvalueTableAddress);
				snapshot.setWord(offset + SNAP_CLOSURE_RECORD_UPVALUE_COUNT, closure->prototype->recordUpvalueCount);
				snapshot.setWord(offset + SNAP_CLOSURE_EXECUTION_DOMAIN_ID, static_cast<u32>(closure->prototype->executionDomainId));
				snapshot.setWord(offset + SNAP_CLOSURE_RECORD, closure->address);
				break;
			}
			case ObjType::Upvalue: {
				const auto* upvalue = static_cast<const Upvalue*>(object);
				offset = snapshot.reserveWords(SNAP_UPVALUE_SIZE);
				snapshot.setWord(offset + SNAP_UPVALUE_KIND, static_cast<u32>(CpuSnapshotObjectKind::Upvalue));
				snapshot.setWord(offset + SNAP_UPVALUE_HASH_ID, upvalue->hashId);
				snapshot.setWord(offset + SNAP_UPVALUE_ADDRESS, upvalue->address);
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
	m_completionValues.clear(0, m_completionValueCount); m_completionValueCount = 0;
	// The caller has already restored RAM. Retire only the reused root's
	// host activations; following or changing old coroutine edges here would
	// access the restored language records before their attachments exist.
	while (m_rootThread->frameDepth != 0) {
		m_rootThread->leaveFrame();
	}
	auto previousCanonical = std::move(m_staticClosuresByAddress);
	m_staticClosuresByAddress.clear();
	auto savedClosure = [&](u32 offset) {
		FunctionPrototype record;
		record.functionAddress = snapshot.word(offset + SNAP_CLOSURE_FUNCTION_ADDRESS);
		record.codeAddress = snapshot.word(offset + SNAP_CLOSURE_CODE_ADDRESS);
		record.numParams = snapshot.word(offset + SNAP_CLOSURE_NUM_PARAMS);
		record.maxStack = snapshot.word(offset + SNAP_CLOSURE_MAX_STACK);
		record.flags = snapshot.word(offset + SNAP_CLOSURE_FLAGS);
		record.upvalueTableAddress = snapshot.word(offset + SNAP_CLOSURE_UPVALUE_TABLE_ADDRESS);
		record.recordUpvalueCount = snapshot.word(offset + SNAP_CLOSURE_RECORD_UPVALUE_COUNT);
		record.executionDomainId = snapshot.integer(offset + SNAP_CLOSURE_EXECUTION_DOMAIN_ID);
		return record;
	};
	m_heap.forgetPhysicalRecords();
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
				Thread* thread = index == static_cast<size_t>(state.rootThreadRef) ? m_rootThread : m_heap.allocate<Thread>(ObjType::Thread, m_heap, snapshot.word(offset + SNAP_THREAD_RECORD));
				thread->bindStack();
				if (index != static_cast<size_t>(state.rootThreadRef)) m_luaHeap.restoreAllocate(m_heap.allocationBytes(thread));
				thread->restored = true;
				thread->hashId = snapshot.word(offset + SNAP_THREAD_HASH_ID);
				thread->stackTop = 0;
				while (thread->currentFrame) thread->leaveFrame();
				restoredObjects[index] = thread;
				break;
			}
			case CpuSnapshotObjectKind::Table: {
				Table* table = m_heap.allocate<Table>(ObjType::Table, m_heap, snapshot.word(offset + SNAP_TABLE_RECORD));
				m_luaHeap.restoreAllocate(table->trackedHeapBytes());
				table->restored = true;
				table->hashId = snapshot.word(offset + SNAP_TABLE_HASH_ID);
				restoredObjects[index] = table;
				break;
			}
			case CpuSnapshotObjectKind::Closure: {
				const FunctionPrototype record = savedClosure(offset);
				const u32 upvalueCount = snapshot.word(offset + SNAP_CLOSURE_UPVALUE_COUNT);
				const u32 address = snapshot.word(offset + SNAP_CLOSURE_RECORD);
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
							return item->hashId == hashId && item->address == address && *item->prototype == record && item->upvalueCount == upvalueCount;
						});
						if (existing != candidates.end()) {
							closure = *existing;
							candidates.erase(existing);
						}
					}
					if (!closure) {
						m_luaHeap.restoreAllocate(heapAllocationBytes(closureRecordBytes(upvalueCount)));
						closure = m_heap.bindClosureRecord(address, record, upvalueCount, canonical);
					}
					versions.push_back(closure);
				} else {
					m_luaHeap.restoreAllocate(heapAllocationBytes(closureRecordBytes(upvalueCount)));
					closure = m_heap.bindClosureRecord(address, record, upvalueCount, canonical);
				}
				closure->restored = true;
				closure->hashId = snapshot.word(offset + SNAP_CLOSURE_HASH_ID);
				restoredObjects[index] = closure;
				break;
			}
			case CpuSnapshotObjectKind::Upvalue: {
				m_luaHeap.restoreAllocate(UPVALUE_HEAP_BYTES);
				auto* upvalue = m_heap.allocate<Upvalue>(ObjType::Upvalue, m_memory, snapshot.word(offset + SNAP_UPVALUE_ADDRESS));
				upvalue->restored = true;
				upvalue->hashId = snapshot.word(offset + SNAP_UPVALUE_HASH_ID);
				restoredObjects[index] = upvalue;
				break;
			}
		}
	}
	m_heap.bindRestoredReferences(state.gc, restoredObjects, state.nextObjectHashId);
	const CpuSnapshotReader reader(snapshot);
	m_memory.clearMappedPageWriteWatches();
	m_heap.armThreadStackWatches();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	clearNativeContinuationBindings();
#endif
	for (auto& image : m_executionImagesByDomain) {
		image.reset();
	}
	clearGlobalSlots();
	m_systemGlobalNames.reserve(state.systemGlobals.size());
	m_systemGlobalValues.resize(state.systemGlobals.size());
	for (const CpuRootValueState& entry : state.systemGlobals) {
		m_systemGlobalSlotByKey.emplace(entry.key, m_systemGlobalNames.size());
		m_systemGlobalNames.push_back(entry.key);
		m_systemGlobalValues.set(m_systemGlobalNames.size() - 1, reader.readValue(entry.value));
	}
	m_globalNames.reserve(state.globalSlots.size());
	m_globalValues.resize(state.globalSlots.size());
	for (const CpuRootValueState& entry : state.globalSlots) {
		m_globalSlotByKey.emplace(entry.key, m_globalNames.size());
		m_globalNames.push_back(entry.key);
		m_globalValues.set(m_globalNames.size() - 1, reader.readValue(entry.value));
	}
	for (size_t index = 0; index < m_executionImagesByDomain.size(); ++index) {
		if ((state.executionResidencyMask & (1u << index)) != 0u) {
			const auto boot = m_executionAddressSpace.resolveDomain(static_cast<ExecutionDomainId>(index) - 1);
			m_executionImagesByDomain[index] = activateExecutionImage(*boot, true);
		}
	}
	m_systemImage = m_executionImagesByDomain[static_cast<size_t>(SYSTEM_EXECUTION_DOMAIN_ID + 1)].get();
	Blua32ExecutionImage* executionImage = m_executionImagesByDomain[static_cast<size_t>(state.executionCartridgeSlot + 1)].get();
	latchActiveExecutionImage(state.executionCartridgeSlot, executionImage);

	for (size_t objectIndex = 0; objectIndex < snapshot.objectCount(); ++objectIndex) {
		const u32 offset = snapshot.objectWord(static_cast<u32>(objectIndex));
		if (snapshot.word(offset) != static_cast<u32>(CpuSnapshotObjectKind::Thread)) continue;
		const auto& saved = state.threads[snapshot.word(offset + SNAP_THREAD_INDEX)];
		Thread* thread = static_cast<Thread*>(restoredObjects[objectIndex]);
		m_activeThread = thread;
		thread->stackTop = saved.stackTop;
		for (u32 depth = 0; depth < saved.frameDepth; ++depth) {
			auto* frame = m_activeThread->acquireFrame();
			frame->executionImage = m_executionImagesByDomain[static_cast<size_t>(frame->savedExecutionBank() + 1)].get();

			m_activeThread->enterFrame(frame);
		}
		thread->bindStack();
	}
	m_activeThread = static_cast<Thread*>(restoredObjects[state.activeThreadRef]);
	if (auto* current = m_activeThread->currentFrame) current->executionImage = m_activeExecutionImage;
	m_completionThread = static_cast<Thread*>(restoredObjects[state.completionThreadRef]);
	m_threadSwitchRequested = false;

	const Value stringIndexTable = reader.readValue(state.stringIndexTable);
	m_stringIndexTable = stringIndexTable;
	m_completionValues.reserveCapacity(state.completionValues.size());
	for (u32 valueState : state.completionValues) {
		m_completionValues.set(m_completionValueCount++, reader.readValue(valueState));
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
		case BuiltinFunctionId::NumberType:
			out.push_back(valueIsNumber(args[0])
				? valueString(m_stringPool.intern(valueIsInteger(args[0]) ? "integer" : "float"))
				: valueNil());
			break;
		case BuiltinFunctionId::ToInteger:
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
			out.push_back(valueInteger(asThread(args[0], m_heap)->frameDepth));
			break;
		case BuiltinFunctionId::FrameHeader: {
			const auto& frame = *asThread(args[0], m_heap)->frameAtDepth(integerOperand(args[1]));
			out.push_back(valueInteger(frame.readControl(FrameField::Function)));
			out.push_back(valueInteger(frame.readControl(FrameField::Pc)));
			out.push_back(valueInteger(frame.readControl(FrameField::CallSite)));
			out.push_back(valueBool(frame.hasControlFlag(FRAME_COMPLETION)));
			out.push_back(valueInteger(static_cast<u32>(frame.savedExecutionBank())));
			out.push_back(valueBool(frame.hasControlFlag(FRAME_EXCEPTION)));
			break;
		}
		case BuiltinFunctionId::GetFrameRegister:
		case BuiltinFunctionId::SetFrameRegister: {
			auto& frame = *asThread(args[0], m_heap)->frameAtDepth(integerOperand(args[1]));
			const int index = integerOperand(args[2]);
			if (fn.id == BuiltinFunctionId::GetFrameRegister) out.push_back(frame.registers.get(index));
			else frame.registers.set(index, args[3]);
			break;
		}
		case BuiltinFunctionId::GetFrameUpvalue:
		case BuiltinFunctionId::SetFrameUpvalue: {
			const auto& frame = *asThread(args[0], m_heap)->frameAtDepth(integerOperand(args[1]));
			const u32 address = frame.captureAddress(integerOperand(args[2]));
			if (fn.id == BuiltinFunctionId::SetFrameUpvalue) writeUpvalue(address, args[3]);
			else out.push_back(readUpvalue(address));
			break;
		}
		case BuiltinFunctionId::StringChar:
			runBuiltinStringChar(args, out);
			break;
		case BuiltinFunctionId::SetStringIndex:
			if (!valueIsTable(args[0])) {
				throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			}
			m_stringIndexTable = args[0];
			break;
		case BuiltinFunctionId::CoroutineCreate: {
			Closure* closure = !args.empty() && valueIsClosure(args[0]) ? asClosure(args[0], m_heap) : nullptr;
			if (!closure) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			out.push_back(valueThread(m_heap.reference(createThread(closure))));
			break;
		}
		case BuiltinFunctionId::CoroutineRunning:
			out.push_back(valueThread(m_heap.reference(m_activeThread)));
			out.push_back(valueBool(m_activeThread == m_rootThread));
			break;
		case BuiltinFunctionId::CoroutineStatus:
		case BuiltinFunctionId::CoroutineClose:
		case BuiltinFunctionId::CoroutineIsYieldable: {
			Thread* thread = args.empty() && fn.id == BuiltinFunctionId::CoroutineIsYieldable ? m_activeThread
				: !args.empty() && valueIsThread(args[0]) ? asThread(args[0], m_heap) : nullptr;
			if (thread == nullptr) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			if (fn.id == BuiltinFunctionId::CoroutineIsYieldable) out.push_back(valueBool(coroutineYieldable(*thread)));
			else if (fn.id == BuiltinFunctionId::CoroutineStatus) {
				out.push_back(valueInteger(static_cast<int>(thread->status())));
			} else {
				const bool failed = thread->status() == ThreadStatus::Failed;
				out.push_back(valueBool(!failed));
				if (failed) out.push_back(thread->error());
				closeThread(*thread);
				thread->setError(valueNil());
			}
			break;
		}
		case BuiltinFunctionId::CoroutineResume:
		case BuiltinFunctionId::CoroutineYield:
			throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		case BuiltinFunctionId::CollectGarbage: {
			if (!args.empty() && !valueIsNumber(args[0])) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			const i32 operation = args.empty() ? 0 : integerOperand(args[0]);
			if (operation == static_cast<int>(GarbageCollectionOperation::Collect)) m_luaHeap.collectRuntime();
			else if (operation == static_cast<int>(GarbageCollectionOperation::Count)) {
				out.push_back(valueInteger(m_luaHeap.usedBytes()));
				out.push_back(valueInteger(m_luaHeap.capacity()));
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
	const u32 address = m_luaHeap.allocateRecord(THREAD_HEAP_BYTES, true, THREAD_INITIAL_BACKING_BYTES, static_cast<u32>(ThreadField::StackBlock),
		entry ? valueClosure(entry->address) : valueNil());
	auto* thread = m_heap.allocate<Thread>(ObjType::Thread, m_heap, address);
	thread->initializeRecord(entry);
	trackLocalRoot(valueThread(m_heap.reference(thread)));
	return thread;
}

bool CPU::coroutineYieldable(const Thread& thread) const {
	if (&thread == m_rootThread) return false;
	for (auto* frame = thread.currentFrame; frame; frame = frame->previous)
		if (frame->hasControlFlag(FRAME_EXCEPTION | FRAME_COMPLETION)) return false;
	const u32 depth = thread.protectedDepth();
	for (u32 i = 0; i < depth; ++i) {
		if ((thread.protectedWord(i, ProtectedField::Flags) & PROTECTED_CALL_KIND_MASK)
			== static_cast<u32>(ProtectedCallKind::XPCallHandler)) return false;
	}
	return true;
}

void CPU::returnToResumer(int sourceBase, int sourceCount, bool succeeded) {
	Thread* thread = m_activeThread;
	Thread* resumer = thread->resumer();
	m_activeThread = resumer;
	resumeFrameBank();
	resumer->setStatus(ThreadStatus::Running);
	CallFrame& caller = *resumer->currentFrame;
	const int callBase = resumer->callBase();
	const int count = decodeValueCount(resumer->returnCount(), sourceCount + 1);
	if (count > 0) {
		ensureRegisterCapacity(caller, callBase + count - 1);
		caller.registers.set(callBase, valueBool(succeeded));
		const int copied = std::min(sourceCount, count - 1);
		for (int i = 0; i < copied; ++i)
			caller.registers.set(callBase + i + 1, succeeded ? thread->stack.get(sourceBase + i) : thread->error());
		for (int i = copied + 1; i < count; ++i) caller.registers.set(callBase + i, valueNil());
	}
	caller.setTop(callBase + count);
	thread->setResumer(nullptr);
	m_threadSwitchRequested = true;
	m_yieldRequested = true;
	instructionBudgetRemaining -= count;
}

void CPU::runCoroutineTransfer(BuiltinFunctionId id, CallFrame& caller, int base, int count, int argc) {
	Thread* thread = m_activeThread;
	if (id == BuiltinFunctionId::CoroutineYield) {
		if (!coroutineYieldable(*thread)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		thread->setReturnWindow(base, count);
		thread->setStatus(ThreadStatus::Suspended);
		returnToResumer(caller.stackBase() + base + 1, argc, true);
		return;
	}
	if (argc == 0 || !valueIsThread(caller.registers.get(base + 1))) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	Thread* target = asThread(caller.registers.get(base + 1), m_heap);
	const ThreadStatus status = target->status();
	const bool exceptionActive = readExceptionReturnFrameDepth() != -1;
	if (exceptionActive || (status != ThreadStatus::New && status != ThreadStatus::Suspended)) {
		auto scratch = acquireBuiltinResultScratch();
		BuiltinResults& out = scratch.get();
		out.push_back(valueBool(false));
		out.push_back(valueString(m_stringPool.intern(exceptionActive ? "cannot resume coroutine across a hardware exception" : "cannot resume non-suspended coroutine")));
		writeReturnValuesFromBuiltinResults(caller, base, count, out);
		return;
	}
	const bool fresh = status == ThreadStatus::New;
	thread->setReturnWindow(base, count);
	thread->setStatus(ThreadStatus::Normal);
	target->setResumer(thread);
	target->setStatus(ThreadStatus::Running);
	m_activeThread = target;
	if (fresh) {
		pushFrame(caller, target->entry(), base + 2, argc - 1, 0, 0, false, 0);
		target->setEntry(nullptr);
	} else {
		resumeFrameBank();
		CallFrame& frame = *target->currentFrame;
		writeReturnValuesFromRegisters(frame, target->callBase(), target->returnCount(), caller, base + 2, argc - 1);
	}
	m_threadSwitchRequested = true;
	m_yieldRequested = true;
}

bool CPU::handleThreadError(Value error) {
	if (handleProtectedCallError(error)) return true;
	Thread* thread = m_activeThread;
	if (thread->resumer() == nullptr) return false;
	for (auto* frame = thread->currentFrame; frame; frame = frame->previous)
		if (frame->hasControlFlag(FRAME_EXCEPTION | FRAME_COMPLETION)) return false;
	thread->setStatus(ThreadStatus::Failed);
	thread->setError(error);
	returnToResumer(0, 1, false);
	return true;
}

void CPU::closeThread(Thread& thread) {
	const ThreadStatus status = thread.status();
	if (status == ThreadStatus::Running || status == ThreadStatus::Normal) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	while (thread.currentFrame) {
		instructionBudgetRemaining -= closeUpvalues(*thread.currentFrame);
		thread.leaveFrame();
	}
	thread.setProtectedDepth(0);
	thread.stack.clear(0, thread.stackCapacity);
	thread.stackTop = 0;
	thread.setEntry(nullptr);
	thread.setStatus(ThreadStatus::Dead);
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
	const BuiltinArgsView args(frame.registers.subspan(callBase + 1, argCount));
	callBuiltinFunction(fn, args, out, returnCount == 0 ? -1 : returnCount - 1);
	if (m_activeThread->frameDepth != 0 && m_activeThread->currentFrame == &frame) {
		writeReturnValuesFromBuiltinResults(frame, callBase, returnCount, out);
	}
}

void CPU::startProtectedCall(BuiltinFunctionId id, CallFrame& caller, int callBase, int returnCount,
	int argumentBase, int argumentCount, bool returnsToProtectedParent) {
	if (id == BuiltinFunctionId::XPCall) {
		const Value handler = argumentCount > 1
			? caller.registers.get(static_cast<size_t>(argumentBase + 1))
			: valueNil();
		if (!valueIsClosure(handler) && !valueIsBuiltinFunction(handler)) {
			throw LuaExecutionError(LUA_FAULT_REASON_XPCALL_HANDLER_NOT_FUNCTION);
		}
	}
	const auto kind = id == BuiltinFunctionId::PCall ? ProtectedCallKind::PCall : ProtectedCallKind::XPCallBody;
	const u32 continuationIndex = m_activeThread->pushProtectedCall(kind, returnsToProtectedParent, callBase,
		returnCount, id == BuiltinFunctionId::XPCall ? argumentBase + 1 : -1);

	const int targetArgumentOffset = id == BuiltinFunctionId::PCall ? 1 : 2;
	invokeProtectedTarget(
		continuationIndex,
		argumentCount > 0 ? caller.registers.get(static_cast<size_t>(argumentBase)) : valueNil(),
		argumentBase + targetArgumentOffset,
		std::max(argumentCount - targetArgumentOffset, 0)
	);
}

void CPU::invokeProtectedTarget(u32 continuationIndex, Value target, int argumentBase, int argumentCount) {
	CallFrame& caller = protectedCaller(continuationIndex);
	if (valueIsClosure(target)) {
		Closure* closure = asClosure(target, m_heap);
		if (!closure) throw LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
		auto* frame = pushFrame(caller, closure, argumentBase, argumentCount, 0, 0, false, caller.readControl(FrameField::Pc) - INSTRUCTION_BYTES);
		if (frame) frame->writeControl(FrameField::Protected, continuationIndex);
		return;
	}
	if (valueIsBuiltinFunction(target)) {
		BuiltinFunction& builtin = m_builtinFunctions[static_cast<size_t>(asBuiltinFunctionId(target))];
		instructionBudgetRemaining -= static_cast<int>(builtin.cycleBase);
		if (builtin.id == BuiltinFunctionId::PCall || builtin.id == BuiltinFunctionId::XPCall) {
			startProtectedCall(builtin.id, caller, m_activeThread->protectedWord(continuationIndex, ProtectedField::Base),
				0, argumentBase, argumentCount, true);
			return;
		}
		auto resultsScratch = acquireBuiltinResultScratch();
		BuiltinResults& results = resultsScratch.get();
		callBuiltinFunction(
			builtin,
			BuiltinArgsView(caller.registers.subspan(argumentBase, argumentCount)),
			results, -1
		);
		finishProtectedCall(continuationIndex, results.data(), static_cast<int>(results.size()));
		return;
	}
	throw LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
}

void CPU::finishProtectedCall(u32 continuationIndex, const Value* values, int valueCount) {
	if ((m_activeThread->protectedWord(continuationIndex, ProtectedField::Flags) & PROTECTED_CALL_KIND_MASK)
		== static_cast<u32>(ProtectedCallKind::XPCallHandler)) {
		finishProtectedCallWithError(continuationIndex, valueCount > 0 ? values[0] : valueNil());
		return;
	}
	const int resultCount = writeProtectedResults(continuationIndex, true, values, valueCount);
	instructionBudgetRemaining -= resultCount;
	finishProtectedContinuation(continuationIndex, resultCount);
}

void CPU::finishProtectedCall(u32 continuationIndex, CallFrame& source, int sourceBase, int sourceCount) {
	if ((m_activeThread->protectedWord(continuationIndex, ProtectedField::Flags) & PROTECTED_CALL_KIND_MASK)
		== static_cast<u32>(ProtectedCallKind::XPCallHandler)) {
		finishProtectedCallWithError(
			continuationIndex,
			sourceCount > 0 ? source.registers.get(static_cast<size_t>(sourceBase)) : valueNil()
		);
		return;
	}
	const int resultCount = writeProtectedResults(continuationIndex, true, source, sourceBase, sourceCount);
	instructionBudgetRemaining -= resultCount;
	finishProtectedContinuation(continuationIndex, resultCount);
}

void CPU::finishProtectedCallWithError(u32 continuationIndex, Value errorValue) {
	CallFrame& caller = protectedCaller(continuationIndex);
	const i32 callBase = static_cast<i32>(m_activeThread->protectedWord(continuationIndex, ProtectedField::Base));
	const i32 returnCount = static_cast<i32>(m_activeThread->protectedWord(continuationIndex, ProtectedField::Wanted));
	const int resultCount = decodeValueCount(returnCount, 2);
	if (resultCount > 0) {
		ValueSpan registers = ensureRegisterCapacity(caller, callBase + resultCount - 1);
		registers.set(static_cast<size_t>(callBase), valueBool(false));
		if (resultCount > 1) {
			registers.set(static_cast<size_t>(callBase + 1), errorValue);
			for (int index = 2; index < resultCount; ++index) {
				registers.set(static_cast<size_t>(callBase + index), valueNil());
			}
		}
	}
	caller.setTop(callBase + resultCount);
	instructionBudgetRemaining -= resultCount;
	finishProtectedContinuation(continuationIndex, resultCount);
}

int CPU::writeProtectedResults(u32 continuationIndex, bool prefix, const Value* values, int valueCount) {
	CallFrame& caller = protectedCaller(continuationIndex);
	const i32 callBase = static_cast<i32>(m_activeThread->protectedWord(continuationIndex, ProtectedField::Base));
	const i32 returnCount = static_cast<i32>(m_activeThread->protectedWord(continuationIndex, ProtectedField::Wanted));
	const int resultCount = decodeValueCount(returnCount, valueCount + 1);
	if (resultCount > 0) {
		ValueSpan registers = ensureRegisterCapacity(caller, callBase + resultCount - 1);
		registers.set(static_cast<size_t>(callBase), valueBool(prefix));
		const int copiedCount = std::min(valueCount, resultCount - 1);
		if (copiedCount > 0) {
			for (int i = 0; i < copiedCount; ++i) registers.set(callBase + 1 + i, values[i]);
		}
		for (int index = copiedCount + 1; index < resultCount; ++index) {
			registers.set(static_cast<size_t>(callBase + index), valueNil());
		}
	}
	caller.setTop(callBase + resultCount);
	return resultCount;
}

int CPU::writeProtectedResults(u32 continuationIndex, bool prefix, CallFrame& source, int sourceBase, int sourceCount) {
	CallFrame& caller = protectedCaller(continuationIndex);
	const i32 callBase = static_cast<i32>(m_activeThread->protectedWord(continuationIndex, ProtectedField::Base));
	const i32 returnCount = static_cast<i32>(m_activeThread->protectedWord(continuationIndex, ProtectedField::Wanted));
	const int resultCount = decodeValueCount(returnCount, sourceCount + 1);
	if (resultCount > 0) {
		ValueSpan registers = ensureRegisterCapacity(caller, callBase + resultCount - 1);
		const int copiedCount = std::min(sourceCount, resultCount - 1);
		if (copiedCount > 0) {
			registers.copyFrom(source.registers, callBase + 1, sourceBase, copiedCount);
		}
		registers.set(static_cast<size_t>(callBase), valueBool(prefix));
		for (int index = copiedCount + 1; index < resultCount; ++index) {
			registers.set(static_cast<size_t>(callBase + index), valueNil());
		}
	}
	caller.setTop(callBase + resultCount);
	return resultCount;
}

CallFrame& CPU::protectedCaller(u32 continuationIndex) {
	if (auto* frame = m_activeThread->protectedCaller(continuationIndex)) return *frame;
	throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
}

void CPU::finishProtectedContinuation(u32 continuationIndex, int resultCount) {
	const u32 flags = m_activeThread->protectedWord(continuationIndex, ProtectedField::Flags);
	m_activeThread->setProtectedDepth(continuationIndex);
	if ((flags & PROTECTED_CALL_PARENT) != 0) {
		const i32 callBase = static_cast<i32>(m_activeThread->protectedWord(continuationIndex, ProtectedField::Base));
		finishProtectedCall(continuationIndex - 1, protectedCaller(continuationIndex), callBase, resultCount);
	}
}

bool CPU::handleProtectedCallError(Value errorValue) {
	for (;;) {
		const u32 depth = m_activeThread->protectedDepth();
		if (depth == 0) return false;
		const u32 continuationIndex = depth - 1;
		const u32 callerIndex = m_activeThread->protectedWord(continuationIndex, ProtectedField::Caller);
		if (callerIndex >= m_activeThread->frameDepth) return false;
		auto* frame = m_activeThread->currentFrame;
		for (size_t at = m_activeThread->frameDepth - 1; at > callerIndex; --at, frame = frame->previous) {
			// Completion roots return to their latch, not the interrupted caller.
			if (frame->hasControlFlag(FRAME_EXCEPTION | FRAME_COMPLETION)) return false;
		}
		unwindToDepth(callerIndex + 1, true);
		const auto kind = static_cast<ProtectedCallKind>(m_activeThread->protectedWord(continuationIndex, ProtectedField::Flags)
			& PROTECTED_CALL_KIND_MASK);
		if (kind != ProtectedCallKind::XPCallBody) {
			const Value result = kind == ProtectedCallKind::XPCallHandler ? m_errorInErrorHandlingValue : errorValue;
			finishProtectedCallWithError(continuationIndex, result);
			return true;
		}

		m_activeThread->setProtectedKind(continuationIndex, ProtectedCallKind::XPCallHandler);
		const i32 handlerRegister = static_cast<i32>(m_activeThread->protectedWord(continuationIndex, ProtectedField::Handler));
		const i32 callBase = static_cast<i32>(m_activeThread->protectedWord(continuationIndex, ProtectedField::Base));
		const Value handler = frame->registers.get(static_cast<size_t>(handlerRegister));
		setRegister(*frame, callBase, errorValue);
		--instructionBudgetRemaining;
		try {
			invokeProtectedTarget(continuationIndex, handler, callBase, 1);
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
	instructionBudgetRemaining -= static_cast<int>(TableRecord(m_heap, valuePayload(target)).nextEntry(key, nextKey, nextValue));
	out.push_back(nextKey);
	if (!isNil(nextKey)) out.push_back(nextValue);
}

void CPU::runBuiltinRawGet(BuiltinArgsView args, BuiltinResults& out) {
	const Value target = args[0];
	if (!valueIsTable(target)) {
		throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	}
	out.push_back(TableRecord(m_heap, valuePayload(target)).get(args[1]));
}

void CPU::runBuiltinRawSet(BuiltinArgsView args, BuiltinResults& out) {
	const Value target = args[0];
	if (!valueIsTable(target)) {
		throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	}
	TableRecord(m_heap, valuePayload(target)).set(args[1], args[2]);
	out.push_back(target);
}

void CPU::runBuiltinSelect(BuiltinArgsView args, BuiltinResults& out, int resultLimit) {
	const Value selector = args[0];
	if (valueIsString(selector)) {
		if (m_stringPool.byteLength(asStringId(selector)) == 1 && m_stringPool.byteAt(asStringId(selector), 0) == '#') {
			out.push_back(valueInteger(static_cast<i32>(args.size() - 1)));
			return;
		}
		throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	}
	if (!valueIsNumber(selector)) {
		throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	}
	const int count = static_cast<int>(args.size()) - 1;
	int start = integerOperand(selector);
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
		const u32 byte = wordOperand(arg);
		if (byte > 0xffu) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		result.push_back(static_cast<char>(static_cast<u8>(byte)));
	}
	out.push_back(valueString(m_stringPool.intern(result)));
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
			m_activeThread->currentFrame->readControl(FrameField::Pc)
		);
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
		enterException(image, image.irqFunctionAddress, CPU_CAUSE_IRQ, m_activeThread->currentFrame->readControl(FrameField::Pc));
		if (!hadHaltLatch) m_interruptEventPending = true;
		return true;
	}
	return false;
}

CallFrame* CPU::enterSynchronousException(CallFrame& interruptedFrame, u32 causeWord) {
	interruptedFrame.writeControl(FrameField::Pc, m_currentInstructionPc);
	return enterException(*m_systemImage, m_systemExceptionFunctionAddress, causeWord, m_currentInstructionPc);
}

void CPU::enterSynchronousAddressException(CallFrame& interruptedFrame, u32 causeWord, u32 address) {
	m_cop0Words[COP0_BAD_ADDRESS] = address;
	enterSynchronousException(interruptedFrame, causeWord);
}

void CPU::enterInstructionFetchException(CallFrame& interruptedFrame, u32 causeWord, u32 pc) {
	instructionBudgetRemaining -= 1;
	interruptedFrame.writeControl(FrameField::Pc, pc);
	enterException(*m_systemImage, m_systemExceptionFunctionAddress, causeWord, pc);
}

void CPU::enterLuaFaultException(u32 reason, Value errorValue) {
	m_cop0Words[COP0_LUA_FAULT_REASON] = reason;
	if (auto* frame = enterSynchronousException(*m_activeThread->currentFrame, CPU_CAUSE_CODE_TRAP))
		frame->registers.set(0, errorValue);
}

void CPU::returnFromException(CallFrame& frame) {
	if (isUserMode()) {
		enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
		return;
	}
	if (!frame.hasControlFlag(FRAME_EXCEPTION)) {
		hardHalt();
		return;
	}
	const bool returnFromNmi = frame.hasControlFlag(FRAME_NMI);
	const u32 returnPc = m_cop0Words[COP0_EPC];
	instructionBudgetRemaining -= closeUpvalues(frame);
	m_activeThread->leaveFrame();
	resumeFrameBank();
	m_cop0Words[COP0_STATUS] = (m_cop0Words[COP0_STATUS] & ~CPU_STATUS_RFE_RESTORE_MASK)
		| ((m_cop0Words[COP0_STATUS] >> 2u) & CPU_STATUS_RFE_RESTORE_MASK);
	if (m_activeThread->frameDepth != 0) {
		auto& caller = *m_activeThread->currentFrame;
		caller.writeControl(FrameField::Pc, returnPc);
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

CallFrame* CPU::enterException(
	Blua32ExecutionImage& vectorImage,
	u32 functionAddress,
	u32 causeWord,
	u32 epcWord
) {
	m_exceptionDomainWord = static_cast<u32>(m_activeExecutionDomainId);
	m_cop0Words[COP0_EPC] = epcWord;
	m_cop0Words[COP0_CAUSE] = causeWord;
	m_cop0Words[COP0_STATUS] = (m_cop0Words[COP0_STATUS] & ~CPU_STATUS_MODE_STACK_MASK)
		| ((m_cop0Words[COP0_STATUS] << 2u) & CPU_STATUS_MODE_STACK_MASK);
	clearHaltAfterAcceptedInterrupt();
	if (!readFunctionRecordOnBus(vectorImage, functionAddress, executionBusSignalsForDomain(vectorImage.executionDomainId))) {
		hardHalt();
		return nullptr;
	}
	try {
		Closure* closure = staticClosureForRecord(decodePrototype(m_functionRecordLatch));
		CallFrame* frame = pushFrame(closure, {}, 0, 0, false, true);
		frame->writeControl(FrameField::CallSite, epcWord);
		frame->addControlFlags(FRAME_EXCEPTION | (causeWord == CPU_CAUSE_NMI ? FRAME_NMI : 0));
		return frame;
	} catch (const LuaOutOfMemorySignal&) {
		// Failure to admit an exception vector cannot recursively trap.
		hardHalt();
		return nullptr;
	}
}

void CPU::clearHaltAfterAcceptedInterrupt() {
	m_haltedUntilIrqFrameDepth = -1;
	m_haltedUntilIrqThread = nullptr;
	m_yieldRequested = false;
}

void CPU::blockMappedWrite(CallFrame& frame, uint32_t address) {
	frame.writeControl(FrameField::Pc, m_currentInstructionPc);
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
#include "machine/cpu/cpu_control.inl"
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
	ValueSpan registers;
	bool canReuseFrame = false;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const NativeBlock* nativeBlock = nullptr;
	int nativeFirstDispatchCycles = 0;
	bool forceScalarOnce = false;
	NativeCpuRunState nativeState{.state = {}, .cpu = this, .targetDepth = targetDepth,
		.systemRom = &m_memory.systemRomStorage(), .error = {}};
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
			if (image && image != m_activeExecutionImage) latchActiveExecutionImage(image->executionDomainId, image);
			registers = frame->registers;
			if constexpr (Instrumented) {
				if (m_nonMaskableInterruptPending) {
					enterPendingInterrupt();
					continue;
				}
				if ((m_cop0Words[COP0_STATUS] & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) != 0u
					&& m_irqController.hasAssertedMaskableInterruptLine()) {
					CallFrame* interruptedFrame = thread.currentFrame;
					if ((hookBinding.preMaskableInterruptDomainMask
						& executionDomainBit(m_activeExecutionDomainId)) != 0u
						&& hookBinding.hook(
							hookBinding.context,
							m_activeExecutionDomainId,
							interruptedFrame->readControl(FrameField::Pc)
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
			pc = frame->readControl(FrameField::Pc);
			if constexpr (Instrumented) {
				if ((hookBinding.domainMask & executionDomainBit(m_activeExecutionDomainId)) != 0u
					&& hookBinding.hook(hookBinding.context, m_activeExecutionDomainId, pc)) {
					return RunResult::ExecutionStopped;
				}
			}
			if ((pc & (INSTRUCTION_BYTES - 1u)) != 0u) {
				m_cop0Words[COP0_BAD_ADDRESS] = pc;
				enterInstructionFetchException(*frame, CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD, pc);
				continue;
			}
			if (!image) {
				m_cop0Words[COP0_BAD_ADDRESS] = pc;
				enterInstructionFetchException(*frame, CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, pc);
				continue;
			}
			pageAddress = pc & ~MAPPED_PAGE_BYTE_MASK;
			decodedPage = &decodedPageForFrame(*frame, pc);
			goto dispatch_decode;

dispatch_decode:
			if (m_activeStackRebound) {
				registers = frame->registers;
				m_activeStackRebound = false;
			}
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
			frame->writeControl(FrameField::Pc, pc + (static_cast<u32>(decoded->width) * INSTRUCTION_BYTES));
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
#define REG(index) registers.get(static_cast<size_t>(index))
#define CYCLES_ADD(n) do { instructionBudgetRemaining -= (n); } while (0)
#define SET_REGISTER_FAST(index, valueExpr) do { \
	registers.set(static_cast<size_t>(index), (valueExpr)); \
	const int nextTop = (index) + 1; \
	if (nextTop > FRAME.readWindow(FrameField::Top)) { \
		FRAME.setTop(nextTop); \
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
			pc = frame->readControl(FrameField::Pc); \
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
					if (forceScalarOnce || std::endian::native == std::endian::big || thread.stackRequiresScalar()) {
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
					if (thread.stackRequiresScalar()) {
						dispatchOp = decoded->op;
						goto dispatch_instruction;
					}
					const int a = decoded->a;
					const int rkB = decoded->b;
					const int rkC = decoded->c;
					const Value& shiftLeftValue = readRK(IMAGE, registers, rkB);
					const Value& shiftRightValue = readRK(IMAGE, registers, rkC);
					const i32 shifted = dispatchOp == static_cast<u8>(DecodedDispatchOp::FusedShlBxor)
						? luaShiftLeft(integerOperand(shiftLeftValue), integerOperand(shiftRightValue))
						: luaShiftRight(integerOperand(shiftLeftValue), integerOperand(shiftRightValue));
					SET_REGISTER_FAST(
						a,
						valueInteger(shifted)
					);
					if (instructionBudgetRemaining <= 0) {
						DISPATCH_CONTINUE();
					}
					const u32 successorPc = FRAME.readControl(FrameField::Pc);
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
					FRAME.writeControl(FrameField::Pc, successorPc
						+ (static_cast<u32>(decoded->width) * INSTRUCTION_BYTES));
					m_lastExecutionDomainId = IMAGE.executionDomainId;
					lastPc = successorPc
						+ ((static_cast<u32>(decoded->width) - 1u) * INSTRUCTION_BYTES);
					instructionBudgetRemaining -= decoded->baseCycles;
					const Value& xorLeftValue = readRK(IMAGE, registers, decoded->b);
					const Value& xorRightValue = readRK(IMAGE, registers, decoded->c);
					const int32_t xorResult = static_cast<int32_t>(
						static_cast<u32>(integerOperand(xorLeftValue)) ^ static_cast<u32>(integerOperand(xorRightValue))
					);
					SET_REGISTER_FAST(
						decoded->a,
						valueInteger(xorResult)
					);
					DISPATCH_CONTINUE();
				}
				case static_cast<uint8_t>(DecodedDispatchOp::FusedAddShl): {
					if (thread.stackRequiresScalar()) {
						dispatchOp = decoded->op;
						goto dispatch_instruction;
					}
					const int a = decoded->a;
					const int rkB = decoded->b;
					const int rkC = decoded->c;
					const Value& addLeftValue = readRK(IMAGE, registers, rkB);
					const Value& addRightValue = readRK(IMAGE, registers, rkC);
					SET_REGISTER_FAST(
						a,
						valueAdd(addLeftValue, addRightValue)
					);
					if (instructionBudgetRemaining <= 0) {
						DISPATCH_CONTINUE();
					}
					const u32 successorPc = FRAME.readControl(FrameField::Pc);
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
					FRAME.writeControl(FrameField::Pc, successorPc
						+ (static_cast<u32>(decoded->width) * INSTRUCTION_BYTES));
					m_lastExecutionDomainId = IMAGE.executionDomainId;
					lastPc = successorPc
						+ ((static_cast<u32>(decoded->width) - 1u) * INSTRUCTION_BYTES);
					instructionBudgetRemaining -= decoded->baseCycles;
					const Value& shiftLeftValue = readRK(IMAGE, registers, decoded->b);
					const Value& shiftRightValue = readRK(IMAGE, registers, decoded->c);
					const i32 shifted = luaShiftLeft(integerOperand(shiftLeftValue), integerOperand(shiftRightValue));
					SET_REGISTER_FAST(
						decoded->a,
						valueInteger(shifted)
					);
					DISPATCH_CONTINUE();
				}
#include "machine/cpu/cpu_dispatch.inl"
				}
			}
			goto dispatch_continue;

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
dispatch_native_block: {
				nativeState.frameBank = frameBankWord(IMAGE.executionDomainId);
				nativeState.cartridgeSlot = m_memory.cartridgeController().selectedSlot(m_executionBusSignals);
				nativeState.cartridgeRom = m_memory.cartridgeController().romStorage(nativeState.cartridgeSlot);
				nativeState.codeRoot = IMAGE.nativeCodeLookup->root(nativeState.cartridgeSlot);
				nativeState.state = {.registers = registers, .constants = IMAGE.constPool.view(), .frame = frame, .heap = &m_heap,
					.globalValues = m_globalValues.view(), .systemGlobalValues = m_systemGlobalValues.view(),
					.cop0Words = m_cop0Words.data(), .constantCount = static_cast<u32>(IMAGE.constPool.capacity()),
					.remainingCycles = instructionBudgetRemaining + nativeFirstDispatchCycles, .registerTop = FRAME.readWindow(FrameField::Top),
					.ram = m_memory.ramData(), .stackOffset = thread.stackOffset(), .stackBytes = thread.backingByteLength(),
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
				if (!image) goto dispatch_continue;
				if (image != m_activeExecutionImage) latchActiveExecutionImage(image->executionDomainId, image);
				registers = frame->registers;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
				pc = frame->readControl(FrameField::Pc);
				// A function record can supply a raw unaligned code address. Leave
				// its address exception to the ordinary instruction-fetch boundary.
				if ((pc & (INSTRUCTION_BYTES - 1u)) == 0u) {
					pageAddress = pc & ~MAPPED_PAGE_BYTE_MASK;
					decodedPage = &decodedPageForFrame(FRAME, pc);
					if (decodedPage->nativeBlocks) {
						nativeBlock = decodedPage->nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES].get();
						if (nativeBlock && std::endian::native == std::endian::little && !thread.stackRequiresScalar()) {
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
	const bool unwinding = static_cast<int>(m_activeThread->frameDepth) > targetDepth;
	if (unwinding) abortStalledMemoryWrite();
	while (static_cast<int>(m_activeThread->frameDepth) > targetDepth) {
		auto* finished = m_activeThread->currentFrame;
		const int closed = closeUpvalues(*finished);
		if (chargeCaptures) instructionBudgetRemaining -= closed;
		m_activeThread->leaveFrame();
	}
	if (unwinding) resumeFrameBank();
	u32 depth = m_activeThread->protectedDepth();
	while (depth > 0 && m_activeThread->protectedWord(depth - 1, ProtectedField::Caller) >= m_activeThread->frameDepth) --depth;
	m_activeThread->setProtectedDepth(depth);
}

size_t CPU::collectionRootWordCount() const {
	size_t words = 3 * (m_systemGlobalNames.size() + m_globalNames.size());
	for (const auto& image : m_executionImagesByDomain) {
		if (image) words += 2 * image->constPool.capacity();
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
	return m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex))->savedExecutionBank();
}

ExecutionDomainId CPU::readLastExecutionDomain() const {
	return m_lastExecutionDomainId;
}

u32 CPU::readCurrentInstructionPc() const {
	return m_currentInstructionPc;
}

u32 CPU::readFrameFunctionAddress(int frameIndex) const {
	return m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex))->readControl(FrameField::Function);
}

u32 CPU::readFramePc(int frameIndex) const {
	return m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex))->readControl(FrameField::Pc);
}

u32 CPU::readFrameCallSitePc(int childFrameIndex) const {
	return m_activeThread->frameAtDepth(static_cast<size_t>(childFrameIndex))->readControl(FrameField::CallSite);
}

bool CPU::completionCallPending() const {
	for (auto* frame = m_completionThread->currentFrame; frame; frame = frame->previous) {
		if (frame->hasControlFlag(FRAME_COMPLETION)) {
			return true;
		}
	}
	return false;
}

bool CPU::readFrameReturnsToCompletionLatch(int frameIndex) const {
	return m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex))->hasControlFlag(FRAME_COMPLETION);
}

void CPU::abortCompletionCall(int frameIndex) {
	unwindToDepth(frameIndex, false);
	m_completionValues.clear(0, m_completionValueCount); m_completionValueCount = 0;
}

auto CPU::readCompletionValues() const -> ConstValueSpan {
	return m_completionValues.view().subspan(0, m_completionValueCount);
}

bool CPU::isExceptionFrame(int frameIndex) const {
	return m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex))->hasControlFlag(FRAME_EXCEPTION);
}

// Frame depth reached after all currently active exception roots return.
int CPU::readExceptionReturnFrameDepth() const {
	const CallFrame* frame = m_activeThread->firstFrame;
	for (size_t frameIndex = 0; frameIndex < m_activeThread->frameDepth; ++frameIndex, frame = frame->next) {
		if (frame->hasControlFlag(FRAME_EXCEPTION)) return static_cast<int>(frameIndex);
	}
	return -1;
}

bool CPU::isNonMaskableExceptionFrame(int frameIndex) const {
	return m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex))->hasControlFlag(FRAME_NMI);
}

int CPU::getFrameRegisterCount(int frameIndex) const {
	return m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex))->readWindow(FrameField::Top);
}

Value CPU::readFrameRegister(int frameIndex, int registerIndex) const {
	const CallFrame& frame = *m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex));
	return frame.registers.get(static_cast<size_t>(registerIndex));
}

int CPU::getFrameUpvalueCount(int frameIndex) const {
	const CallFrame& frame = *m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex));
	return static_cast<int>(frame.captureCount());
}

Value CPU::readFrameUpvalue(int frameIndex, int upvalueIndex) const {
	const CallFrame& frame = *m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex));
	return readUpvalue(frame.captureAddress(static_cast<u32>(upvalueIndex)));
}

Value CPU::readClosureUpvalue(const Closure* closure, int upvalueIndex) const {
	return readUpvalue(closure->captureAddress(static_cast<u32>(upvalueIndex)));
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
	if (registerCount > static_cast<u32>(frame.stackCapacity())) {
		ensureRegisterCapacity(frame, static_cast<int>(registerCount) - 1);
	}
	if ((functionRecord.flags & BLUA32_FUNCTION_STATIC) != 0u
		&& functionRecord.upvalueCount == 0u) {
		frame.writeControl(FrameField::Closure, staticClosureForRecord(decodePrototype(functionRecord))->address);
	} else {
		const u32 count = frame.captureCount();
		Closure* replacement = allocateClosure(decodePrototype(functionRecord), count, false);
		for (u32 index = 0; index < count; ++index)
			replacement->setCaptureAddress(index, frame.captureAddress(index));
		frame.writeControl(FrameField::Closure, replacement->address);
	}
	frame.writeControl(FrameField::Function, functionRecord.address);
	frame.executionImage = functionRecord.image;
	frame.saveExecutionBank(executionDomainId);
	if (&frame == m_activeThread->currentFrame) latchActiveExecutionImage(executionDomainId, frame.executionImage);
	frame.decodedPage = nullptr;
	frame.decodedPageAddress = 0;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	frame.nativeContinuationCells = {};
#endif
	frame.compilationEntry = true;
	frame.writeControl(FrameField::Pc, pc);
}

void CPU::writeFrameCallSitePc(int childFrameIndex, u32 pc) {
	m_activeThread->frameAtDepth(static_cast<size_t>(childFrameIndex))->writeControl(FrameField::CallSite, pc);
}

Upvalue* CPU::findOpenUpvalue(const CallFrame& frame, int index) const {
	const u32 slot = static_cast<u32>(frame.stackBase()) + static_cast<u32>(index);
	u32 address = frame.readControl(FrameField::OpenHead);
	for (u32 remaining = UPVALUE_CHAIN_LIMIT; address != 0 && remaining != 0; --remaining) {
		auto* upvalue = m_heap.openCellAt(address);
		if (!upvalue) break;
		const u32 current = upvalue->stackSlot();
		if (current <= slot) return current == slot ? upvalue : nullptr;
		address = upvalue->nextAddress();
	}
	return nullptr;
}

void CPU::linkOpenUpvalue(CallFrame& frame, Upvalue& upvalue, u32 slot) {
	Upvalue* previous = nullptr;
	u32 next = frame.readControl(FrameField::OpenHead);
	for (u32 remaining = UPVALUE_CHAIN_LIMIT; next != 0 && remaining != 0; --remaining) {
		auto* current = m_heap.openCellAt(next);
		if (!current || current->stackSlot() <= slot) break;
		previous = current;
		next = current->nextAddress();
	}
	upvalue.bind(frame.thread->address, slot, next);
	if (previous) previous->setNextAddress(upvalue.address);
	else frame.writeControl(FrameField::OpenHead, upvalue.address);
}

Closure* CPU::createClosure(CallFrame& frame) {
	const Blua32FunctionRecordLatch& functionRecord = m_functionRecordLatch;
	if ((functionRecord.flags & BLUA32_FUNCTION_STATIC) != 0u
		&& functionRecord.upvalueCount == 0u) {
		return staticClosureForRecord(decodePrototype(functionRecord));
	}
	m_closureCellScratch.resize(functionRecord.upvalueCount);
	std::fill(m_closureCellScratch.begin(), m_closureCellScratch.end(), 0u);
	m_closureUpvalueWordScratch.resize(functionRecord.upvalueCount);
	const u32 faultSequence = m_memory.readBusFaultSequence();
	size_t newUpvalueCount = 0;
	for (u32 index = 0; index < functionRecord.upvalueCount; ++index) {
		const u32 upvalueWord = m_memory.readMappedBusU32LE(
			functionRecord.upvalueTableAddress + index * BLUA32_UPVALUE_RECORD_SIZE,
			functionRecord.busSignals
		);
		if (m_memory.readBusFaultSequence() != faultSequence) {
			m_closureCellScratch.clear();
			m_closureUpvalueWordScratch.clear();
			hardHalt();
			return nullptr;
		}
		m_closureUpvalueWordScratch[index] = upvalueWord;
		const u32 upvalueIndex = upvalueWord & BLUA32_UPVALUE_INDEX_MASK;
		if ((upvalueWord & BLUA32_UPVALUE_IN_STACK_MASK) != 0u) {
			Upvalue* upvalue = findOpenUpvalue(frame, static_cast<int>(upvalueIndex));
			if (upvalue) {
				m_closureCellScratch[index] = upvalue->address;
			} else {
				newUpvalueCount += 1;
			}
		} else {
			m_closureCellScratch[index] = frame.captureAddress(upvalueIndex);
		}
	}
	m_captureAddressScratch.resize(newUpvalueCount);
	auto* closure = allocateClosure(decodePrototype(functionRecord), functionRecord.upvalueCount, false, m_captureAddressScratch);
	size_t nextCell = 0;
	for (u32 index = 0; index < functionRecord.upvalueCount; ++index) {
		u32 address = m_closureCellScratch[index];
		if (address == 0u && (m_closureUpvalueWordScratch[index] & BLUA32_UPVALUE_IN_STACK_MASK) != 0u) {
			address = m_captureAddressScratch[nextCell++];
			auto* upvalue = m_heap.allocate<Upvalue>(ObjType::Upvalue, m_memory, address);
			linkOpenUpvalue(frame, *upvalue, static_cast<u32>(frame.stackBase())
				+ (m_closureUpvalueWordScratch[index] & BLUA32_UPVALUE_INDEX_MASK));
		}
		closure->setCaptureAddress(index, address);
	}
	m_closureCellScratch.clear();
	m_closureUpvalueWordScratch.clear();
	instructionBudgetRemaining -= static_cast<int>(functionRecord.upvalueCount);
	return closure;
}

int CPU::closeUpvalues(CallFrame& frame) {
	int closed = 0;
	u32 address = frame.readControl(FrameField::OpenHead);
	if (address != 0) frame.writeControl(FrameField::OpenHead, 0);
	while (address != 0 && closed < static_cast<int>(UPVALUE_CHAIN_LIMIT)) {
		auto* upvalue = m_heap.openCellAt(address);
		if (!upvalue) break;
		address = upvalue->nextAddress();
		upvalue->close();
		++closed;
	}
	return closed;
}

Value CPU::readUpvalue(u32 address) const {
	return Upvalue::load(m_memory, address);
}

void CPU::writeUpvalue(u32 address, const Value& value) {
	if (!Upvalue::isOpen(m_memory, address)) {
		if (auto* cell = m_heap.cellAt(address)) cell->writeBarrier();
	}
	Upvalue::store(m_memory, address, value);
}

CallFrame* CPU::pushFrame(CallFrame& caller, Closure* closure, int argBase, int argCount,
	int returnBase, int returnCount, bool returnToCompletionLatch, u32 callSitePc) {
	const FunctionPrototype& functionRecord = *closure->prototype;
	const int callerArgBase = caller.stackBase() + argBase;
	const bool sharedStack = caller.thread == m_activeThread;
	const int argumentBase = sharedStack ? callerArgBase : m_activeThread->stackTop;
	const bool vararg = (functionRecord.flags & BLUA32_FUNCTION_VARARG) != 0u;
	const int varargCount = vararg && static_cast<u32>(argCount) > functionRecord.numParams
		? static_cast<int>(static_cast<u32>(argCount) - functionRecord.numParams) : 0;
	const int top = static_cast<int>(functionRecord.numParams);
	const int varargBase = argumentBase + top;
	const int stackBase = vararg ? argumentBase + argCount : argumentBase;
	const size_t targetCapacity = std::max({functionRecord.maxStack, functionRecord.numParams, 1u});
	auto* frame = m_activeThread->acquireFrame();
	ensureStackSize(static_cast<size_t>(stackBase) + targetCapacity, valueClosure(m_heap.reference(closure)), true);
	frame->executionImage = executionImageForDomain(functionRecord.executionDomainId);
	frame->initializeControl(functionRecord.functionAddress, functionRecord.codeAddress, callSitePc,
		frameBankWord(functionRecord.executionDomainId) | (returnToCompletionLatch ? FRAME_COMPLETION : 0u),
		varargBase, varargCount, returnBase, returnCount, top, closure->address, stackBase, static_cast<int>(targetCapacity));
	const int copiedCount = std::min(top, argCount);
	if (vararg || !sharedStack) {
		frame->registers.copyFrom(caller.thread->stack, 0, callerArgBase, copiedCount);
	}
	frame->registers.clear(copiedCount, top - copiedCount);
	if (vararg) {
		if (sharedStack) {
			// Fixed arguments now live in the relocated working frame. Keep only
			// the original extra arguments below it, as in a Lua vararg frame.
			m_activeThread->stack.clear(argumentBase, copiedCount);
		} else {
			m_activeThread->stack.copyFrom(caller.thread->stack, varargBase, callerArgBase + top, varargCount);
		}
	}
	instructionBudgetRemaining -= (vararg || !sharedStack ? top : top - copiedCount)
		+ (sharedStack ? 0 : varargCount);
	m_activeThread->stackTop = stackBase + static_cast<int>(targetCapacity);
	m_activeThread->enterFrame(frame);
	latchActiveExecutionImage(functionRecord.executionDomainId, frame->executionImage);
	return frame;
}

CallFrame* CPU::pushFrame(Closure* closure, BuiltinArgsView args,
	int returnBase, int returnCount, bool returnToCompletionLatch, bool exception) {
	const FunctionPrototype& functionRecord = *closure->prototype;
	const size_t argCount = args.size();
	auto* frame = m_activeThread->acquireFrame();
	const int argumentBase = m_activeThread->stackTop;
	const bool vararg = (functionRecord.flags & BLUA32_FUNCTION_VARARG) != 0u;
	const int varargCount = vararg && argCount > functionRecord.numParams
		? static_cast<int>(argCount - functionRecord.numParams) : 0;
	const int top = static_cast<int>(functionRecord.numParams);
	const int varargBase = argumentBase + top;
	const int stackBase = vararg ? argumentBase + static_cast<int>(argCount) : argumentBase;
	const size_t targetCapacity = std::max({functionRecord.maxStack, functionRecord.numParams, 1u});
	ensureStackSize(static_cast<size_t>(stackBase) + targetCapacity, valueClosure(m_heap.reference(closure)), true, exception);
	frame->executionImage = executionImageForDomain(functionRecord.executionDomainId);
	frame->initializeControl(functionRecord.functionAddress, functionRecord.codeAddress, functionRecord.codeAddress,
		frameBankWord(functionRecord.executionDomainId) | (returnToCompletionLatch ? FRAME_COMPLETION : 0u),
		varargBase, varargCount, returnBase, returnCount, top, closure->address, stackBase, static_cast<int>(targetCapacity));
	const int copiedCount = std::min(top, static_cast<int>(argCount));
	for (int i = 0; i < copiedCount; ++i) frame->registers.set(i, args[i]);
	frame->registers.clear(copiedCount, top - copiedCount);
	if (varargCount != 0) {
		for (int i = 0; i < varargCount; ++i) m_activeThread->stack.set(varargBase + i, args[top + i]);
	}
	m_activeThread->stackTop = stackBase + static_cast<int>(targetCapacity);
	m_activeThread->enterFrame(frame);
	latchActiveExecutionImage(functionRecord.executionDomainId, frame->executionImage);
	return frame;
}

void CPU::writeReturnValuesFromRegisters(CallFrame& frame, int base, int count, const CallFrame& source, int sourceBase, int sourceCount) {
	const int targetCount = decodeValueCount(count, sourceCount);
	if (targetCount > 0) {
		ValueSpan registers = ensureRegisterCapacity(frame, base + targetCount - 1);
		// Backing growth can relocate both views; their stack offsets stay fixed.
		const int copiedCount = std::min(sourceCount, targetCount);
		registers.copyFrom(source.registers, base, sourceBase, copiedCount);
		registers.clear(base + copiedCount, targetCount - copiedCount);
	}
	frame.setTop(base + targetCount);
	instructionBudgetRemaining -= targetCount;
}

void CPU::writeReturnValuesFromBuiltinResults(CallFrame& frame, int base, int count, const BuiltinResults& values) {
	const int valueCount = static_cast<int>(values.size());
	const int targetCount = decodeValueCount(count, valueCount);
	if (targetCount > 0) {
		ValueSpan registers = ensureRegisterCapacity(frame, base + targetCount - 1);
		const int copiedCount = std::min(valueCount, targetCount);
		for (int i = 0; i < copiedCount; ++i) {
			registers.set(base + i, values[i]);
		}
		for (int i = copiedCount; i < targetCount; ++i) {
			registers.set(base + i, valueNil());
		}
	}
	frame.setTop(base + targetCount);
	instructionBudgetRemaining -= targetCount;
}

void CPU::setRegister(CallFrame& frame, int index, Value value) {
	ValueSpan registers = ensureRegisterCapacity(frame, index);
	registers.set(static_cast<size_t>(index), value);
	const int nextTop = index + 1;
	if (nextTop > frame.readWindow(FrameField::Top)) {
		frame.setTop(nextTop);
	}
}

ValueSpan CPU::ensureRegisterCapacity(CallFrame& frame, int index) {
	if (index < frame.stackCapacity()) {
		return frame.registers;
	}
	const size_t needed = static_cast<size_t>(index) + 1;
	size_t bucket = nextPowerOfTwo(needed);
	if (bucket < 8) {
		bucket = 8;
	}
	ensureStackSize(static_cast<size_t>(frame.stackBase()) + bucket);
	frame.growRegisterWindow(static_cast<int>(bucket));
	return frame.registers;
}

// TODO: Admit function-valued __index through VM call/return continuations in
// all indexed-read forms. Table-only resolution is an implementation limitation,
// not the intended BLua contract; raw Table storage must not execute guest code.
Value CPU::resolveTableIndex(const TableRecord& table, const Value& key) {
	TableLookupResult result;
	table.resolveIndex(asStringId(m_indexKey), key, result);
	instructionBudgetRemaining -= static_cast<int>(result.extraVisits) * TABLE_INDEX_VISIT_CYCLES;
	if (result.status == TableLookupStatus::ChainExhausted) throw LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
	return result.value;
}

Value CPU::resolveTableIntegerIndex(const TableRecord& table, int index) {
	TableLookupResult result;
	table.resolveIntegerIndex(asStringId(m_indexKey), index, result);
	instructionBudgetRemaining -= static_cast<int>(result.extraVisits) * TABLE_INDEX_VISIT_CYCLES;
	if (result.status == TableLookupStatus::ChainExhausted) throw LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
	return result.value;
}

Value CPU::resolveTableFieldIndex(const TableRecord& table, StringId key) {
	TableLookupResult result;
	table.resolveStringIndex(asStringId(m_indexKey), key, result);
	instructionBudgetRemaining -= static_cast<int>(result.extraVisits) * TABLE_INDEX_VISIT_CYCLES;
	if (result.status == TableLookupStatus::ChainExhausted) throw LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
	return result.value;
}

Value CPU::loadTableIndex(const Value& base, const Value& key) {
	if (valueIsTable(base)) {
		const TableRecord table(m_heap, valuePayload(base));
		if (!table.metatableAddress()) {
			return table.get(key);
		}
		return resolveTableIndex(table, key);
	}
	if (valueIsString(base)) {
		const TableRecord table(m_heap, valuePayload(m_stringIndexTable));
		if (!table.metatableAddress()) {
			return table.get(key);
		}
		return resolveTableIndex(table, key);
	}
	throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NON_TABLE);
}

Value CPU::loadTableIntegerIndex(const Value& base, int index) {
	if (valueIsTable(base)) {
		const TableRecord table(m_heap, valuePayload(base));
		if (!table.metatableAddress()) {
			return table.getInteger(index);
		}
		return resolveTableIntegerIndex(table, index);
	}
	if (valueIsString(base)) {
		const TableRecord table(m_heap, valuePayload(m_stringIndexTable));
		if (!table.metatableAddress()) {
			return table.getInteger(index);
		}
		return resolveTableIntegerIndex(table, index);
	}
	throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NON_TABLE);
}

Value CPU::loadTableFieldIndexCached(int& predictedSlot, const Value& base, StringId key) {
	if (!valueIsTable(base) && !valueIsString(base)) throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NON_TABLE);
	const TableRecord table(m_heap, valuePayload(valueIsTable(base) ? base : m_stringIndexTable));
	if (!table.metatableAddress()) return table.getStringKeyCached(key, predictedSlot);
	TableLookupResult result;
	table.resolveStringIndexCached(asStringId(m_indexKey), key, predictedSlot, result);
	instructionBudgetRemaining -= static_cast<int>(result.extraVisits) * TABLE_INDEX_VISIT_CYCLES;
	if (result.status == TableLookupStatus::ChainExhausted) throw LuaExecutionError(LUA_FAULT_REASON_METATABLE_LOOP);
	predictedSlot = result.slot;
	return result.value;
}

Value CPU::loadTableFieldIndex(const Value& base, StringId key) {
	if (valueIsTable(base)) {
		const TableRecord table(m_heap, valuePayload(base));
		if (!table.metatableAddress()) {
			return table.getStringKey(key);
		}
		return resolveTableFieldIndex(table, key);
	}
	if (valueIsString(base)) {
		const TableRecord table(m_heap, valuePayload(m_stringIndexTable));
		if (!table.metatableAddress()) {
			return table.getStringKey(key);
		}
		return resolveTableFieldIndex(table, key);
	}
	throw LuaExecutionError(LUA_FAULT_REASON_INDEX_NON_TABLE);
}

void CPU::storeTableIndex(const Value& base, const Value& key, const Value& value) {
	if (valueIsTable(base)) {
		TableRecord(m_heap, valuePayload(base)).set(key, value);
		return;
	}
	throw LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
}

void CPU::storeTableIntegerIndex(const Value& base, int index, const Value& value) {
	if (valueIsTable(base)) {
		TableRecord(m_heap, valuePayload(base)).setInteger(index, value);
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
		TableRecord(m_heap, valuePayload(base)).setStringKeyCached(key, value, predictedSlot);
		return;
	}
	throw LuaExecutionError(LUA_FAULT_REASON_ASSIGN_NON_TABLE);
}

void CPU::clearCallStack() {
	abortStalledMemoryWrite();
	for (;;) {
		m_activeThread->setProtectedDepth(0);
		while (m_activeThread->frameDepth != 0) {
			CallFrame* frame = m_activeThread->currentFrame;
			closeUpvalues(*frame);
			m_activeThread->leaveFrame();
		}
		m_activeThread->stack.clear(0, m_activeThread->stackCapacity);
		m_activeThread->stackTop = 0;
		Thread* thread = m_activeThread;
		thread->setStatus(ThreadStatus::Dead);
		thread->setEntry(nullptr);
		thread->setError(valueNil());
		if (thread == m_rootThread) break;
		m_activeThread = thread->resumer() == nullptr ? m_rootThread : thread->resumer();
		thread->setResumer(nullptr);
	}
	m_rootThread->setStatus(ThreadStatus::Running);
	m_completionThread = m_rootThread;
	m_threadSwitchRequested = false;
}


void CPU::ensureStackSize(size_t size, Value root, bool frameEntry, bool exception) {
	const size_t current = m_activeThread->stackCapacity;
	size_t capacity = current;
	if (size > current) {
		capacity = 8;
		while (capacity < size) capacity *= 2;
	}
	if (frameEntry) m_activeThread->reserveFrame(capacity, root, exception);
	else if (capacity != current) m_activeThread->resizeStack(capacity, root);
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
	heap.markValue(m_stringIndexTable);
	for (size_t i = 0; i < m_completionValueCount; ++i) {
		heap.markValue(m_completionValues.get(i));
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
		heap.markValue(m_systemGlobalValues.get(slot));
	}
	for (size_t slot = 0; slot < m_globalNames.size(); ++slot) {
		m_stringPool.markReachable(m_globalNames[slot]);
		heap.markValue(m_globalValues.get(slot));
	}
	for (const std::unique_ptr<Blua32ExecutionImage>& executionImage : m_executionImagesByDomain) {
		if (!executionImage) {
			continue;
		}
		Blua32ExecutionImage* image = executionImage.get();
		for (size_t index = 0; index < image->constPool.capacity(); ++index) {
			heap.markValue(image->constPool.get(index));
		}
	}
	heap.markObject(m_rootThread);
	heap.markObject(m_activeThread);
	heap.markObject(m_completionThread);
	heap.markObject(m_haltedUntilIrqThread);
}

// end repeated-sequence-acceptable

} // namespace bmsx
