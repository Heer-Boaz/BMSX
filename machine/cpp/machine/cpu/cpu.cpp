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
	, m_newIndexKey(valueString(m_stringPool.intern("__newindex")))
	, m_lengthKey(valueString(m_stringPool.intern("__len")))
	, m_heap(*this, m_luaHeap, m_memory, m_heapAllocator, m_stringPool, m_stringPool.intern("__mode"))
	, m_rootView(m_heap)
	, m_transferViews{Thread{m_heap}, Thread{m_heap}}
	, m_errorInErrorHandlingValue(valueString(m_stringPool.intern("error in error handling")))
	, m_systemGlobalBank(memory, m_heap)
	, m_globalBank(memory, m_heap) {
	m_cop0Words[COP0_STATUS] = CPU_STATUS_CART_ENTRY;
	m_luaFaultErrorValues.fill(valueNil());
	m_luaFaultErrorValues[LUA_FAULT_REASON_UNKNOWN] = valueString(m_stringPool.intern("Attempted to get length of an unsupported value."));
	m_luaFaultErrorValues[LUA_FAULT_REASON_CALL_NON_FUNCTION] = valueString(m_stringPool.intern("Attempted to call a non-function value."));
	m_luaFaultErrorValues[LUA_FAULT_REASON_INDEX_NON_TABLE] = valueString(m_stringPool.intern("Attempted to index field on a non-table value."));
	m_luaFaultErrorValues[LUA_FAULT_REASON_ASSIGN_NON_TABLE] = valueString(m_stringPool.intern("Attempted to assign to a non-table value."));
	m_luaFaultErrorValues[LUA_FAULT_REASON_INDEX_NIL] = valueString(m_stringPool.intern("Table index is nil."));
	m_luaFaultErrorValues[LUA_FAULT_REASON_METATABLE_LOOP] = valueString(m_stringPool.intern("Metatable index chain too long."));
	m_luaFaultErrorValues[LUA_FAULT_REASON_ITERATE_NON_TABLE] = valueString(m_stringPool.intern("Attempted to iterate a non-table value."));
	m_luaFaultErrorValues[LUA_FAULT_REASON_XPCALL_HANDLER_NOT_FUNCTION] = valueString(m_stringPool.intern("xpcall error handler must be a function."));
	m_luaFaultErrorValues[LUA_FAULT_REASON_OUT_OF_MEMORY] = valueString(m_stringPool.intern("Out of memory."));
	m_luaFaultErrorValues[LUA_FAULT_REASON_INVALID_ARGUMENT] = valueString(m_stringPool.intern("Invalid argument."));
	m_luaFaultErrorValues[LUA_FAULT_REASON_INVALID_NEXT_KEY] = valueString(m_stringPool.intern("invalid key to 'next'"));
	m_luaFaultErrorValues[LUA_FAULT_REASON_INDEX_NAN] = valueString(m_stringPool.intern("Table index is NaN."));
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
	m_rootView.select(createThread(0u));
	m_rootView.bindStack();
	m_rootView.setStatus(ThreadStatus::Running);
	m_activeThread = &m_rootView;
	m_completionThreadAddress = m_rootView.address;
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

TableRecord CPU::createTable(int arraySize, int hashSize) {
	return TableRecord(m_heap, allocateTable(arraySize, hashSize, LuaAllocationMode::Direct));
}

u32 CPU::allocateClosure(const FunctionPrototype& prototype, u32 count, bool canonical, std::span<u32> cells) {
	const bool latched = !m_functionRecordLatch.romBacked;
	const u32 address = m_luaHeap.allocateClosureRecord(count, latched, cells);
	ClosureRecord::initialize(m_memory, address, prototype, m_heap.white(), count, canonical, latched);
	m_heap.publishObject(address);
	return address;
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
	for (auto& view : m_transferViews) view.select(0u);
	m_stringIndexTable = valueNil();
	m_haltedUntilIrqFrameDepth = -1;
	m_haltedUntilIrqThreadAddress = 0u;
	m_interruptEventPending = false;
	m_memoryWriteBlocked = false;
	m_memoryWriteBlockedAddress = 0u;
	m_pendingMemory.kind = PendingMemoryKind::None;
	m_pendingAllocation = {};
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
	if (!setProgramHeapFloor(systemBoot.staticEnd)) { hardHalt(); return; }
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	clearNativeContinuationBindings();
#endif
	for (auto& image : m_executionImagesByDomain) {
		if (image) releaseImageData(*image);
		image.reset();
	}
	m_unpublishedRomMask = 0u;
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
	u32 systemResetClosure = staticClosureForRecord(decodePrototype(m_functionRecordLatch));
	pushFrame(systemResetClosure, {}, {});
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

void CPU::decodeConstantPool(ExecutionDomainId executionDomainId, u32 tableAddress, ValueSpan constPool) {
	const u32 constantCount = static_cast<u32>(constPool.size());
	if (constantCount == 0u) return;
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
					readLE32(record + BLUA32_CONSTANT_PAYLOAD_OFFSET)
				)));
				break;
			default:
				throw BMSX_RUNTIME_ERROR("BLua32 constant tag is invalid.");
		}
	}
}

