#include "machine/cpu/cpu.h"
#include "machine/cpu/decoded_instruction.h"
#include "machine/cpu/frame_placement.h"

#include <bit>
#include "machine/cpu/upvalue.h"
#include "machine/cpu/value_arithmetic.h"
#include "machine/cpu/value_comparison.h"
#if defined(BMSX_NATIVE_COMPILER_WORKER)
#include "machine/cpu/jit/worker.h"
#endif

#include "common/compiler.h"
#include "common/scope_exit.h"
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
#include "machine/cpu/jit/source_policy.h"
#include "machine/cpu/jit/runtime/execution.h"
#endif
#include "common/endian.h"
#include "machine/common/numeric.h"
#include "spec/blua32/numeric.h"
#include "spec/blua32/pow.h"
#include "machine/devices/irq/controller.h"
#include "spec/blua32/builtin.h"
#include "spec/blua32/image_format.h"
#include "spec/bmsx/heap_service.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/device.h"
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
	, m_heap(*this, m_luaHeap, m_memory, m_heapAllocator, m_stringPool)
	, m_rootView(m_heap)
	, m_irqView(m_heap)
	, m_heapServiceView(m_heap)
	, m_transferViews{Thread{m_heap}, Thread{m_heap}}
	, m_staticClosuresByAddress(memory)
	, m_systemGlobalBank(memory, m_heap, m_heapAllocator.managementOffset() + SYSTEM_GLOBAL_BANK_OFFSET)
	, m_globalBank(memory, m_heap, m_heapAllocator.managementOffset() + GLOBAL_BANK_OFFSET) {
	m_memory.setRamBusEnd(DYNAMIC_RAM_BASE);
	m_cop0Words[COP0_STATUS] = CPU_STATUS_CART_ENTRY;
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
	m_activeThread = &m_rootView;
	m_memory.attachMappedPageInvalidator(*this);
	initializeHeapService();
}

static_assert(CPU_RESET_BANK_ADDRESS + THREAD_HEAP_BYTES == CPU_RESET_BANK_END);
static_assert(CPU_FIXED_FRAME_ADDRESS + CPU_FIXED_FRAME_COUNT * FRAME_CONTROL_BYTES <= CPU_FIXED_VALUE_ADDRESS);
static_assert(CPU_FIXED_VALUE_ADDRESS + CPU_FIXED_VALUE_COUNT * THREAD_STACK_SLOT_BYTES == CPU_FIXED_VALUE_END);

void CPU::initializeResetBank() {
	const u32 offset = CPU_RESET_BANK_ADDRESS - RAM_BASE, bytes = CPU_RESET_BANK_END - CPU_RESET_BANK_ADDRESS;
	const u32 frames = CPU_FIXED_FRAME_ADDRESS - RAM_BASE, frameBytes = CPU_FIXED_FRAME_COUNT * FRAME_CONTROL_BYTES;
	const u32 values = CPU_FIXED_VALUE_ADDRESS - RAM_BASE, valueBytes = CPU_FIXED_VALUE_END - CPU_FIXED_VALUE_ADDRESS;
	std::memset(m_memory.ramData() + offset, 0, bytes);
	std::memset(m_memory.ramData() + frames, 0, frameBytes);
	std::memset(m_memory.ramData() + values, 0, valueBytes);
	m_memory.invalidateRamWrite(offset, bytes);
	m_memory.invalidateRamWrite(frames, frameBytes);
	m_memory.invalidateRamWrite(values, valueBytes);
	m_memory.writeRamRecordPair(CPU_RESET_BANK_ADDRESS + static_cast<u32>(ThreadField::StackBlock),
		CPU_FIXED_VALUE_ADDRESS, CPU_FIXED_VALUE_COUNT);
	m_memory.writeRamRecordWord(CPU_RESET_BANK_ADDRESS + static_cast<u32>(ThreadField::FrameCapacity), CPU_FIXED_FRAME_COUNT);
	m_memory.writeRamRecordWord(CPU_RESET_BANK_ADDRESS + static_cast<u32>(ThreadField::FrameBlock), CPU_FIXED_FRAME_ADDRESS);
	m_rootView.select(CPU_RESET_BANK_ADDRESS);
	m_rootView.bindStack();
	m_rootView.reserveFixedFrameViews();
	m_rootView.setStatus(ThreadStatus::Running);
	m_memory.writeRamRecordPair(CPU_INTERRUPTED_CONTEXT_ADDRESS, 0u, 0u);
	m_memory.writeRamRecordWord(CPU_IRQ_VECTOR_ADDRESS, 0u);
	m_irqView.select(0u);
	m_activeThread = &m_rootView;
	m_completionThreadAddress = CPU_RESET_BANK_ADDRESS;
}

void CPU::bindFixedIrqBank() {
	m_irqView.select(CPU_RESET_BANK_ADDRESS);
	m_irqView.bindStack();
	m_irqView.reserveFixedFrameViews();
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

u32 CPU::allocateClosure(const FunctionPrototype& prototype, u32 count, bool canonical) {
	const bool latched = !m_functionRecordLatch.romBacked;
	const u32 address = m_luaHeap.allocateClosureRecord(count, latched);
	ClosureRecord::initialize(m_memory, address, prototype, m_heap.white(), count, canonical, latched);
	m_heap.publishObject(address);
	return address;
}

void CPU::reset() {
	if (fixedInterruptDefersReset()) throw BMSX_RUNTIME_ERROR("System IRQ must retire before reset.");
	if (heapServiceActive()) throw BMSX_RUNTIME_ERROR("Heap service must retire before CPU reset.");
	const u32 previousRoot = m_rootView.address;
	if (previousRoot != 0u && previousRoot != CPU_RESET_BANK_ADDRESS) {
		m_cop0Words[COP0_CONTEXT] = previousRoot;
		m_cop0Words[COP0_PREVIOUS_ACTIVE] = fixedInterruptActive()
			? m_memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS) : m_activeThread->address;
	}
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	discardNativeCompilation();
#endif
	const Blua32ExecutionBoot systemBoot =
		m_executionAddressSpace.resolveSystemDomain();
	const u32 systemResetFunctionAddress = systemBoot.startupFunctionAddress;
	const u32 systemExceptionFunctionAddress = systemBoot.exceptionFunctionAddress;
	if (tableRebuild.record && tableRebuild.arrayStorage) {
		TableRecord table(m_heap, tableRebuild.record);
		if (table.arrayAddress() == tableRebuild.arrayStorage) {
			if (tableRebuild.arraySlots < table.arrayCapacity() && !tableRebuild.arrayCleared)
				tableRebuild.arrayStorage = 0; // The old allocation still belongs entirely to the record.
			else table.advanceRebuild(tableRebuild, std::numeric_limits<int>::max());
		}
	}
	m_completionValues.clear(0, m_completionValueCount); m_completionValueCount = 0;
	m_systemGlobalBank.detach();
	m_globalBank.detach();
	for (auto& view : m_transferViews) view.select(0u);
	m_haltedUntilIrqFrameDepth = -1;
	m_haltedUntilIrqThreadAddress = 0u;
	m_interruptEventPending = false;
	m_runSignals = 0u;
	m_memoryWriteBlockedAddress = 0u;
	m_pendingMemory.kind = PendingMemoryKind::None;
	m_pendingAllocation = {};
	m_stringComparison = {};
	if (tableRebuild.record) {
		if (tableRebuild.storage) m_heapAllocator.free(tableRebuild.storage);
		if (tableRebuild.arrayStorage) m_heapAllocator.free(tableRebuild.arrayStorage);
	}
	tableRebuild = {};
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
	m_staticClosuresByAddress.clear();
	m_memory.clearMappedPageWriteWatches();
	initializeResetBank();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	clearNativeContinuationBindings();
#endif
	for (auto& image : m_executionImagesByDomain) image.reset();
	m_unpublishedRomMask = 0u;
	std::unique_ptr<Blua32ExecutionImage> activatedSystemImage =
		activateExecutionImage(systemBoot, ExecutionImageUpdate::Select);
	m_systemImage = activatedSystemImage.get();
	m_executionImagesByDomain[static_cast<size_t>(SYSTEM_EXECUTION_DOMAIN_ID + 1)] =
		std::move(activatedSystemImage);
	m_cop0Words[COP0_SYSTEM_VECTOR] = systemExceptionFunctionAddress;
	latchActiveExecutionImage(SYSTEM_EXECUTION_DOMAIN_ID, m_systemImage);
	if (!readFunctionRecord(*m_systemImage, systemResetFunctionAddress, executionBusSignalsForDomain(SYSTEM_EXECUTION_DOMAIN_ID))) {
		hardHalt();
		return;
	}
	enterDirectFrame(0u);
}

void CPU::decodeConstantPool(Blua32ExecutionImage& image, Span<const u8> records) {
	auto& storage = image.decodedConstants;
	ValueSpan constPool(storage.words(), storage.tags(), storage.capacity());
	const auto executionDomainId = image.executionDomainId;
	for (size_t index = 0; index < constPool.size(); ++index) {
		const u8* record = records.data() + index * BLUA32_CONSTANT_RECORD_SIZE;
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
			case Blua32ConstantTag::Builtin: {
				const u32 id = readLE32(record + BLUA32_CONSTANT_PAYLOAD_OFFSET);
				if (executionDomainId != SYSTEM_EXECUTION_DOMAIN_ID || id >= BUILTIN_FUNCTION_COUNT)
					throw BMSX_RUNTIME_ERROR("BLua32 builtin constant is invalid for this image.");
				constPool.set(index, valueBuiltinFunction(static_cast<BuiltinFunctionId>(id)));
				break;
			}
			case Blua32ConstantTag::String:
				storage.tags()[index] = static_cast<u8>(ValueTag::String);
				image.constantStringSlots.push_back(static_cast<u32>(index));
				break;
			default:
				throw BMSX_RUNTIME_ERROR("BLua32 constant tag is invalid.");
		}
	}
}

u32 CPU::bindConstantStrings(Blua32ExecutionImage& image, Span<const u8> records, u32 stringBinding, bool restoring) {
	auto& storage = image.decodedConstants;
	const u32 count = static_cast<u32>(image.constantStringSlots.size());
	u32 ramCount = 0, slot = 0;
	for (const u32 index : image.constantStringSlots) {
		if (stringBinding == 0u) {
			storage.tags()[index] = static_cast<u8>(ValueTag::UnboundStringLiteral);
			storage.words()[index] = 0u;
			continue;
		}
		storage.tags()[index] = static_cast<u8>(ValueTag::String);
		StringId id;
		if (restoring) {
			id = loadImageStringBinding(m_memory, stringBinding, count, slot, ramCount);
			ramCount += isRamStringId(id);
		} else {
			const u8* record = records.data() + index * BLUA32_CONSTANT_RECORD_SIZE;
			id = m_stringPool.resolveImageRecord(image.executionDomainId, readLE32(record + BLUA32_CONSTANT_PAYLOAD_OFFSET));
			ramCount = storeImageStringBinding(m_memory, stringBinding, count, slot, ramCount, id);
		}
		++slot;
		storage.words()[index] = id;
	}
	image.constPool = ConstValueSpan(storage.words(), storage.tags(), storage.capacity());
	return ramCount;
}

void CPU::registerGlobalNames(ExecutionDomainId domain, u32 tableAddress, u32 nameCount, GlobalBank& bank, u32 destination) {
	if (nameCount == 0u) return;
	m_executionAddressSpace.bindReadOnlyView(domain, tableAddress,
		static_cast<size_t>(nameCount) * BLUA32_GLOBAL_NAME_RECORD_SIZE, m_executionTableView);
	for (u32 index = 0; index < nameCount; ++index) {
		const u8* record = m_executionTableView.data() + static_cast<size_t>(index) * BLUA32_GLOBAL_NAME_RECORD_SIZE;
		const StringId key = m_stringPool.resolveImageRecord(domain, readLE32(record + BLUA32_GLOBAL_NAME_ADDRESS_OFFSET));
		m_memory.writeRamRecordWord(destination + index * 4u, bank.registerName(key));
	}
}

std::unique_ptr<Blua32ExecutionImage> CPU::activateExecutionImage(
	Blua32ExecutionBoot executionBoot, ExecutionImageUpdate update
) {
	const bool restoring = update == ExecutionImageUpdate::Restore || update == ExecutionImageUpdate::UseInstalled;
	const bool selecting = update == ExecutionImageUpdate::Select;
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
	if (readLE32(header + BLUA32_IMAGE_MAGIC_OFFSET) != BLUA32_IMAGE_MAGIC) {
		throw BMSX_RUNTIME_ERROR("BLua32 image magic is invalid.");
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
	if (constantCount > CART_ROM_SIZE / BLUA32_CONSTANT_RECORD_SIZE)
		throw BMSX_RUNTIME_ERROR("BLua32 constant table exceeds the ROM address window.");
	Span<const u8> records;
	if (constantCount != 0u)
		m_executionAddressSpace.bindReadOnlyView(executionDomainId, constantTableAddress,
			constantCount * BLUA32_CONSTANT_RECORD_SIZE, records);
	auto* previous = m_executionImagesByDomain[static_cast<size_t>(executionDomainId + 1)].get();
	const bool reuseConstants = restoring && constantCount != 0u && previous
		&& previous->constantSource.data() == records.data() && previous->constantSource.size() == records.size();
	u32 stringCount = 0;
	if (reuseConstants) {
		stringCount = static_cast<u32>(previous->constantStringSlots.size());
	} else {
		for (u32 i = 0; i < constantCount; ++i)
			stringCount += readLE32(records.data() + i * BLUA32_CONSTANT_RECORD_SIZE + BLUA32_CONSTANT_TAG_OFFSET)
				== static_cast<u32>(Blua32ConstantTag::String);
	}
	const u64 nameCount = static_cast<u64>(globalNameCount) + systemGlobalNameCount;
	if (nameCount + stringCount > MAIN_RAM_SIZE / sizeof(u32))
		throw BMSX_RUNTIME_ERROR("BLua32 image bank extents exceed main RAM.");
	image->romFunctions = Blua32RomFunctionDirectory::read(m_memory, executionDomainId, header);
	if ((readLE32(header + BLUA32_IMAGE_FLAGS_OFFSET) & HEAP_SERVICE_IMAGE_FLAG) != 0u) {
		if (executionDomainId != SYSTEM_EXECUTION_DOMAIN_ID || image->romFunctions.mappedCode
			|| readLE32(header + BLUA32_IMAGE_BYTE_COUNT_OFFSET) < HEAP_SERVICE_IMAGE_HEADER_SIZE)
			throw BMSX_RUNTIME_ERROR("Heap service requires an extended linked System ROM image.");
		Span<const u8> bytes;
		m_executionAddressSpace.bindReadOnlyView(executionDomainId,
			executionBoot.imageAddress + HEAP_SERVICE_IMAGE_ADDRESS_OFFSET, sizeof(u32), bytes);
		const u32 address = readLE32(bytes.data());
		const u32 offset = address - readLE32(header + BLUA32_IMAGE_RODATA_ADDRESS_OFFSET);
		const u32 size = readLE32(header + BLUA32_IMAGE_RODATA_BYTE_COUNT_OFFSET);
		if ((address & 3u) != 0u || offset > size || HEAP_SERVICE_DESCRIPTOR_SIZE > size - offset
			|| address >= SYSTEM_ROM_SIZE || HEAP_SERVICE_DESCRIPTOR_SIZE > SYSTEM_ROM_SIZE - address)
			throw BMSX_RUNTIME_ERROR("Heap service descriptor is outside System ROM RODATA.");
		m_executionAddressSpace.bindReadOnlyView(executionDomainId, address, HEAP_SERVICE_DESCRIPTOR_SIZE, bytes);
		const u8* descriptor = bytes.data();
		const u32 values = readLE32(descriptor + HEAP_SERVICE_DESCRIPTOR_VALUE_SLOTS_OFFSET);
		const u32 frames = readLE32(descriptor + HEAP_SERVICE_DESCRIPTOR_FRAMES_OFFSET);
		if (values == 0u || values > HEAP_SERVICE_VALUE_COUNT || frames == 0u || frames > HEAP_SERVICE_FRAME_COUNT)
			throw BMSX_RUNTIME_ERROR("Heap service descriptor does not fit the private CPU stack.");
		const u8* functions = descriptor + HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET;
		for (u32 index = 0; index < HEAP_SERVICE_ENTRY_COUNT; ++index) {
			const u32 entry = readLE32(functions + index * sizeof(u32));
			const auto* version = image->romFunctions.find(entry);
			if (!version || version->upvalueCount != 0u || version->entry.registerCapacity() > values
				|| (version->entry.flags & (BLUA32_FUNCTION_STATIC | BLUA32_FUNCTION_VARARG)) != BLUA32_FUNCTION_STATIC)
				throw BMSX_RUNTIME_ERROR("Heap service descriptor does not name a fixed System ROM activation.");
			image->heapServiceFunctions[index] = entry;
		}
	}
	if (update == ExecutionImageUpdate::Replace) {
		admitImageReplacement(*image);
		if (executionDomainId == m_programExecutionDomainId && !m_heapAllocator.setFloor(executionBoot.staticEnd)) {
			throw BMSX_RUNTIME_ERROR("Replacement program static storage overlaps live language-heap pages.");
		}
#if defined(BMSX_NATIVE_COMPILER_WORKER)
		discardNativeCompilation();
#endif
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		clearNativeContinuationBindings();
#endif
	}
	if (!restoring && !selecting) m_stringPool.activateRomTable(executionDomainId,
		readLE32(header + BLUA32_IMAGE_STRING_BUCKET_ADDRESS_OFFSET),
		readLE32(header + BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET));
	image->globalNameCount = globalNameCount;
	image->systemNameCount = systemGlobalNameCount;
	const u32 binding = executionImageBindingOffset(m_heapAllocator.managementOffset(), executionDomainId);
	const u32 bytes = static_cast<u32>(nameCount + stringCount) * sizeof(u32);
	if (update == ExecutionImageUpdate::UseInstalled &&
		m_memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_SPAN_OFFSET) != bytes) return nullptr;
	const u32 base = selecting ? 0u : restoring ? m_memory.readRamRecordWord(binding)
		: bytes == 0u ? 0u : m_luaHeap.allocateRecord(bytes, false, 0, 0);
	if (!restoring && !selecting && bytes != 0u) {
		registerGlobalNames(executionDomainId, globalNameTableAddress, globalNameCount, m_globalBank, base);
		registerGlobalNames(executionDomainId, systemGlobalNameTableAddress, systemGlobalNameCount,
			m_systemGlobalBank, base + 4u * globalNameCount);
	}
	image->constantSource = records;
	if (reuseConstants) {
		image->decodedConstants = std::move(previous->decodedConstants);
		image->constantStringSlots = std::move(previous->constantStringSlots);
	} else {
		image->decodedConstants.resize(constantCount);
		image->constantStringSlots.reserve(stringCount);
		decodeConstantPool(*image, records);
	}
	const u32 strings = selecting ? 0u : restoring ? m_memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET)
		: base + static_cast<u32>(nameCount) * sizeof(u32);
	const u32 ramStringCount = bindConstantStrings(*image, records, strings, restoring);
	if (!restoring && !selecting) {
		m_memory.writeRamRecordPair(binding + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET, strings, ramStringCount);
		m_memory.writeRamRecordPair(binding, base, bytes);
	}
	return image;
}

