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

CPU::CPU(
	Memory& memory,
	IrqController& irqController,
	ExecutionAddressSpace& executionAddressSpace
)
	: m_memory(memory)
	, m_irqController(irqController)
	, m_executionAddressSpace(executionAddressSpace)
	, m_stringPool(memory)
	, m_rootView(memory)
	, m_irqView(memory)
	, m_transferViews{Thread{memory}, Thread{memory}}
	, m_systemGlobalBank(memory, CPU_FIXED_STACK_BASE + SYSTEM_GLOBAL_BANK_OFFSET)
	, m_globalBank(memory, CPU_FIXED_STACK_BASE + GLOBAL_BANK_OFFSET) {
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

void CPU::reset() {
	if (fixedInterruptDefersReset()) throw BMSX_RUNTIME_ERROR("System IRQ must retire before reset.");
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
	m_stringComparison = {};
	m_programExecutionDomainId = SYSTEM_EXECUTION_DOMAIN_ID;
	m_cop0Words[COP0_STATUS] = CPU_STATUS_SYSTEM_ENTRY;
	m_cop0Words[COP0_CAUSE] = 0u;
	m_cop0Words[COP0_EPC] = 0u;
	m_cop0Words[COP0_BAD_ADDRESS] = 0u;
	m_cop0Words[COP0_LUA_FAULT_REASON] = 0u;
	m_cop0Words[COP0_TABLE_LOOKUP_KEY] = 0u;
	m_cop0Words[COP0_TABLE_ASSIGN_KEY] = 0u;
	m_cop0Words[COP0_TABLE_LENGTH_KEY] = 0u;
	m_cop0Words[COP0_STRING_INDEX_TABLE] = 0u;
	m_exceptionDomainWord = 0u;
	m_nmiReturnCauseWord = 0u;
	m_nmiReturnEpcWord = 0u;
	m_nmiReturnBadAddressWord = 0u;
	m_nmiReturnLuaFaultReasonWord = 0u;
	m_nmiReturnExceptionDomainWord = 0u;
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
			case Blua32ConstantTag::CodeFunction: {
				const u32 address = readLE32(record + BLUA32_CONSTANT_PAYLOAD_OFFSET);
				const auto domain = address < CART_ROM_BASE ? SYSTEM_EXECUTION_DOMAIN_ID : executionDomainId;
				const auto& directory = domain == executionDomainId ? image.romFunctions : m_executionImagesByDomain[0]->romFunctions;
				const auto* function = directory.find(address);
				if (address == 0u || directory.mappedCode
					|| !function || !isStaticCodeFunction(function->entry.flags, function->upvalueCount))
					throw BMSX_RUNTIME_ERROR("BLua32 code constant must name an immutable ROM function.");
				constPool.set(index, valueFromTag(ValueTag::CodeFunction, codeFunctionWord(address, domain)));
				break;
			}
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

void CPU::bindConstantStrings(Blua32ExecutionImage& image, u32 stringBinding) {
	auto& storage = image.decodedConstants;
	if (stringBinding == 0u) {
		for (const u32 index : image.constantStringSlots) {
			storage.tags()[index] = static_cast<u8>(ValueTag::UnboundStringLiteral);
			storage.words()[index] = 0u;
		}
	} else {
		for (const u32 index : image.constantStringSlots) {
			storage.tags()[index] = static_cast<u8>(ValueTag::String);
			storage.words()[index] = m_memory.readRamRecordWord(stringBinding);
			stringBinding += sizeof(u32);
		}
	}
	image.constPool = ConstValueSpan(storage.words(), storage.tags(), storage.capacity());
}

std::unique_ptr<Blua32ExecutionImage> CPU::activateExecutionImage(
	Blua32ExecutionBoot executionBoot, ExecutionImageUpdate update
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
	if (readLE32(header + BLUA32_IMAGE_MAGIC_OFFSET) != BLUA32_IMAGE_MAGIC) {
		throw BMSX_RUNTIME_ERROR("BLua32 image magic is invalid.");
	}
	const u32 constantTableAddress = readLE32(
		header + BLUA32_IMAGE_CONSTANT_TABLE_ADDRESS_OFFSET
	);
	const u32 constantCount = readLE32(
		header + BLUA32_IMAGE_CONSTANT_COUNT_OFFSET
	);
	const u32 globalNameCount = readLE32(
		header + BLUA32_IMAGE_GLOBAL_NAME_COUNT_OFFSET
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
	const bool reuseConstants = update == ExecutionImageUpdate::Restore && constantCount != 0u && previous
		&& previous->constantSource.data() == records.data() && previous->constantSource.size() == records.size();
	u32 stringCount = 0;
	if (reuseConstants) {
		stringCount = static_cast<u32>(previous->constantStringSlots.size());
	} else {
		for (u32 i = 0; i < constantCount; ++i)
			stringCount += readLE32(records.data() + i * BLUA32_CONSTANT_RECORD_SIZE + BLUA32_CONSTANT_TAG_OFFSET)
				== static_cast<u32>(Blua32ConstantTag::String);
	}
	if (std::max({globalNameCount, systemGlobalNameCount, stringCount}) > MAIN_RAM_SIZE / sizeof(u32))
		throw BMSX_RUNTIME_ERROR("BLua32 image bank extents exceed main RAM.");
	const u32 binding = executionImageBindingOffset(executionDomainId);
	u32 strings = 0u;
	if (update == ExecutionImageUpdate::UseInstalled) {
		if ((globalNameCount != 0u && m_memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_ORDINARY_OFFSET) == 0u)
			|| (systemGlobalNameCount != 0u && m_memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_SYSTEM_OFFSET) == 0u)) return nullptr;
		if (stringCount != 0u) {
			strings = m_memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET);
			if (strings == 0u) return nullptr;
		}
	} else if (update == ExecutionImageUpdate::Restore) {
		strings = m_memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET);
	}
	image->romFunctions = Blua32RomFunctionDirectory::read(m_memory, executionDomainId, header);
	image->globalNameCount = globalNameCount;
	image->systemNameCount = systemGlobalNameCount;
	image->constantSource = records;
	if (reuseConstants) {
		image->decodedConstants = std::move(previous->decodedConstants);
		image->constantStringSlots = std::move(previous->constantStringSlots);
	} else {
		image->decodedConstants.resize(constantCount);
		image->constantStringSlots.reserve(stringCount);
		decodeConstantPool(*image, records);
	}
	bindConstantStrings(*image, strings);
	return image;
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
	if (fixedInterruptActive()) throw BMSX_RUNTIME_ERROR("Fixed execution must retire before replacing code execution.");
	std::unique_ptr<Blua32ExecutionImage>& imageEntry = m_executionImagesByDomain[
		static_cast<size_t>(executionBoot.executionDomainId + 1)
	];
	std::unique_ptr<Blua32ExecutionImage> image =
		activateExecutionImage(executionBoot, ExecutionImageUpdate::UseInstalled);
	if (!image) throw BMSX_RUNTIME_ERROR("Replacement image requires an installed operand binding.");
