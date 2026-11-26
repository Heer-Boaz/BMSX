// A pinned activation bank for the link-verified system routines that cannot
// enter the managed allocator. RAM owns their depth, windows and result.
static_assert(HEAP_SERVICE_THREAD_OFFSET + THREAD_HEAP_BYTES <= HEAP_SERVICE_RESULT_OFFSET);
static_assert(HEAP_SERVICE_RESULT_OFFSET + sizeof(u32) <= HEAP_SERVICE_FRAME_OFFSET);
static_assert(HEAP_SERVICE_FRAME_OFFSET + HEAP_SERVICE_FRAME_COUNT * FRAME_CONTROL_BYTES <= HEAP_SERVICE_VALUE_OFFSET);
static_assert(HEAP_SERVICE_VALUE_OFFSET + HEAP_SERVICE_VALUE_COUNT * THREAD_STACK_SLOT_BYTES <= RUNTIME_MANAGEMENT_SIZE);
static_assert(HEAP_SERVICE_RECORD_OFFSET + static_cast<u32>(HeapServiceRecordField::DirectRecovery) + sizeof(u32) <= HEAP_SERVICE_GC_OFFSET);
static_assert(HEAP_SERVICE_ROOT_BANKS_OFFSET + HEAP_SERVICE_ROOT_BANKS_SIZE <= HEAP_SERVICE_REMARK_HEAD_OFFSET);
static_assert(HEAP_SERVICE_ROOT_PORT_BASE >= SYSTEM_ROM_BASE + SYSTEM_ROM_SIZE);
static_assert(HEAP_SERVICE_ROOT_PORT_BASE + HEAP_SERVICE_ROOT_PORT_BYTES <= RAM_BASE);
static_assert(MAX_THREAD_VALUE_SLOTS * sizeof(u32) <= HEAP_SERVICE_ROOT_PORT_STRIDE);
static_assert(HEAP_SERVICE_REMARK_HEAD_OFFSET + static_cast<u32>(HeapServiceRemarkHeadField::ValueWord) + sizeof(u32)
	<= HEAP_SERVICE_REMARK_FAULTS_OFFSET);
static_assert(HEAP_SERVICE_REMARK_FAULTS_OFFSET + (LUA_FAULT_REASON_INDEX_NAN + 1u) * sizeof(u32) <= HEAP_SERVICE_OBJECT_SWEEP_OFFSET);
static_assert(HEAP_SERVICE_OBJECT_SWEEP_OFFSET + static_cast<u32>(HeapServiceObjectSweepField::ProtectedCapacity) + sizeof(u32) <= HEAP_SERVICE_TRACE_QUANTUM_OFFSET);
static_assert(HEAP_SERVICE_TRACE_QUANTUM_OFFSET + static_cast<u32>(HeapServiceTraceField::MirrorPolicy) + sizeof(u32) <= HEAP_SERVICE_THREAD_OFFSET);
static_assert(HEAP_SERVICE_GC_OFFSET + static_cast<u32>(HeapServiceGcField::QuantumLimit) + sizeof(u32) <= HEAP_SERVICE_RECORD_CONTROL_OFFSET);
static_assert(HEAP_SERVICE_RECORD_CONTROL_OFFSET + static_cast<u32>(HeapServiceRecordControlField::Kind) + sizeof(u32) <= HEAP_SERVICE_TABLE_GROWTH_OFFSET);
static_assert(HEAP_SERVICE_TABLE_GROWTH_OFFSET + static_cast<u32>(HeapServiceTableGrowthField::Immediate) + sizeof(u32) <= HEAP_SERVICE_VALUE_OFFSET);
static_assert(HEAP_SERVICE_TRACE_QUANTUM_OFFSET + static_cast<u32>(HeapServiceTraceField::MirrorPolicy) + sizeof(u32) <= HEAP_SERVICE_TABLE_GROWTH_RESULT_OFFSET);
static_assert(HEAP_SERVICE_TABLE_GROWTH_RESULT_OFFSET + static_cast<u32>(HeapServiceTableGrowthResultField::ArrayStorage) + sizeof(u32)
	== HEAP_SERVICE_TABLE_RESIZE_CONTEXT_OFFSET);
static_assert(HEAP_SERVICE_TABLE_RESIZE_CONTEXT_OFFSET + static_cast<u32>(HeapServiceTableResizeContextField::HashBytes) + sizeof(u32)
	== HEAP_SERVICE_GC_PROJECTION_OFFSET);
static_assert(HEAP_SERVICE_GC_PROJECTION_OFFSET + sizeof(u32) <= HEAP_SERVICE_GC_ARGUMENTS_OFFSET);
static_assert(HEAP_SERVICE_GC_ARGUMENTS_OFFSET + static_cast<u32>(HeapServiceGcArgumentField::PendingTop) + sizeof(u32)
	<= HEAP_SERVICE_THREAD_OFFSET);

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
	if ((kind != MemoryAccessKind::U8 && kind != MemoryAccessKind::Word && kind != MemoryAccessKind::U32LE)
		|| (kind != MemoryAccessKind::U8 && (address & 3u) != 0u))
		throw BMSX_RUNTIME_ERROR("Heap service access requires an aligned byte or word.");
}