void CPU::admitImageReplacement(const Blua32ExecutionImage& image) {
	const auto* previous = m_executionImagesByDomain[static_cast<size_t>(image.executionDomainId + 1)].get();
	if (image.romFunctions.mappedCode && (!previous || previous->romFunctions.mappedCode)) return;
	struct Admission {
		const Memory& memory;
		const GcHeap& heap;
		const Blua32ExecutionImage* previous;
		const Blua32ExecutionImage& image;
	} admission{m_memory, m_heap, previous, image};
	// A dormant coroutine may not have a host Thread view. Walk the allocated
	// records before changing banks or rebinding any retained frame view.
	m_heap.visitObjectRecords(&admission, [](void* context, u32 address) {
		const auto& [memory, heap, previous, image] = *static_cast<const Admission*>(context);
		const u8 kind = memory.readRamRecordByte(address);
		if (kind == static_cast<u8>(ValueTag::Closure)) {
			const ClosureRecord::BindingFlags binding{memory.readRamRecordByte(address + CLOSURE_BINDING_FLAGS)};
			if (binding.latched() || binding.domain() != image.executionDomainId || heap.sweepGarbage(address)) return;
			const u32 function = memory.readRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS);
			const auto* prior = previous && !previous->romFunctions.mappedCode ? previous->romFunctions.find(function) : nullptr;
			const auto* next = image.romFunctions.find(function);
			if (!prior || image.romFunctions.mappedCode || !next || prior->upvalueCount != next->upvalueCount) {
				throw BMSX_RUNTIME_ERROR("Replacement image does not preserve a retained ROM closure.");
			}
		} else if (kind == THREAD_RECORD_KIND && !heap.sweepGarbage(address)) {
			const u32 depth = ThreadRecord::count(memory, address, ThreadField::FrameDepth);
			const auto storage = ThreadRecord::storageLayout(memory, address);
			for (u32 i = 0; i < depth; ++i) {
				const u32 frame = storage.frameAddress(i);
				const u32 flags = memory.readRamRecordWord(frame + static_cast<u32>(FrameField::Flags));
				if (frameExecutionBank(flags) != image.executionDomainId) continue;
				const u32 function = memory.readRamRecordWord(frame + static_cast<u32>(FrameField::Function));
				const u32 pc = memory.readRamRecordWord(frame + static_cast<u32>(FrameField::Pc));
				if ((previous && previous->romFunctions.mappedCode != image.romFunctions.mappedCode)
					|| !image.admitsFunctionPc(function, pc)) {
					throw BMSX_RUNTIME_ERROR("Replacement image does not preserve a retained frame continuation.");
				}
				if (const auto* prior = previous ? previous->romFunctions.find(function) : nullptr) {
					const auto* next = image.romFunctions.find(function);
					if (!next || prior->entry.numParams != next->entry.numParams || prior->entry.maxStack != next->entry.maxStack
						|| prior->entry.flags != next->entry.flags || prior->upvalueCount != next->upvalueCount) {
						throw BMSX_RUNTIME_ERROR("Replacement image does not preserve a retained frame layout.");
					}
				}
			}
		}
	});
}

Blua32ExecutionImage* CPU::executionImageForDomain(ExecutionDomainId executionDomainId) {
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
		activateExecutionImage(*executionBoot, ExecutionImageUpdate::UseInstalled);
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
			frame->compilationEntry = true;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			frame->nativeContinuationCells = {};
#endif
		}
		latchActiveExecutionImage(domain, image);
	}
}

void CPU::replaceExecutionImage(Blua32ExecutionBoot executionBoot) {
	if (heapServiceActive() || fixedInterruptActive()) throw BMSX_RUNTIME_ERROR("Fixed execution must retire before replacing code execution.");
	std::unique_ptr<Blua32ExecutionImage>& imageEntry = m_executionImagesByDomain[
		static_cast<size_t>(executionBoot.executionDomainId + 1)
	];
	const u32 binding = executionImageBindingOffset(m_heapAllocator.managementOffset(), executionBoot.executionDomainId);
	const u32 oldBase = m_memory.readRamRecordWord(binding);
	const u32 oldBytes = m_memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_SPAN_OFFSET);
	std::unique_ptr<Blua32ExecutionImage> image =
		activateExecutionImage(executionBoot, ExecutionImageUpdate::Replace);
	auto previousImage = std::move(imageEntry);
	Blua32ExecutionImage* activatedImage = image.get();
	imageEntry = std::move(image);
	m_unpublishedRomMask &= ~executionDomainBit(activatedImage->executionDomainId);
	if (activatedImage->executionDomainId == SYSTEM_EXECUTION_DOMAIN_ID) {
		m_systemImage = activatedImage;
	}
	if (previousImage) {
		visitThreadViews([&](Thread& thread) {
			for (auto* frame = thread.firstFrame; frame; frame = frame->next) {
				if (frame->executionImage != previousImage.get()) continue;
				frame->executionImage = activatedImage;
				frame->decodedPage = nullptr;
				frame->compilationEntry = true;
			}
		});
	}
	if (previousImage && oldBase != 0u) m_luaHeap.releaseRecord(oldBase, oldBytes);
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
	result.entry = {record.codeAddress, record.numParams, record.maxStack, record.flags};
	result.upvalueTableAddress = record.upvalueTableAddress;
	result.recordUpvalueCount = record.upvalueCount;
	result.executionDomainId = record.image->executionDomainId;
	return result;
}

FunctionPrototype CPU::readClosureBinding(u32 closure) {
	const ClosureRecord::BindingFlags binding{m_memory.readRamRecordByte(closure + CLOSURE_BINDING_FLAGS)};
	return ClosureRecord::readBinding(m_memory, closure, binding, executionImageForDomain(binding.domain())->romFunctions);
}

u32 CPU::findStaticClosure(const FunctionPrototype& record) {
	u32 first = 0u;
	for (const u32 closure : m_staticClosuresByAddress.find(record.functionAddress)) {
		if ((first == 0u || closure < first) && !m_heap.sweepGarbage(closure)
			&& readClosureBinding(closure) == record)
			first = closure;
	}
	return first;
}

u32 CPU::staticClosureForRecord(const FunctionPrototype& record) {
	if (const u32 first = findStaticClosure(record)) return first;
	return allocateStaticClosure(record);
}

u32 CPU::allocateStaticClosure(const FunctionPrototype& record) {
	const u32 closure = allocateClosure(record, 0, true);
	m_staticClosuresByAddress.insert(record.functionAddress, closure);
	return closure;
}

void CPU::setGlobalByKey(StringId key, const Value& value) {
	const u32 slot = m_globalBank.registerName(key, value);
	m_globalBank.writeSlot(slot, value);
}

void CPU::setSystemGlobalByKey(StringId key, const Value& value) {
	const auto slot = m_systemGlobalBank.find(key);
	if (!slot) {
		throw BMSX_RUNTIME_ERROR("System global '" + m_stringPool.toString(key) + "' has no register slot.");
	}
	m_systemGlobalBank.writeSlot(*slot, value);
}

Value CPU::getSystemGlobalByKey(StringId key) const {
	return m_systemGlobalBank.values().get(*m_systemGlobalBank.find(key));
}

Value CPU::getGlobalByKey(StringId key) const {
	const auto slot = m_globalBank.find(key);
	return slot ? m_globalBank.values().get(*slot) : valueNil();
}