#if defined(BMSX_NATIVE_COMPILER_WORKER)
	discardNativeCompilation();
#endif
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	clearNativeContinuationBindings();
#endif
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

FunctionPrototype CPU::readClosureBinding(u32 closure) {
	const ClosureRecord::BindingFlags binding{m_memory.readRamRecordByte(closure + CLOSURE_BINDING_FLAGS)};
	return ClosureRecord::readBinding(m_memory, closure, binding, executionImageForDomain(binding.domain())->romFunctions);
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
	// Keep the currently selected view while binding the next one.
	auto& view = m_activeThread == &m_transferViews[0] ? m_transferViews[1] : m_transferViews[0];
	view.select(address);
	bindPhysicalFrames(view);
	return view;
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
	}
}

DecodedInstructionPage& CPU::decodedPageForFrame(CallFrame& frame, u32 pc) {
	const u32 pageAddress = pc & ~MAPPED_PAGE_BYTE_MASK;
	const auto slot = m_memory.cartridgeController().selectedSlot(m_executionBusSignals);
	const u64 key = mappedPageAddressKey(pageAddress, slot);
	if (frame.decodedPage && frame.decodedPage->mapping.key == key) {
		return *frame.decodedPage;
	}
	auto& directory = frame.executionImage->decodedPages;
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
	const u32 binding = executionImageBindingOffset(SYSTEM_EXECUTION_DOMAIN_ID);
	const u32 strings = m_memory.readRamRecordWord(binding + EXECUTION_IMAGE_BINDING_STRINGS_OFFSET);
	bindConstantStrings(image, strings);
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
	if (!frame.hasControlFlag(FRAME_EXCEPTION) || frame.readControl(FrameField::OpenHead) != 0u) {
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
	m_activeThread->leaveFrame();
	if (resumesContext) resumeInterruptedContext();
	enterLatchedExceptionFrame(nmi, m_cop0Words[COP0_EPC]);
}

void CPU::resumeInterruptedContext() {
	const u32 context = m_memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS);
	m_memory.writeRamRecordPair(CPU_INTERRUPTED_CONTEXT_ADDRESS, 0u, 0u);
	m_globalBank.bind();
	m_systemGlobalBank.bind();
	auto& thread = bindThread(context);
	if (thread.currentFrameViewMatches()) thread.bindStack(true);
	else bindPhysicalFrames(thread);
	m_activeThread = &thread;
	m_runSignals |= RunThreadSwitch | RunYield;
}