void CPU::releaseImageData(Blua32ExecutionImage& image) {
	if (const u32 base = std::exchange(image.globalMapBase, 0u)) {
		m_luaHeap.releaseRecord(base, image.globalMapBytes());
	}
	if (const u32 base = std::exchange(image.constantBase, 0u)) {
		m_luaHeap.releaseRecord(base, static_cast<u32>(image.constPool.size()) * (sizeof(u32) + sizeof(u8)));
	}
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
	Blua32ExecutionBoot executionBoot, std::optional<std::array<u32, 2>> restoredBases, ExecutionImageUpdate update
) {
	const bool restoring = restoredBases.has_value();
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
	constexpr u32 constantSlotBytes = sizeof(u32) + sizeof(u8);
	if (constantCount > MAIN_RAM_SIZE / constantSlotBytes
		|| static_cast<u64>(globalNameCount) + systemGlobalNameCount > MAIN_RAM_SIZE / sizeof(u32)) {
		throw BMSX_RUNTIME_ERROR("BLua32 image bank extents exceed main RAM.");
	}
	image->romFunctions = Blua32RomFunctionDirectory::read(m_memory, executionDomainId, header);
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
	if (!restoring) m_stringPool.activateRomTable(executionDomainId,
		readLE32(header + BLUA32_IMAGE_STRING_BUCKET_ADDRESS_OFFSET),
		readLE32(header + BLUA32_IMAGE_STRING_BUCKET_COUNT_OFFSET));
	image->globalNameCount = globalNameCount;
	image->systemNameCount = systemGlobalNameCount;
	if (const u32 bytes = image->globalMapBytes()) {
		image->globalMapBase = restoring ? (*restoredBases)[1] : m_luaHeap.allocateRecord(bytes, false, 0, 0);
		const u32 base = image->globalMapBase;
		if (!restoring) {
			registerGlobalNames(executionDomainId, globalNameTableAddress, globalNameCount, m_globalBank, base);
			registerGlobalNames(executionDomainId, systemGlobalNameTableAddress, systemGlobalNameCount,
				m_systemGlobalBank, base + 4u * globalNameCount);
		}
	}
	if (constantCount != 0u) {
		image->constantBase = restoring ? (*restoredBases)[0] : m_luaHeap.allocateRecord(constantCount * constantSlotBytes, false, 0, 0);
		const ValueSpan constants(m_memory, image->constantBase, image->constantBase + constantCount * 4u, constantCount);
		if (!restoring) decodeConstantPool(executionDomainId, constantTableAddress, constants);
		image->constPool = constants;
		for (u32 slot = 0; slot < constantCount; ++slot) {
			if (constants.tag(slot) != ValueTag::String) continue;
			const StringId id = constants.payload(slot);
			if (isRamStringId(id)) image->constantStringRoots.push_back(id);
		}
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
	std::unique_ptr<Blua32ExecutionImage>& imageEntry = m_executionImagesByDomain[
		static_cast<size_t>(executionBoot.executionDomainId + 1)
	];
	std::unique_ptr<Blua32ExecutionImage> image =
		activateExecutionImage(executionBoot, std::nullopt, ExecutionImageUpdate::Replace);
	auto previousImage = std::move(imageEntry);
	Blua32ExecutionImage* activatedImage = image.get();
	imageEntry = std::move(image);
	m_unpublishedRomMask &= ~executionDomainBit(activatedImage->executionDomainId);
	if (activatedImage->executionDomainId == SYSTEM_EXECUTION_DOMAIN_ID) {
		m_systemImage = activatedImage;
		m_systemExceptionFunctionAddress = executionBoot.exceptionFunctionAddress;
	}
	if (previousImage) {
		visitThreadViews([&](Thread& thread) {
			for (auto* frame = thread.firstFrame; frame; frame = frame->next) {
				if (frame->executionImage != previousImage.get()) continue;
				frame->executionImage = activatedImage;
				frame->decodedPage = nullptr;
				frame->decodedPageAddress = 0;
				frame->compilationEntry = true;
			}
		});
	}
	if (previousImage) releaseImageData(*previousImage);
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

u32 CPU::staticClosureForRecord(const FunctionPrototype& record) {
	u32 first = 0u;
	for (const u32 closure : m_staticClosuresByAddress.find(record.functionAddress)) {
		if ((first == 0u || closure < first) && !m_heap.sweepGarbage(closure)
			&& readClosureBinding(closure) == record)
			first = closure;
	}
	if (first != 0u) return first;
	const u32 closure = allocateClosure(record, 0, true);
	m_staticClosuresByAddress.insert(record.functionAddress, closure);
	return closure;
}

void CPU::retireStaticClosure(u32 address) {
	const u32 prototype = m_memory.readRamRecordWord(address + CLOSURE_PROTOTYPE_ADDRESS);
	m_staticClosuresByAddress.retire(prototype, address);
}

void CPU::clearExecutionEnvironment() {
	m_completionValues.clear(0, m_completionValueCount); m_completionValueCount = 0;
	clearCallStack();
	m_systemGlobalBank.clear();
	m_globalBank.clear();
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

Thread& CPU::bindThread(u32 address) {
	if (address == m_rootView.address) return m_rootView;
	for (auto& view : m_transferViews) if (view.address == address) return view;
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
		m_activeStackRebound |= &thread == m_activeThread;
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
	if ((address == SYSTEM_ROM_BASE && end == SYSTEM_ROM_BASE + SYSTEM_ROM_SIZE)
		|| (address == CART_ROM_BASE && end == CART_ROM_END)) {
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
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		// The key's low word is the mapped address, even for a socket-specific
		// ROM install. Any execution image may have used system ROM records.
		if (address < SYSTEM_ROM_BASE + SYSTEM_ROM_SIZE
			|| (address >= CART_ROM_BASE && address < CART_ROM_END)) {
			image->nativeRomCallBindings.fill({});
		}
#endif
		for (const auto& entry : image->decodedPages.entries()) {
			auto& [key, page] = *entry;
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
	m_memory.bindMappedPage(pageAddress, busSignals | MAPPED_BUS_INSTRUCTION_FETCH, binding);
	DecodedInstructionPage& page = frame.executionImage->decodedPages.bind(binding);
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
	clearCallStack();
	latchActiveExecutionImage(m_functionRecordLatch.image->executionDomainId, m_functionRecordLatch.image);
	m_programExecutionDomainId = m_functionRecordLatch.image->executionDomainId;
	m_cop0Words[COP0_STATUS] = m_functionRecordLatch.image->executionDomainId >= 0
		? CPU_STATUS_CART_ENTRY
		: CPU_STATUS_SYSTEM_ENTRY;
	m_haltedUntilIrqFrameDepth = -1;
	m_haltedUntilIrqThreadAddress = 0u;
	m_interruptEventPending = false;
	m_memoryWriteBlocked = false;
	m_memoryWriteBlockedAddress = 0u;
	m_pendingMemory.kind = PendingMemoryKind::None;
	m_pendingAllocation = {};
	m_hardHalted = false;
	m_yieldRequested = false;
	u32 closure = staticClosureForRecord(decodePrototype(m_functionRecordLatch));
	pushFrame(closure, {}, {});
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	// A later native grant may warm this entry. EXEC only commits the machine
	// activation and never waits for or runs the compiler itself.
	auto& warmup = m_activeExecutionImage->nativeWarmup;
	if (m_activeExecutionDomainId >= 0 && !warmup.consumed) warmup.entryPc = m_functionRecordLatch.codeAddress;
#endif
}

void CPU::beginCompletionCall(u32 closure, BuiltinArgsView args) {
	if (allocationParked()) throw BMSX_RUNTIME_ERROR("A parked allocation must retire before replacing code execution.");
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
	m_yieldRequested = false;
	pushFrame(closure, args, {}, FRAME_COMPLETION);
}

void CPU::beginCompletionCallInExecutionDomain(
	ExecutionDomainId executionDomainId,
	u32 functionAddress
) {
	if (allocationParked()) throw BMSX_RUNTIME_ERROR("A parked allocation must retire before replacing code execution.");
	m_heap.finishFinalMark();
	if (!readFunctionRecord(*executionImageForDomain(executionDomainId), functionAddress, executionBusSignalsForDomain(executionDomainId))) {
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
	state.systemGlobals = m_systemGlobalBank.captureState();
	state.globals = m_globalBank.captureState();
	state.executionCartridgeSlot = m_activeExecutionDomainId;
	state.programExecutionDomainId = m_programExecutionDomainId;
	completionStorage.resize(m_completionValueCount);
	for (size_t i = 0; i < m_completionValueCount; ++i)
		completionStorage[i] = m_completionValues.get(i);
	state.completionValues = std::move(completionStorage);
	state.stringIndexTable = m_stringIndexTable;
	for (size_t index = 0; index < m_executionImagesByDomain.size(); ++index) {
		if (m_executionImagesByDomain[index]) {
			state.executionResidencyMask |= 1u << index;
			state.constantPoolBases[index] = m_executionImagesByDomain[index]->constantBase;
			state.globalMapBases[index] = m_executionImagesByDomain[index]->globalMapBase;
		}
	}
	state.hardHalted = m_hardHalted;
	state.lastExecutionDomainId = m_lastExecutionDomainId;
	state.lastPc = lastPc;
	state.haltedUntilIrqFrameDepth = m_haltedUntilIrqFrameDepth;
	state.interruptEventPending = m_interruptEventPending;
	state.memoryWriteBlocked = m_memoryWriteBlocked;
	state.memoryWriteBlockedAddress = m_memoryWriteBlockedAddress;
	state.pendingMemory = m_pendingMemory;
	state.pendingAllocation = m_pendingAllocation;
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
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	clearNativeContinuationBindings();
#endif
	m_completionValues.clear(0, m_completionValueCount); m_completionValueCount = 0;
	m_staticClosuresByAddress.clear();
	m_rootView.select(state.rootThreadAddress);
	for (auto& view : m_transferViews) view.select(0u);
	m_activeThread = &m_rootView;
	m_memory.clearMappedPageWriteWatches();
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
	for (auto& image : m_executionImagesByDomain) {
		image.reset();
	}
	m_systemGlobalBank.bind(state.systemGlobals);
	m_globalBank.bind(state.globals);
	for (size_t index = 0; index < m_executionImagesByDomain.size(); ++index) {
		if ((state.executionResidencyMask & (1u << index)) != 0u) {
			const auto boot = m_executionAddressSpace.resolveDomain(static_cast<ExecutionDomainId>(index) - 1);
			m_executionImagesByDomain[index] = activateExecutionImage(*boot, std::array{state.constantPoolBases[index], state.globalMapBases[index]});
		}
	}
	m_systemImage = m_executionImagesByDomain[static_cast<size_t>(SYSTEM_EXECUTION_DOMAIN_ID + 1)].get();
	Blua32ExecutionImage* executionImage = m_executionImagesByDomain[static_cast<size_t>(state.executionCartridgeSlot + 1)].get();
	latchActiveExecutionImage(state.executionCartridgeSlot, executionImage);

	bindPhysicalFrames(m_rootView);
	m_activeThread = &bindThread(state.activeThreadAddress);
	if (auto* current = m_activeThread->currentFrame) current->executionImage = m_activeExecutionImage;
	m_completionThreadAddress = state.completionThreadAddress;
	m_threadSwitchRequested = false;

	m_stringIndexTable = state.stringIndexTable;
	m_completionValues.reserveCapacity(state.completionValues.size());
	for (Value value : state.completionValues) m_completionValues.set(m_completionValueCount++, value);
	m_programExecutionDomainId = state.programExecutionDomainId;
	m_lastExecutionDomainId = state.lastExecutionDomainId;
	lastPc = state.lastPc;
	m_haltedUntilIrqFrameDepth = state.haltedUntilIrqFrameDepth;
	m_haltedUntilIrqThreadAddress = state.haltedUntilIrqThreadAddress;
	m_interruptEventPending = state.interruptEventPending;
	m_memoryWriteBlocked = state.memoryWriteBlocked;
	m_memoryWriteBlockedAddress = state.memoryWriteBlockedAddress;
	m_pendingMemory = state.pendingMemory;
	m_pendingAllocation = state.pendingAllocation;
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
}

void CPU::requestYield() {
	m_yieldRequested = true;
}

void CPU::haltUntilIrq() {
	if (m_interruptEventPending) {
		m_interruptEventPending = false;
		return;
	}
	m_haltedUntilIrqFrameDepth = static_cast<int>(m_activeThread->frameDepth());
	m_haltedUntilIrqThreadAddress = m_activeThread->address;
	m_yieldRequested = false;
}

void CPU::hardHalt() {
	m_hardHalted = true;
	m_haltedUntilIrqFrameDepth = -1;
	m_haltedUntilIrqThreadAddress = 0u;
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
		case BuiltinFunctionId::SetMetatable: {
			const Value target = args[0], metatable = args[1];
			if (!valueIsTable(target) || (!valueIsTable(metatable) && !isNil(metatable)))
				throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			TableRecord(m_heap, valuePayload(target)).setMetatableAddress(valueIsTable(metatable) ? valuePayload(metatable) : 0u);
			out.push_back(target);
			break;
		}
		case BuiltinFunctionId::ToInteger:
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
		case BuiltinFunctionId::TableCopy: {
			const Value source = args[0];
			if (!valueIsTable(source)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			const auto copy = asTable(source, m_heap).copyOwn();
			instructionBudgetRemaining -= static_cast<int>(copy.arrayCapacity() + 2u * copy.hashSlots());
			out.push_back(valueTable(copy.address()));
			break;
		}
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
		case BuiltinFunctionId::FrameHeader:
		case BuiltinFunctionId::GetFrameRegister:
		case BuiltinFunctionId::SetFrameRegister:
		case BuiltinFunctionId::GetFrameUpvalue:
		case BuiltinFunctionId::SetFrameUpvalue:
			ThreadRecord::invokeDiagnostic(m_heap, fn.id, args, out);
			break;
		case BuiltinFunctionId::StringChar:
			runBuiltinStringChar(args, out);
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
		case BuiltinFunctionId::StringSlice: {
			i32 first, last;
			if (args.size() < 3 || !valueIsString(args[0]) ||
				!valueToInteger(args[1], first) || !valueToInteger(args[2], last) ||
				first < 1 || last < first || last > m_stringPool.byteLength(asStringId(args[0])))
				throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			const auto count = last - first + 1;
			instructionBudgetRemaining -= count;
			out.push_back(valueString(m_stringPool.internSlice(asStringId(args[0]), first - 1, count)));
			break;
		}
		case BuiltinFunctionId::SetStringIndex:
			if (!valueIsTable(args[0])) {
				throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			}
			m_stringIndexTable = args[0];
			break;
		case BuiltinFunctionId::CoroutineCreate: {
			u32 closure = !args.empty() && valueIsClosure(args[0]) ? asClosure(args[0], m_heap) : 0u;
			if (!closure) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			out.push_back(valueThread(createThread(closure)));
			break;
		}
		case BuiltinFunctionId::CoroutineRunning:
			out.push_back(valueThread(m_activeThread->address));
			out.push_back(valueBool(m_activeThread == &m_rootView));
			break;
		case BuiltinFunctionId::CoroutineStatus:
		case BuiltinFunctionId::CoroutineClose:
		case BuiltinFunctionId::CoroutineIsYieldable: {
			const u32 address = args.empty() && fn.id == BuiltinFunctionId::CoroutineIsYieldable ? m_activeThread->address
				: !args.empty() && valueIsThread(args[0]) ? asThread(args[0], m_heap) : 0u;
			if (address == 0u) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			if (fn.id == BuiltinFunctionId::CoroutineIsYieldable) out.push_back(valueBool(coroutineYieldable(address)));
			else {
				const auto status = static_cast<ThreadStatus>(ThreadRecord::read(m_memory, address, ThreadField::Status));
				if (fn.id == BuiltinFunctionId::CoroutineStatus) out.push_back(valueInteger(static_cast<int>(status)));
				else {
					const bool failed = status == ThreadStatus::Failed;
					out.push_back(valueBool(!failed));
					if (failed) out.push_back(ThreadRecord::error(m_memory, address));
					Thread& view = bindThread(address);
					closeThread(view);
					view.setError(valueNil());
				}
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

u32 CPU::createThread(u32 entry) {
	const u32 address = m_luaHeap.allocateThreadRecord(entry);
	trackLocalRoot(valueThread(address));
	return address;
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

void CPU::returnToResumer(BuiltinArgsView values, bool succeeded) {
	Thread* thread = m_activeThread;
	auto roots = acquireLocalRoots();
	trackLocalRoot(valueThread(thread->address));
	Thread* resumer = &bindThread(thread->resumer());
	m_activeThread = resumer;
	resumeFrameBank();
	resumer->setStatus(ThreadStatus::Running);
	CallFrame& caller = *resumer->currentFrame;
	const auto result = resumer->transferResult();
	const int count = result.selected(static_cast<int>(values.size()) + 1);
	if (count > 0) {
		ensureRegisterCapacity(caller, result.base + count - 1);
		caller.registers.set(result.base, valueBool(succeeded));
		const int copied = std::min(static_cast<int>(values.size()), count - 1);
		for (int i = 0; i < copied; ++i)
			caller.registers.set(result.base + i + 1, values[i]);
		for (int i = copied + 1; i < count; ++i) caller.registers.set(result.base + i, valueNil());
	}
	caller.placeResultTop(result, count);
	thread->setResumer(0u);
	m_threadSwitchRequested = true;
	m_yieldRequested = true;
	instructionBudgetRemaining -= count;
}

void CPU::runCoroutineTransfer(BuiltinFunctionId id, CallFrame& caller, CallResultPlacement result, const CallArguments& arguments) {
	Thread* thread = m_activeThread;
	const auto args = arguments.values();
	if (id == BuiltinFunctionId::CoroutineYield) {
		if (!coroutineYieldable(thread->address)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		thread->setTransferResult(result);
		thread->setStatus(ThreadStatus::Suspended);
		returnToResumer(args, true);
		return;
	}
	const Value targetValue = args[0];
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
		if (supplied.frame) pushFrame(*supplied.frame, closure, supplied.base, supplied.count, {}, 0u);
		else pushFrame(closure, supplied.values(), {}, 0u, 0u);
		target->setEntry(0u);
	} else {
		resumeFrameBank();
		CallFrame& frame = *target->currentFrame;
		if (supplied.frame) writeReturnValuesFromRegisters(frame, target->transferResult(), *supplied.frame, supplied.base, supplied.count);
		else writeReturnValues(frame, target->transferResult(), supplied.values());
	}
	m_threadSwitchRequested = true;
	m_yieldRequested = true;
}

bool CPU::handleThreadError(Value error) {
	if (handleProtectedCallError(error)) return true;
	Thread* thread = m_activeThread;
	if (thread->resumer() == 0u) return false;
	for (auto* frame = thread->currentFrame; frame; frame = frame->previous)
		if (frame->hasControlFlag(FRAME_EXCEPTION | FRAME_COMPLETION)) return false;
	thread->setStatus(ThreadStatus::Failed);
	thread->setError(error);
	returnToResumer(BuiltinArgsView(&error, 1), false);
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
	thread.setStackTop(0);
	thread.setEntry(0u);
	thread.setStatus(ThreadStatus::Dead);
}

void CPU::runBuiltinFunction(BuiltinFunction& fn, CallFrame& frame, CallResultPlacement result, const CallArguments& arguments) {
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
	callBuiltinFunction(fn, arguments.values(), out, result.limit());
	if (m_activeThread->frameDepth() != 0 && m_activeThread->currentFrame == &frame) {
		writeReturnValues(frame, result, BuiltinArgsView(out.data(), out.size()));
	}
}

void CPU::startProtectedCall(BuiltinFunctionId id, CallResultPlacement result,
	const CallArguments& arguments, bool returnsToProtectedParent) {
	Value handler = valueNil();
	if (id == BuiltinFunctionId::XPCall) {
		handler = arguments.values()[1];
		if (!valueIsClosure(handler) && !valueIsBuiltinFunction(handler)) {
			throw LuaExecutionError(LUA_FAULT_REASON_XPCALL_HANDLER_NOT_FUNCTION);
		}
	}
	const auto kind = id == BuiltinFunctionId::PCall ? ProtectedCallKind::PCall : ProtectedCallKind::XPCallBody;
	const u32 continuationIndex = m_activeThread->pushProtectedCall(kind, returnsToProtectedParent, result, handler);

	const int targetArgumentOffset = id == BuiltinFunctionId::PCall ? 1 : 2;
	invokeProtectedTarget(continuationIndex, arguments.values()[0], arguments.tail(targetArgumentOffset));
}

void CPU::invokeProtectedTarget(u32 continuationIndex, Value target, const CallArguments& arguments) {
	CallFrame& caller = protectedCaller(continuationIndex);
	if (valueIsClosure(target)) {
		u32 closure = asClosure(target, m_heap);
		if (!closure) throw LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
		auto* frame = arguments.frame
			? pushFrame(*arguments.frame, closure, arguments.base, arguments.count, {}, caller.readControl(FrameField::Pc) - INSTRUCTION_BYTES)
			: pushFrame(closure, arguments.values(), {}, 0u, m_currentInstructionPc);
		if (frame) frame->writeControl(FrameField::Protected, continuationIndex);
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
		callBuiltinFunction(builtin, arguments.values(), results, -1);
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
	if (finishImplicitProtectedHandler(continuationIndex, true)) return;
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
	if (finishImplicitProtectedHandler(continuationIndex, true)) return;
	const int resultCount = writeProtectedResults(continuationIndex, true, source, sourceBase, sourceCount);
	instructionBudgetRemaining -= resultCount;
	finishProtectedContinuation(continuationIndex, resultCount);
}

void CPU::finishProtectedCallWithError(u32 continuationIndex, Value errorValue) {
	if (finishImplicitProtectedHandler(continuationIndex, false)) return;
	CallFrame& caller = protectedCaller(continuationIndex);
	const auto result = m_activeThread->protectedResult(continuationIndex);
	const i32 callBase = result.base;
	const int resultCount = result.selected(2);
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
	finishProtectedCall(continuationIndex - 1u, &status, 1);
	return true;
}

int CPU::writeProtectedResults(u32 continuationIndex, bool prefix, const Value* values, int valueCount) {
	CallFrame& caller = protectedCaller(continuationIndex);
	const auto result = m_activeThread->protectedResult(continuationIndex);
	const i32 callBase = result.base;
	const int resultCount = result.selected(valueCount + 1);
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
	caller.placeResultTop(result, resultCount);
	return resultCount;
}

int CPU::writeProtectedResults(u32 continuationIndex, bool prefix, CallFrame& source, int sourceBase, int sourceCount) {
	CallFrame& caller = protectedCaller(continuationIndex);
	const auto result = m_activeThread->protectedResult(continuationIndex);
	const i32 callBase = result.base;
	const int resultCount = result.selected(sourceCount + 1);
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
	caller.placeResultTop(result, resultCount);
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
			const Value result = kind == ProtectedCallKind::XPCallHandler ? m_errorInErrorHandlingValue : errorValue;
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
	TableRecord(m_heap, valuePayload(target)).nextEntry(key, nextKey, nextValue);
	out.push_back(nextKey);
	if (!isNil(nextKey)) out.push_back(nextValue);
}

bool CPU::stepTableIterator(ValueSpan registers, int base, int destination, int count) {
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

void CPU::runBuiltinRawGet(BuiltinArgsView args, BuiltinResults& out) {
	const Value target = args[0];
	if (!valueIsTable(target) || args.size() < 2) {
		throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	}
	out.push_back(TableRecord(m_heap, valuePayload(target)).get(args[1]));
}

void CPU::runBuiltinRawSet(BuiltinArgsView args, BuiltinResults& out) {
	const Value target = args[0];
	if (!valueIsTable(target) || args.size() < 3) {
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
	m_haltedUntilIrqThreadAddress = 0u;
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
	if (m_pendingMemory.kind != PendingMemoryKind::None || allocationParked()) return false;
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
		u32 closure = staticClosureForRecord(decodePrototype(m_functionRecordLatch));
		return pushFrame(closure, {}, {}, FRAME_EXCEPTION | (causeWord == CPU_CAUSE_NMI ? FRAME_NMI : 0), epcWord);
	} catch (const LuaOutOfMemorySignal&) {
		// Failure to admit an exception vector cannot recursively trap.
		hardHalt();
		return nullptr;
	}
}

void CPU::clearHaltAfterAcceptedInterrupt() {
	m_haltedUntilIrqFrameDepth = -1;
	m_haltedUntilIrqThreadAddress = 0u;
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

inline CPU::GrantAdmission CPU::admitGrant(const Thread& thread, int targetDepth, int remainingCycles) const {
	const int depth = static_cast<int>(thread.frameDepth());
	if (depth <= targetDepth || m_hardHalted || m_memoryWriteBlocked
		|| (m_haltedUntilIrqThreadAddress == thread.address && m_haltedUntilIrqFrameDepth == depth))
		return GrantAdmission::Halted;
	if (m_yieldRequested) return GrantAdmission::RequestedYield;
	if (remainingCycles <= 0) return GrantAdmission::OutOfCycles;
	return GrantAdmission::Admitted;
}

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
	ValueSpan registers;
	bool canReuseFrame = false;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const NativeBlock* nativeBlock = nullptr;
	int nativeFirstDispatchCycles = 0;
	NativeCpuRunState nativeState{.state = {}, .cpu = this, .targetDepth = targetDepth,
		.error = {}};
#define OBSERVE_SCALAR_ARITHMETIC(left, right) do { \
	if constexpr (!Instrumented) { \
		if (nativeState.replay && nativeState.replay->pc == pc && nativeState.replay->arithmetic) { \
			const auto assumption = *nativeState.replay->arithmetic; \
			nativeState.replay.reset(); \
			observeNativeArithmeticReplay(*decodedPage, (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES, \
				assumption, left, right); \
		} else if (decoded->dispatchOp == static_cast<u8>(DecodedDispatchOp::NativeWarm)) { \
			decoded->observeNativeNumericTypes(left, right); \
		} \
	} \
} while (0)
#endif
	for (;;) {
		try {
			auto admission = admitGrant(thread, RootBoundary ? 0 : targetDepth, instructionBudgetRemaining);
			if (admission == GrantAdmission::Admitted && m_pendingMemory.kind != PendingMemoryKind::None) {
				resumePendingMemoryOperation();
				admission = admitGrant(thread, RootBoundary ? 0 : targetDepth, instructionBudgetRemaining);
			}
			switch (admission) {
				case GrantAdmission::Admitted: break;
				case GrantAdmission::Halted: return RunResult::Halted;
				case GrantAdmission::RequestedYield:
					m_yieldRequested = false;
					return RunResult::Yielded;
				case GrantAdmission::OutOfCycles: return RunResult::Yielded;
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
					nativeState.replay.reset();
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
			if constexpr (!Instrumented) publishedTop = registerTop = frame->readWindow(FrameField::Top);
			pageAddress = pc & ~MAPPED_PAGE_BYTE_MASK;
			decodedPage = &decodedPageForFrame(*frame, pc);
			goto dispatch_decode;

dispatch_decode:
			if (m_activeStackRebound) {
				m_activeStackRebound = false;
				if (frame != thread.currentFrame) continue;
				registers = frame->registers;
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
				PUBLISH_SCALAR_FRONTIER();
				if (!decodeInstruction(*frame, *decodedPage, pageOffset, pc, !Instrumented)) {
					continue;
				}
				refreshState = decodedPage->refreshState[pageOffset];
				if constexpr (!Instrumented) publishedTop = registerTop = frame->readWindow(FrameField::Top);
			}
			decoded = &decodedPage->words[pageOffset];
			m_currentInstructionPc = pc;
			nextPc = pc + static_cast<u32>(decoded->width) * INSTRUCTION_BYTES;
			if constexpr (Instrumented) frame->writeControl(FrameField::Pc, nextPc);
			else scalarFrame = frame;
			m_lastExecutionDomainId = image->executionDomainId;
			lastPc = pc + ((static_cast<u32>(decoded->width) - 1u) * INSTRUCTION_BYTES);
			uint8_t dispatchOp;
			if constexpr (Instrumented) {
				dispatchOp = decoded->dispatchOp == static_cast<u8>(DecodedDispatchOp::Observe)
					? decoded->dispatchOp : decoded->op;
			} else {
				dispatchOp = decoded->dispatchOp;
				// Cacheable instruction reads cannot raise a device edge during fetch.
				canReuseFrame = (refreshState & DECODED_REFRESH_DECODE) == 0u;
			}
			instructionBudgetRemaining -= decoded->baseCycles;

#define FRAME (*frame)
#define IMAGE (*image)
#define REG(index) registers.get(static_cast<size_t>(index))
#define CYCLES_ADD(n) do { instructionBudgetRemaining -= (n); } while (0)
#define EXTEND_TOP(extent) do { \
	if constexpr (Instrumented) FRAME.extendTop(extent); \
	else registerTop = std::max(registerTop, static_cast<int>(extent)); \
} while (0)
#define SET_REGISTER_FAST(index, valueExpr) do { \
	registers.set(static_cast<size_t>(index), (valueExpr)); \
	EXTEND_TOP((index) + 1); \
} while (0)
#define SET_NEXT_PC(target) do { \
	if constexpr (Instrumented) FRAME.writeControl(FrameField::Pc, target); \
	else nextPc = (target); \
} while (0)
#define SKIP_NEXT_INSTRUCTION() do { \
	PUBLISH_SCALAR_FRONTIER(); \
	skipNextInstruction(FRAME); \
} while (0)
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
			if (decoded->requiredSlots > registers.size()) {
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
#include "machine/cpu/cpu_dispatch.inl"
				}
			} else {
				switch (dispatchOp) {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
				case static_cast<u8>(DecodedDispatchOp::NativeWarm): {
					auto& visits = decodedPage->nativeVisits[pageOffset];
					if (visits < NATIVE_BLOCK_COMPILATION_THRESHOLD) ++visits;
					if (FRAME.compilationEntry && visits == NATIVE_BLOCK_COMPILATION_THRESHOLD
						&& !(nativeState.replay && nativeState.replay->pc == pc && nativeState.replay->arithmetic)) {
						prepareNativeBlock(FRAME, *decodedPage, pc, m_executionBusSignals);
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
					// An interior scalar continuation may already have run before
					// reaching the next native entry. Only bypass its exact PC.
					const bool replay = nativeState.replay && nativeState.replay->pc == pc;
					if (!replay || !nativeState.replay->arithmetic) nativeState.replay.reset();
					if (replay || std::endian::native == std::endian::big || thread.stackRequiresScalar()) {
						FRAME.compilationEntry = rewritten || nativeBlockEndsBlock(decoded->op, decoded->b);
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
				case static_cast<u8>(DecodedDispatchOp::ReservedMemory):
					PUBLISH_SCALAR_FRONTIER();
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
					if (decoded->requiredSlots > registers.size()) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
					const Value& xorLeftValue = readRK(IMAGE, registers, decoded->b);
					const Value& xorRightValue = readRK(IMAGE, registers, decoded->c);
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
					if (decoded->requiredSlots > registers.size()) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
					const Value& shiftLeftValue = readRK(IMAGE, registers, decoded->b);
					const Value& shiftRightValue = readRK(IMAGE, registers, decoded->c);
					const i32 shifted = luaShiftLeft(integerOperand(shiftLeftValue), integerOperand(shiftRightValue));
					SET_REGISTER_FAST(
						decoded->a,
						valueInteger(shifted)
					);
					PUBLISH_SCALAR_FRONTIER();
					DISPATCH_CONTINUE();
				}
#include "machine/cpu/cpu_dispatch.inl"
				}
			}
			goto dispatch_continue;

#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
dispatch_native_block: {
				PUBLISH_SCALAR_FRONTIER();
				thread.recordNativeWrites(m_memory.ramWriteWatches());
				nativeState.frameBank = frameBankWord(IMAGE.executionDomainId);
				nativeState.nativeStackCapacity = thread.stackCapacity;
				nativeState.nativeFrameLimit = thread.retainedFrameLimit();
				nativeState.haltedCallDepth = m_haltedUntilIrqThreadAddress == thread.address ? m_haltedUntilIrqFrameDepth : -1;
			nativeState.closureDomain = ClosureRecord::domainBits(IMAGE.executionDomainId);
				nativeState.cartridgeSlot = m_memory.cartridgeController().selectedSlot(m_executionBusSignals);
				nativeState.codeRoot = IMAGE.nativeCodeLookup->root(nativeState.cartridgeSlot);
				nativeState.state = {.constants = IMAGE.constPool, .frame = frame, .heap = &m_heap,
					.globalValues = m_globalBank.values(), .systemGlobalValues = m_systemGlobalBank.values(),
					.cop0Words = m_cop0Words.data(),
					.tableIndexKey = asStringId(m_indexKey),
					.remainingCycles = instructionBudgetRemaining + nativeFirstDispatchCycles, .registerTop = FRAME.readWindow(FrameField::Top),
					.closure = FRAME.closureAddress(), .stackBase = FRAME.stackBase(),
					.frameDepth = static_cast<u32>(thread.frameDepth()),
					.ram = m_memory.ramData(),
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
				if (nativeState.error) std::rethrow_exception(std::exchange(nativeState.error, {}));
				if (allocationParked()) return RunResult::ParkedAllocation;
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
				if (m_haltedUntilIrqThreadAddress == m_activeThread->address
					&& m_haltedUntilIrqFrameDepth == static_cast<int>(thread.frameDepth())) return RunResult::Halted;
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
			PUBLISH_SCALAR_FRONTIER();
			canReuseFrame = false;
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			FRAME.compilationEntry = rewritten || nativeBlockEndsBlock(decoded->op, decoded->b);
#endif
			// Observation precedes the original instruction's charge.
			instructionBudgetRemaining += decoded->baseCycles;
			m_instructionObserver.observe(m_instructionObserver.context, image->executionDomainId, pc, registers);
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
#undef SKIP_NEXT_INSTRUCTION
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
			if (!handleThreadError(m_luaFaultErrorValues[LUA_FAULT_REASON_OUT_OF_MEMORY])) {
				enterLuaFaultException(
					LUA_FAULT_REASON_OUT_OF_MEMORY,
					m_luaFaultErrorValues[LUA_FAULT_REASON_OUT_OF_MEMORY]
				);
			}
		} catch (const LuaThrownValueError& error) {
			PUBLISH_SCALAR_FRONTIER();
			if (!handleThreadError(error.value)) {
				enterLuaFaultException(LUA_FAULT_REASON_EXPLICIT_ERROR, error.value);
			}
		} catch (const LuaExecutionError& error) {
			PUBLISH_SCALAR_FRONTIER();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
			nativeState.replay.reset();
#endif
			const Value errorValue = m_luaFaultErrorValues[error.reason];
			if (!handleThreadError(errorValue)) {
				enterLuaFaultException(error.reason, errorValue);
			}
		} catch (...) {
			PUBLISH_SCALAR_FRONTIER();
			throw;
		}
	}
}

#undef RESUME_SCALAR_FRONTIER
#undef PUBLISH_SCALAR_FRONTIER
#undef OBSERVE_SCALAR_ARITHMETIC

RunResult CPU::runUntilDepth(int targetDepth, int instructionBudget, u32 target, CpuRunKind kind) {
	if (allocationParked()) {
		instructionBudgetRemaining = instructionBudget;
		return RunResult::ParkedAllocation;
	}
	m_runKind = kind;
	if (m_unpublishedRomMask != 0u)
		throw BMSX_RUNTIME_ERROR("Installed ROM must be published before CPU execution.");
	if (target == 0u) target = m_rootView.address;
	for (;;) {
		const RunResult result = m_runUntilDepthEntry(*this, m_activeThread->address == target ? targetDepth : 0, instructionBudget);
		if (!m_threadSwitchRequested) return result;
		m_threadSwitchRequested = false;
		m_yieldRequested = false;
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
		&& cpu.m_pendingMemory.kind == PendingMemoryKind::None
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

size_t CPU::stepHeap(Value root0, Value root1, Value root2, u32 growingThread) {
	return m_heap.step(root0, root1, root2, growingThread);
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
	return Upvalue::load(m_memory, frame.captureAddress(static_cast<u32>(upvalueIndex)));
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
	if (allocationParked()) throw BMSX_RUNTIME_ERROR("A parked allocation must retire before replacing code execution.");
	Blua32ExecutionImage& image = *executionImageForDomain(executionDomainId);
	if (!image.admitsFunctionPc(functionAddress, pc)
		|| !readFunctionRecord(image, functionAddress, executionBusSignalsForDomain(executionDomainId)))
		throw BMSX_RUNTIME_ERROR("Frame execution must enter an instruction of its published function.");
	const Blua32FunctionRecordLatch& functionRecord = m_functionRecordLatch;
	const auto prototype = decodePrototype(functionRecord);
	const u32 registerCount = prototype.entry.registerCapacity();
	if (registerCount > MAX_THREAD_VALUE_SLOTS) throw LuaOutOfMemorySignal{};
	CallFrame& frame = *m_activeThread->frameAtDepth(static_cast<size_t>(frameIndex));
	if (&frame == m_activeThread->currentFrame) abortStalledMemoryWrite();
	if (registerCount > static_cast<u32>(frame.stackCapacity())) {
		ensureRegisterCapacity(frame, static_cast<int>(registerCount) - 1);
	}
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

u32 CPU::findOpenUpvalue(const CallFrame& frame, int index) const {
	const u32 slot = static_cast<u32>(frame.stackBase()) + static_cast<u32>(index);
	u32 address = frame.readControl(FrameField::OpenHead);
	for (u32 remaining = UPVALUE_CHAIN_LIMIT; address != 0 && remaining != 0; --remaining) {
		const u32 cell = m_heap.openCellAddress(address);
		if (cell == 0u) break;
		const u32 current = m_memory.readRamRecordWord(cell + UPVALUE_VALUE_WORD);
		if (current <= slot) return current == slot ? cell : 0u;
		address = m_memory.readRamRecordWord(cell + UPVALUE_NEXT);
	}
	return 0u;
}

void CPU::linkOpenUpvalue(CallFrame& frame, u32 cell, u32 slot) {
	u32 previous = 0u;
	u32 next = frame.readControl(FrameField::OpenHead);
	for (u32 remaining = UPVALUE_CHAIN_LIMIT; next != 0 && remaining != 0; --remaining) {
		const u32 current = m_heap.openCellAddress(next);
		if (current == 0u || m_memory.readRamRecordWord(current + UPVALUE_VALUE_WORD) <= slot) break;
		previous = current;
		next = m_memory.readRamRecordWord(current + UPVALUE_NEXT);
	}
	Upvalue::bindOpen(m_memory, cell, frame.thread->address, slot, next);
	if (previous != 0u) m_memory.writeRamRecordWord(previous + UPVALUE_NEXT, cell);
	else frame.writeControl(FrameField::OpenHead, cell);
}

u32 CPU::createClosure(CallFrame& frame) {
	const Blua32FunctionRecordLatch& functionRecord = m_functionRecordLatch;
	if ((functionRecord.flags & BLUA32_FUNCTION_STATIC) != 0u
		&& functionRecord.upvalueCount == 0u) {
		return staticClosureForRecord(decodePrototype(functionRecord));
	}
	if (functionRecord.upvalueCount > maxClosureCaptures(!functionRecord.romBacked)) throw LuaOutOfMemorySignal{};
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
			return 0u;
		}
		m_closureUpvalueWordScratch[index] = upvalueWord;
		const u32 upvalueIndex = upvalueWord & BLUA32_UPVALUE_INDEX_MASK;
		if ((upvalueWord & BLUA32_UPVALUE_IN_STACK_MASK) != 0u) {
			if (upvalueIndex >= frame.registers.size()) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			const u32 cell = findOpenUpvalue(frame, static_cast<int>(upvalueIndex));
			m_closureCellScratch[index] = cell;
			newUpvalueCount += cell == 0u;
		} else {
			if (upvalueIndex >= frame.captureCount()) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			m_closureCellScratch[index] = frame.captureAddress(upvalueIndex);
		}
	}
	m_captureAddressScratch.resize(newUpvalueCount);
	const u32 closure = allocateClosure(decodePrototype(functionRecord), functionRecord.upvalueCount, false, m_captureAddressScratch);
	size_t nextCell = 0;
	for (u32 index = 0; index < functionRecord.upvalueCount; ++index) {
		u32 address = m_closureCellScratch[index];
		if (address == 0u && (m_closureUpvalueWordScratch[index] & BLUA32_UPVALUE_IN_STACK_MASK) != 0u) {
			address = m_captureAddressScratch[nextCell++];
			linkOpenUpvalue(frame, address, static_cast<u32>(frame.stackBase())
				+ (m_closureUpvalueWordScratch[index] & BLUA32_UPVALUE_INDEX_MASK));
		}
		ClosureRecord::setCaptureAddress(m_memory, closure, index, address);
	}
	m_closureCellScratch.clear();
	m_closureUpvalueWordScratch.clear();
	instructionBudgetRemaining -= static_cast<int>(functionRecord.upvalueCount);
	return closure;
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

CallFrame* CPU::pushFrame(CallFrame& caller, u32 closure, int argBase, int argCount,
	CallResultPlacement result, u32 callSitePc) {
	const FunctionPrototype functionRecord = readClosureBinding(closure);
	const int callerArgBase = caller.stackBase() + argBase;
	const bool sharedStack = caller.thread == m_activeThread;
	const int argumentBase = sharedStack ? callerArgBase : m_activeThread->stackTop();
	const auto admitted = ArgumentPlacement::forEntry(argumentBase, argCount, functionRecord.entry);
	if (!admitted) throw LuaOutOfMemorySignal{};
	const auto& placement = *admitted;
	auto* frame = m_activeThread->acquireFrame();
	ensureStackSize(placement.stackEnd(), valueClosure(closure), true);
	frame->executionImage = executionImageForDomain(functionRecord.executionDomainId);
	frame->initializeControl({
		functionRecord.functionAddress, functionRecord.entry.codeAddress, callSitePc,
		frameBankWord(functionRecord.executionDomainId),
		placement.varargBase, placement.varargCount, result, placement.top(),
		closure, placement.stackBase, static_cast<int>(placement.capacity),
	});
	const auto [copied, padded] = placement.formals;
	if (placement.relocatesFormals || !sharedStack)
		frame->registers.copyFrom(caller.thread->stack, 0, callerArgBase, copied);
	frame->registers.clear(copied, padded);
	if (placement.relocatesFormals) {
		if (sharedStack)
			m_activeThread->stack.clear(placement.argumentBase, copied);
		else
			m_activeThread->stack.copyFrom(caller.thread->stack, placement.varargBase, callerArgBase + placement.top(), placement.varargCount);
	}
	instructionBudgetRemaining -= placement.cycles(sharedStack);
	m_activeThread->setStackTop(static_cast<int>(placement.stackEnd()));
	m_activeThread->enterFrame(frame);
	latchActiveExecutionImage(functionRecord.executionDomainId, frame->executionImage);
	return frame;
}

CallFrame* CPU::pushFrame(u32 closure, BuiltinArgsView args,
	CallResultPlacement result, u32 flags, std::optional<u32> callSitePc) {
	const FunctionPrototype functionRecord = readClosureBinding(closure);
	const size_t argCount = args.size();
	auto* frame = m_activeThread->acquireFrame();
	const int argumentBase = m_activeThread->stackTop();
	const auto admitted = ArgumentPlacement::forEntry(argumentBase, static_cast<int>(argCount), functionRecord.entry);
	if (!admitted) throw LuaOutOfMemorySignal{};
	const auto& placement = *admitted;
	ensureStackSize(placement.stackEnd(), valueClosure(closure), true, (flags & FRAME_EXCEPTION) != 0u);
	frame->executionImage = executionImageForDomain(functionRecord.executionDomainId);
	frame->initializeControl({
		functionRecord.functionAddress, functionRecord.entry.codeAddress, callSitePc.value_or(functionRecord.entry.codeAddress),
		frameBankWord(functionRecord.executionDomainId) | flags,
		placement.varargBase, placement.varargCount, result, placement.top(),
		closure, placement.stackBase, static_cast<int>(placement.capacity),
	});
	const auto [copied, padded] = placement.formals;
	for (int i = 0; i < copied; ++i) frame->registers.set(i, args[i]);
	frame->registers.clear(copied, padded);
	for (int i = 0; i < placement.varargCount; ++i)
		m_activeThread->stack.set(placement.varargBase + i, args[placement.top() + i]);
	if (callSitePc && (flags & FRAME_EXCEPTION) == 0u) instructionBudgetRemaining -= placement.cycles(false);
	m_activeThread->setStackTop(static_cast<int>(placement.stackEnd()));
	m_activeThread->enterFrame(frame);
	latchActiveExecutionImage(functionRecord.executionDomainId, frame->executionImage);
	return frame;
}

void CPU::writeReturnValuesFromRegisters(CallFrame& frame, CallResultPlacement result, const CallFrame& source, int sourceBase, int sourceCount) {
	const int base = result.base;
	const auto placement = ValuePlacement::fit(sourceCount, result.selected(sourceCount));
	if (placement.count() > 0) {
		ValueSpan registers = ensureRegisterCapacity(frame, base + placement.count() - 1);
		// Backing growth can relocate both views; their stack offsets stay fixed.
		registers.copyFrom(source.registers, base, sourceBase, placement.copied);
		registers.clear(base + placement.copied, placement.padded);
	}
	frame.placeResultTop(result, placement.count());
	instructionBudgetRemaining -= placement.count();
}

void CPU::writeReturnValues(CallFrame& frame, CallResultPlacement result, BuiltinArgsView values) {
	const int base = result.base;
	const int valueCount = static_cast<int>(values.size());
	const int targetCount = result.selected(valueCount);
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
	frame.placeResultTop(result, targetCount);
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

void CPU::markRootHead(GcHeap& heap) {
	// Opcode metamethod selectors stay interned independently of guest tables.
	heap.markValue(m_indexKey);
	heap.markValue(m_newIndexKey);
	heap.markValue(m_lengthKey);
	heap.markValue(m_errorInErrorHandlingValue);
	for (const Value value : m_luaFaultErrorValues) heap.markValue(value);
	heap.markValue(m_stringIndexTable);
	if (allocationParked()) markPendingAllocationRoots(heap);
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

size_t CPU::rootBankSlots(GcRootBank bank) const {
	if (bank == GcRootBank::SystemGlobals) return m_systemGlobalBank.count();
	if (bank == GcRootBank::Globals) return m_globalBank.count();
	if (bank == GcRootBank::Completion) return m_completionValueCount;
	const auto& image = m_executionImagesByDomain[static_cast<u32>(bank) - static_cast<u32>(GcRootBank::SystemConstants)];
	return image ? image->constantStringRoots.size() : 0u;
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
	const auto& roots = m_executionImagesByDomain[static_cast<u32>(bank) - static_cast<u32>(GcRootBank::SystemConstants)]->constantStringRoots;
	for (size_t slot = first; slot < end; ++slot) heap.markString(roots[slot]);
}

void CPU::markRootThreads(GcHeap& heap) {
	heap.markThread(m_rootView.address);
	if (m_activeThread) heap.markThread(m_activeThread->address);
	heap.markThread(m_completionThreadAddress);
	heap.markThread(m_haltedUntilIrqThreadAddress);
}

// end repeated-sequence-acceptable

} // namespace bmsx