void CPU::invalidateDecodedWords(u64 key, u32 firstWord, u32 endWord) {
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	if (m_nativeCompilerWorker && !m_nativeCompilerWorker->idle()
		&& std::ranges::find(m_pendingNativeCompilation.sources(), key, &NativeCodeSourcePage::key)
			!= m_pendingNativeCompilation.sources().end())
		m_pendingNativeCompilation.invalidated = true;
#endif
	const u32 firstPredecessor = firstWord >= DECODED_DEPENDENCY_PREDECESSOR_WORDS
		? firstWord - DECODED_DEPENDENCY_PREDECESSOR_WORDS : 0u;
	const u32 predecessorEnd = std::min(firstWord, static_cast<u32>(DECODED_PAGE_WORDS));
	for (const std::unique_ptr<Blua32ExecutionImage>& image : m_executionImagesByDomain) {
		if (!image) {
			continue;
		}
		if (auto* page = image->decodedPages.find(key)) {
			auto& decodedPage = *page;
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

void CPU::bindPhysicalFrames(Thread& thread) {
	thread.bindFrameViews();
	for (auto* frame = thread.currentFrame; frame; frame = frame->previous)
		frame->executionImage = m_executionImagesByDomain[static_cast<size_t>(frame->savedExecutionBank() + 1)].get();
}

Thread& CPU::bindThread(u32 address, bool authored) {
	Thread* retained = address == m_rootView.address ? &m_rootView
		: address == CPU_RESET_BANK_ADDRESS ? &m_irqView : nullptr;
	if (!retained) {
		for (auto& view : m_transferViews) {
			if (view.address != address) continue;
			retained = &view;
			break;
		}
	}
	if (retained) {
		// Software can edit the saved frame and Value backing while dormant.
		if (authored) bindPhysicalFrames(*retained);
		return *retained;
	}
	// A transfer may still borrow the current bank for arguments/results.
	auto& view = m_activeThread == &m_transferViews[0] ? m_transferViews[1] : m_transferViews[0];
	view.select(address);
	bindPhysicalFrames(view);
	return view;
}

void CPU::retireThreadView(u32 address) {
	for (auto& view : m_transferViews) {
		if (view.address != address) continue;
		view.select(0u);
		return;
	}
}

void CPU::rebindRelocatedThread(u32 address) {
	visitThreadViews([&](Thread& thread) {
		if (thread.address != address) return;
		thread.bindStack();
	});
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
	const u32 address = static_cast<u32>(firstKey);
	const u32 end = static_cast<u32>(endKey);
	const bool romReplaced = (address == SYSTEM_ROM_BASE && end == SYSTEM_ROM_BASE + SYSTEM_ROM_SIZE)
		|| (address == CART_ROM_BASE && end == CART_ROM_END);
	if (romReplaced) {
		const u32 index = mappedPageDomainIndex(firstKey);
		const auto& resident = m_executionImagesByDomain[index];
		if (resident && !resident->romFunctions.mappedCode)
			m_unpublishedRomMask |= executionDomainBit(resident->executionDomainId);
	}
	const u64 invalidationStart = firstKey >= MAPPED_PAGE_BYTE_SIZE
		? firstKey - MAPPED_PAGE_BYTE_SIZE
		: 0u;
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	if (m_nativeCompilerWorker && !m_nativeCompilerWorker->idle()
		&& std::ranges::any_of(m_pendingNativeCompilation.sources(), [&](const NativeCodeSourcePage& source) {
			return source.key >= invalidationStart && source.key < endKey;
		}))
		m_pendingNativeCompilation.invalidated = true;
#endif
	for (const std::unique_ptr<Blua32ExecutionImage>& image : m_executionImagesByDomain) {
		if (!image) {
			continue;
		}
		// The key's low word is the mapped address, even for a socket-specific
		// ROM install. Any execution image may have used system ROM records.
		if (address < SYSTEM_ROM_BASE + SYSTEM_ROM_SIZE
			|| (address >= CART_ROM_BASE && address < CART_ROM_END)) {
			image->romCallBindings.fill({});
		}
		// Literal records can come from a different ROM than the image.
		// Remount invalidates the reuse key, not the latched values.
		if (romReplaced) image->constantSource = {};
		const auto rebindPages = [&](DecodedPageDirectory& directory) {
			for (const auto& entry : directory.entries()) {
				auto& [key, page] = *entry;
				if (key < invalidationStart || key >= endKey) continue;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
				page.retireNativeBlocks();
#endif
				// The physical mapping has already changed. Rebind in place:
				// suspended frames and native links retain the page itself.
				m_memory.bindMappedPage(static_cast<u32>(key),
					mappedBusSignalsForCartridgeSlot(mappedPageDomainIndex(key) == 2u) | MAPPED_BUS_INSTRUCTION_FETCH,
					page.mapping);
				page.refreshState.fill(DECODED_REFRESH_DECODE);
			}
		};
		rebindPages(image->decodedPages);
		if (image->privateFirmwareCode && address < SYSTEM_ROM_BASE + SYSTEM_ROM_SIZE)
			rebindPages(image->privateFirmwareCode->decoded);
	}
}

DecodedInstructionPage& CPU::decodedPageForFrame(CallFrame& frame, u32 pc, bool privateFirmware) {
	const u32 pageAddress = pc & ~MAPPED_PAGE_BYTE_MASK;
	const auto slot = privateFirmware ? 0u : m_memory.cartridgeController().selectedSlot(m_executionBusSignals);
	const u64 key = mappedPageAddressKey(pageAddress, slot);
	if (frame.decodedPage && frame.decodedPage->mapping.key == key && frame.decodedPage->privateFirmware == privateFirmware) {
		return *frame.decodedPage;
	}
	auto& directory = frame.executionImage->decodedDirectory(privateFirmware);
	auto* page = directory.find(key);
	if (!page) {
		MappedPageBinding binding;
		m_memory.bindMappedPage(pageAddress, mappedBusSignalsForCartridgeSlot(slot) | MAPPED_BUS_INSTRUCTION_FETCH, binding);
		page = &directory.bind(binding);
	}
	frame.decodedPage = page;
	frame.compilationEntry = true;
	return *page;
}


void CPU::skipNextInstruction(CallFrame& frame, bool privateFirmware) {
	const u32 pc = frame.readControl(FrameField::Pc);
	DecodedInstructionPage& page = decodedPageForFrame(frame, pc, privateFirmware);
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
	m_functionRecordLatch.romBacked = false;
	if (!image.romFunctions.mappedCode) {
		if (m_unpublishedRomMask & executionDomainBit(image.executionDomainId)) return false;
		if (const auto* version = image.romFunctions.find(address)) {
			m_functionRecordLatch.romBacked = true;
			m_functionRecordLatch.codeAddress = version->entry.codeAddress;
			m_functionRecordLatch.numParams = version->entry.numParams;
			m_functionRecordLatch.maxStack = version->entry.maxStack;
			m_functionRecordLatch.flags = version->entry.flags;
			m_functionRecordLatch.upvalueTableAddress = version->upvalueTableAddress;
			m_functionRecordLatch.upvalueCount = version->upvalueCount;
			return true;
		}
		if (address - SYSTEM_ROM_BASE < SYSTEM_ROM_SIZE || address - CART_ROM_BASE < CART_ROM_SIZE) return false;
	}
	Span<const u8> view;
	if (m_memory.bindMappedReadView(address, BLUA32_FUNCTION_RECORD_SIZE, busSignals, view)) {
		m_functionRecordLatch.romBacked = address < RAM_BASE || (address >= CART_ROM_BASE && address < CART_ROM_END);
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
		return image.admitsFunctionPc(address, m_functionRecordLatch.codeAddress);
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
	return m_memory.readBusFaultSequence() == faultSequence
		&& image.admitsFunctionPc(address, m_functionRecordLatch.codeAddress);
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

void CPU::selectRamEnd(CallFrame& frame, u32 address) {
	if (m_activeExecutionDomainId != SYSTEM_EXECUTION_DOMAIN_ID
		|| m_currentInstructionPc - SYSTEM_ROM_BASE >= SYSTEM_ROM_SIZE) {
		enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
		return;
	}
	const u32 end = address & ~(HEAP_PAGE_SIZE - 1u);
	if (end < DYNAMIC_RAM_BASE || end > RAM_BASE + m_memory.ramByteCount() - RUNTIME_MANAGEMENT_SIZE) {
		enterSynchronousAddressException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, address);
		return;
	}
	m_memory.setRamBusEnd(end);
	requestYield();
}

void CPU::activateRootContext(u32 address) {
	using F = ThreadField;
	if (fixedInterruptActive() || !resetBankSelected() || isUserMode() || m_activeThread->frameDepth() != 1u
		|| (address & 3u) != 0u || address < m_memory.ramBusEnd() || !m_memory.isRamRange(address, THREAD_HEAP_BYTES, true)) {
		hardHalt();
		return;
	}
	const u32 stack = m_memory.readRamRecordWord(address + static_cast<u32>(F::StackBlock));
	const u32 values = m_memory.readRamRecordWord(address + static_cast<u32>(F::StackCapacity));
	const u32 frames = m_memory.readRamRecordWord(address + static_cast<u32>(F::FrameBlock));
	const u32 frameCount = m_memory.readRamRecordWord(address + static_cast<u32>(F::FrameCapacity));
	if (m_memory.readRamRecordWord(address + static_cast<u32>(F::FrameDepth)) != 1u || frameCount < 2u || frameCount > MAIN_RAM_SIZE / FRAME_CONTROL_BYTES || values > MAX_THREAD_VALUE_SLOTS
		|| ((stack | frames) & 3u) != 0u || stack < m_memory.ramBusEnd() || frames < m_memory.ramBusEnd()
		|| !m_memory.isRamRange(stack, static_cast<size_t>(values) * THREAD_STACK_SLOT_BYTES, true)
		|| !m_memory.isRamRange(frames, static_cast<size_t>(frameCount) * FRAME_CONTROL_BYTES, true)) {
		hardHalt();
		return;
	}
	const u32 pc = m_memory.readRamRecordWord(frames + static_cast<u32>(FrameField::Pc));
	const u32 fn = m_memory.readRamRecordWord(frames + static_cast<u32>(FrameField::Function));
	const u32 flags = m_memory.readRamRecordWord(frames + static_cast<u32>(FrameField::Flags));
	if (frameExecutionBank(flags) != SYSTEM_EXECUTION_DOMAIN_ID || pc >= SYSTEM_ROM_BASE + SYSTEM_ROM_SIZE
		|| !m_systemImage->admitsFunctionPc(fn, pc)) {
		hardHalt();
		return;
	}
	// Operand projections describe the newly selected immutable image. The
	// namespace records and installed backing already belong to machine RAM.
	m_globalBank.bind();
	m_systemGlobalBank.bind();
	auto& image = *m_systemImage;
	const u32 binding = executionImageBindingOffset(m_heapAllocator.managementOffset(), SYSTEM_EXECUTION_DOMAIN_ID);
	const u32 strings = m_memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET);
	bindConstantStrings(image, image.constantSource, strings, true);
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	discardNativeCompilation();
#endif
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	clearNativeContinuationBindings();
#endif
	for (const auto& entry : image.decodedPages.entries()) {
		auto& page = entry->page;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		page.retireNativeBlocks(0u, DECODED_PAGE_WORDS);
#endif
		page.refreshState.fill(DECODED_REFRESH_DECODE);
		for (auto& decoded : page.words) decoded.width = 0u;
	}
	m_memory.writeRamRecordWord(CPU_RESET_BANK_ADDRESS + static_cast<u32>(F::FrameDepth), 0u);
	m_activeThread->setStackTop(0);
	bindFixedIrqBank();
	m_rootView.select(address);
	bindPhysicalFrames(m_rootView);
	m_completionThreadAddress = address;
	m_cop0Words[COP0_CONTEXT] = 0u;
	m_cop0Words[COP0_PREVIOUS_ACTIVE] = 0u;
	requestYield();
}

void CPU::selectExecutionContext(CallFrame& frame, u32 address) {
	if (!supervisorSystemInstruction() || resetBankSelected()) {
		enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
		return;
	}
	if ((address & 3u) != 0u || address < m_memory.ramBusEnd() || !m_memory.isRamRange(address, THREAD_HEAP_BYTES, true)) {
		enterSynchronousAddressException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_STORE, address);
		return;
	}
	m_activeThread = &bindThread(address, true);
	resumeFrameBank();
	m_runSignals |= RunThreadSwitch | RunYield;
}

void CPU::installSystemVector(CallFrame& frame, u32 address, int field) {
	// A cartridge exception frame executes in supervisor mode but cannot
	// reprogram the System exception vector.
	if (m_activeExecutionDomainId != SYSTEM_EXECUTION_DOMAIN_ID
		|| m_currentInstructionPc - SYSTEM_ROM_BASE >= SYSTEM_ROM_SIZE) {
		enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
		return;
	}
	const auto& directory = m_systemImage->romFunctions;
	const auto* version = directory.mappedCode ? nullptr : directory.find(address);
	if (!version || version->upvalueCount != 0u || version->entry.codeAddress >= version->endPc) {
		enterSynchronousAddressException(frame, (address & 3u) != 0u
			? CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD : CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, address);
		return;
	}
	if (field == COP0_IRQ_VECTOR) m_memory.writeRamRecordWord(CPU_IRQ_VECTOR_ADDRESS, address);
	else m_cop0Words[COP0_SYSTEM_VECTOR] = address;
}

void CPU::transferExceptionVector(CallFrame& frame, u32 target) {
	if (m_activeExecutionDomainId != SYSTEM_EXECUTION_DOMAIN_ID
		|| m_currentInstructionPc - SYSTEM_ROM_BASE >= SYSTEM_ROM_SIZE) {
		enterSynchronousException(frame, CPU_CAUSE_CODE_COPROCESSOR_UNUSABLE);
		return;
	}
	if (!frame.hasControlFlag(FRAME_EXCEPTION)) {
		hardHalt();
		return;
	}
	const u32 address = target & CPU_EXCEPTION_TARGET_ADDRESS_MASK;
	const auto signals = mappedBusSignalsForCartridgeSlot(target >> CPU_EXCEPTION_TARGET_SOCKET_SHIFT);
	if (!readFunctionRecordOnBus(*m_systemImage, address, signals)
		|| (m_functionRecordLatch.flags & BLUA32_FUNCTION_STATIC) == 0u) {
		hardHalt();
		return;
	}
	// Only the outer fixed exception can transfer into the retained frame bank.
	const bool resumesContext = fixedInterruptActive() && !frame.previous;
	if (resetBankSelected() && m_functionRecordLatch.image->executionDomainId >= 0 && !resumesContext) {
		hardHalt();
		return;
	}
	const bool nmi = frame.hasControlFlag(FRAME_NMI);
	const bool carriesValue = resumesContext && m_cop0Words[COP0_CAUSE] == CPU_CAUSE_CODE_TRAP;
	instructionBudgetRemaining -= closeUpvalues(frame);
	m_activeThread->leaveFrame();
	if (resumesContext) resumeInterruptedContext();
	if (auto* next = enterLatchedExceptionFrame(nmi, m_cop0Words[COP0_EPC]); next && carriesValue) {
		next->registers.set(0, m_activeThread->error());
		m_activeThread->setError(valueNil());
	}
}

void CPU::resumeInterruptedContext() {
	const u32 context = m_memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS);
	m_memory.writeRamRecordPair(CPU_INTERRUPTED_CONTEXT_ADDRESS, 0u, 0u);
	m_activeThread = &bindThread(context);
	m_activeThread->bindStack(true);
	m_runSignals |= RunThreadSwitch | RunYield;
}

void CPU::executeFunctionAddress(u32 functionAddress) {
	// A normal transfer reuses the receiving bank; it cannot retain reset authority.
	if (resetBankSelected()) { hardHalt(); return; }
	if (!readFunctionRecordOnBus(*m_activeExecutionImage, functionAddress, MAPPED_BUS_MASTER_CPU)
		|| (m_functionRecordLatch.flags & BLUA32_FUNCTION_STATIC) == 0u) {
		hardHalt();
		return;
	}
	clearCallStack();
	latchActiveExecutionImage(m_functionRecordLatch.image->executionDomainId, m_functionRecordLatch.image);
	m_programExecutionDomainId = m_functionRecordLatch.image->executionDomainId;
	if (m_programExecutionDomainId >= 0) {
		m_systemGlobalBank.bind();
		m_globalBank.bind();
	}
	m_cop0Words[COP0_STATUS] = m_functionRecordLatch.image->executionDomainId >= 0
		? CPU_STATUS_CART_ENTRY
		: CPU_STATUS_SYSTEM_ENTRY;
	m_haltedUntilIrqFrameDepth = -1;
	m_haltedUntilIrqThreadAddress = 0u;
	m_interruptEventPending = false;
	m_runSignals &= ~(RunMemoryBlocked | RunHardHalted | RunYield);
	m_memoryWriteBlockedAddress = 0u;
	m_pendingMemory.kind = PendingMemoryKind::None;
	m_pendingAllocation = {};
	m_stringComparison = {};
	[[maybe_unused]] const auto* entry = enterDirectFrame(0u);
	if (!entry) return;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	// A later native grant may warm this entry. EXEC only commits the machine
	// activation and never waits for or runs the compiler itself.
	auto& warmup = m_activeExecutionImage->nativeWarmup;
	if (m_activeExecutionDomainId >= 0 && !warmup.consumed) warmup.entryPc = entry->readControl(FrameField::Pc);
#endif
}

void CPU::beginCompletionCall(u32 closure, BuiltinArgsView args) {
	if (heapServiceActive() || fixedInterruptActive()) throw BMSX_RUNTIME_ERROR("Fixed execution must retire before replacing code execution.");
	if (allocationParked() || m_stringComparison.remaining || tableRebuild.record) throw BMSX_RUNTIME_ERROR("Pending CPU work must retire before replacing code execution.");
	if (m_unpublishedRomMask != 0u)
		throw BMSX_RUNTIME_ERROR("Installed ROM must be published before CPU execution.");
	auto roots = acquireLocalRoots();
	trackLocalRoot(valueClosure(closure));
	for (size_t index = 0; index < args.size(); ++index) trackLocalRoot(args[index]);
	m_heap.finishFinalMark();
	// Call injection takes over the physical instruction stream. The suspended
	// frame retains its PC; an unaccepted endpoint access must not follow it.
	abortStalledMemoryWrite();
	// The input span may borrow the completion latch being cleared below.
	args = BuiltinArgsView(m_localRoots.data() + m_localRoots.size() - args.size(), args.size());
	m_completionValues.clear(0, m_completionValueCount); m_completionValueCount = 0;
	m_completionThreadAddress = m_activeThread->address;
	m_runSignals &= ~RunYield;
	pushFrame(closure, args, {}, FRAME_COMPLETION);
}

void CPU::beginCompletionCallInExecutionDomain(
	ExecutionDomainId executionDomainId,
	u32 functionAddress
) {
	if (heapServiceActive() || fixedInterruptActive()) throw BMSX_RUNTIME_ERROR("Fixed execution must retire before replacing code execution.");
	if (allocationParked() || m_stringComparison.remaining || tableRebuild.record) throw BMSX_RUNTIME_ERROR("Pending CPU work must retire before replacing code execution.");
	m_heap.finishFinalMark();
	auto* image = executionImageForDomain(executionDomainId);
	if (!image || !readFunctionRecord(*image, functionAddress, executionBusSignalsForDomain(executionDomainId))) {
		hardHalt();
		return;
	}
	beginCompletionCall(staticClosureForRecord(decodePrototype(m_functionRecordLatch)));
}

CpuRuntimeState CPU::captureRuntimeState(std::vector<Value> completionStorage) const {
	CpuRuntimeState state;
	state.rootThreadAddress = m_rootView.address;
	state.activeThreadAddress = m_activeThread->address;
	state.completionThreadAddress = m_completionThreadAddress;
	state.haltedUntilIrqThreadAddress = m_haltedUntilIrqThreadAddress;
	state.executionCartridgeSlot = m_activeExecutionDomainId;
	state.programExecutionDomainId = m_programExecutionDomainId;
	completionStorage.resize(m_completionValueCount);
	for (size_t i = 0; i < m_completionValueCount; ++i)
		completionStorage[i] = m_completionValues.get(i);
	state.completionValues = std::move(completionStorage);
	for (size_t index = 0; index < m_executionImagesByDomain.size(); ++index) {
		if (m_executionImagesByDomain[index]) {
			state.executionResidencyMask |= 1u << index;
		}
	}
	state.hardHalted = (m_runSignals & RunHardHalted) != 0u;
	state.lastExecutionDomainId = m_lastExecutionDomainId;
	state.lastPc = lastPc;
	state.haltedUntilIrqFrameDepth = m_haltedUntilIrqFrameDepth;
	state.interruptEventPending = m_interruptEventPending;
	state.memoryWriteBlocked = (m_runSignals & RunMemoryBlocked) != 0u;
	state.memoryWriteBlockedAddress = m_memoryWriteBlockedAddress;
	state.pendingMemory = m_pendingMemory;
	state.stringComparison = m_stringComparison;
	if (tableRebuild.record) state.rebuild = tableRebuild;
	state.pendingAllocation = m_pendingAllocation;
	state.statusWord = m_cop0Words[COP0_STATUS];
	state.systemVectorWord = m_cop0Words[COP0_SYSTEM_VECTOR];
	state.previousRootContextWord = m_cop0Words[COP0_CONTEXT];
	state.previousActiveContextWord = m_cop0Words[COP0_PREVIOUS_ACTIVE];
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
	state.nonMaskableInterruptPending = (m_runSignals & RunNonMaskableInterrupt) != 0u;
	state.yieldRequested = (m_runSignals & RunYield) != 0u;
	return state;
}

void CPU::restoreRuntimeState(const CpuRuntimeState& state) {
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	discardNativeCompilation();
#endif
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	clearNativeContinuationBindings();
#endif
	m_completionValues.clear(0, m_completionValueCount); m_completionValueCount = 0;
	m_staticClosuresByAddress.clear();
	m_rootView.select(state.rootThreadAddress);
	const bool boardBank = state.rootThreadAddress == CPU_RESET_BANK_ADDRESS;
	for (auto& view : m_transferViews) view.select(0u);
	m_activeThread = &m_rootView;
	m_memory.clearMappedPageWriteWatches();
	if (boardBank) {
		m_systemGlobalBank.detach();
		m_globalBank.detach();
	} else {
		// This scan is independent of the in-flight collector sweep cursor.
		m_heap.visitObjectRecords(this, [](void* context, u32 address) {
			auto& cpu = *static_cast<CPU*>(context);
			auto& heap = cpu.m_heap;
			switch (cpu.m_memory.readRamRecordByte(address)) {
				case static_cast<u8>(ValueTag::Closure): {
					const u8 binding = cpu.m_memory.readRamRecordByte(address + CLOSURE_BINDING_FLAGS);
					if ((binding & CLOSURE_CANONICAL) != 0u && !heap.sweepGarbage(address)) {
						const u32 functionAddress = cpu.m_memory.readRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS);
						cpu.m_staticClosuresByAddress.insert(functionAddress, address);
					}
					break;
				}
			}
		});
		m_systemGlobalBank.bind();
		m_globalBank.bind();
	}
	for (size_t index = 0; index < m_executionImagesByDomain.size(); ++index) {
		if ((state.executionResidencyMask & (1u << index)) != 0u) {
			const auto boot = m_executionAddressSpace.resolveDomain(static_cast<ExecutionDomainId>(index) - 1);
			m_executionImagesByDomain[index] = activateExecutionImage(*boot, boardBank ? ExecutionImageUpdate::Select : ExecutionImageUpdate::Restore);
		} else {
			m_executionImagesByDomain[index].reset();
		}
	}
	m_systemImage = m_executionImagesByDomain[static_cast<size_t>(SYSTEM_EXECUTION_DOMAIN_ID + 1)].get();
	Blua32ExecutionImage* executionImage = m_executionImagesByDomain[static_cast<size_t>(state.executionCartridgeSlot + 1)].get();
	latchActiveExecutionImage(state.executionCartridgeSlot, executionImage);

	bindPhysicalFrames(m_rootView);
	bindPhysicalFrames(m_heapServiceView);
	m_activeThread = &bindThread(state.activeThreadAddress);
	if (!boardBank) {
		bindFixedIrqBank();
		if (fixedInterruptActive()) bindPhysicalFrames(m_irqView);
	} else m_irqView.select(0u);
	if (auto* current = m_activeThread->currentFrame) current->executionImage = m_activeExecutionImage;
	m_completionThreadAddress = state.completionThreadAddress;

	m_completionValues.reserveCapacity(state.completionValues.size());
	for (Value value : state.completionValues) m_completionValues.set(m_completionValueCount++, value);
	m_programExecutionDomainId = state.programExecutionDomainId;
	m_lastExecutionDomainId = state.lastExecutionDomainId;
	lastPc = state.lastPc;
	m_haltedUntilIrqFrameDepth = state.haltedUntilIrqFrameDepth;
	m_haltedUntilIrqThreadAddress = state.haltedUntilIrqThreadAddress;
	m_interruptEventPending = state.interruptEventPending;
	m_memoryWriteBlockedAddress = state.memoryWriteBlockedAddress;
	m_pendingMemory = state.pendingMemory;
	m_stringComparison = state.stringComparison;
	tableRebuild = state.rebuild;
	m_pendingAllocation = state.pendingAllocation;
	m_cop0Words[COP0_STATUS] = state.statusWord;
	m_cop0Words[COP0_SYSTEM_VECTOR] = state.systemVectorWord;
	m_cop0Words[COP0_CONTEXT] = state.previousRootContextWord;
	m_cop0Words[COP0_PREVIOUS_ACTIVE] = state.previousActiveContextWord;
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
	m_runSignals = (state.hardHalted ? RunHardHalted : 0u)
		| (state.memoryWriteBlocked ? RunMemoryBlocked : 0u)
		| (state.nonMaskableInterruptPending ? RunNonMaskableInterrupt : 0u)
		| (state.yieldRequested ? RunYield : 0u);
}

void CPU::requestYield() {
	m_runSignals |= RunYield;
}

void CPU::haltUntilIrq() {
	if (m_interruptEventPending) {
		m_interruptEventPending = false;
		return;
	}
	m_haltedUntilIrqFrameDepth = static_cast<int>(m_activeThread->frameDepth());
	m_haltedUntilIrqThreadAddress = m_activeThread->address;
	m_runSignals &= ~RunYield;
}

void CPU::hardHalt() {
	m_runSignals = (m_runSignals & ~RunYield) | RunHardHalted;
	m_haltedUntilIrqFrameDepth = -1;
	m_haltedUntilIrqThreadAddress = 0u;
}


void CPU::callBuiltinFunction(BuiltinFunction& fn, BuiltinArgsView args, BuiltinResults& out) {
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
		case BuiltinFunctionId::GetMetatable:
		case BuiltinFunctionId::RawGet:
		case BuiltinFunctionId::StringByte: {
			Value result;
			if (!executeBuiltinLeaf(fn.id, args, result)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			out.push_back(result);
			break;
		}
		case BuiltinFunctionId::GetGlobal:
			if (!valueIsString(args[0])) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			out.push_back(getGlobalByKey(asStringId(args[0])));
			break;
		case BuiltinFunctionId::FrameCount:
		case BuiltinFunctionId::FrameHeader:
		case BuiltinFunctionId::GetFrameRegister:
		case BuiltinFunctionId::SetFrameRegister:
		case BuiltinFunctionId::GetFrameUpvalue:
			ThreadRecord::invokeDiagnostic(m_heap, fn.id, args, out);
			break;
		case BuiltinFunctionId::StringFromBytes: {
			i32 address, count;
			if (args.size() < 2 || !valueToInteger(args[0], address) || !valueToInteger(args[1], count) ||
				count < 0)
				throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			Span<const u8> span;
			if (count != 0 && !m_memory.bindMappedReadView(static_cast<u32>(address), static_cast<u32>(count), MAPPED_BUS_MASTER_CPU, span))
				throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			instructionBudgetRemaining -= count;
			const auto bytes = span.empty() ? std::string_view{} : std::string_view{reinterpret_cast<const char*>(span.data()), span.size()};
			out.push_back(valueString(m_stringPool.intern(bytes)));
			break;
		}
		case BuiltinFunctionId::CoroutineRunning:
			out.push_back(valueThread(m_activeThread->address));
			out.push_back(valueBool(m_activeThread == &m_rootView));
			break;
		case BuiltinFunctionId::CoroutineStatus:
		case BuiltinFunctionId::CoroutineIsYieldable: {
			const u32 address = args.empty() && fn.id == BuiltinFunctionId::CoroutineIsYieldable ? m_activeThread->address
				: !args.empty() && valueIsThread(args[0]) ? asThread(args[0], m_heap) : 0u;
			if (address == 0u) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			if (fn.id == BuiltinFunctionId::CoroutineIsYieldable) out.push_back(valueBool(coroutineYieldable(address)));
			else out.push_back(valueInteger(static_cast<i32>(ThreadRecord::read(m_memory, address, ThreadField::Status))));
			break;
		}
		case BuiltinFunctionId::CoroutineResume:
		case BuiltinFunctionId::CoroutineYield:
			throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		case BuiltinFunctionId::Error:
			runBuiltinError(args);
			break;
		case BuiltinFunctionId::PCall:
		case BuiltinFunctionId::XPCall:
			throw std::runtime_error("Protected calls execute as Lua CPU microcode.");
	}
}

