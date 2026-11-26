// A pinned activation bank for the link-verified system routines that cannot
// enter the managed allocator. RAM owns their depth, windows and result.
static_assert(HEAP_SERVICE_THREAD_OFFSET + THREAD_HEAP_BYTES <= HEAP_SERVICE_RESULT_OFFSET);
static_assert(HEAP_SERVICE_RESULT_OFFSET + sizeof(u32) <= HEAP_SERVICE_FRAME_OFFSET);
static_assert(HEAP_SERVICE_FRAME_OFFSET + HEAP_SERVICE_FRAME_COUNT * FRAME_CONTROL_BYTES <= HEAP_SERVICE_VALUE_OFFSET);
static_assert(HEAP_SERVICE_VALUE_OFFSET + HEAP_SERVICE_VALUE_COUNT * THREAD_STACK_SLOT_BYTES <= HEAP_SERVICE_NEWT_OFFSET);
static_assert(HEAP_SERVICE_NEWT_OFFSET + static_cast<u32>(HeapServiceNewtField::DirectRecovery) + sizeof(u32) <= HEAP_SERVICE_GC_OFFSET);
static_assert(HEAP_SERVICE_OBJECT_SWEEP_OFFSET + static_cast<u32>(HeapServiceObjectSweepField::ProtectedCapacity) + sizeof(u32) <= HEAP_SERVICE_THREAD_OFFSET);
static_assert(HEAP_SERVICE_GC_OFFSET + static_cast<u32>(HeapServiceGcField::QuantumLimit) + sizeof(u32) <= RUNTIME_MANAGEMENT_SIZE);

void CPU::initializeHeapService() {
	const u32 management = RAM_BASE + m_heapAllocator.managementOffset();
	const u32 thread = management + HEAP_SERVICE_THREAD_OFFSET;
	m_memory.writeRamRecordWord(thread + static_cast<u32>(ThreadField::StackBlock), management + HEAP_SERVICE_VALUE_OFFSET);
	m_memory.writeRamRecordWord(thread + static_cast<u32>(ThreadField::StackCapacity), HEAP_SERVICE_VALUE_COUNT);
	m_memory.writeRamRecordWord(thread + static_cast<u32>(ThreadField::FrameBlock), management + HEAP_SERVICE_FRAME_OFFSET);
	m_memory.writeRamRecordWord(thread + static_cast<u32>(ThreadField::FrameCapacity), HEAP_SERVICE_FRAME_COUNT);
	m_heapServiceView.select(thread);
	m_heapServiceView.bindStack();
	m_heapServiceView.reserveFixedFrameViews();
}

bool CPU::heapServiceActive() const {
	return m_heapServiceView.frameDepth() != 0;
}

u32 CPU::heapServiceResult() const {
	return m_memory.readRamRecordWord(RAM_BASE + m_heapAllocator.managementOffset() + HEAP_SERVICE_RESULT_OFFSET);
}

bool CPU::beginHeapService(u32 functionAddress, std::span<const u32> args) {
	if (heapServiceActive()) return false;
	CallFrame& frame = prepareHeapServiceFrame(functionAddress, 0, static_cast<int>(args.size()), {}, std::nullopt);
	const size_t copied = std::min(args.size(), static_cast<size_t>(frame.readWindow(FrameField::Top)));
	for (size_t index = 0; index < copied; ++index)
		frame.registers.set(index, valueInteger(static_cast<i32>(args[index])));
	m_memory.writeRamRecordWord(RAM_BASE + m_heapAllocator.managementOffset() + HEAP_SERVICE_RESULT_OFFSET, 0u);
	m_heapServiceView.enterFrame(&frame);
	return true;
}