void CPU::executeFunctionAddress(u32 functionAddress) {
	// A normal transfer reuses the receiving bank; it cannot retain reset authority.
	const bool fixed = fixedInterruptActive();
	if (!fixed && resetBankSelected()) { hardHalt(); return; }
	if (!readFunctionRecordOnBus(*m_activeExecutionImage, functionAddress, MAPPED_BUS_MASTER_CPU)
		|| (m_functionRecordLatch.flags & BLUA32_FUNCTION_STATIC) == 0u) {
		hardHalt();
		return;
	}
	if (fixed) {
		m_irqView.discardFrames();
		resumeInterruptedContext();
	}
	m_activeThread->discardFrames();
	m_completionThreadAddress = m_activeThread->address;
	latchActiveExecutionImage(m_functionRecordLatch.image->executionDomainId, m_functionRecordLatch.image);
	m_programExecutionDomainId = m_functionRecordLatch.image->executionDomainId;
	if (!fixed && m_programExecutionDomainId >= 0) {
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
	if (fixedInterruptActive()) throw BMSX_RUNTIME_ERROR("Fixed execution must retire before replacing code execution.");
	if (m_stringComparison.remaining) throw BMSX_RUNTIME_ERROR("Pending CPU work must retire before replacing code execution.");
	if (m_unpublishedRomMask != 0u)
		throw BMSX_RUNTIME_ERROR("Installed ROM must be published before CPU execution.");
	const ClosureRecord::BindingFlags binding{m_memory.readRamRecordByte(closure + CLOSURE_BINDING_FLAGS)};
	auto* image = m_executionImagesByDomain[static_cast<size_t>(binding.domain() + 1)].get();
	if (!image) throw BMSX_RUNTIME_ERROR("External call requires a resident execution bank.");
	pushDetachedFrame(resolveClosureActivation(*image, closure, binding), closure, args, {});
}

void CPU::beginCompletionCallInExecutionDomain(
	ExecutionDomainId executionDomainId,
	u32 functionAddress,
	BuiltinArgsView args
) {
	if (fixedInterruptActive()) throw BMSX_RUNTIME_ERROR("Fixed execution must retire before replacing code execution.");
	if (m_stringComparison.remaining) throw BMSX_RUNTIME_ERROR("Pending CPU work must retire before replacing code execution.");
	if (m_unpublishedRomMask != 0u)
		throw BMSX_RUNTIME_ERROR("Installed ROM must be published before CPU execution.");
	auto* image = m_executionImagesByDomain[static_cast<size_t>(executionDomainId + 1)].get();
	if (!image) throw BMSX_RUNTIME_ERROR("External call requires a resident execution bank.");
	const auto* record = image->romFunctions.find(functionAddress);
	if (!record || record->upvalueCount != 0u || (record->entry.flags & BLUA32_FUNCTION_STATIC) == 0u)
		throw BMSX_RUNTIME_ERROR("External call requires a static capture-free Function.");
	pushDetachedFrame({image, {functionAddress, record->entry}}, 0u, args, {});
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
	state.statusWord = m_cop0Words[COP0_STATUS];
	state.systemVectorWord = m_cop0Words[COP0_SYSTEM_VECTOR];
	state.previousRootContextWord = m_cop0Words[COP0_CONTEXT];
	state.previousActiveContextWord = m_cop0Words[COP0_PREVIOUS_ACTIVE];
	state.causeWord = m_cop0Words[COP0_CAUSE];
	state.epcWord = m_cop0Words[COP0_EPC];
	state.badAddressWord = m_cop0Words[COP0_BAD_ADDRESS];
	state.luaFaultReasonWord = m_cop0Words[COP0_LUA_FAULT_REASON];
	state.tableLookupKeyWord = m_cop0Words[COP0_TABLE_LOOKUP_KEY];
	state.tableAssignKeyWord = m_cop0Words[COP0_TABLE_ASSIGN_KEY];
	state.tableLengthKeyWord = m_cop0Words[COP0_TABLE_LENGTH_KEY];
	state.stringIndexTableWord = m_cop0Words[COP0_STRING_INDEX_TABLE];
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
	m_rootView.select(state.rootThreadAddress);
	const bool boardBank = state.rootThreadAddress == CPU_RESET_BANK_ADDRESS;
	for (auto& view : m_transferViews) view.select(0u);
	m_activeThread = &m_rootView;
	m_memory.clearMappedPageWriteWatches();
	if (boardBank) {
		m_systemGlobalBank.detach();
		m_globalBank.detach();
	} else {
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
	m_cop0Words[COP0_STATUS] = state.statusWord;
	m_cop0Words[COP0_SYSTEM_VECTOR] = state.systemVectorWord;
	m_cop0Words[COP0_CONTEXT] = state.previousRootContextWord;
	m_cop0Words[COP0_PREVIOUS_ACTIVE] = state.previousActiveContextWord;
	m_cop0Words[COP0_CAUSE] = state.causeWord;
	m_cop0Words[COP0_EPC] = state.epcWord;
	m_cop0Words[COP0_BAD_ADDRESS] = state.badAddressWord;
	m_cop0Words[COP0_LUA_FAULT_REASON] = state.luaFaultReasonWord;
	m_cop0Words[COP0_TABLE_LOOKUP_KEY] = state.tableLookupKeyWord;
	m_cop0Words[COP0_TABLE_ASSIGN_KEY] = state.tableAssignKeyWord;
	m_cop0Words[COP0_TABLE_LENGTH_KEY] = state.tableLengthKeyWord;
	m_cop0Words[COP0_STRING_INDEX_TABLE] = state.stringIndexTableWord;
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
		case BuiltinFunctionId::ToInteger:
		case BuiltinFunctionId::GetMetatable:
		case BuiltinFunctionId::RawGet:
		case BuiltinFunctionId::StringByte: {
			Value result;
			if (!executeBuiltinLeaf(fn.id, args, result)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			out.push_back(result);
			break;
		}
		case BuiltinFunctionId::FrameCount:
		case BuiltinFunctionId::FrameHeader:
		case BuiltinFunctionId::GetFrameRegister:
		case BuiltinFunctionId::SetFrameRegister:
		case BuiltinFunctionId::GetFrameUpvalue:
			ThreadRecord::invokeDiagnostic(m_memory, fn.id, args, out);
			break;
		case BuiltinFunctionId::CoroutineRunning:
			out.push_back(valueThread(m_activeThread->address));
			out.push_back(valueBool(m_activeThread == &m_rootView));
			break;
		case BuiltinFunctionId::CoroutineStatus: {
			const Value thread = args[0];
			if (!valueIsThread(thread)) throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			out.push_back(valueInteger(static_cast<i32>(ThreadRecord::read(m_memory, valuePayload(thread), ThreadField::Status))));
			break;
		}
		case BuiltinFunctionId::Error:
			runBuiltinError(args);
			break;
	}
}

void CPU::runBuiltinFunction(BuiltinFunction& fn, CallFrame& frame, CallResultPlacement result, BuiltinArgsView arguments) {
	instructionBudgetRemaining -= static_cast<int>(fn.cycleBase);
	auto outScratch = acquireBuiltinResultScratch();
	BuiltinResults& out = outScratch.get();
	callBuiltinFunction(fn, arguments, out);
	writeReturnValues(frame, result, BuiltinArgsView(out.data(), out.size()));
}

void CPU::runBuiltinNextValue(Value target, Value key, BuiltinResults& out) {
	if (!valueIsTable(target)) {
		throw LuaExecutionError(LUA_FAULT_REASON_ITERATE_NON_TABLE);
	}
	Value nextKey;
	Value nextValue;
	TableRecord(m_memory, valuePayload(target)).nextEntry(key, nextKey, nextValue);
	out.push_back(nextKey);
	if (!isNil(nextKey)) out.push_back(nextValue);
}

bool CPU::stepTableIterator(ValueSpan& registers, int base, int destination, int count) {
	if (registers.get(base) != valueBuiltinFunction(BuiltinFunctionId::Next)) return false;
	const Value table = registers.get(base + 1), control = registers.get(base + 2);
	if (!valueIsTable(table) || !isNil(control)) return false;
	Value key, value;
	const u32 cursor = TableRecord(m_memory, valuePayload(table)).nextStoredEntry(valuePayload(control), key, value);
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
	if (fixedInterruptActive()) return false;
	if (m_pendingMemory.kind != PendingMemoryKind::None || m_stringComparison.remaining) return false;
	if ((m_runSignals & RunNonMaskableInterrupt) != 0u) {
		m_runSignals &= ~RunNonMaskableInterrupt;
		const bool hadHaltLatch = m_haltedUntilIrqFrameDepth >= 0;
		const u32 returnCauseWord = m_cop0Words[COP0_CAUSE];
		const u32 returnEpcWord = m_cop0Words[COP0_EPC];
		const u32 returnBadAddressWord = m_cop0Words[COP0_BAD_ADDRESS];
		const u32 returnLuaFaultReasonWord = m_cop0Words[COP0_LUA_FAULT_REASON];
		const u32 returnExceptionDomainWord = m_exceptionDomainWord;
		clearHaltAfterAcceptedInterrupt();
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
		clearHaltAfterAcceptedInterrupt();
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

void CPU::enterLuaFaultException(Value errorValue) {
	m_cop0Words[COP0_LUA_FAULT_REASON] = LUA_FAULT_REASON_EXPLICIT_ERROR;
	const std::array arguments{errorValue};
	enterException(*m_systemImage, m_cop0Words[COP0_SYSTEM_VECTOR], CPU_CAUSE_CODE_TRAP,
		m_currentInstructionPc, arguments);
}

void CPU::retireNumericLuaFault(u32 reason) {
	m_cop0Words[COP0_LUA_FAULT_REASON] = reason;
	if (resetBankSelected()) {
		enterSynchronousException(*m_activeThread->currentFrame, CPU_CAUSE_CODE_TRAP);
		return;
	}
	enterException(*m_systemImage, m_cop0Words[COP0_SYSTEM_VECTOR], CPU_CAUSE_CODE_TRAP, m_currentInstructionPc);
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
	const bool fixed = fixedInterruptActive();
	const u32 aliases = frame.readControl(FrameField::OpenHead);
	if (aliases != 0u) {
		if (!fixed && !resetBankSelected()) {
			const std::array arguments{valueInteger(0), valueInteger(0), valueInteger(static_cast<i32>(OpCode::RFE)),
				valueInteger(remainingDeviceCycles())};
			frame.writeControl(FrameField::Pc, m_currentInstructionPc);
			// The original exception is still active: do not push Status or
			// overwrite its latches before retiring the retained window.
			detachExceptionContext(CPU_INTERRUPT_STATE_WINDOW);
			placeExceptionVector(*m_systemImage, m_cop0Words[COP0_SYSTEM_VECTOR], false, m_currentInstructionPc, arguments, {});
			return;
		}
		instructionBudgetRemaining -= closeFixedWindow(frame, aliases);
	}
	if (fixed && !frame.previous && m_memory.readRamRecordWord(CPU_INTERRUPT_STATE_ADDRESS) == CPU_INTERRUPT_STATE_WINDOW) {
		m_activeThread->leaveFrame();
		resumeInterruptedContext();
	}
	const bool returnFromNmi = m_activeThread->currentFrame->hasControlFlag(FRAME_NMI);
	const u32 returnPc = m_cop0Words[COP0_EPC];
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
}

void CPU::executeSupervisorCall(CallFrame& frame, int source, int width) {
	if (static_cast<size_t>(source + std::max(1, width)) > frame.registers.size())
		throw LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	const Value token = frame.registers.get(source);
	const u32 successor = frame.readControl(FrameField::Pc);
	if (width == 0)
		enterException(*m_systemImage, m_cop0Words[COP0_SYSTEM_VECTOR], CPU_CAUSE_CODE_SYSCALL, successor, std::span{&token, 1u});
	else {
		const std::array arguments{token, valueInteger(source), valueInteger(width - 1)};
		enterException(*m_systemImage, m_cop0Words[COP0_SYSTEM_VECTOR], CPU_CAUSE_CODE_SYSCALL, successor, arguments);
	}
}

bool CPU::executeWindowTransfer(CallFrame& frame, u16 a, u16 b, RegisterJumpMode mode) {
	auto& thread = *frame.thread;
	if (mode == RegisterJumpMode::EnterWindow) {
		const auto& registers = frame.registers;
		if (!registers.containsRange(a, 1)) {
			enterSynchronousException(frame, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
			return false;
		}
		const u32 target = registers.payload(a);
		if ((target & (INSTRUCTION_BYTES - 1u)) != 0u) {
			enterSynchronousAddressException(frame, CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD, target);
			return false;
		}
		if (!registers.containsRange(b, 3)) {
			enterSynchronousException(frame, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
			return false;
		}
		const u32 offset = registers.payload(b);
		const u32 width = registers.payload(b + 1);
		const u32 top = registers.payload(b + 2);
		const auto capacity = registers.size();
		if (offset > capacity || width > capacity - offset || top > width) {
			enterSynchronousException(frame, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
			return false;
		}
		const u32 base = frame.stackBase() + offset;
		const u32 end = base + width;
		if (!thread.frameSpaceFits(end)) {
			if (resetBankSelected()) enterSynchronousException(frame, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
			else enterRegisterWindowException(frame, end, static_cast<u32>(thread.frameDepth()) + 2u, OpCode::JREG, a);
			return false;
		}
		auto* child = thread.acquireFrame();
		child->executionImage = frame.executionImage;
		child->initializeWindow(target, m_currentInstructionPc, m_activeExecutionDomainId, base, width, top);
		thread.setStackTop(static_cast<i32>(end));
		thread.enterFrame(child);
		return true;
	}
	CallFrame* const parent = frame.previous;
	if (parent == nullptr || frame.hasControlFlag(FRAME_EXCEPTION)
		|| (mode == RegisterJumpMode::LeaveWindowFromRegister && b >= frame.registers.size())) {
		enterSynchronousException(frame, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
		return false;
	}
	const u32 frontier = mode == RegisterJumpMode::LeaveWindowFromRegister ? frame.registers.payload(b) : b;
	const u32 top = static_cast<u32>(frame.stackBase()) + frontier - static_cast<u32>(parent->stackBase());
	if (frontier > frame.registers.size() || top > parent->registers.size()) {
		enterSynchronousException(frame, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
		return false;
	}
	thread.leaveFrame();
	parent->setTop(static_cast<i32>(top));
	resumeFrameBank();
	return true;
}

void CPU::enterReferenceStore(CallFrame& issuer, u32 payloadAddress, Value value, u32 tagAddress) {
	m_cop0Words[COP0_BAD_ADDRESS] = payloadAddress;
	const std::array arguments{value, valueInteger(static_cast<i32>(tagAddress))};
	enterException(*m_systemImage, m_cop0Words[COP0_SYSTEM_VECTOR], CPU_CAUSE_CODE_REFERENCE_STORE,
		issuer.readControl(FrameField::Pc), std::span{arguments}.first(tagAddress == 0u ? 1u : 2u));
}

void CPU::enterGlobalReferenceStore(CallFrame& issuer, const ValueSpan& bank, u32 slot, Value value) {
	const u32 word = (bank.wordAddress() + slot * sizeof(u32)) & RAM_RECORD_WORD_MASK;
	const u32 tag = (bank.tagAddress() + slot) & (MAIN_RAM_SIZE - 1u);
	enterReferenceStore(issuer, RAM_BASE + word, value, RAM_BASE + tag);
}

void CPU::enterRegisterWindowException(CallFrame& issuer, u32 valueEnd, u32 frameEnd, OpCode opcode, int a,
	std::optional<u32> continuation) {
	const u32 instruction = static_cast<u32>(opcode) | (static_cast<u32>(a) << 8u);
	const std::array arguments{
		valueInteger(static_cast<i32>(valueEnd)), valueInteger(static_cast<i32>(frameEnd)),
		valueInteger(static_cast<i32>(instruction)), valueInteger(remainingDeviceCycles()),
	};
	issuer.writeControl(FrameField::Pc, continuation.value_or(m_currentInstructionPc));
	enterException(*m_systemImage, m_cop0Words[COP0_SYSTEM_VECTOR], CPU_CAUSE_CODE_REGISTER_WINDOW,
		m_currentInstructionPc, arguments);
}

void CPU::requestRegisterWindow(u32 valueEnd, u32 frameEnd, u32 deadline) {
	const std::array arguments{valueInteger(static_cast<i32>(valueEnd)), valueInteger(static_cast<i32>(frameEnd)),
		valueNil(), valueInteger(static_cast<i32>(deadline))};
	enterException(*m_systemImage, m_cop0Words[COP0_SYSTEM_VECTOR], CPU_CAUSE_CODE_REGISTER_WINDOW,
		m_activeThread->currentFrame->readControl(FrameField::Pc), arguments);
}

CallFrame* CPU::enterException(
	Blua32ExecutionImage& vectorImage,
	u32 functionAddress,
	u32 causeWord,
	u32 epcWord,
	std::span<const Value> arguments,
	const BuiltinArgsView& suffix
) {
	latchExceptionEntry(causeWord, epcWord);
	if (fixedInterruptActive()) {
		// A second synchronous fault cannot enter another detached context.
		hardHalt();
		return nullptr;
	}
	if (&vectorImage == m_systemImage && !resetBankSelected()) detachExceptionContext(0u);
	return placeExceptionVector(vectorImage, functionAddress, causeWord == CPU_CAUSE_NMI, epcWord, arguments, suffix);
}

void CPU::detachExceptionContext(u32 state) {
	m_memory.writeRamRecordPair(CPU_INTERRUPTED_CONTEXT_ADDRESS, m_activeThread->address, state);
	m_activeThread = &m_irqView;
	m_runSignals |= RunThreadSwitch | RunYield;
}

void CPU::latchExceptionEntry(u32 causeWord, u32 epcWord) {
	m_exceptionDomainWord = static_cast<u32>(m_activeExecutionDomainId);
	m_cop0Words[COP0_EPC] = epcWord;
	m_cop0Words[COP0_CAUSE] = causeWord;
	m_cop0Words[COP0_STATUS] = (m_cop0Words[COP0_STATUS] & ~CPU_STATUS_MODE_STACK_MASK)
		| ((m_cop0Words[COP0_STATUS] << 2u) & CPU_STATUS_MODE_STACK_MASK);
	m_runSignals &= ~RunYield;
}

CallFrame* CPU::placeExceptionVector(Blua32ExecutionImage& vectorImage, u32 functionAddress, bool nmi, u32 epcWord,
	std::span<const Value> arguments, const BuiltinArgsView& suffix) {
	if (!readFunctionRecordOnBus(vectorImage, functionAddress, executionBusSignalsForDomain(vectorImage.executionDomainId))) {
		hardHalt();
		return nullptr;
	}
	return enterLatchedExceptionFrame(nmi, epcWord, arguments, suffix);
}

CallFrame* CPU::enterLatchedExceptionFrame(bool nmi, u32 epcWord, std::span<const Value> arguments, const BuiltinArgsView& suffix) {
	try {
		return enterDirectFrame(FRAME_EXCEPTION | (nmi ? FRAME_NMI : 0u), epcWord, arguments, suffix);
	} catch (const LuaOutOfMemorySignal&) {
		// Failure to admit an exception vector cannot recursively trap.
		hardHalt();
		return nullptr;
	}
}

CallFrame* CPU::enterDirectFrame(u32 flags, std::optional<u32> epcWord, std::span<const Value> arguments, const BuiltinArgsView& suffix) {
	// Direct machine entry binds the sampled Function and no capture environment.
	const auto& record = m_functionRecordLatch;
	const auto argc = static_cast<u32>(arguments.size() + suffix.size());
	const FunctionEntry entry{record.codeAddress, record.numParams, std::max(record.maxStack, argc), record.flags};
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
	frame->initializeControl({
		address, entry.codeAddress, epcWord.value_or(entry.codeAddress), frameBankWord(domain) | flags,
		placement.varargBase, static_cast<int>(argc), {}, std::max(placement.top(), static_cast<int>(argc)),
		0u, placement.stackBase, static_cast<int>(placement.capacity),
	});
	// A detached register-window exception may take its Value suffix from
	// the same physical fixed stack. Move that range before writing R0...
	if (!suffix.empty()) suffix.placeInto(frame->registers, arguments.size(), suffix.size(), 0);
	const auto initialized = static_cast<u32>(exception ? std::max(1, placement.top()) : placement.top());
	if (argc < initialized) frame->registers.clear(argc, initialized - argc);
	for (size_t index = 0; index < arguments.size(); ++index) frame->registers.set(index, arguments[index]);
	m_activeThread->setStackTop(static_cast<int>(placement.stackEnd()));
	m_activeThread->enterFrame(frame);
	latchActiveExecutionImage(domain, image);
	return frame;
}

void CPU::clearHaltAfterAcceptedInterrupt() {
	m_haltedUntilIrqFrameDepth = -1;
	m_haltedUntilIrqThreadAddress = 0u;
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

template <bool RootBoundary, bool Instrumented>
RunResult CPU::runLoop(
	int targetDepth,
	int instructionBudget
) {
	instructionBudgetRemaining = instructionBudget;
	Thread& thread = *m_activeThread;
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
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
	const NativeBlock* nativeBlock = nullptr;
	int nativeFirstDispatchCycles = 0;
	NativeCpuRunState nativeState(*this, targetDepth);
#define OBSERVE_SCALAR_ARITHMETIC(left, right) do { \
	if constexpr (!Instrumented) { \
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
			auto admission = admitGrant(thread, RootBoundary ? 0 : targetDepth, instructionBudgetRemaining);
			if (admission == GrantAdmission::Admitted && m_pendingMemory.kind != PendingMemoryKind::None) {
				resumePendingMemoryOperation();
				admission = admitGrant(thread, RootBoundary ? 0 : targetDepth, instructionBudgetRemaining);
			}
			if (admission == GrantAdmission::Admitted && m_stringComparison.remaining) {
				advanceStringComparison(*thread.currentFrame);
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
			frame = thread.currentFrame;
			image = frame->executionImage;
			if (image && image != m_activeExecutionImage) latchActiveExecutionImage(image->executionDomainId, image);

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
					if (&thread != m_activeThread) {
						m_runSignals |= RunThreadSwitch;
						return RunResult::Yielded;
					}
					continue;
				}
			} else {
				if (canInterrupt && ((m_runSignals & RunNonMaskableInterrupt) != 0u || canAcceptMaskableInterruptLine())) {
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
					// The next instruction belongs to the interrupt handler; retry admission
					// for the suspended instruction after RFE instead.
					nativeState.replay.reset();
					nativeState.hotSidePc.reset();
#endif
					enterPendingInterrupt();
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
			if (!image || (resetBankSelected() && pc >= SYSTEM_ROM_BASE + SYSTEM_ROM_SIZE)) {
				m_cop0Words[COP0_BAD_ADDRESS] = pc;
				enterInstructionFetchException(*frame, CPU_CAUSE_CODE_INSTRUCTION_BUS_ERROR, pc);
				continue;
			}
			if constexpr (!Instrumented) publishedTop = registerTop = frame->readWindow(FrameField::Top);
			pageAddress = pc & ~MAPPED_PAGE_BYTE_MASK;
			decodedPage = &decodedPageForFrame(*frame, pc);
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
dispatch_bound_page:
			if constexpr (!Instrumented) {
				if (nativeState.hotSidePc) {
					const bool atTarget = *nativeState.hotSidePc == pc;
					nativeState.hotSidePc.reset();
					const u32 word = (pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
					if (atTarget && !decodedPage->refreshState[word]
						&& isNativeWarmDispatch(decodedPage->words[word].dispatchOp))
						prepareNativeBlock(*frame, *decodedPage, pc, m_executionBusSignals);
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
				if (!decodeInstruction(*frame, *decodedPage, pageOffset, pc, !Instrumented)) continue;
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
	skipNextInstruction(FRAME); \
	DISPATCH_CONTINUE(); \
} while (0)
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
// On fallthrough the comparison owns the paired JMP. A separate incoming
// edge to that same PC still requests an independent native entry.
#define COMPARISON_FALLTHROUGH() do { \
	if constexpr (!Instrumented) { \
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
							prepareNativeBlock(FRAME, *decodedPage, pc, m_executionBusSignals);
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
			FRAME.compilationEntry = rewritten || nativeBlockEndsBlock(decoded->op, decoded->b);
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
			retireNumericLuaFault(LUA_FAULT_REASON_OUT_OF_MEMORY);
		} catch (const LuaThrownValueError& error) {
			PUBLISH_SCALAR_FRONTIER();
				enterLuaFaultException(error.value);
		} catch (const LuaExecutionError& error) {
			PUBLISH_SCALAR_FRONTIER();
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
		&& !cpu.m_stringComparison.remaining && cpu.m_pendingMemory.kind == PendingMemoryKind::None
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
	if (fixedInterruptActive() || m_stringComparison.remaining) throw BMSX_RUNTIME_ERROR("Pending CPU work must retire before replacing code execution.");
	if (m_unpublishedRomMask != 0u) throw BMSX_RUNTIME_ERROR("Installed ROM must be published before CPU execution.");
	auto* image = m_executionImagesByDomain[static_cast<size_t>(executionDomainId + 1)].get();
	if (!image || !image->admitsFunctionPc(functionAddress, pc))
		throw BMSX_RUNTIME_ERROR("Frame execution must enter an instruction of its published function.");
	auto& thread = *m_activeThread;
	auto& frame = *thread.frameAtDepth(static_cast<size_t>(frameIndex));
	const u32 closure = frame.closureAddress(), captures = frame.captureCount();
	const ClosureRecord::BindingFlags binding{
		closure != 0u ? m_memory.readRamRecordByte(closure + CLOSURE_BINDING_FLAGS) : u8{0},
	};
	const bool sameBinding = closure != 0u && binding.domain() == executionDomainId
		&& m_memory.readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS) == functionAddress;
	if (captures != 0u && !sameBinding)
		throw BMSX_RUNTIME_ERROR("Frame execution does not preserve its capture binding.");

	const auto& directory = image->romFunctions;
	const auto* published = directory.mappedCode ? nullptr : directory.find(functionAddress);
	FunctionEntry entry;
	u32 upvalueCount;
	if (sameBinding && binding.latched()) {
		const auto sampled = ClosureRecord::readBinding(m_memory, closure, binding, directory);
		entry = sampled.entry;
		upvalueCount = sampled.recordUpvalueCount;
	} else if (published) {
		entry = published->entry;
		upvalueCount = published->upvalueCount;
	} else {
		Span<const u8> bytes;
		if ((!directory.mappedCode && (functionAddress - SYSTEM_ROM_BASE < SYSTEM_ROM_SIZE || functionAddress - CART_ROM_BASE < CART_ROM_SIZE))
			|| !m_memory.bindMappedReadView(functionAddress, BLUA32_FUNCTION_RECORD_SIZE, executionBusSignalsForDomain(executionDomainId), bytes))
			throw BMSX_RUNTIME_ERROR("Frame execution must enter an instruction of its published function.");
		entry = FunctionEntry::fromRom(bytes.data());
		if (!image->admitsFunctionPc(functionAddress, entry.codeAddress))
			throw BMSX_RUNTIME_ERROR("Frame execution must enter an instruction of its published function.");
		upvalueCount = readLE32(bytes.data() + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET);
	}
	if (captures != upvalueCount) throw BMSX_RUNTIME_ERROR("Frame execution does not preserve its capture binding.");

	const u32 width = entry.registerCapacity();
	const size_t current = frame.stackCapacity();
	if (width > MAX_THREAD_VALUE_SLOTS) throw BMSX_RUNTIME_ERROR("Frame execution exceeds the admitted register window.");
	int capacity = 0;
	if (width > current) {
		const size_t base = frame.stackBase();
		const size_t first = base + current;
		const size_t bucket = registerWindowBucket(width), end = base + bucket;
		if (end > thread.stackCapacity) throw BMSX_RUNTIME_ERROR("Frame execution exceeds the admitted register window.");
		// Existing CALL windows can overlap; only the newly claimed tail
		// must be disjoint from every other live window.
		for (auto* live = thread.currentFrame; live; live = live->previous) {
			if (live == &frame) continue;
			const size_t liveBase = live->stackBase();
			const size_t liveFirst = std::min(liveBase, static_cast<size_t>(live->readWindow(FrameField::VarargBase)));
			const size_t liveEnd = liveBase + live->stackCapacity();
			if (first < liveEnd && liveFirst < end) throw BMSX_RUNTIME_ERROR("Frame execution exceeds the admitted register window.");
		}
		capacity = static_cast<int>(bucket);
	}
	if (&frame == thread.currentFrame) abortStalledMemoryWrite();
	if (capacity != 0) frame.growRegisterWindow(capacity);
	frame.writeControl(FrameField::Function, functionAddress);
	frame.executionImage = image;
	frame.saveExecutionBank(executionDomainId);
	if (&frame == thread.currentFrame) latchActiveExecutionImage(executionDomainId, image);
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

int CPU::closeFixedWindow(CallFrame& frame, u32 address) {
	int closed = 0;
	while (address != 0 && closed < static_cast<int>(UPVALUE_CHAIN_LIMIT)) {
		const u32 cell = address & RAM_REFERENCE_MASK;
		if (m_memory.readRamRecordByte(cell) != UPVALUE_RECORD_KIND || !Upvalue::isOpen(m_memory, cell)) break;
		address = m_memory.readRamRecordWord(cell + UPVALUE_NEXT);
		Upvalue::close(m_memory, cell);
		++closed;
	}
	frame.writeControl(FrameField::OpenHead, 0u);
	return closed;
}

CPU::FunctionActivation CPU::resolveFunctionActivation(u32 closure, u32 codeFunction) {
	if (closure == 0u) {
		const auto domain = codeFunctionDomain(codeFunction);
		auto* image = domain == SYSTEM_EXECUTION_DOMAIN_ID ? m_systemImage : executionImageForDomain(domain);
		const auto address = codeFunctionAddress(codeFunction);
		return {image, {address, image->bindRomFunction(m_memory, address)->entry}};
	}
	const ClosureRecord::BindingFlags binding{m_memory.readRamRecordByte(closure + CLOSURE_BINDING_FLAGS)};
	return resolveClosureActivation(*executionImageForDomain(binding.domain()), closure, binding);
}

CPU::FunctionActivation CPU::resolveClosureActivation(Blua32ExecutionImage& image, u32 closure, ClosureRecord::BindingFlags binding) {
	const u32 prototype = m_memory.readRamRecordWord(closure + CLOSURE_PROTOTYPE_ADDRESS);
	if (binding.latched()) return {&image, {prototype, ClosureRecord::readLatchedEntry(m_memory, closure)}};
	const auto* rom = image.bindRomFunction(m_memory, prototype);
	// No ROM driver: the sampled entry words are zero.
	return {&image, {prototype, rom ? rom->entry : FunctionEntry{}}};
}

CallFrame* CPU::pushFrame(CallFrame& caller, u32 closure, int argBase, int argCount,
	CallResultPlacement result, u32 callSitePc, u32 codeFunction) {
	const auto [image, functionRecord] = resolveFunctionActivation(closure, codeFunction);
	const int argumentBase = caller.stackBase() + argBase;
	const auto admitted = ArgumentPlacement::forEntry(argumentBase, argCount, functionRecord.entry);
	if (!admitted) throw LuaOutOfMemorySignal{};
	const auto& placement = *admitted;
	const FrameEntryControl entry{
		functionRecord.functionAddress, functionRecord.entry.codeAddress, callSitePc,
		frameBankWord(image->executionDomainId),
		placement.varargBase, argCount, result, placement.top(),
		closure, placement.stackBase, static_cast<int>(placement.capacity),
	};
	auto& thread = *m_activeThread;
	const size_t end = placement.stackEnd();
	if (!thread.frameSpaceFits(end)) {
		if (resetBankSelected()) throw LuaOutOfMemorySignal{};
		enterRegisterWindowException(caller, static_cast<u32>(end), static_cast<u32>(thread.frameDepth()) + 2u, OpCode::CALL, argBase - 1);
		return nullptr;
	}
	auto* frame = thread.acquireFrame();
	frame->executionImage = image;
	frame->initializeControl(entry);
	const auto [copied, padded] = placement.formals;
	placeSharedFormals(*frame, argumentBase, copied, padded, placement.relocatesFormals);
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

CallFrame* CPU::pushDetachedFrame(FunctionActivation activation, u32 closure, BuiltinArgsView args,
	CallResultPlacement result, std::optional<u32> callSitePc) {
	const auto& [image, functionRecord] = activation;
	const size_t argCount = args.size();
	auto& thread = *m_activeThread;
	int argumentBase = thread.stackTop();
	if (!callSitePc) {
		if (argCount > MAX_THREAD_VALUE_SLOTS)
			throw BMSX_RUNTIME_ERROR("External call exceeds the admitted register window.");
		// A debugger call must not overlay any suspended register window.
		for (auto* frame = thread.currentFrame; frame; frame = frame->previous)
			argumentBase = std::max(argumentBase, frame->stackBase() + frame->stackCapacity());
	}
	const auto admitted = ArgumentPlacement::forEntry(argumentBase, static_cast<int>(argCount), functionRecord.entry);
	const u32 bank = frameBankWord(image->executionDomainId);
	if (!admitted || !thread.frameSpaceFits(admitted->stackEnd())) {
		if (!callSitePc) throw BMSX_RUNTIME_ERROR("External call exceeds the admitted register window.");
		if (!admitted || resetBankSelected()) throw LuaOutOfMemorySignal{};
		// This instruction has already resolved the callable and consumed
		// the lookup. Its successor stays in the caller's physical frame.
		const auto& placement = *admitted;
		constexpr size_t firstArgument = 12u;
		std::array<Value, firstArgument + 3u> operands{
			valueInteger(static_cast<i32>(placement.stackEnd())),
			valueInteger(static_cast<i32>(thread.frameDepth()) + 2),
			valueInteger(0), valueInteger(remainingDeviceCycles()),
			valueInteger(static_cast<i32>(functionRecord.functionAddress)), valueInteger(static_cast<i32>(functionRecord.entry.codeAddress)),
			valueInteger(static_cast<i32>(closure)),
			valueInteger(static_cast<i32>(bank | (result.extendsTop() ? FRAME_EXTEND_RESULT_TOP : 0u))),
			valueInteger(placement.top()), valueInteger(placement.stackBase),
			valueInteger(result.base), valueInteger(static_cast<i32>(result.countWord())),
		};
		for (size_t slot = 0; slot < argCount; ++slot) operands[firstArgument + slot] = args[slot];
		enterException(*m_systemImage, m_cop0Words[COP0_SYSTEM_VECTOR], CPU_CAUSE_CODE_REGISTER_WINDOW,
			m_currentInstructionPc, {operands.data(), firstArgument + argCount});
		return nullptr;
	}
	const auto& placement = *admitted;
	const FrameEntryControl entry{
		functionRecord.functionAddress, functionRecord.entry.codeAddress, callSitePc.value_or(functionRecord.entry.codeAddress),
		bank | (callSitePc ? 0u : FRAME_COMPLETION),
		placement.varargBase, static_cast<int>(argCount), result, placement.top(),
		closure, placement.stackBase, static_cast<int>(placement.capacity),
	};
	auto* frame = thread.acquireFrame();
	frame->executionImage = image;
	frame->initializeControl(entry);
	const auto [copied, padded] = placement.formals;
	args.placeInto(frame->registers, 0, copied, padded);
	if (placement.varargCount != 0)
		args.tailFrom(placement.top()).placeInto(thread.stack, placement.varargBase, placement.varargCount, 0);
	if (callSitePc) {
		instructionBudgetRemaining -= placement.cycles(false);
	} else {
		// Input can borrow the previous completion Values. The new frame
		// already owns its operands before the result latch is cleared.
		abortStalledMemoryWrite();
		m_completionValues.clear(0, m_completionValueCount); m_completionValueCount = 0;
		m_completionThreadAddress = thread.address;
		m_runSignals &= ~RunYield;
	}
	thread.setStackTop(static_cast<int>(placement.stackEnd()));
	thread.enterFrame(frame);
	latchActiveExecutionImage(image->executionDomainId, frame->executionImage);
	return frame;
}

void CPU::writeReturnValues(CallFrame& frame, CallResultPlacement result, BuiltinArgsView values) {
	const int base = result.base;
	const int valueCount = static_cast<int>(values.size());
	const auto placement = ValuePlacement::fit(valueCount, result.selected(valueCount));
	const int count = placement.count();
	const int end = base + count;
	if (count != 0) {
		if (end > frame.stackCapacity()) {
			const auto capacity = registerWindowBucket(static_cast<size_t>(end));
			const auto extent = static_cast<size_t>(frame.stackBase()) + capacity;
			if (extent > frame.thread->stackCapacity) {
				if (resetBankSelected()) throw LuaOutOfMemorySignal{};
				// The instruction has already completed. The vector owns
				// the otherwise unplaced Values and the caller's next PC.
				const std::array operands{
					valueInteger(static_cast<i32>(extent)),
					valueInteger(result.topAfter(frame.readWindow(FrameField::Top), count)),
					valueInteger(-1), valueInteger(remainingDeviceCycles()),
					valueInteger(base), valueInteger(count),
				};
				enterException(*m_systemImage, m_cop0Words[COP0_SYSTEM_VECTOR], CPU_CAUSE_CODE_REGISTER_WINDOW,
					m_currentInstructionPc, operands, values);
				return;
			}
			frame.growRegisterWindow(static_cast<int>(capacity));
		}
		values.placeInto(frame.registers, base, placement.copied, placement.padded);
	}
	frame.placeResultTop(result, count);
	instructionBudgetRemaining -= count;
}

BuiltinResultsScratchScope CPU::acquireBuiltinResultScratch() {
	BuiltinResults& out = m_builtinResultScratch.get(m_builtinResultScratchIndex);
	m_builtinResultScratchIndex += 1;
	return BuiltinResultsScratchScope(*this, out);
}

// end repeated-sequence-acceptable

} // namespace bmsx