bool CPU::coroutineYieldable(u32 address) const {
	if (address == m_rootView.address) return false;
	const auto layout = ThreadRecord::storageLayout(m_memory, address);
	for (u32 depth = ThreadRecord::count(m_memory, address, ThreadField::FrameDepth); depth != 0u; --depth) {
		const u32 flags = m_memory.readRamRecordWord(layout.frameAddress(depth - 1u) + static_cast<u32>(FrameField::Flags));
		if ((flags & (FRAME_EXCEPTION | FRAME_COMPLETION)) != 0u) return false;
	}
	const u32 depth = ThreadRecord::count(m_memory, address, ThreadField::ProtectedDepth);
	for (u32 i = 0; i < depth; ++i) {
		const u32 flags = m_memory.readRamRecordWord(layout.protectedAddress(i) + static_cast<u32>(ProtectedField::Flags));
		if ((flags & PROTECTED_CALL_KIND_MASK) == static_cast<u32>(ProtectedCallKind::XPCallHandler)) return false;
	}
	return true;
}

void CPU::returnToResumer(const CallValueSource& source, bool succeeded) {
	Thread* thread = m_activeThread;
	auto roots = acquireLocalRoots();
	trackLocalRoot(valueThread(thread->address));
	Thread* resumer = &bindThread(thread->resumer());
	m_activeThread = resumer;
	resumeFrameBank();
	resumer->setStatus(ThreadStatus::Running);
	CallFrame& caller = *resumer->currentFrame;
	const auto result = resumer->transferResult();
	const int count = result.selected(source.count + 1);
	if (count > 0) {
		ensureRegisterCapacity(caller, result.base + count - 1);
		const auto values = source.values();
		caller.registers.set(result.base, valueBool(succeeded));
		const int copied = std::min(source.count, count - 1);
		values.placeInto(caller.registers, result.base + 1, copied, count - 1 - copied);
	}
	caller.placeResultTop(result, count);
	thread->setResumer(0u);
	m_runSignals |= RunThreadSwitch | RunYield;
	instructionBudgetRemaining -= count;
}

void CPU::runCoroutineTransfer(BuiltinFunctionId id, CallFrame& caller, CallResultPlacement result, const CallValueSource& arguments) {
	Thread* thread = m_activeThread;
	if (id == BuiltinFunctionId::CoroutineYield) {
		if (!coroutineYieldable(thread->address)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		thread->setTransferResult(result);
		thread->setStatus(ThreadStatus::Suspended);
		returnToResumer(arguments, true);
		return;
	}
	const Value targetValue = arguments.values()[0];
	if (!valueIsThread(targetValue)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	const u32 targetAddress = asThread(targetValue, m_heap);
	if (targetAddress == 0u) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	const auto status = static_cast<ThreadStatus>(ThreadRecord::read(m_memory, targetAddress, ThreadField::Status));
	const bool exceptionActive = readExceptionReturnFrameDepth() != -1;
	if (exceptionActive || (status != ThreadStatus::New && status != ThreadStatus::Suspended)) {
		auto scratch = acquireBuiltinResultScratch();
		BuiltinResults& out = scratch.get();
		out.push_back(valueBool(false));
		out.push_back(valueString(m_stringPool.intern(exceptionActive ? "cannot resume coroutine across a hardware exception" : "cannot resume non-suspended coroutine")));
		writeReturnValues(caller, result, BuiltinArgsView(out.data(), out.size()));
		return;
	}
	const bool fresh = status == ThreadStatus::New;
	Thread* target = &bindThread(targetAddress);
	thread->setTransferResult(result);
	thread->setStatus(ThreadStatus::Normal);
	target->setResumer(thread->address);
	target->setStatus(ThreadStatus::Running);
	m_activeThread = target;
	const auto supplied = arguments.tail(1);
	if (fresh) {
		const auto closure = m_heap.closureRecordAddress(target->entry());
		// The resumer owns the argument slots while the new Thread
		// owns its Entry. Let the existing prepared CALL acquire space.
		const auto* frame = supplied.frame
			? pushFrame(*supplied.frame, closure, supplied.base, supplied.count, {}, 0u)
			: pushFrame(closure, supplied.values(), {}, 0u, 0u, true);
		if (!frame) return;
		target->setEntry(0u);
	} else {
		resumeFrameBank();
		CallFrame& frame = *target->currentFrame;
		if (supplied.frame) writeReturnValuesFromRegisters(frame, target->transferResult(), *supplied.frame, supplied.base, supplied.count);
		else writeReturnValues(frame, target->transferResult(), supplied.values());
	}
	m_runSignals |= RunThreadSwitch | RunYield;
}

bool CPU::handleThreadError(Value error) {
	if (handleProtectedCallError(error)) return true;
	Thread* thread = m_activeThread;
	if (thread->resumer() == 0u) return false;
	for (auto* frame = thread->currentFrame; frame; frame = frame->previous)
		if (frame->hasControlFlag(FRAME_EXCEPTION | FRAME_COMPLETION)) return false;
	thread->setStatus(ThreadStatus::Failed);
	thread->setError(error);
	returnToResumer({nullptr, &error, 0, 1}, false);
	return true;
}

void CPU::runBuiltinFunction(BuiltinFunction& fn, CallFrame& frame, CallResultPlacement result, const CallValueSource& arguments) {
	instructionBudgetRemaining -= static_cast<int>(fn.cycleBase);
	if (fn.id == BuiltinFunctionId::PCall || fn.id == BuiltinFunctionId::XPCall) {
		startProtectedCall(fn.id, result, arguments, false);
		return;
	}
	if (fn.id == BuiltinFunctionId::CoroutineResume || fn.id == BuiltinFunctionId::CoroutineYield) {
		runCoroutineTransfer(fn.id, frame, result, arguments);
		return;
	}
	auto outScratch = acquireBuiltinResultScratch();
	BuiltinResults& out = outScratch.get();
	callBuiltinFunction(fn, arguments.values(), out);
	if (m_activeThread->frameDepth() != 0 && m_activeThread->currentFrame == &frame) {
		writeReturnValues(frame, result, BuiltinArgsView(out.data(), out.size()));
	}
}

void CPU::startProtectedCall(BuiltinFunctionId id, CallResultPlacement result,
	const CallValueSource& arguments, bool returnsToProtectedParent) {
	Value handler = valueNil();
	if (id == BuiltinFunctionId::XPCall) {
		handler = arguments.values()[1];
		if (!valueIsClosure(handler) && !valueIsBuiltinFunction(handler) && valueTag(handler) != ValueTag::ResidentFunction) {
			throw LuaExecutionError(LUA_FAULT_REASON_XPCALL_HANDLER_NOT_FUNCTION);
		}
	}
	const auto kind = id == BuiltinFunctionId::PCall ? ProtectedCallKind::PCall : ProtectedCallKind::XPCallBody;
	const u32 continuationIndex = m_activeThread->pushProtectedCall(kind, returnsToProtectedParent, result, handler);

	const int targetArgumentOffset = id == BuiltinFunctionId::PCall ? 1 : 2;
	invokeProtectedTarget(continuationIndex, arguments.values()[0], arguments.tail(targetArgumentOffset));
}

void CPU::invokeProtectedTarget(u32 continuationIndex, Value target, const CallValueSource& arguments) {
	CallFrame& caller = protectedCaller(continuationIndex);
	if (valueIsClosure(target)) {
		u32 closure = asClosure(target, m_heap);
		if (!closure) throw LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
		const auto protectedIndex = static_cast<i32>(continuationIndex);
		if (arguments.frame) pushFrame(*arguments.frame, closure, arguments.base, arguments.count, {},
			caller.readControl(FrameField::Pc) - INSTRUCTION_BYTES, 0u, protectedIndex);
		else pushFrame(closure, arguments.values(), {}, 0u, m_currentInstructionPc, true, protectedIndex);
		return;
	}
	if (valueTag(target) == ValueTag::ResidentFunction) {
		beginResidentCall(valuePayload(target), arguments.values(), {}, static_cast<i32>(continuationIndex));
		return;
	}
	if (valueIsBuiltinFunction(target)) {
		BuiltinFunction& builtin = m_builtinFunctions[static_cast<size_t>(asBuiltinFunctionId(target))];
		instructionBudgetRemaining -= static_cast<int>(builtin.cycleBase);
		if (builtin.id == BuiltinFunctionId::PCall || builtin.id == BuiltinFunctionId::XPCall) {
			const auto parent = m_activeThread->protectedResult(continuationIndex);
			startProtectedCall(builtin.id, parent.extendsTop() ? CallResultPlacement::discard()
				: CallResultPlacement::call(parent.base, -1), arguments, true);
			return;
		}
		auto resultsScratch = acquireBuiltinResultScratch();
		BuiltinResults& results = resultsScratch.get();
		callBuiltinFunction(builtin, arguments.values(), results);
		finishProtectedCall(continuationIndex, {nullptr, results.data(), 0, static_cast<int>(results.size())});
		return;
	}
	throw LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
}

void CPU::finishProtectedCall(u32 continuationIndex, const CallValueSource& source) {
	if ((m_activeThread->protectedWord(continuationIndex, ProtectedField::Flags) & PROTECTED_CALL_KIND_MASK)
		== static_cast<u32>(ProtectedCallKind::XPCallHandler)) {
		finishProtectedCallWithError(continuationIndex, source.values()[0]);
		return;
	}
	if (finishImplicitProtectedHandler(continuationIndex, true)) return;
	CallFrame& caller = protectedCaller(continuationIndex);
	const auto result = m_activeThread->protectedResult(continuationIndex);
	const int count = result.selected(source.count + 1);
	if (count > 0) {
		auto& registers = ensureRegisterCapacity(caller, result.base + count - 1);
		const int copied = std::min(source.count, count - 1);
		// A nested continuation may consume the caller's own result window.
		// Move it before publishing the status over the first source slot.
		source.values().placeInto(registers, result.base + 1, copied, 0);
		registers.set(result.base, valueBool(true));
		registers.clear(result.base + 1 + copied, count - 1 - copied);
	}
	caller.placeResultTop(result, count);
	instructionBudgetRemaining -= count;
	finishProtectedContinuation(continuationIndex, count);
}

void CPU::finishProtectedCallWithError(u32 continuationIndex, Value errorValue) {
	if (finishImplicitProtectedHandler(continuationIndex, false)) return;
	CallFrame& caller = protectedCaller(continuationIndex);
	const auto result = m_activeThread->protectedResult(continuationIndex);
	const i32 callBase = result.base;
	const int resultCount = result.selected(2);
	if (resultCount > 0) {
		ValueSpan& registers = ensureRegisterCapacity(caller, callBase + resultCount - 1);
		registers.set(static_cast<size_t>(callBase), valueBool(false));
		if (resultCount > 1) {
			registers.set(static_cast<size_t>(callBase + 1), errorValue);
			registers.clear(callBase + 2, resultCount - 2);
		}
	}
	caller.placeResultTop(result, resultCount);
	instructionBudgetRemaining -= resultCount;
	finishProtectedContinuation(continuationIndex, resultCount);
}

bool CPU::finishImplicitProtectedHandler(u32 continuationIndex, bool succeeded) {
	const u32 flags = m_activeThread->protectedWord(continuationIndex, ProtectedField::Flags);
	if ((flags & PROTECTED_CALL_PARENT) == 0u || !m_activeThread->protectedResult(continuationIndex).extendsTop()) return false;
	// The enclosing implicit xpcall receives only its handler's first value.
	// A nested protected builtin delivers its status directly, without staging
	// it in the caller's live operand window or charging a write not performed.
	m_activeThread->setProtectedDepth(continuationIndex);
	const Value status = valueBool(succeeded);
	finishProtectedCall(continuationIndex - 1u, {nullptr, &status, 0, 1});
	return true;
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
		finishProtectedCall(continuationIndex - 1, {&protectedCaller(continuationIndex), nullptr, callBase, resultCount});
	}
}

bool CPU::handleProtectedCallError(Value errorValue) {
	for (;;) {
		const u32 depth = m_activeThread->protectedDepth();
		if (depth == 0) return false;
		const u32 continuationIndex = depth - 1;
		const u32 callerIndex = m_activeThread->protectedWord(continuationIndex, ProtectedField::Caller);
		if (callerIndex >= m_activeThread->frameDepth()) return false;
		auto* frame = m_activeThread->currentFrame;
		for (size_t at = m_activeThread->frameDepth() - 1; at > callerIndex; --at, frame = frame->previous) {
			// Completion roots return to their latch, not the interrupted caller.
			if (frame->hasControlFlag(FRAME_EXCEPTION | FRAME_COMPLETION)) return false;
		}
		unwindToDepth(callerIndex + 1, true);
		const auto kind = static_cast<ProtectedCallKind>(m_activeThread->protectedWord(continuationIndex, ProtectedField::Flags)
			& PROTECTED_CALL_KIND_MASK);
		if (kind != ProtectedCallKind::XPCallBody) {
			const Value result = kind == ProtectedCallKind::XPCallHandler ? valueString(m_heap.diagnosticWord(HeapServiceRemarkHeadField::Error)) : errorValue;
			finishProtectedCallWithError(continuationIndex, result);
			return true;
		}

		m_activeThread->setProtectedKind(continuationIndex, ProtectedCallKind::XPCallHandler);
		const auto result = m_activeThread->protectedResult(continuationIndex);
		const Value handler = m_activeThread->protectedHandler(continuationIndex);
		--instructionBudgetRemaining;
		try {
			if (result.extendsTop()) {
				auto roots = acquireLocalRoots();
				trackLocalRoot(errorValue);
				invokeProtectedTarget(continuationIndex, handler, {nullptr, &errorValue, 0, 1});
			} else {
				setRegister(*frame, result.base, errorValue);
				invokeProtectedTarget(continuationIndex, handler, {frame, nullptr, result.base, 1});
			}
			return true;
		} catch (const LuaThrownValueError& handlerError) {
			errorValue = handlerError.value;
		} catch (const LuaExecutionError& handlerError) {
			errorValue = luaFaultValue(handlerError.reason);
		}
	}
}

void CPU::runBuiltinNextValue(Value target, Value key, BuiltinResults& out) {
	if (!valueIsTable(target)) {
		throw LuaExecutionError(LUA_FAULT_REASON_ITERATE_NON_TABLE);
	}
	Value nextKey;
	Value nextValue;
	TableRecord(m_heap, valuePayload(target)).nextEntry(key, nextKey, nextValue);
	out.push_back(nextKey);
	if (!isNil(nextKey)) out.push_back(nextValue);
}

bool CPU::stepTableIterator(ValueSpan& registers, int base, int destination, int count) {
	if (registers.get(base) != valueBuiltinFunction(BuiltinFunctionId::Next)) return false;
	const Value table = registers.get(base + 1), control = registers.get(base + 2);
	if (!valueIsTable(table) || !isNil(control)) return false;
	Value key, value;
	const u32 cursor = TableRecord(m_heap, valuePayload(table)).nextStoredEntry(valuePayload(control), key, value);
	registers.set(destination, key);
	const int placed = count > 1 && cursor != 0 ? 2 : 1;
	if (placed == 2) registers.set(destination + 1, value);
	if (count > placed) registers.clear(destination + placed, count - placed);
	// The language-view of the hidden control slot remains nil. The
	// payload is a private cursor, carried by the normal frame state.
	registers.set(base + 2, valueFromTag(ValueTag::Nil, cursor));
	return true;
}

void CPU::runBuiltinError(BuiltinArgsView args) {
	const Value value = args[0];
	throw LuaThrownValueError(value);
}

void CPU::clearHaltUntilIrq() {
	m_haltedUntilIrqFrameDepth = -1;
	m_haltedUntilIrqThreadAddress = 0u;
	m_runSignals &= ~RunYield;
}

void CPU::requestNonMaskableInterrupt() {
	// NMI is an edge latch and can preempt the supervisor IRQ root reached
	// immediately before a system-request fence.
	m_runSignals |= RunNonMaskableInterrupt;
}

bool CPU::canAcceptMaskableInterruptLine() const {
	return (m_cop0Words[COP0_STATUS] & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) != 0u
		&& m_irqController.hasAssertedMaskableInterruptLine();
}

bool CPU::hasFramesAbove(u32 context, int depth) const {
	return (fixedInterruptActive() && m_memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS) == context)
		|| static_cast<int>(ThreadRecord::count(m_memory, context, ThreadField::FrameDepth)) > depth;
}

AcceptedInterruptKind CPU::peekPendingInterrupt() const {
	if (fixedInterruptActive()) return AcceptedInterruptKind::None;
	if ((m_runSignals & RunNonMaskableInterrupt) != 0u) {
		return AcceptedInterruptKind::NonMaskable;
	}
	if (canAcceptMaskableInterruptLine()) {
		return AcceptedInterruptKind::Maskable;
	}
	return AcceptedInterruptKind::None;
}