void CPU::executeHeapServiceLoad(CallFrame& frame, int destination, MemoryAccessKind kind, u32 address) {
	admitHeapServiceAccess(kind, address);
	u32 word;
	if (address - RAM_BASE < m_memory.ramByteCount()) {
		// Raw records may project into the bus-visible part or beneath MMIO.
		word = kind == MemoryAccessKind::U8 ? m_memory.readRamRecordByte(address) : m_memory.readRamRecordWord(address);
	} else if (address - HEAP_SERVICE_ROOT_PORT_BASE < HEAP_SERVICE_ROOT_PORT_BYTES) {
		word = readHeapServiceRoot(address - HEAP_SERVICE_ROOT_PORT_BASE, kind);
	} else {
		const u32 slot = address >> BLUA32_STRING_ROM_SOCKET_SHIFT;
		const u32 busAddress = address & BLUA32_STRING_ROM_ADDRESS_MASK;
		Span<const u8> view;
		if ((slot != 0u && busAddress < CART_ROM_BASE)
			|| !m_memory.bindRomByteView(busAddress, kind == MemoryAccessKind::U8 ? 1u : 4u, slot, view))
			throw BMSX_RUNTIME_ERROR("Heap service read is outside installed RAM and ROM.");
		word = kind == MemoryAccessKind::U8 ? view.data()[0] : readLE32(view.data());
	}
	frame.registers.set(destination, valueInteger(static_cast<i32>(word)));
	frame.extendTop(destination + 1);
}

void CPU::executeHeapServiceStore(CallFrame& frame, int source, MemoryAccessKind kind, u32 address) {
	admitHeapServiceAccess(kind, address);
	const u32 management = RAM_BASE + m_heapAllocator.managementOffset();
	const u32 end = management + HEAP_SERVICE_THREAD_OFFSET;
	if (address < m_memory.ramBusEnd() || address >= end)
		throw BMSX_RUNTIME_ERROR("Heap service write is outside its private RAM port.");
	const u32 word = wordOperand(frame.registers.get(source));
	if (address - (management + HEAP_SERVICE_GC_PROJECTION_OFFSET) < sizeof(u32)) {
		if (kind == MemoryAccessKind::U8) throw BMSX_RUNTIME_ERROR("Heap projection requires a word store.");
		writeHeapServiceProjection(word);
		return;
	}
	if (kind == MemoryAccessKind::U8) m_memory.writeRamRecordByte(address, static_cast<u8>(word));
	else m_memory.writeRamRecordWord(address, word);
}

void CPU::writeHeapServiceProjection(u32 word) {
	using Projection = HeapServiceProjection;
	if (word == static_cast<u32>(Projection::PublishRoots)) {
		publishHeapRemarkHead();
		publishHeapRootBanks();
		const u32 management = m_heapAllocator.managementOffset();
		const u32 trace = management + HEAP_SERVICE_TRACE_QUANTUM_OFFSET;
		m_memory.writeRamRecordWord(trace + static_cast<u32>(HeapServiceTraceField::PendingStringWork), static_cast<u32>(m_stringPool.takeMarkWork()));
		const u32 args = management + HEAP_SERVICE_GC_ARGUMENTS_OFFSET;
		const u32 pendingTop = m_concat.registersLeft ? static_cast<u32>(m_concat.nextRegister + m_concat.registersLeft) : 0u;
		m_memory.writeRamRecordPair(args + static_cast<u32>(HeapServiceGcArgumentField::ModeKey), m_heap.modeKey, m_heap.newIndexKey);
		m_memory.writeRamRecordPair(args + static_cast<u32>(HeapServiceGcArgumentField::ActiveThread), m_activeThread->address, pendingTop);
		return;
	}
	if (word == static_cast<u32>(Projection::ReleaseStringWork)) {
		const u32 trace = m_heapAllocator.managementOffset() + HEAP_SERVICE_TRACE_QUANTUM_OFFSET;
		m_stringPool.resumeMarkWork(m_memory.readRamRecordWord(trace + static_cast<u32>(HeapServiceTraceField::PendingStringWork)));
		return;
	}
	const u32 record = word & ~HEAP_SERVICE_GC_PROJECTION_MASK;
	switch (static_cast<Projection>(word & HEAP_SERVICE_GC_PROJECTION_MASK)) {
		case Projection::RebindRelocatedThread: rebindRelocatedThread(record); return;
		case Projection::RetireCanonicalClosure: retireStaticClosure(record); return;
		case Projection::RetireThreadView: retireThreadView(record); return;
		case Projection::ObserveRetiredRecord: return; // No native record inspector.
		default: throw BMSX_RUNTIME_ERROR("Unknown heap projection store command.");
	}
}