CallFrame& CPU::prepareHeapServiceFrame(u32 functionAddress, int base, int supplied,
	CallResultPlacement result, std::optional<u32> callSite
) {
	auto& image = *m_systemImage;
	const auto* function = image.romFunctions.find(functionAddress);
	if (!function || function->upvalueCount != 0u
		|| (function->entry.flags & (BLUA32_FUNCTION_STATIC | BLUA32_FUNCTION_VARARG)) != BLUA32_FUNCTION_STATIC)
		throw BMSX_RUNTIME_ERROR("Heap service target is not a static system ROM function.");
	const auto placement = ArgumentPlacement::forEntry(base, supplied, function->entry);
	auto& thread = m_heapServiceView;
	if (!placement || placement->stackEnd() > HEAP_SERVICE_VALUE_COUNT || thread.frameDepth() == HEAP_SERVICE_FRAME_COUNT)
		throw BMSX_RUNTIME_ERROR("Heap service activation exceeds its fixed stack.");
	auto& frame = *thread.acquireFrame();
	frame.executionImage = &image;
	frame.initializeControl({
		functionAddress, function->entry.codeAddress, callSite.value_or(function->entry.codeAddress), frameBankWord(SYSTEM_EXECUTION_DOMAIN_ID),
		placement->varargBase, 0, result, placement->top(), 0u, base, static_cast<int>(placement->capacity),
	});
	frame.registers.clear(placement->formals.copied, placement->formals.padded);
	thread.setStackTop(static_cast<int>(placement->stackEnd()));
	return frame;
}

void CPU::executeHeapServiceCall(CallFrame& caller, int base, int supplied, int requested) {
	const auto record = static_cast<u32>(asInteger(caller.registers.get(base)));
	const auto result = CallResultPlacement::call(base, requested);
	auto& callee = prepareHeapServiceFrame(record, caller.stackBase() + base + 1, supplied, result,
		caller.readControl(FrameField::Pc) - INSTRUCTION_BYTES);
	instructionBudgetRemaining -= std::max(callee.readWindow(FrameField::Top) - supplied, 0);
	m_heapServiceView.enterFrame(&callee);
}

void CPU::executeHeapServiceReturn(CallFrame& frame, int base, int produced) {
	if (frame.previous) {
		auto& caller = *frame.previous;
		const auto result = CallResultPlacement::frame(frame.readWindow(FrameField::ReturnBase),
			frame.readWindow(FrameField::ReturnCount), frame.readControl(FrameField::Flags));
		const auto placement = ValuePlacement::fit(produced, result.selected(produced));
		caller.registers.copyFrom(frame.registers, result.base, base, placement.copied, placement.padded);
		caller.placeResultTop(result, placement.count());
		instructionBudgetRemaining -= placement.count();
	} else {
		const u32 result = produced == 0 ? 0u : valuePayload(frame.registers.get(base));
		m_memory.writeRamRecordWord(RAM_BASE + m_heapAllocator.managementOffset() + HEAP_SERVICE_RESULT_OFFSET, result);
		instructionBudgetRemaining -= produced;
	}
	m_heapServiceView.leaveFrame();
}

void CPU::admitHeapServiceAccess(MemoryAccessKind kind, u32 address) const {
	const u32 end = RAM_BASE + m_heapAllocator.managementOffset() + HEAP_SERVICE_THREAD_OFFSET;
	if (address < m_memory.ramBusEnd() || address >= end
		|| (kind != MemoryAccessKind::U8 && kind != MemoryAccessKind::Word && kind != MemoryAccessKind::U32LE)
		|| (kind != MemoryAccessKind::U8 && (address & 3u) != 0u))
		throw BMSX_RUNTIME_ERROR("Heap service access is outside its private RAM port.");
}

void CPU::executeHeapServiceLoad(CallFrame& frame, int destination, MemoryAccessKind kind, u32 address) {
	admitHeapServiceAccess(kind, address);
	const u32 word = kind == MemoryAccessKind::U8 ? m_memory.readRamRecordByte(address) : m_memory.readRamRecordWord(address);
	frame.registers.set(destination, valueInteger(static_cast<i32>(word)));
	frame.extendTop(destination + 1);
}

void CPU::executeHeapServiceStore(CallFrame& frame, int source, MemoryAccessKind kind, u32 address) {
	admitHeapServiceAccess(kind, address);
	const u32 word = wordOperand(frame.registers.get(source));
	if (kind == MemoryAccessKind::U8) m_memory.writeRamRecordByte(address, static_cast<u8>(word));
	else m_memory.writeRamRecordWord(address, word);
}