bool CPU::enterPendingInterrupt() {
	if (fixedInterruptActive() || heapServiceActive()) return false;
	if (m_pendingMemory.kind != PendingMemoryKind::None || allocationParked() || m_stringComparison.remaining || tableRebuild.record) return false;
	if ((m_runSignals & RunNonMaskableInterrupt) != 0u) {
		m_runSignals &= ~RunNonMaskableInterrupt;
		const bool hadHaltLatch = m_haltedUntilIrqFrameDepth >= 0;
		const u32 returnCauseWord = m_cop0Words[COP0_CAUSE];
		const u32 returnEpcWord = m_cop0Words[COP0_EPC];
		const u32 returnBadAddressWord = m_cop0Words[COP0_BAD_ADDRESS];
		const u32 returnLuaFaultReasonWord = m_cop0Words[COP0_LUA_FAULT_REASON];
		const u32 returnExceptionDomainWord = m_exceptionDomainWord;
		enterException(
			*m_systemImage,
			m_cop0Words[COP0_SYSTEM_VECTOR],
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
	const u32 enabledFlags = (m_cop0Words[COP0_STATUS] & CPU_STATUS_INTERRUPT_ENABLE_CURRENT) != 0u
		? m_irqController.enabledPendingFlags() : 0u;
	if (enabledFlags != 0u) {
		const bool user = isUserMode();
		const bool canDetach = !resetBankSelected();
		const u32 irqVector = user && canDetach ? m_memory.readRamRecordWord(CPU_IRQ_VECTOR_ADDRESS) : 0u;
		const auto domain = user && irqVector == 0u ? m_programExecutionDomainId : SYSTEM_EXECUTION_DOMAIN_ID;
		auto& image = *executionImageForDomain(domain);
		const u32 vector = irqVector != 0u ? irqVector : image.irqFunctionAddress;
		const u32 epc = m_activeThread->currentFrame->readControl(FrameField::Pc);
		const u32 accepted = enabledFlags | (isHaltedUntilIrq() ? CPU_INTERRUPT_STATE_HALT : 0u);
		if (m_haltedUntilIrqFrameDepth < 0) m_interruptEventPending = true;
		latchExceptionEntry(CPU_CAUSE_IRQ, epc);
		if (!readFunctionRecordOnBus(image, vector, executionBusSignalsForDomain(domain))) {
			hardHalt();
			return true;
		}
		if (canDetach && (irqVector != 0u || (!user && (m_functionRecordLatch.flags & BLUA32_FUNCTION_CODE) != 0u))) {
			m_memory.writeRamRecordPair(CPU_INTERRUPTED_CONTEXT_ADDRESS, m_activeThread->address, accepted);
			m_activeThread = &m_irqView;
		}
		enterLatchedExceptionFrame(false, epc);
		return true;
	}
	return false;
}

CallFrame* CPU::enterSynchronousException(CallFrame& interruptedFrame, u32 causeWord) {
	interruptedFrame.writeControl(FrameField::Pc, m_currentInstructionPc);
	return enterException(*m_systemImage, m_cop0Words[COP0_SYSTEM_VECTOR], causeWord, m_currentInstructionPc);
}

void CPU::enterSynchronousAddressException(CallFrame& interruptedFrame, u32 causeWord, u32 address) {
	m_cop0Words[COP0_BAD_ADDRESS] = address;
	enterSynchronousException(interruptedFrame, causeWord);
}

void CPU::enterInstructionFetchException(CallFrame& interruptedFrame, u32 causeWord, u32 pc) {
	instructionBudgetRemaining -= 1;
	interruptedFrame.writeControl(FrameField::Pc, pc);
	enterException(*m_systemImage, m_cop0Words[COP0_SYSTEM_VECTOR], causeWord, pc);
}

void CPU::enterLuaFaultException(u32 reason, Value errorValue) {
	m_cop0Words[COP0_LUA_FAULT_REASON] = reason;
	auto& interrupted = *m_activeThread;
	if (auto* frame = enterSynchronousException(*interrupted.currentFrame, CPU_CAUSE_CODE_TRAP)) {
		if (fixedInterruptActive()) interrupted.setError(errorValue);
		else frame->registers.set(0, errorValue);
	}
}

void CPU::retireNumericLuaFault(u32 reason) {
	if (resetBankSelected()) {
		m_cop0Words[COP0_LUA_FAULT_REASON] = reason;
		enterSynchronousException(*m_activeThread->currentFrame, CPU_CAUSE_CODE_TRAP);
		return;
	}
	const Value value = luaFaultValue(reason);
	if (!handleThreadError(value)) enterLuaFaultException(reason, value);
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
	if (fixedInterruptActive() && m_irqView.frameDepth() == 0u) resumeInterruptedContext();
	resumeFrameBank();
	m_cop0Words[COP0_STATUS] = (m_cop0Words[COP0_STATUS] & ~CPU_STATUS_RFE_RESTORE_MASK)
		| ((m_cop0Words[COP0_STATUS] >> 2u) & CPU_STATUS_RFE_RESTORE_MASK);
	if (m_activeThread->frameDepth() != 0) {
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
	if (auto* caller = m_activeThread->currentFrame; caller && caller->executionImage
		&& !caller->executionImage->admitsFunctionPc(caller->readControl(FrameField::Function), returnPc)) {
		m_cop0Words[COP0_BAD_ADDRESS] = returnPc;
		const auto cause = (returnPc & (INSTRUCTION_BYTES - 1u)) != 0u
			? CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD : CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR;
		enterInstructionFetchException(*caller, cause, returnPc);
	}
}

void CPU::executeSupervisorCall(CallFrame& frame, int source) {
	enterException(*m_systemImage, m_cop0Words[COP0_SYSTEM_VECTOR], CPU_CAUSE_CODE_SYSCALL,
		frame.readControl(FrameField::Pc), frame.registers.get(source));
}

CallFrame* CPU::enterException(
	Blua32ExecutionImage& vectorImage,
	u32 functionAddress,
	u32 causeWord,
	u32 epcWord,
	std::optional<Value> argument
) {
	latchExceptionEntry(causeWord, epcWord);
	if (fixedInterruptActive()) {
		// A second synchronous fault cannot enter another detached context.
		hardHalt();
		return nullptr;
	}
	if (&vectorImage == m_systemImage && !resetBankSelected()) {
		m_memory.writeRamRecordPair(CPU_INTERRUPTED_CONTEXT_ADDRESS, m_activeThread->address, 0u);
		m_activeThread = &m_irqView;
		m_runSignals |= RunThreadSwitch | RunYield;
	}
	return placeExceptionVector(vectorImage, functionAddress, causeWord == CPU_CAUSE_NMI, epcWord, argument);
}

void CPU::latchExceptionEntry(u32 causeWord, u32 epcWord) {
	m_exceptionDomainWord = static_cast<u32>(m_activeExecutionDomainId);
	m_cop0Words[COP0_EPC] = epcWord;
	m_cop0Words[COP0_CAUSE] = causeWord;
	m_cop0Words[COP0_STATUS] = (m_cop0Words[COP0_STATUS] & ~CPU_STATUS_MODE_STACK_MASK)
		| ((m_cop0Words[COP0_STATUS] << 2u) & CPU_STATUS_MODE_STACK_MASK);
	clearHaltAfterAcceptedInterrupt();
}

CallFrame* CPU::placeExceptionVector(Blua32ExecutionImage& vectorImage, u32 functionAddress, bool nmi, u32 epcWord,
	std::optional<Value> argument) {
	if (!readFunctionRecordOnBus(vectorImage, functionAddress, executionBusSignalsForDomain(vectorImage.executionDomainId))) {
		hardHalt();
		return nullptr;
	}
	return enterLatchedExceptionFrame(nmi, epcWord, argument);
}

CallFrame* CPU::enterLatchedExceptionFrame(bool nmi, u32 epcWord, std::optional<Value> argument) {
	try {
		return enterDirectFrame(FRAME_EXCEPTION | (nmi ? FRAME_NMI : 0u), epcWord, argument);
	} catch (const LuaOutOfMemorySignal&) {
		// Failure to admit an exception vector cannot recursively trap.
		hardHalt();
		return nullptr;
	}
}

CallFrame* CPU::enterDirectFrame(u32 flags, std::optional<u32> epcWord, std::optional<Value> argument) {
	// Direct machine entry binds the sampled Function and no capture environment.
	const auto& record = m_functionRecordLatch;
	const FunctionEntry entry{record.codeAddress, record.numParams, record.maxStack, record.flags};
	auto* image = record.image;
	const auto domain = image->executionDomainId;
	const bool exception = (flags & FRAME_EXCEPTION) != 0u;
	const bool boardBank = m_activeThread->address == CPU_RESET_BANK_ADDRESS;
	const auto admitted = ArgumentPlacement::forEntry(m_activeThread->stackTop(), 0, entry);
	if (!exception && !boardBank && (!admitted || !m_activeThread->frameSpaceFits(admitted->stackEnd()))) {
		hardHalt();
		return nullptr;
	}
	if (!admitted) throw LuaOutOfMemorySignal{};
	const auto& placement = *admitted;
	const u32 address = record.address;
	if (boardBank) {
		const auto frames = m_activeThread->frameDepth() + (exception ? 1u : 2u);
		if (placement.stackEnd() > CPU_FIXED_VALUE_COUNT || frames > CPU_FIXED_FRAME_COUNT) throw LuaOutOfMemorySignal{};
	} else if (exception && !m_activeThread->frameSpaceFits(placement.stackEnd(), 1u)) throw LuaOutOfMemorySignal{};
	auto* frame = m_activeThread->acquireFrame();
	frame->executionImage = image;
	const int argc = argument.has_value();
	frame->initializeControl({
		address, entry.codeAddress, epcWord.value_or(entry.codeAddress), frameBankWord(domain) | flags,
		placement.varargBase, argc, {}, std::max(placement.top(), argc), 0u, placement.stackBase, static_cast<int>(placement.capacity),
	});
	frame->registers.clear(0, exception ? std::max(1, placement.top()) : placement.top());
	if (argument) frame->registers.set(0, *argument);
	m_activeThread->setStackTop(static_cast<int>(placement.stackEnd()));
	m_activeThread->enterFrame(frame);
	latchActiveExecutionImage(domain, image);
	return frame;
}

void CPU::clearHaltAfterAcceptedInterrupt() {
	m_haltedUntilIrqFrameDepth = -1;
	m_haltedUntilIrqThreadAddress = 0u;
	m_runSignals &= ~RunYield;
}

void CPU::blockMappedWrite(CallFrame& frame, uint32_t address) {
	frame.writeControl(FrameField::Pc, m_currentInstructionPc);
	m_runSignals = (m_runSignals & ~RunYield) | RunMemoryBlocked;
	m_memoryWriteBlockedAddress = address;
}

void CPU::resumeMemoryWrite(uint32_t address) {
	// A device-ready edge releases only the instruction stalled on that raw MMIO target.
	if ((m_runSignals & RunMemoryBlocked) != 0u && m_memoryWriteBlockedAddress == address) {
		m_runSignals &= ~RunMemoryBlocked;
	}
}

#include "machine/cpu/cpu_calls.inl"
#include "machine/cpu/cpu_heap_service.inl"
#include "machine/cpu/cpu_bios_call.inl"
#include "machine/cpu/cpu_heap_record.inl"
#include "machine/cpu/cpu_memory.inl"
#include "machine/cpu/cpu_control.inl"
#include "machine/cpu/cpu_strings.inl"

inline CPU::GrantAdmission CPU::admitGrant(const Thread& thread, int targetDepth, int remainingCycles) const {
	const int depth = static_cast<int>(thread.frameDepth());
	if (depth <= targetDepth || (m_runSignals & (RunHardHalted | RunMemoryBlocked)) != 0u
		|| (m_haltedUntilIrqThreadAddress == thread.address && m_haltedUntilIrqFrameDepth == depth))
		return GrantAdmission::Halted;
	if ((m_runSignals & RunYield) != 0u) return GrantAdmission::RequestedYield;
	if (remainingCycles <= 0) return GrantAdmission::OutOfCycles;
	return GrantAdmission::Admitted;
}

template <bool RootBoundary, bool Instrumented, bool HeapService>
RunResult CPU::runLoop(
	int targetDepth,
	int instructionBudget
) {
	instructionBudgetRemaining = instructionBudget;
	Thread& thread = HeapService ? m_heapServiceView : *m_activeThread;
	const bool canInterrupt = &thread != &m_irqView;
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
	u32 nextPc = 0;
	int registerTop = 0;
	int publishedTop = 0;
	CallFrame* scalarFrame = nullptr;
	// Preserve the local PC/top across ordinary dispatch. Like the dispatch
	// macros below, these transitions must not pass the locals by address.
#define PUBLISH_SCALAR_FRONTIER() do { \
	if constexpr (!Instrumented) { \
		if (scalarFrame) { \
			scalarFrame->writeControl(FrameField::Pc, nextPc); \
			if (registerTop != publishedTop) scalarFrame->setTop(registerTop); \
			scalarFrame = nullptr; \
		} \
	} \
} while (0)
#define RESUME_SCALAR_FRONTIER() do { \
	if constexpr (!Instrumented) { \
		nextPc = frame->readControl(FrameField::Pc); \
		publishedTop = registerTop = frame->readWindow(FrameField::Top); \
		scalarFrame = frame; \
	} \
} while (0)
	bool canReuseFrame = false;
	constexpr bool privateFirmware = HeapService;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const NativeBlock* nativeBlock = nullptr;
	int nativeFirstDispatchCycles = 0;
	NativeCpuRunState nativeState(*this, targetDepth);
	nativeState.privateFirmware = privateFirmware;
#define OBSERVE_SCALAR_ARITHMETIC(left, right) do { \
	if constexpr (!Instrumented && !HeapService) { \
		if (nativeState.replay && nativeState.replay->pc == pc && nativeState.replay->arithmetic) { \
			const auto assumption = *nativeState.replay->arithmetic; \
			nativeState.replay.reset(); \
			observeNativeArithmeticReplay(*decodedPage, (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES, \
				assumption, left, right); \
		} else if (isNativeWarmDispatch(decoded->dispatchOp)) { \
			decoded->observeNativeNumericTypes(left, right); \
		} \
	} \
} while (0)
#endif
	for (;;) {
		try {
			if constexpr (HeapService) {
				if ((m_runSignals & RunHardHalted) != 0u || thread.frameDepth() == 0) return RunResult::Halted;
				if ((m_runSignals & RunYield) != 0u) {
					m_runSignals &= ~RunYield;
					return RunResult::Yielded;
				}
				if (instructionBudgetRemaining <= 0) return RunResult::Yielded;
			} else {
				auto admission = admitGrant(thread, RootBoundary ? 0 : targetDepth, instructionBudgetRemaining);
				if (admission == GrantAdmission::Admitted && m_pendingMemory.kind != PendingMemoryKind::None) {
					resumePendingMemoryOperation();
					admission = admitGrant(thread, RootBoundary ? 0 : targetDepth, instructionBudgetRemaining);
				}
				if (admission == GrantAdmission::Admitted && m_stringComparison.remaining) {
					advanceStringComparison(*thread.currentFrame);
					admission = admitGrant(thread, RootBoundary ? 0 : targetDepth, instructionBudgetRemaining);
				}
				if (admission == GrantAdmission::Admitted && tableRebuild.record) {
					advanceTableStore(*thread.currentFrame);
					if (allocationParked()) return RunResult::ParkedAllocation;
					admission = admitGrant(thread, RootBoundary ? 0 : targetDepth, instructionBudgetRemaining);
				}
				switch (admission) {
					case GrantAdmission::Admitted: break;
					case GrantAdmission::Halted: return RunResult::Halted;
					case GrantAdmission::RequestedYield:
						m_runSignals &= ~RunYield;
						return RunResult::Yielded;
					case GrantAdmission::OutOfCycles: return RunResult::Yielded;
				}
			}
			frame = thread.currentFrame;
			image = frame->executionImage;
			if constexpr (!HeapService) {
				if (image && image != m_activeExecutionImage) latchActiveExecutionImage(image->executionDomainId, image);
			}

			if constexpr (Instrumented) {
				if (canInterrupt && (m_runSignals & RunNonMaskableInterrupt) != 0u) {
					enterPendingInterrupt();
					continue;
				}
				if (canInterrupt && canAcceptMaskableInterruptLine()) {
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
					if (heapServiceActive()) return RunResult::CollectionProgress;
					if (&thread != m_activeThread) {
						m_runSignals |= RunThreadSwitch;
						return RunResult::Yielded;
					}
					continue;
				}
			} else if constexpr (!HeapService) {
				if (canInterrupt && ((m_runSignals & RunNonMaskableInterrupt) != 0u || canAcceptMaskableInterruptLine())) {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
					// The next instruction belongs to the interrupt handler; retry admission
					// for the suspended instruction after RFE instead.
					nativeState.replay.reset();
					nativeState.hotSidePc.reset();
#endif
					enterPendingInterrupt();
					if (heapServiceActive()) return RunResult::CollectionProgress;
					if (&thread != m_activeThread) {
						m_runSignals |= RunThreadSwitch;
						return RunResult::Yielded;
					}
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
			if (!image || (!HeapService && resetBankSelected() && pc >= SYSTEM_ROM_BASE + SYSTEM_ROM_SIZE)) {
				m_cop0Words[COP0_BAD_ADDRESS] = pc;
				enterInstructionFetchException(*frame, CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, pc);
				continue;
			}
			if constexpr (!Instrumented) publishedTop = registerTop = frame->readWindow(FrameField::Top);
			pageAddress = pc & ~MAPPED_PAGE_BYTE_MASK;
			decodedPage = &decodedPageForFrame(*frame, pc, privateFirmware);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
dispatch_bound_page:
			if constexpr (!Instrumented) {
				if (nativeState.hotSidePc) {
					const bool atTarget = *nativeState.hotSidePc == pc;
					nativeState.hotSidePc.reset();
					const u32 word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
					if (atTarget && !decodedPage->refreshState[word]
						&& isNativeWarmDispatch(decodedPage->words[word].dispatchOp))
						prepareNativeBlock(*frame, *decodedPage, pc, HeapService ? mappedBusSignalsForCartridgeSlot(0u) : m_executionBusSignals);
				}
			}
#endif
			goto dispatch_decode;

dispatch_decode:
			const u32 pageOffset = (pc & MAPPED_PAGE_BYTE_MASK) >> 2;
			decoded = &decodedPage->words[pageOffset];
			const u8 refresh = decodedPage->refreshState[pageOffset];
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			[[maybe_unused]] bool rewritten = false;
#endif
			if constexpr (!Instrumented) canReuseFrame = true;
			if ((Instrumented ? (refresh & DECODED_REFRESH_DECODE) : refresh) != 0u) {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
				rewritten = (refresh & DECODED_REFRESH_DECODE) && decoded->width != 0u;
#endif
				PUBLISH_SCALAR_FRONTIER();
				if (!decodeInstruction(*frame, *decodedPage, pageOffset, pc, !Instrumented && !HeapService)) continue;
				if constexpr (!Instrumented) {
					canReuseFrame = !(decodedPage->refreshState[pageOffset] & DECODED_REFRESH_DECODE);
					publishedTop = registerTop = frame->readWindow(FrameField::Top);
				}
			}
			m_currentInstructionPc = pc;
			nextPc = pc + static_cast<u32>(decoded->width) * INSTRUCTION_BYTES;
			if constexpr (Instrumented) frame->writeControl(FrameField::Pc, nextPc);
			else scalarFrame = frame;
			m_lastExecutionDomainId = image->executionDomainId;
			lastPc = nextPc - INSTRUCTION_BYTES;
			uint8_t dispatchOp;
			if constexpr (Instrumented) {
				dispatchOp = decoded->dispatchOp == static_cast<u8>(DecodedDispatchOp::Observe)
					? decoded->dispatchOp : decoded->op;
			} else {
				dispatchOp = decoded->dispatchOp;
			}
			instructionBudgetRemaining -= decoded->baseCycles;

#define FRAME (*frame)
#define IMAGE (*image)
#define REG(index) frame->registers.get(static_cast<size_t>(index))
#define CYCLES_ADD(n) do { instructionBudgetRemaining -= (n); } while (0)
#define EXTEND_TOP(extent) do { \
	if constexpr (Instrumented) FRAME.extendTop(extent); \
	else registerTop = std::max(registerTop, static_cast<int>(extent)); \
} while (0)
#define SET_REGISTER_FAST(index, valueExpr) do { \
	frame->registers.set(static_cast<size_t>(index), (valueExpr)); \
	EXTEND_TOP((index) + 1); \
} while (0)
#define SET_NEXT_PC(target) do { \
	if constexpr (Instrumented) FRAME.writeControl(FrameField::Pc, target); \
	else nextPc = (target); \
} while (0)
// A decoded skip changes the local PC, just like a taken JMP. Only an
// actual fetch of the skipped encoding needs a published frame for faults.
#define DISPATCH_SKIP_NEXT() do { \
	if constexpr (!Instrumented) { \
		if (canReuseFrame && (nextPc & ~MAPPED_PAGE_BYTE_MASK) == pageAddress) { \
			const u32 skipped = (nextPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES; \
			if (!(decodedPage->refreshState[skipped] & DECODED_REFRESH_DECODE)) { \
				nextPc += decodedPage->words[skipped].width * INSTRUCTION_BYTES; \
				DISPATCH_NEXT(); \
			} \
		} \
	} \
	PUBLISH_SCALAR_FRONTIER(); \
	skipNextInstruction(FRAME, privateFirmware); \
	DISPATCH_CONTINUE(); \
} while (0)
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
// On fallthrough the comparison owns the paired JMP. A separate incoming
// edge to that same PC still requests an independent native entry.
#define COMPARISON_FALLTHROUGH() do { \
	if constexpr (!Instrumented && !HeapService) { \
		if ((nextPc & ~MAPPED_PAGE_BYTE_MASK) == pageAddress) { \
			const u32 word = (nextPc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES; \
			if (!(decodedPage->refreshState[word] & DECODED_REFRESH_DECODE) \
				&& nativeComparisonPairsJump(decodedPage->words[word])) FRAME.compilationEntry = false; \
		} \
	} \
} while (0)
#else
#define COMPARISON_FALLTHROUGH() ((void)0)
#endif
#define TABLE_CACHE_SLOT() (decoded->tableCacheSlot())
#define DISPATCH_LABEL(name) case static_cast<uint8_t>(OpCode::name):
#define DISPATCH_CONTINUE() do { goto dispatch_continue; } while (0)
#define DISPATCH_NEXT() do { \
	if constexpr (!Instrumented) { \
		if (canReuseFrame && instructionBudgetRemaining > 0) { \
			pc = nextPc; \
			if ((pc & ~MAPPED_PAGE_BYTE_MASK) == pageAddress) goto dispatch_decode; \
			PUBLISH_SCALAR_FRONTIER(); \
			goto dispatch_fetch; \
		} \
		PUBLISH_SCALAR_FRONTIER(); \
	} \
	goto dispatch_continue; \
} while (0)
#define DISPATCH_BLOCKED() do { return RunResult::Halted; } while (0)
#define DISPATCH_REBIND_FRAME() do { \
	goto dispatch_rebind_frame; \
} while (0)

dispatch_instruction:
			if (decoded->requiredSlots > frame->registers.size()) {
				if (dispatchOp == static_cast<u8>(DecodedDispatchOp::Observe)) goto dispatch_observe;
				if (decoded->c == static_cast<u8>(MemoryAccessKind::F64LE)) {
					switch (static_cast<OpCode>(decoded->op)) {
					case OpCode::LOAD_MEM: case OpCode::LOAD_MEM_D:
					case OpCode::STORE_MEM: case OpCode::STORE_MEM_D:
						instructionBudgetRemaining -= F64_ACCESS_EXTRA_CYCLES;
						break;
					default:
						break;
					}
				}
				throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			}
			if constexpr (Instrumented) {
				switch (dispatchOp) {
				case static_cast<u8>(DecodedDispatchOp::ReservedMemory):
					PUBLISH_SCALAR_FRONTIER();
					enterSynchronousException(FRAME, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
					DISPATCH_CONTINUE();
				case static_cast<u8>(DecodedDispatchOp::Observe):
					goto dispatch_observe;
#define DISPATCH_INTERNAL(name) case static_cast<u8>(DecodedDispatchOp::name):
#include "machine/cpu/cpu_dispatch.inl"
#undef DISPATCH_INTERNAL
				}
			} else {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
				// Warmth selects an execution tier for the admitted instruction.
				// It is not a guest opcode: dispatch the selected operation once.
				if (isNativeWarmDispatch(dispatchOp)) {
					const bool entry = FRAME.compilationEntry;
					FRAME.compilationEntry = rewritten || dispatchOp == static_cast<u8>(DecodedDispatchOp::NativeWarmBoundary);
					dispatchOp = decoded->op;
					// Mapped source discovery needs per-word heat, including ROM
					// entered at a previously sequential PC.
					if (entry || image->romFunctions.mappedCode || decodedPage->mapping.writeWatch.groups) {
						auto& visits = decodedPage->nativeVisits[pageOffset];
						if (visits < NATIVE_BLOCK_COMPILATION_THRESHOLD) ++visits;
						if (entry && visits == NATIVE_BLOCK_COMPILATION_THRESHOLD
							&& !(nativeState.replay && nativeState.replay->pc == pc && nativeState.replay->arithmetic)) {
							prepareNativeBlock(FRAME, *decodedPage, pc, HeapService ? mappedBusSignalsForCartridgeSlot(0u) : m_executionBusSignals);
							if (decoded->dispatchOp == static_cast<u8>(DecodedDispatchOp::NativeBlock))
								dispatchOp = decoded->dispatchOp;
						}
					}
				}
#endif
				// All selectors here are issued by decode or native publication.
				// Keep one handler per selector; only the branch mechanism differs.
#if defined(__GNUC__) && !defined(_MSC_VER)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wpedantic"
				static void* const targets[] = {
#define OP(name) &&op_##name,
#include "spec/blua32/opcode_list.inl"
// Warm selectors resolve above and are never indexed here.
#define TIER(name) nullptr,
#include "machine/cpu/decoded_dispatch_list.inl"
#undef TIER
#undef OP
				};
				static_assert(std::size(targets) == DECODED_DISPATCH_OP_COUNT);
				goto *targets[dispatchOp];
#pragma GCC diagnostic pop
#undef DISPATCH_LABEL
#define DISPATCH_LABEL(name) op_##name:
#define DISPATCH_INTERNAL(name) op_##name:
				{
#else
#define DISPATCH_INTERNAL(name) case static_cast<u8>(DecodedDispatchOp::name):
				switch (dispatchOp) {
#endif
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
				DISPATCH_INTERNAL(NativeBlock) {
					// The CPU thread owns code publication and source writes. With no
					// intervening guest instruction, this is the same published entry;
					// interrupt entry above cancels the retry before any handler runs.
					// An interior scalar continuation may already have run before
					// reaching the next native entry. Only bypass its exact PC.
					const bool replay = nativeState.replay && nativeState.replay->pc == pc;
					if (!replay || !nativeState.replay->arithmetic) nativeState.replay.reset();
					if (replay || std::endian::native == std::endian::big || thread.stackRequiresScalar()) {
						FRAME.compilationEntry = rewritten || nativeBlockEndsBlock(decoded->op, decoded->b, HeapService);
						dispatchOp = decoded->op;
						goto dispatch_instruction;
					}
					nativeBlock = decodedPage->nativeBlocks->entries[pageOffset].get();
					// The first instruction was admitted and charged with positive
					// budget; the native grant takes over that accounting.
					nativeFirstDispatchCycles = decoded->baseCycles;
					goto dispatch_native_block;
				}
#endif
				DISPATCH_INTERNAL(ReservedMemory)
					PUBLISH_SCALAR_FRONTIER();
					enterSynchronousException(FRAME, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
					DISPATCH_CONTINUE();
				DISPATCH_INTERNAL(Observe)
					goto dispatch_observe;
				DISPATCH_INTERNAL(FusedShlBxor)
				DISPATCH_INTERNAL(FusedShrBxor) {
					if (thread.stackRequiresScalar()) {
						dispatchOp = decoded->op;
						goto dispatch_instruction;
					}
					const int a = decoded->a;
					const int rkB = decoded->b;
					const int rkC = decoded->c;
					const Value& shiftLeftValue = readRK(IMAGE, frame->registers, rkB);
					const Value& shiftRightValue = readRK(IMAGE, frame->registers, rkC);
					const i32 shifted = dispatchOp == static_cast<u8>(DecodedDispatchOp::FusedShlBxor)
						? luaShiftLeft(integerOperand(shiftLeftValue), integerOperand(shiftRightValue))
						: luaShiftRight(integerOperand(shiftLeftValue), integerOperand(shiftRightValue));
					SET_REGISTER_FAST(
						a,
						valueInteger(shifted)
					);
					if (instructionBudgetRemaining <= 0) {
						PUBLISH_SCALAR_FRONTIER();
						DISPATCH_CONTINUE();
					}
					const u32 successorPc = nextPc;
					DecodedInstructionPage& successorPage = decodedPageForFrame(FRAME, successorPc);
					const u32 successorOffset = (successorPc & MAPPED_PAGE_BYTE_MASK) >> 2;
					if ((successorPage.refreshState[successorOffset]
						& DECODED_REFRESH_DECODE) != 0u) {
						PUBLISH_SCALAR_FRONTIER();
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
					nextPc = successorPc + static_cast<u32>(decoded->width) * INSTRUCTION_BYTES;
					scalarFrame = frame;
					m_lastExecutionDomainId = IMAGE.executionDomainId;
					lastPc = successorPc
						+ ((static_cast<u32>(decoded->width) - 1u) * INSTRUCTION_BYTES);
					instructionBudgetRemaining -= decoded->baseCycles;
					if (decoded->requiredSlots > frame->registers.size()) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
					const Value& xorLeftValue = readRK(IMAGE, frame->registers, decoded->b);
					const Value& xorRightValue = readRK(IMAGE, frame->registers, decoded->c);
					const int32_t xorResult = static_cast<int32_t>(
						static_cast<u32>(integerOperand(xorLeftValue)) ^ static_cast<u32>(integerOperand(xorRightValue))
					);
					SET_REGISTER_FAST(
						decoded->a,
						valueInteger(xorResult)
					);
					PUBLISH_SCALAR_FRONTIER();
					DISPATCH_CONTINUE();
				}
				DISPATCH_INTERNAL(FusedAddShl) {
					if (thread.stackRequiresScalar()) {
						dispatchOp = decoded->op;
						goto dispatch_instruction;
					}
					const int a = decoded->a;
					const int rkB = decoded->b;
					const int rkC = decoded->c;
					const Value& addLeftValue = readRK(IMAGE, frame->registers, rkB);
					const Value& addRightValue = readRK(IMAGE, frame->registers, rkC);
					SET_REGISTER_FAST(
						a,
						valueAdd(addLeftValue, addRightValue)
					);
					if (instructionBudgetRemaining <= 0) {
						PUBLISH_SCALAR_FRONTIER();
						DISPATCH_CONTINUE();
					}
					const u32 successorPc = nextPc;
					DecodedInstructionPage& successorPage = decodedPageForFrame(FRAME, successorPc);
					const u32 successorOffset = (successorPc & MAPPED_PAGE_BYTE_MASK) >> 2;
					if ((successorPage.refreshState[successorOffset]
						& DECODED_REFRESH_DECODE) != 0u) {
						PUBLISH_SCALAR_FRONTIER();
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
					nextPc = successorPc + static_cast<u32>(decoded->width) * INSTRUCTION_BYTES;
					scalarFrame = frame;
					m_lastExecutionDomainId = IMAGE.executionDomainId;
					lastPc = successorPc
						+ ((static_cast<u32>(decoded->width) - 1u) * INSTRUCTION_BYTES);
					instructionBudgetRemaining -= decoded->baseCycles;
					if (decoded->requiredSlots > frame->registers.size()) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
					const Value& shiftLeftValue = readRK(IMAGE, frame->registers, decoded->b);
					const Value& shiftRightValue = readRK(IMAGE, frame->registers, decoded->c);
					const i32 shifted = luaShiftLeft(integerOperand(shiftLeftValue), integerOperand(shiftRightValue));
					SET_REGISTER_FAST(
						decoded->a,
						valueInteger(shifted)
					);
					PUBLISH_SCALAR_FRONTIER();
					DISPATCH_CONTINUE();
				}
#include "machine/cpu/cpu_dispatch.inl"
#undef DISPATCH_INTERNAL
				}
			}
			goto dispatch_continue;

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
dispatch_native_block: {
				PUBLISH_SCALAR_FRONTIER();
				const int nativeBudget = instructionBudgetRemaining + nativeFirstDispatchCycles;
				nativeState.enterFrame(*frame, nativeBudget);
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
				const int nativeStartBudget = nativeState.state.remainingCycles;
#endif
				nativeBlock->execute(nativeState);
#if defined(BMSX_NATIVE_GATE_PROFILE)
				if constexpr (HeapService) {
					const int retiredCycles = nativeBudget - instructionBudgetRemaining;
					if (retiredCycles > 0) {
						++m_nativeGateProfile.privateFirmwareEntries;
						m_nativeGateProfile.privateFirmwareCycles += retiredCycles;
						m_nativeGateProfile.lastPrivateFirmwareEntryPc = nativeBlock->firstPc;
					}
				}
#endif
#if defined(BMSX_DIAGNOSTIC_CPU_SLICES)
				// Helpers publish the authoritative CPU grant before returning or
				// reporting an error; the native state's copy can then be stale.
				m_diagnosticExecutionProfile.nativeOriginCycles += static_cast<i64>(nativeStartBudget) - instructionBudgetRemaining;
				const auto& counts = nativeState.state.diagnosticOpcodes;
				auto& total = m_diagnosticExecutionProfile.nativeOpcodes;
				total.call += counts.call;
				total.setfield += counts.setfield;
				total.concat += counts.concat;
				total.concatn += counts.concatn;
#endif
				if (nativeState.error) std::rethrow_exception(std::exchange(nativeState.error, {}));
				if constexpr (!HeapService) {
					if (allocationParked()) return RunResult::ParkedAllocation;
				}
				DISPATCH_CONTINUE();
			}
#endif

dispatch_rebind_frame:
			if constexpr (Instrumented) goto dispatch_continue;
			if (canReuseFrame && instructionBudgetRemaining > 0) {
				if constexpr (RootBoundary) {
					if (thread.frameDepth() == 0) return RunResult::Halted;
				} else {
					if (static_cast<int>(thread.frameDepth()) <= targetDepth) return RunResult::Halted;
				}
				// A pure frame transition can activate the depth-sensitive HALT latch.
				if constexpr (!HeapService) {
					if (m_haltedUntilIrqThreadAddress == m_activeThread->address
						&& m_haltedUntilIrqFrameDepth == static_cast<int>(thread.frameDepth())) return RunResult::Halted;
				}
				frame = thread.currentFrame;
				image = frame->executionImage;
				if (!image) goto dispatch_continue;
				if constexpr (!HeapService) {
					if (image != m_activeExecutionImage) latchActiveExecutionImage(image->executionDomainId, image);
				}

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
				pc = frame->readControl(FrameField::Pc);
				// A function record can supply a raw unaligned code address. Leave
				// its address exception to the ordinary instruction-fetch boundary.
				if ((pc & (INSTRUCTION_BYTES - 1u)) == 0u) {
					pageAddress = pc & ~MAPPED_PAGE_BYTE_MASK;
					decodedPage = &decodedPageForFrame(FRAME, pc, privateFirmware);
					if (decodedPage->nativeBlocks) {
						nativeBlock = decodedPage->nativeBlocks->entries[(pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES].get();
						if (nativeBlock && std::endian::native == std::endian::little && !thread.stackRequiresScalar()) {
							nativeFirstDispatchCycles = 0;
							goto dispatch_native_block;
						}
					}
					// The receiving frame and its aligned fetch page are already
					// bound, even when this entry has no native body.
					publishedTop = registerTop = FRAME.readWindow(FrameField::Top);
					goto dispatch_bound_page;
				}
#endif
				goto dispatch_fetch;
			}
			goto dispatch_continue;

dispatch_observe:
			PUBLISH_SCALAR_FRONTIER();
			canReuseFrame = false;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			FRAME.compilationEntry = rewritten || nativeBlockEndsBlock(decoded->op, decoded->b, HeapService);
#endif
			// Observation precedes the original instruction's charge.
			instructionBudgetRemaining += decoded->baseCycles;
			m_instructionObserver.observe(m_instructionObserver.context, image->executionDomainId, pc, frame->registers);
			RESUME_SCALAR_FRONTIER();
			dispatchOp = decoded->op;
			instructionBudgetRemaining -= decoded->baseCycles;
			goto dispatch_instruction;

dispatch_continue:
#undef DISPATCH_BLOCKED
#undef DISPATCH_REBIND_FRAME
#undef DISPATCH_NEXT
#undef DISPATCH_CONTINUE
#undef DISPATCH_LABEL
#undef DISPATCH_SKIP_NEXT
#undef COMPARISON_FALLTHROUGH
#undef TABLE_CACHE_SLOT
#undef SET_NEXT_PC
#undef SET_REGISTER_FAST
#undef EXTEND_TOP
#undef CYCLES_ADD
#undef REG
#undef IMAGE
#undef FRAME
			continue;
		} catch (const LuaOutOfMemorySignal&) {
			PUBLISH_SCALAR_FRONTIER();
			if constexpr (HeapService) throw;
			retireNumericLuaFault(LUA_FAULT_REASON_OUT_OF_MEMORY);
		} catch (const LuaThrownValueError& error) {
			PUBLISH_SCALAR_FRONTIER();
			if constexpr (HeapService) throw;
			if (!handleThreadError(error.value)) {
				enterLuaFaultException(LUA_FAULT_REASON_EXPLICIT_ERROR, error.value);
			}
		} catch (const LuaExecutionError& error) {
			PUBLISH_SCALAR_FRONTIER();
			if constexpr (HeapService) throw;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			nativeState.replay.reset();
#endif
			retireNumericLuaFault(error.reason);
		} catch (...) {
			PUBLISH_SCALAR_FRONTIER();
			throw;
		}
	}
}

#undef RESUME_SCALAR_FRONTIER
#undef PUBLISH_SCALAR_FRONTIER
#undef OBSERVE_SCALAR_ARITHMETIC

int CPU::remainingDeviceCycles() const {
	// Bare CPU execution supplies only an explicit clock horizon.
	return m_deviceClock == nullptr ? std::max(0, instructionBudgetRemaining) : m_deviceClock->cyclesUntilDeadline();
}

RunResult CPU::runUntilDepth(int targetDepth, int instructionBudget, u32 target, CpuRunKind kind, const DeviceScheduler* deviceClock) {
	m_deviceClock = deviceClock;
	ScopeExit endClock([this] { m_deviceClock = nullptr; });
	if (heapServiceActive()) {
		const u32 biosCall = m_heapAllocator.managementOffset() + HEAP_SERVICE_BIOS_CALL_OFFSET;
		const auto completion = static_cast<HeapServiceBiosCallKind>(m_memory.readRamRecordWord(biosCall + static_cast<u32>(HeapServiceBiosCallField::Kind)));
		const u32 flags = m_heapServiceView.firstFrame->readControl(FrameField::Flags);
		const bool resident = (flags & FRAME_RESIDENT_ACTIVATION) != 0u;
		m_runKind = kind;
		ScopeExit endGrant([this] { m_runKind = CpuRunKind::Idle; });
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		synchronizeNativeHistoryWrites();
#endif
#if defined(BMSX_ENABLE_NATIVE_COMPILER_WORKER)
		publishNativeCompilation();
		serviceNativeDemand();
#endif
		runLoop<true, false, true>(0, instructionBudget);
		if (!heapServiceActive()) {
			// An inactive borrow might name reused storage. The selected
			// Thread itself is rooted but its physical planes can change.
			m_activeThread->bindStack(true);
			if (m_activeThread != &m_rootView) m_rootView.bindStack(true);
			m_globalBank.bind();
			m_systemGlobalBank.bind();
			for (auto& view : m_transferViews)
				if (&view != m_activeThread && view.address != 0u) view.select(0u);
			try {
				if (resident) finishResidentCall(flags);
				else if (completion != HeapServiceBiosCallKind::Idle) {
					finishBiosCall(completion);
				} else {
					finishClosureReservation();
				}
			} catch (const LuaOutOfMemorySignal&) {
				const auto value = luaFaultValue(LUA_FAULT_REASON_OUT_OF_MEMORY);
				if (!handleThreadError(value)) enterLuaFaultException(LUA_FAULT_REASON_OUT_OF_MEMORY, value);
			} catch (const LuaThrownValueError& error) {
				if (!handleThreadError(error.value)) enterLuaFaultException(LUA_FAULT_REASON_EXPLICIT_ERROR, error.value);
			} catch (const LuaExecutionError& error) {
				const auto value = luaFaultValue(error.reason);
				if (!handleThreadError(value)) enterLuaFaultException(error.reason, value);
			}
		}
		if ((m_runSignals & RunHardHalted) != 0u) return RunResult::Halted;
		return (flags & FRAME_FIXED_WORK) != 0u && kind == CpuRunKind::Scheduled
			? RunResult::CollectionProgress : RunResult::Yielded;
	}
	if (allocationParked()) {
		instructionBudgetRemaining = instructionBudget;
		return RunResult::ParkedAllocation;
	}
	m_runKind = kind;
	ScopeExit endGrant([this] { m_runKind = CpuRunKind::Idle; });
	if (m_unpublishedRomMask != 0u)
		throw BMSX_RUNTIME_ERROR("Installed ROM must be published before CPU execution.");
	if (target == 0u) target = m_rootView.address;
	for (;;) {
		const RunResult result = m_runUntilDepthEntry(*this, m_activeThread->address == target ? targetDepth : 0, instructionBudget);
		if ((m_runSignals & RunThreadSwitch) == 0u) return result;
		m_runSignals &= ~(RunThreadSwitch | RunYield);
		instructionBudget = instructionBudgetRemaining;
		if (instructionBudget <= 0) return RunResult::Yielded;
	}
}

RunResult CPU::runUntilDepthNormal(CPU& cpu, int targetDepth, int instructionBudget) {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	cpu.synchronizeNativeHistoryWrites();
#endif
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	cpu.publishNativeCompilation();
#endif
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	if (auto* image = cpu.m_activeExecutionImage; image && image->nativeWarmup.entryPc
		&& cpu.admitGrant(*cpu.m_activeThread, targetDepth, instructionBudget) == GrantAdmission::Admitted
		&& cpu.m_activeThread->currentFrame->executionImage == image
		&& !cpu.tableRebuild.record && !cpu.m_stringComparison.remaining && cpu.m_pendingMemory.kind == PendingMemoryKind::None
		&& cpu.peekPendingInterrupt() == AcceptedInterruptKind::None) {
#if defined(BMSX_NATIVE_COMPILER_WORKER)
		// Preserve the request until no worker snapshot can overlap it.
		if (!cpu.m_nativeCompilerWorker || cpu.m_nativeCompilerWorker->idle())
#endif
		{
			auto& warmup = image->nativeWarmup;
			cpu.prepareNativeImageCode(*image, warmup.entryPc);
			warmup.entryPc.reset();
			warmup.consumed = true;
		}
	}
#endif
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	cpu.serviceNativeDemand();
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
		for (const auto& entry : image->decodedPages.entries()) {
			auto& page = entry->page;
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
	const bool unwinding = static_cast<int>(m_activeThread->frameDepth()) > targetDepth;
	if (unwinding) abortStalledMemoryWrite();
	while (static_cast<int>(m_activeThread->frameDepth()) > targetDepth) {
		auto* finished = m_activeThread->currentFrame;
		const int closed = closeUpvalues(*finished);
		if (chargeCaptures) instructionBudgetRemaining -= closed;
		m_activeThread->leaveFrame();
	}
	if (unwinding) resumeFrameBank();
	u32 depth = m_activeThread->protectedDepth();
	while (depth > 0 && m_activeThread->protectedWord(depth - 1, ProtectedField::Caller) >= m_activeThread->frameDepth()) --depth;
	m_activeThread->setProtectedDepth(depth);
}

size_t CPU::collectHeap(Value root0, Value root1, Value root2, u32 growingThread) {
	return m_heap.collect(root0, root1, root2, growingThread);
}

void CPU::chargeCollectionWork(size_t work) {
	if (m_runKind != CpuRunKind::Idle) instructionBudgetRemaining -= GC_WORK_WORD_CYCLES * static_cast<int>(work);
}

size_t CPU::assistAllocation(Value root0, Value root1, Value root2, u32 growingThread, size_t words, const int* sourceBudget) {
	if (m_runKind != CpuRunKind::Idle || sourceBudget) {
		const int remaining = sourceBudget ? *sourceBudget : instructionBudgetRemaining;
		if (remaining < GC_WORK_WORD_CYCLES) return 0;
		words = std::min(words, static_cast<size_t>(remaining / GC_WORK_WORD_CYCLES));
	}
	const size_t work = m_heap.step(root0, root1, root2, growingThread, false, words);
	chargeCollectionWork(work);
	return work;
}

size_t CPU::stepHeap(Value root0, Value root1, Value root2, u32 growingThread) {
	return m_heap.step(root0, root1, root2, growingThread);
}

ExecutionDomainId CPU::readFrameExecutionDomain(int frameIndex) const {
	return frameExecutionBank(ThreadRecord::readFrameWord(m_memory, m_activeThread->address, static_cast<u32>(frameIndex), FrameField::Flags));
}

ExecutionDomainId CPU::readLastExecutionDomain() const {
	return m_lastExecutionDomainId;
}

u32 CPU::readCurrentInstructionPc() const {
	return m_currentInstructionPc;
}

u32 CPU::readFrameFunctionAddress(int frameIndex) const {
	return ThreadRecord::readFrameWord(m_memory, m_activeThread->address, static_cast<u32>(frameIndex), FrameField::Function);
}

u32 CPU::readFramePc(int frameIndex) const {
	return ThreadRecord::readFrameWord(m_memory, m_activeThread->address, static_cast<u32>(frameIndex), FrameField::Pc);
}

u32 CPU::readFrameCallSitePc(int childFrameIndex) const {
	return ThreadRecord::readFrameWord(m_memory, m_activeThread->address, static_cast<u32>(childFrameIndex), FrameField::CallSite);
}

bool CPU::completionCallPending() const {
	const u32 thread = m_completionThreadAddress;
	const auto layout = ThreadRecord::storageLayout(m_memory, thread);
	for (u32 depth = ThreadRecord::count(m_memory, thread, ThreadField::FrameDepth); depth != 0u; --depth) {
		const u32 flags = m_memory.readRamRecordWord(layout.frameAddress(depth - 1u) + static_cast<u32>(FrameField::Flags));
		if ((flags & FRAME_COMPLETION) != 0u) return true;
	}
	return false;
}

bool CPU::readFrameReturnsToCompletionLatch(int frameIndex) const {
	return m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex))->hasControlFlag(FRAME_COMPLETION);
}

void CPU::abortCompletionCall(int frameIndex) {
	if (fixedInterruptActive()) throw BMSX_RUNTIME_ERROR("Fixed execution must retire before replacing code execution.");
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
	for (size_t frameIndex = 0; frameIndex < m_activeThread->frameDepth(); ++frameIndex, frame = frame->next) {
		if (frame->hasControlFlag(FRAME_EXCEPTION)) return static_cast<int>(frameIndex);
	}
	return -1;
}

bool CPU::isNonMaskableExceptionFrame(int frameIndex) const {
	return m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex))->hasControlFlag(FRAME_NMI);
}

int CPU::getFrameRegisterCount(int frameIndex) const {
	return static_cast<int>(ThreadRecord::readFrameWord(m_memory, m_activeThread->address, static_cast<u32>(frameIndex), FrameField::Top) & FRAME_WINDOW_MASK);
}

Value CPU::readFrameRegister(int frameIndex, int registerIndex) const {
	const u32 thread = m_activeThread->address;
	const u32 base = ThreadRecord::readFrameWord(m_memory, thread, static_cast<u32>(frameIndex), FrameField::StackBase) & FRAME_WINDOW_MASK;
	const auto layout = ThreadRecord::storageLayout(m_memory, thread);
	return layout.slots(m_memory, base + static_cast<u32>(registerIndex) >= layout.valueCapacity).get(base + static_cast<u32>(registerIndex));
}

int CPU::getFrameUpvalueCount(int frameIndex) const {
	const u32 closure = ThreadRecord::readFrameWord(m_memory, m_activeThread->address, static_cast<u32>(frameIndex), FrameField::Closure);
	return static_cast<int>(frameCaptureCount(m_memory, closure));
}

Value CPU::readFrameUpvalue(int frameIndex, int upvalueIndex) const {
	const u32 closure = ThreadRecord::readFrameWord(m_memory, m_activeThread->address, static_cast<u32>(frameIndex), FrameField::Closure);
	if (closure == 0u) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	return readClosureUpvalue(closure, upvalueIndex);
}

Value CPU::readClosureUpvalue(u32 closure, int upvalueIndex) const {
	return Upvalue::load(m_memory, ClosureRecord::captureAddress(m_memory, closure, static_cast<u32>(upvalueIndex)));
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
	if (heapServiceActive() || fixedInterruptActive() || allocationParked() || m_stringComparison.remaining || tableRebuild.record) throw BMSX_RUNTIME_ERROR("Pending CPU work must retire before replacing code execution.");
	auto* publishedImage = executionImageForDomain(executionDomainId);
	if (!publishedImage || !publishedImage->admitsFunctionPc(functionAddress, pc)
		|| !readFunctionRecord(*publishedImage, functionAddress, executionBusSignalsForDomain(executionDomainId)))
		throw BMSX_RUNTIME_ERROR("Frame execution must enter an instruction of its published function.");
	auto& image = *publishedImage;
	const Blua32FunctionRecordLatch& functionRecord = m_functionRecordLatch;
	const auto prototype = decodePrototype(functionRecord);
	const u32 registerCount = prototype.entry.registerCapacity();
	if (registerCount > MAX_THREAD_VALUE_SLOTS) throw LuaOutOfMemorySignal{};
	CallFrame& frame = *m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex));
	if (&frame == m_activeThread->currentFrame) abortStalledMemoryWrite();
	if (registerCount > static_cast<u32>(frame.stackCapacity())) {
		ensureRegisterCapacity(frame, static_cast<int>(registerCount) - 1);
	}
	// Publishing replacement code does not introduce a capture binding on a vector frame.
	if (frame.closureAddress() != 0u) {
		if ((functionRecord.flags & BLUA32_FUNCTION_STATIC) != 0u
			&& functionRecord.upvalueCount == 0u) {
			frame.writeControl(FrameField::Closure, staticClosureForRecord(prototype));
		} else {
			const u32 count = frame.captureCount();
			u32 replacement = allocateClosure(prototype, count, false);
			for (u32 index = 0; index < count; ++index)
				ClosureRecord::setCaptureAddress(m_memory, replacement, index, frame.captureAddress(index));
			frame.writeControl(FrameField::Closure, replacement);
		}
	}
	frame.writeControl(FrameField::Function, functionRecord.address);
	frame.executionImage = functionRecord.image;
	frame.saveExecutionBank(executionDomainId);
	if (&frame == m_activeThread->currentFrame) latchActiveExecutionImage(executionDomainId, frame.executionImage);
	frame.decodedPage = nullptr;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	frame.nativeContinuationCells = {};
#endif
	frame.compilationEntry = true;
	frame.writeControl(FrameField::Pc, pc);
}

void CPU::writeFrameCallSitePc(int childFrameIndex, u32 pc) {
	m_activeThread->frameAtDepth(static_cast<size_t>(childFrameIndex))->writeControl(FrameField::CallSite, pc);
}

u32 CPU::createClosure(CallFrame& frame, int destination) {
	const Blua32FunctionRecordLatch& functionRecord = m_functionRecordLatch;
	const bool captureless = functionRecord.upvalueCount == 0u;
	const bool canonical = captureless && (functionRecord.flags & BLUA32_FUNCTION_STATIC) != 0u;
	if (canonical) {
		if (const u32 first = findStaticClosure(decodePrototype(functionRecord))) return first;
	}
	if (captureless && functionRecord.romBacked) {
		if (m_systemImage->heapServiceFunctions[static_cast<size_t>(HeapServiceOperation::AllocateRecord)] == 0u) {
			enterSynchronousException(frame, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
			return 0u;
		}
		const auto kind = canonical ? HeapServiceRecordKind::CanonicalClosure : HeapServiceRecordKind::DynamicClosure;
		beginClosureReservation(frame, destination, kind, functionRecord.address,
			static_cast<u32>(functionRecord.image->executionDomainId), frame.readControl(FrameField::Pc));
		requestYield();
		return 0u;
	}
	if (functionRecord.upvalueCount > maxClosureCaptures(!functionRecord.romBacked)) throw LuaOutOfMemorySignal{};
	if (m_systemImage->heapServiceFunctions[static_cast<size_t>(HeapServiceOperation::CapturedClosure)] == 0u) {
		enterSynchronousException(frame, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
		return 0u;
	}
	beginCapturedClosure(frame, destination, canonical);
	requestYield();
	return 0u;
}

int CPU::closeUpvalues(CallFrame& frame, u32 firstSlot) {
	const u32 head = frame.readControl(FrameField::OpenHead);
	u32 address = head;
	int closed = 0;
	while (address != 0 && closed < static_cast<int>(UPVALUE_CHAIN_LIMIT)) {
		const u32 cell = m_heap.openCellAddress(address);
		if (cell == 0u) break;
		if (firstSlot != 0u && m_memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD) < firstSlot) break;
		address = m_memory.readRamRecordWord(cell + UPVALUE_NEXT);
		Upvalue::close(m_heap, cell);
		++closed;
	}
	const u32 remaining = firstSlot == 0u ? 0u : address;
	if (head != remaining) frame.writeControl(FrameField::OpenHead, remaining);
	return closed;
}

CPU::ClosureActivation CPU::resolveClosureActivation(u32 closure) {
	const ClosureRecord::BindingFlags binding{m_memory.readRamRecordByte(closure + CLOSURE_BINDING_FLAGS)};
	auto* image = executionImageForDomain(binding.domain());
	const u32 prototype = m_memory.readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS);
	if (binding.latched()) return {image, {prototype, ClosureRecord::readLatchedEntry(m_memory, closure)}};
	const auto* rom = image->bindRomFunction(m_memory, prototype);
	// No ROM driver: the sampled entry words are zero.
	return {image, {prototype, rom ? rom->entry : FunctionEntry{}}};
}

CallFrame* CPU::pushFrame(CallFrame& caller, u32 closure, int argBase, int argCount,
	CallResultPlacement result, u32 callSitePc, u32 codeFunction, i32 protectedIndex) {
	const auto [image, functionRecord] = closure != 0u ? resolveClosureActivation(closure)
		: ClosureActivation{m_systemImage, {codeFunction, m_systemImage->bindRomFunction(m_memory, codeFunction)->entry}};
	const int callerArgBase = caller.stackBase() + argBase;
	const bool sharedStack = caller.thread == m_activeThread;
	const int argumentBase = sharedStack ? callerArgBase : m_activeThread->stackTop();
	const auto admitted = ArgumentPlacement::forEntry(argumentBase, argCount, functionRecord.entry);
	if (!admitted) {
		// Protected handlers receive the same fault whether the window
		// is impossible at placement or BIOS backing acquisition fails.
		if (protectedIndex >= 0) throw LuaExecutionError(LUA_FAULT_REASON_OUT_OF_MEMORY);
		throw LuaOutOfMemorySignal{};
	}
	const auto& placement = *admitted;
	const FrameEntryControl entry{
		functionRecord.functionAddress, functionRecord.entry.codeAddress, callSitePc,
		frameBankWord(image->executionDomainId),
		placement.varargBase, argCount, result, placement.top(),
		closure, placement.stackBase, static_cast<int>(placement.capacity), protectedIndex,
	};
	auto& thread = *m_activeThread;
	const size_t end = placement.stackEnd();
	if (!thread.frameSpaceFits(end)) {
		if (resetBankSelected()) throw LuaOutOfMemorySignal{};
		const auto function = m_systemImage->heapServiceFunctions[static_cast<size_t>(HeapServiceOperation::ReserveFrameSpace)];
		if (function) {
			prepareFrameEntry(function, entry, callerArgBase, argCount, placement.relocatesFormals);
			return nullptr;
		}
		// A first resumed Thread has no frame in which to trap. The
		// ordinary resumer receives failed admission.
		if (!sharedStack && thread.frameDepth() == 0u) throw LuaOutOfMemorySignal{};
		enterSynchronousException(*thread.currentFrame, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
		return nullptr;
	}
	auto* frame = thread.acquireFrame();
	frame->executionImage = image;
	frame->initializeControl(entry);
	const auto [copied, padded] = placement.formals;
	if (sharedStack) placeSharedFormals(*frame, callerArgBase, copied, padded, placement.relocatesFormals);
	else placeForeignFormals(*frame, caller.thread->stack, callerArgBase, copied, padded, placement.varargBase, placement.varargCount);
	m_activeThread->setStackTop(static_cast<int>(placement.stackEnd()));
	m_activeThread->enterFrame(frame);
	latchActiveExecutionImage(image->executionDomainId, frame->executionImage);
	return frame;
}

void CPU::placeSharedFormals(CallFrame& frame, int first, int copied, int padded, bool relocate) {
	auto& stack = frame.thread->stack;
	if (relocate) {
		frame.registers.copyFrom(stack, 0, first, copied, padded);
		stack.clear(first, copied);
	} else frame.registers.clear(copied, padded);
	instructionBudgetRemaining -= relocate ? copied + padded : padded;
}

void CPU::placeForeignFormals(CallFrame& frame, const ValueSpan& source, int first, int copied, int padded,
	int varargBase, int extras) {
	frame.registers.copyFrom(source, 0, first, copied, padded);
	if (extras != 0) frame.thread->stack.copyFrom(source, varargBase, first + copied + padded, extras);
	instructionBudgetRemaining -= copied + padded + extras;
}

void CPU::prepareFrameEntry(u32 function, const FrameEntryControl& entry, u32 sourceSlot,
	u32 supplied, bool relocate, BuiltinArgsView detached) {
	const u32 prepared = m_heapAllocator.managementOffset() + HEAP_SERVICE_PREPARED_FRAME_OFFSET;
	entry.writeWords([&](FrameField field, u32 word) {
		m_memory.writeRamRecordWord(prepared + static_cast<u32>(field), word);
	});
	m_memory.writeRamRecordPair(prepared + static_cast<u32>(PreparedFrameField::SourceSlot), sourceSlot, supplied);
	m_memory.writeRamRecordWord(prepared + static_cast<u32>(PreparedFrameField::RelocateFormals), relocate);
	u32 roots = entry.closure;
	if (sourceSlot == PREPARED_FRAME_DETACHED_SOURCE) {
		const u32 words = prepared + static_cast<u32>(PreparedFrameField::Payloads);
		const u32 tags = prepared + static_cast<u32>(PreparedFrameField::Tags);
		for (u32 slot = 0; slot < supplied; ++slot) {
			const Value value = detached[slot];
			m_memory.writeRamRecordWord(words + 4u * slot, valuePayload(value));
			m_memory.writeRamRecordByte(tags + slot, static_cast<u8>(valueTag(value)));
		}
		roots = prepared | PREPARED_FRAME_SCOPE_TAG;
	}
	beginFrameSpaceAcquisition(function, entry.stackBase + entry.capacity, static_cast<u32>(m_activeThread->frameDepth()) + 2u,
		roots, FRAME_RESIDENT_PREPARED_ENTRY);
}

void CPU::enterPreparedFrame() {
	const u32 prepared = m_heapAllocator.managementOffset() + HEAP_SERVICE_PREPARED_FRAME_OFFSET;
	auto& thread = *m_activeThread;
	const bool firstResume = thread.frameDepth() == 0u;
	auto& frame = *thread.acquireFrame();
	frame.applyPreparedControl(prepared);
	const auto domain = frame.savedExecutionBank();
	frame.executionImage = executionImageForDomain(domain);
	const int params = frame.readWindow(FrameField::Top);
	const int supplied = static_cast<int>(m_memory.readRamRecordWord(prepared + static_cast<u32>(PreparedFrameField::Supplied)));
	const int copied = std::min(params, supplied);
	const u32 sourceSlot = m_memory.readRamRecordWord(prepared + static_cast<u32>(PreparedFrameField::SourceSlot));
	if (sourceSlot == PREPARED_FRAME_DETACHED_SOURCE) {
		const u32 words = prepared + static_cast<u32>(PreparedFrameField::Payloads);
		const u32 tags = prepared + static_cast<u32>(PreparedFrameField::Tags);
		const auto source = [&](int index) {
			return valueFromTag(static_cast<ValueTag>(m_memory.readRamRecordByte(tags + index)), m_memory.readRamRecordWord(words + 4u * index));
		};
		for (int slot = 0; slot < copied; ++slot) frame.registers.set(slot, source(slot));
		frame.registers.clear(copied, params - copied);
		const int extras = frame.varargCount(), base = frame.readWindow(FrameField::VarargBase);
		for (int slot = 0; slot < extras; ++slot) thread.stack.set(base + slot, source(params + slot));
		instructionBudgetRemaining -= params + extras;
	} else if (firstResume) {
		// The source is the physical resumer's stack, not a saved host view.
		const auto& source = bindThread(thread.resumer()).stack;
		placeForeignFormals(frame, source, static_cast<int>(sourceSlot), copied, params - copied,
			frame.readWindow(FrameField::VarargBase), frame.varargCount());
	} else {
		placeSharedFormals(frame, static_cast<int>(sourceSlot), copied, params - copied,
			m_memory.readRamRecordWord(prepared + static_cast<u32>(PreparedFrameField::RelocateFormals)) != 0);
	}
	thread.setStackTop(frame.stackBase() + frame.stackCapacity());
	thread.enterFrame(&frame);
	latchActiveExecutionImage(domain, frame.executionImage);
	if (firstResume) thread.setEntry(0u);
}

CallFrame* CPU::pushFrame(u32 closure, BuiltinArgsView args,
	CallResultPlacement result, u32 flags, std::optional<u32> callSitePc, bool instructionCall, i32 protectedIndex) {
	const auto [image, functionRecord] = resolveClosureActivation(closure);
	const size_t argCount = args.size();
	auto& thread = *m_activeThread;
	const int argumentBase = thread.stackTop();
	const auto admitted = ArgumentPlacement::forEntry(argumentBase, static_cast<int>(argCount), functionRecord.entry);
	if (!admitted) {
		// Protected handlers receive the same fault whether the window
		// is impossible at placement or BIOS backing acquisition fails.
		if (protectedIndex >= 0) throw LuaExecutionError(LUA_FAULT_REASON_OUT_OF_MEMORY);
		throw LuaOutOfMemorySignal{};
	}
	const auto& placement = *admitted;
	const FrameEntryControl entry{
		functionRecord.functionAddress, functionRecord.entry.codeAddress, callSitePc.value_or(functionRecord.entry.codeAddress),
		frameBankWord(image->executionDomainId) | flags,
		placement.varargBase, static_cast<int>(argCount), result, placement.top(),
		closure, placement.stackBase, static_cast<int>(placement.capacity), protectedIndex,
	};
	if (instructionCall && !thread.frameSpaceFits(placement.stackEnd())) {
		const u32 function = m_systemImage->heapServiceFunctions[static_cast<size_t>(HeapServiceOperation::ReserveFrameSpace)];
		if (function == 0u) {
			if (thread.frameDepth() == 0u) throw LuaOutOfMemorySignal{};
			enterSynchronousException(*thread.currentFrame, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
			return nullptr;
		}
		prepareFrameEntry(function, entry, PREPARED_FRAME_DETACHED_SOURCE, static_cast<u32>(argCount), placement.relocatesFormals, args);
		return nullptr;
	}
	auto* frame = thread.acquireFrame();
	if (!instructionCall) thread.reserveFrame(placement.stackEnd(), valueClosure(closure), (flags & FRAME_EXCEPTION) != 0u);
	frame->executionImage = image;
	frame->initializeControl(entry);
	const auto [copied, padded] = placement.formals;
	for (int i = 0; i < copied; ++i) frame->registers.set(i, args[i]);
	frame->registers.clear(copied, padded);
	for (int i = 0; i < placement.varargCount; ++i)
		m_activeThread->stack.set(placement.varargBase + i, args[placement.top() + i]);
	if (callSitePc && (flags & FRAME_EXCEPTION) == 0u) instructionBudgetRemaining -= placement.cycles(false);
	m_activeThread->setStackTop(static_cast<int>(placement.stackEnd()));
	m_activeThread->enterFrame(frame);
	latchActiveExecutionImage(image->executionDomainId, frame->executionImage);
	return frame;
}

void CPU::writeReturnValuesFromRegisters(CallFrame& frame, CallResultPlacement result, const CallFrame& source, int sourceBase, int sourceCount) {
	const int base = result.base;
	const auto placement = ValuePlacement::fit(sourceCount, result.selected(sourceCount));
	if (placement.count() > 0) {
		ValueSpan& registers = ensureRegisterCapacity(frame, base + placement.count() - 1);
		// Backing growth can relocate both views; their stack offsets stay fixed.
		registers.copyFrom(source.registers, base, sourceBase, placement.copied, placement.padded);
	}
	frame.placeResultTop(result, placement.count());
	instructionBudgetRemaining -= placement.count();
}

void CPU::writeReturnValues(CallFrame& frame, CallResultPlacement result, BuiltinArgsView values) {
	const int base = result.base;
	const int valueCount = static_cast<int>(values.size());
	const int targetCount = result.selected(valueCount);
	if (targetCount > 0) {
		ValueSpan& registers = ensureRegisterCapacity(frame, base + targetCount - 1);
		const int copiedCount = std::min(valueCount, targetCount);
		values.placeInto(registers, base, copiedCount, targetCount - copiedCount);
	}
	frame.placeResultTop(result, targetCount);
	instructionBudgetRemaining -= targetCount;
}

void CPU::setRegister(CallFrame& frame, int index, Value value) {
	ValueSpan& registers = ensureRegisterCapacity(frame, index);
	registers.set(static_cast<size_t>(index), value);
	const int nextTop = index + 1;
	if (nextTop > frame.readWindow(FrameField::Top)) {
		frame.setTop(nextTop);
	}
}

ValueSpan& CPU::ensureRegisterCapacity(CallFrame& frame, int index) {
	if (index < frame.stackCapacity()) {
		return frame.registers;
	}
	const size_t bucket = registerWindowBucket(static_cast<size_t>(index) + 1);
	const size_t end = static_cast<size_t>(frame.stackBase()) + bucket;
	if (end > m_activeThread->stackCapacity) m_activeThread->resizeStack(nextPowerOfTwo(end));
	frame.growRegisterWindow(static_cast<int>(bucket));
	return frame.registers;
}

void CPU::clearCallStack() {
	abortStalledMemoryWrite();
	for (;;) {
		m_activeThread->setProtectedDepth(0);
		while (m_activeThread->frameDepth() != 0) {
			CallFrame* frame = m_activeThread->currentFrame;
			closeUpvalues(*frame);
			m_activeThread->leaveFrame();
		}
		m_activeThread->stack.clear(0, m_activeThread->stackCapacity);
		m_activeThread->setStackTop(0);
		Thread* thread = m_activeThread;
		thread->setStatus(ThreadStatus::Dead);
		thread->setEntry(0u);
		thread->setError(valueNil());
		if (thread == &m_rootView) break;
		const u32 resumer = thread->resumer();
		thread->setResumer(0u);
		m_activeThread = resumer == 0u ? &m_rootView : &bindThread(resumer);
	}
	m_rootView.setStatus(ThreadStatus::Running);
	m_completionThreadAddress = m_rootView.address;
	m_runSignals &= ~RunThreadSwitch;
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

void CPU::publishHeapRemarkHead() {
	using Field = HeapServiceRemarkHeadField;
	const u32 head = m_heapAllocator.managementOffset() + HEAP_SERVICE_REMARK_HEAD_OFFSET;
	m_memory.writeRamRecordWord(head + static_cast<u32>(Field::ComparisonRemaining), m_stringComparison.remaining);
	if (m_stringComparison.remaining) {
		m_memory.writeRamRecordPair(head + static_cast<u32>(Field::ComparisonLeft), m_stringComparison.left, m_stringComparison.right);
	}
	if (allocationParked()) {
		const auto& assignment = m_pendingAllocation;
		m_memory.writeRamRecordWord(head + static_cast<u32>(Field::Receiver), assignment.receiver);
		m_memory.writeRamRecordPair(head + static_cast<u32>(Field::KeyTag), static_cast<u32>(valueTag(assignment.key)), valuePayload(assignment.key));
		m_memory.writeRamRecordPair(head + static_cast<u32>(Field::ValueTag), static_cast<u32>(valueTag(assignment.value)), valuePayload(assignment.value));
		m_memory.writeRamRecordWord(head + static_cast<u32>(Field::HasPendingAssignment), 1u);
	} else {
		m_memory.writeRamRecordWord(head + static_cast<u32>(Field::HasPendingAssignment), 0u);
	}
}

Value CPU::luaFaultValue(u32 reason) const {
	if (reason == LUA_FAULT_REASON_EXPLICIT_ERROR) return valueNil();
	const u32 faults = m_heap.diagnosticWord(HeapServiceRemarkHeadField::FaultIds);
	return valueString(m_memory.readRamRecordWord(faults + reason * sizeof(u32)));
}

void CPU::markRootHead(GcHeap& heap) {
	using Field = HeapServiceRemarkHeadField;
	// Opcode metamethod selectors stay interned independently of guest tables.
	heap.markString(heap.diagnosticWord(Field::Index));
	heap.markString(heap.diagnosticWord(Field::NewIndex));
	heap.markString(heap.diagnosticWord(Field::Length));
	heap.markString(heap.diagnosticWord(Field::Error));
	const u32 faults = heap.diagnosticWord(Field::FaultIds);
	for (u32 reason = 0; reason <= LUA_FAULT_REASON_INDEX_NAN; ++reason)
		if (reason != LUA_FAULT_REASON_EXPLICIT_ERROR) heap.markString(m_memory.readRamRecordWord(faults + reason * sizeof(u32)));
	heap.markValue(valueFromTag(static_cast<ValueTag>(heap.diagnosticWord(Field::StringIndexTag)),
		heap.diagnosticWord(Field::StringIndexWord)));
	if (m_stringComparison.remaining) { heap.markString(m_stringComparison.left); heap.markString(m_stringComparison.right); }
	if (allocationParked()) {
		heap.markValue(valueTable(m_pendingAllocation.receiver));
		heap.markValue(m_pendingAllocation.key);
		heap.markValue(m_pendingAllocation.value);
	}
}

void CPU::markScopedRoots(GcHeap& heap) {
	for (size_t scratchIndex = 0; scratchIndex < m_builtinResultScratchIndex; ++scratchIndex) {
		BuiltinResults& scratch = m_builtinResultScratch.get(scratchIndex);
		for (size_t valueIndex = 0; valueIndex < scratch.size(); ++valueIndex) {
			heap.markValue(scratch[valueIndex]);
		}
	}
	for (const Value value : m_localRoots) {
		heap.markValue(value);
	}
}

void CPU::publishHeapRootBanks() {
	using Field = HeapServiceRootBankField;
	const u32 descriptor = m_heapAllocator.managementOffset() + HEAP_SERVICE_ROOT_BANKS_OFFSET;
	m_memory.writeRamRecordPair(descriptor, m_rootView.address, m_activeThread ? m_activeThread->address : 0u);
	m_memory.writeRamRecordPair(descriptor + 8u, m_completionThreadAddress, m_haltedUntilIrqThreadAddress);
	const u32 destination = descriptor + HEAP_SERVICE_ROOT_BANKS_HEADER_SIZE;
	m_memory.writeRamRecordPair(destination, static_cast<u32>(m_completionValueCount),
		HEAP_SERVICE_ROOT_PORT_BASE + static_cast<u32>(HeapServiceRootPlane::CompletionPayloads) * HEAP_SERVICE_ROOT_PORT_STRIDE);
	m_memory.writeRamRecordWord(destination + static_cast<u32>(Field::Tags),
		HEAP_SERVICE_ROOT_PORT_BASE + static_cast<u32>(HeapServiceRootPlane::CompletionTags) * HEAP_SERVICE_ROOT_PORT_STRIDE);

}

u32 CPU::readHeapServiceRoot(u32 offset, MemoryAccessKind kind) const {
	const auto plane = static_cast<HeapServiceRootPlane>(offset >> HEAP_SERVICE_ROOT_PORT_SHIFT);
	const u32 address = offset & (HEAP_SERVICE_ROOT_PORT_STRIDE - 1u);
	const bool byte = kind == MemoryAccessKind::U8;
	const u32 slot = byte ? address : address >> 2u;
	switch (plane) {
		case HeapServiceRootPlane::CompletionPayloads:
		case HeapServiceRootPlane::CompletionTags:
			if (byte == (plane == HeapServiceRootPlane::CompletionTags) && slot < m_completionValueCount)
				return byte ? m_completionValues.tags()[slot] : m_completionValues.words()[slot];
			break;
		case HeapServiceRootPlane::Count:
			break;
	}
	throw BMSX_RUNTIME_ERROR("Heap service read is outside its root port.");
}

size_t CPU::rootBankSlots(GcRootBank bank) const {
	if (bank == GcRootBank::SystemGlobals) return m_systemGlobalBank.count();
	if (bank == GcRootBank::Globals) return m_globalBank.count();
	if (bank == GcRootBank::Completion) return m_completionValueCount;
	const u32 binding = executionImageBindingOffset(m_heapAllocator.managementOffset(),
		static_cast<i32>(bank) - static_cast<i32>(GcRootBank::Cart0Constants));
	return m_memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_RAM_STRINGS_OFFSET);
}

void CPU::markRootBank(GcHeap& heap, GcRootBank bank, size_t first, size_t end) {
	if (bank < GcRootBank::SystemConstants) {
		const auto& names = bank == GcRootBank::SystemGlobals ? m_systemGlobalBank : m_globalBank;
		const auto slots = names.values();
		for (size_t slot = first; slot < end; ++slot) {
			heap.markString(names.name(slot));
			heap.markValue(slots.get(slot));
		}
		return;
	}
	if (bank == GcRootBank::Completion) {
		for (size_t slot = first; slot < end; ++slot) heap.markValue(m_completionValues.get(slot));
		return;
	}
	const u32 binding = executionImageBindingOffset(m_heapAllocator.managementOffset(),
		static_cast<i32>(bank) - static_cast<i32>(GcRootBank::Cart0Constants));
	const u32 roots = m_memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET);
	for (size_t slot = first; slot < end; ++slot)
		heap.markString(m_memory.readRamRecordWord(roots + static_cast<u32>(slot) * 4u) & ~IMAGE_STRING_RAM_ORDINAL);
}

void CPU::markRootThreads(GcHeap& heap) {
	heap.markThread(m_rootView.address);
	if (m_activeThread) heap.markThread(m_activeThread->address);
	heap.markThread(m_completionThreadAddress);
	heap.markThread(m_haltedUntilIrqThreadAddress);
}

// end repeated-sequence-acceptable

} // namespace bmsx
