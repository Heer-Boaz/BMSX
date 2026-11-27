// A pinned activation bank for the link-verified system routines that cannot
// enter the managed allocator. RAM owns their depth, windows and result.
static_assert(HEAP_SERVICE_THREAD_OFFSET + THREAD_HEAP_BYTES <= HEAP_SERVICE_RESULT_OFFSET);
static_assert(HEAP_SERVICE_RESULT_OFFSET + sizeof(u32) <= HEAP_SERVICE_FRAME_OFFSET);
static_assert(HEAP_SERVICE_FRAME_OFFSET + HEAP_SERVICE_FRAME_COUNT * FRAME_CONTROL_BYTES <= HEAP_SERVICE_CLOSURE_OFFSET);
static_assert(HEAP_SERVICE_VALUE_OFFSET + HEAP_SERVICE_VALUE_COUNT * THREAD_STACK_SLOT_BYTES <= HEAP_SERVICE_PREPARED_FRAME_OFFSET);
static_assert(static_cast<u32>(PreparedFrameField::SourceSlot) == FRAME_CONTROL_BYTES);
static_assert(HEAP_SERVICE_PREPARED_FRAME_OFFSET + static_cast<u32>(PreparedFrameField::End) <= HEAP_SERVICE_FIRMWARE_DATA_OFFSET);
static_assert(HEAP_SERVICE_FIRMWARE_DATA_OFFSET < RUNTIME_MANAGEMENT_SIZE);
static_assert(HEAP_SERVICE_CLOSURE_OFFSET + static_cast<u32>(HeapServiceClosureField::NextPc) + sizeof(u32) <= HEAP_SERVICE_BIOS_CALL_OFFSET);
static_assert(HEAP_SERVICE_ROOT_BANKS_OFFSET + HEAP_SERVICE_ROOT_BANKS_SIZE <= HEAP_SERVICE_REMARK_HEAD_OFFSET);
static_assert(HEAP_SERVICE_ROOT_PORT_BASE >= SYSTEM_ROM_BASE + SYSTEM_ROM_SIZE);
static_assert(HEAP_SERVICE_CALL_FAULT_ADDRESS + sizeof(u32) <= RAM_BASE);
static_assert(MAX_THREAD_VALUE_SLOTS * sizeof(u32) <= HEAP_SERVICE_ROOT_PORT_STRIDE);
static_assert(HEAP_SERVICE_REMARK_HEAD_OFFSET + static_cast<u32>(HeapServiceRemarkHeadField::ValueWord) + sizeof(u32)
	<= HEAP_SERVICE_REMARK_FAULTS_OFFSET);
static_assert(HEAP_SERVICE_REMARK_FAULTS_OFFSET + (LUA_FAULT_REASON_INDEX_NAN + 1u) * sizeof(u32) <= HEAP_SERVICE_TRACE_QUANTUM_OFFSET);
static_assert(HEAP_SERVICE_TRACE_QUANTUM_OFFSET + static_cast<u32>(HeapServiceTraceField::MirrorPolicy) + sizeof(u32) <= HEAP_SERVICE_THREAD_OFFSET);
static_assert(HEAP_SERVICE_BIOS_CALL_OFFSET + static_cast<u32>(HeapServiceBiosCallField::ResultWord) + sizeof(u32)
	<= HEAP_SERVICE_RESIDENT_OFFSET);
static_assert(HEAP_SERVICE_RESIDENT_OFFSET + static_cast<u32>(HeapServiceResidentField::RunKind) + sizeof(u32)
	<= HEAP_SERVICE_VALUE_OFFSET);
static_assert(static_cast<u32>(CpuRunKind::Direct) == 1 && static_cast<u32>(CpuRunKind::Scheduled) == 2);
static_assert(HEAP_SERVICE_TRACE_QUANTUM_OFFSET + static_cast<u32>(HeapServiceTraceField::MirrorPolicy) + sizeof(u32) <= HEAP_SERVICE_GC_PROJECTION_OFFSET);
static_assert(HEAP_SERVICE_GC_PROJECTION_OFFSET + sizeof(u32) <= HEAP_SERVICE_CAPTURE_BINDING_OFFSET);
static_assert(HEAP_SERVICE_CAPTURE_BINDING_OFFSET + 9 * sizeof(u32) <= HEAP_SERVICE_CAPTURE_BUS_OFFSET);
static_assert(HEAP_SERVICE_CAPTURE_BUS_OFFSET + sizeof(u32) <= HEAP_SERVICE_FIXED_WORK_OFFSET);
static_assert(HEAP_SERVICE_FIXED_WORK_OFFSET + sizeof(u32) <= HEAP_SERVICE_THREAD_OFFSET);
static_assert(HEAP_SERVICE_CAPTURE_DESCRIPTOR_PORT >= HEAP_SERVICE_CALL_FAULT_ADDRESS + sizeof(u32));

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

u32 CPU::queuedFixedWork() const {
	// Do not publish a partially committed table as a new input root.
	return resetBankSelected() || tableRebuild.record ? 0u : m_memory.readRamRecordWord(m_heapAllocator.managementOffset() + HEAP_SERVICE_FIXED_WORK_OFFSET);
}

bool CPU::admitFixedWork(CpuRunKind kind) {
	const u32 work = queuedFixedWork();
	if (work == 0u || allocationParked()) return false;
	const auto function = m_systemImage->heapServiceFunctions[work - 1u];
	const std::array args{m_heapAllocator.managementOffset(), static_cast<u32>(kind)};
	if (!beginHeapService(function, args)) return false;
	m_heapServiceView.firstFrame->writeControl(FrameField::Flags, FRAME_FIXED_WORK);
	return true;
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

void CPU::beginResidentCall(u32 address, BuiltinArgsView supplied, CallResultPlacement result, i32 protectedIndex) {
	const auto* record = m_systemImage->romFunctions.find(address);
	if (!record || (record->entry.flags & BLUA32_FUNCTION_RESIDENT) == 0u)
		throw LuaExecutionError(LUA_FAULT_REASON_CALL_NON_FUNCTION);
	const int copied = std::min(static_cast<int>(supplied.size()), static_cast<int>(record->entry.numParams));
	auto& callee = prepareHeapServiceFrame(address, 0, static_cast<int>(supplied.size()), result, m_currentInstructionPc);
	supplied.placeInto(callee.registers, 0, copied, 0);
	callee.writeControl(FrameField::Protected, static_cast<u32>(protectedIndex));
	instructionBudgetRemaining -= callee.readWindow(FrameField::Top);
	enterResidentFrame(callee);
}

void CPU::beginFrameSpaceAcquisition(u32 function, u32 valueEnd, u32 frameEnd, u32 root, u32 receiverFlags) {
	const std::array args{m_activeThread->address, valueEnd, frameEnd, root};
	auto& firmware = prepareHeapServiceFrame(function, 0, static_cast<int>(args.size()), {}, m_currentInstructionPc);
	for (size_t i = 0; i < args.size(); ++i) firmware.registers.set(i, valueInteger(static_cast<i32>(args[i])));
	enterResidentFrame(firmware, receiverFlags);
}

void CPU::enterClosedUpvalueStore(CallFrame& issuer, u32 cell, Value value) {
	const auto address = m_systemImage->heapServiceFunctions[static_cast<size_t>(HeapServiceOperation::StoreClosedUpvalue)];
	if (address == 0u) {
		enterSynchronousException(issuer, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
		return;
	}
	auto& frame = prepareHeapServiceFrame(address, 0, 2, CallResultPlacement::discard(), m_currentInstructionPc);
	frame.registers.set(0, valueInteger(static_cast<i32>(cell)));
	frame.registers.set(1, value);
	instructionBudgetRemaining -= frame.readWindow(FrameField::Top);
	enterResidentFrame(frame);
}

void CPU::enterResidentFrame(CallFrame& frame, u32 receiverFlags) {
	frame.addControlFlags(FRAME_RESIDENT_ACTIVATION | receiverFlags);
	const u32 context = m_heapAllocator.managementOffset() + HEAP_SERVICE_RESIDENT_OFFSET;
	m_memory.writeRamRecordPair(context, m_currentInstructionPc, lastPc);
	m_memory.writeRamRecordPair(context + static_cast<u32>(HeapServiceResidentField::SourceCycles),
		static_cast<u32>(remainingDeviceCycles()), static_cast<u32>(m_runKind));
	frame.thread->enterFrame(&frame);
	requestYield();
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
	} else if (frame.hasControlFlag(FRAME_RESIDENT_ACTIVATION)) {
		const u32 context = m_heapAllocator.managementOffset() + HEAP_SERVICE_RESIDENT_OFFSET;
		m_memory.writeRamRecordPair(context + static_cast<u32>(HeapServiceResidentField::SourceBase), base, produced);
	} else {
		const u32 management = m_heapAllocator.managementOffset();
		const u32 biosCall = management + HEAP_SERVICE_BIOS_CALL_OFFSET;
		if (m_memory.readRamRecordWord(biosCall + static_cast<u32>(HeapServiceBiosCallField::Kind)) != static_cast<u32>(HeapServiceBiosCallKind::Idle)) {
			m_memory.writeRamRecordWord(biosCall + static_cast<u32>(HeapServiceBiosCallField::Status), valuePayload(frame.registers.get(base)));
			m_memory.writeRamRecordPair(biosCall + static_cast<u32>(HeapServiceBiosCallField::Tag),
				valuePayload(frame.registers.get(base + 1)), valuePayload(frame.registers.get(base + 2)));
		} else {
			const u32 result = produced == 0 ? 0u : valuePayload(frame.registers.get(base));
			m_memory.writeRamRecordWord(management + HEAP_SERVICE_RESULT_OFFSET, result);
		}
		instructionBudgetRemaining -= produced;
	}
	m_heapServiceView.leaveFrame();
}

void CPU::finishResidentCall(u32 flags) {
	const u32 context = m_heapAllocator.managementOffset() + HEAP_SERVICE_RESIDENT_OFFSET;
	using Field = HeapServiceResidentField;
	m_currentInstructionPc = m_memory.readRamRecordWord(context + static_cast<u32>(Field::IssuePc));
	lastPc = m_memory.readRamRecordWord(context + static_cast<u32>(Field::LastPc));
	m_lastExecutionDomainId = m_activeExecutionDomainId;
	const u32 source = m_memory.readRamRecordWord(context + static_cast<u32>(Field::SourceBase));
	const u32 produced = m_memory.readRamRecordWord(context + static_cast<u32>(Field::SourceCount));
	if (produced == HEAP_SERVICE_RESULT_FAULT) throw LuaExecutionError(source);
	const int base = static_cast<int>(source), count = static_cast<int>(produced);
	const auto& frame = *m_heapServiceView.firstFrame;
	if ((flags & FRAME_RESIDENT_PREPARED_ENTRY) != 0u) {
		enterPreparedFrame();
		return;
	}
	if ((flags & FRAME_RESIDENT_PLACE_WINDOW) != 0u) {
		auto& current = *m_activeThread->currentFrame;
		const bool retire = (flags & FRAME_RESIDENT_RETIRE_WINDOW_SOURCE) != 0u;
		auto& window = retire ? *current.previous : current;
		const u32 prepared = m_heapAllocator.managementOffset() + HEAP_SERVICE_PREPARED_FRAME_OFFSET;
		using Window = PreparedWindowField;
		const auto read = [&](Window field) { return static_cast<i32>(m_memory.readRamRecordWord(prepared + static_cast<u32>(field))); };
		window.growRegisterWindow(read(Window::Capacity));
		placeRegisterWindow(window, read(Window::Destination), read(Window::SourceSlot), read(Window::Copied), read(Window::Padded), read(Window::Top));
		if (retire) {
			current.thread->leaveFrame();
			resumeFrameBank();
		}
		return;
	}
	const i32 protectedIndex = static_cast<i32>(frame.readControl(FrameField::Protected));
	const auto result = CallResultPlacement::frame(frame.readWindow(FrameField::ReturnBase),
		frame.readWindow(FrameField::ReturnCount), flags);
	auto& caller = *m_activeThread->currentFrame;
	const auto placement = ValuePlacement::fit(count, result.selected(count));
	if (protectedIndex < 0 && caller.registers.containsRange(result.base, placement.count())) {
		caller.registers.copyFrom(m_heapServiceView.stack, result.base, base, placement.copied, placement.padded);
		caller.placeResultTop(result, placement.count());
		instructionBudgetRemaining -= placement.count();
		return;
	}
	// The fixed activation has retired. Keep results rooted if ordinary
	// placement needs to grow the receiving thread or invoke a continuation.
	auto scratch = acquireBuiltinResultScratch();
	auto& values = scratch.get();
	const int copied = protectedIndex < 0 ? placement.copied : count;
	for (int slot = 0; slot < copied; ++slot) values.push_back(m_heapServiceView.stack.get(base + slot));
	if (protectedIndex >= 0) finishProtectedCall(protectedIndex, {nullptr, values.data(), 0, count});
	else writeReturnValues(caller, result, {values.data(), values.size()});
}

void CPU::admitHeapServiceAccess(MemoryAccessKind kind, u32 address) const {
	if ((kind != MemoryAccessKind::U8 && kind != MemoryAccessKind::Word && kind != MemoryAccessKind::U32LE)
		|| (kind != MemoryAccessKind::U8 && (address & 3u) != 0u))
		throw BMSX_RUNTIME_ERROR("Heap service access requires an aligned byte or word.");
}

void CPU::admitPrivateValueSpan(u32 address, u32 management) const {
	const u32 data = management + HEAP_SERVICE_FIRMWARE_DATA_OFFSET;
	const u32 projection = management + HEAP_SERVICE_GC_PROJECTION_OFFSET;
	if ((address & MEMORY_ACCESS_KIND_ALIGNMENT_MASKS[static_cast<size_t>(MemoryAccessKind::Value)]) != 0u
		|| ((address < m_memory.ramBusEnd() || address > management + HEAP_SERVICE_THREAD_OFFSET - VALUE_MEMORY_SIZE)
			&& address - data > RUNTIME_MANAGEMENT_SIZE - HEAP_SERVICE_FIRMWARE_DATA_OFFSET - VALUE_MEMORY_SIZE)
		|| address + VALUE_MEMORY_TAG_OFFSET - projection < VALUE_MEMORY_SIZE)
		throw BMSX_RUNTIME_ERROR("Tagged Value access requires an aligned private RAM span.");
}

void CPU::executeHeapServiceLoad(CallFrame& frame, int destination, MemoryAccessKind kind, u32 address) {
	if (kind == MemoryAccessKind::Value) {
		admitPrivateValueSpan(address, RAM_BASE + m_heapAllocator.managementOffset());
		const auto word = m_memory.readRamRecordWord(address);
		const auto tag = static_cast<ValueTag>(m_memory.readRamRecordByte(address + VALUE_MEMORY_TAG_OFFSET));
		frame.registers.set(destination, valueFromTag(tag, word));
		frame.extendTop(destination + 1);
		return;
	}
	admitHeapServiceAccess(kind, address);
	u32 word;
	if (address - HEAP_SERVICE_CAPTURE_DESCRIPTOR_PORT < MAIN_RAM_SIZE && kind != MemoryAccessKind::U8) {
		const u32 management = m_heapAllocator.managementOffset();
		const u32 descriptor = m_memory.readRamRecordWord(management + HEAP_SERVICE_CAPTURE_BINDING_OFFSET + static_cast<u32>(HeapServiceCaptureBindingField::Descriptor));
		const auto signals = static_cast<MappedBusSignals>(m_memory.readRamRecordWord(management + HEAP_SERVICE_CAPTURE_BUS_OFFSET));
		const u32 faultSequence = m_memory.readBusFaultSequence();
		word = m_memory.readMappedBusU32LE(descriptor + address - HEAP_SERVICE_CAPTURE_DESCRIPTOR_PORT, signals);
		if (m_memory.readBusFaultSequence() != faultSequence) {
			do m_heapServiceView.leaveFrame(); while (heapServiceActive());
			hardHalt();
			return;
		}
	} else if (address - RAM_BASE < m_memory.ramByteCount()) {
		// Raw records may project into the bus-visible part or beneath MMIO.
		word = kind == MemoryAccessKind::U8 ? m_memory.readRamRecordByte(address) : m_memory.readRamRecordWord(address);
	} else if (address - HEAP_SERVICE_ROOT_PORT_BASE < HEAP_SERVICE_ROOT_PORT_BYTES) {
		word = readHeapServiceRoot(address - HEAP_SERVICE_ROOT_PORT_BASE, kind);
	} else if (address == HEAP_SERVICE_REMAINING_DEVICE_CYCLES_ADDRESS && kind != MemoryAccessKind::U8) {
		word = static_cast<u32>(remainingDeviceCycles());
	} else if (address == HEAP_SERVICE_MANAGEMENT_ADDRESS && kind != MemoryAccessKind::U8) {
		word = m_heapAllocator.managementOffset();
	} else if (kind != MemoryAccessKind::U8
		&& (address == HEAP_SERVICE_CALL_CYCLES_ADDRESS || address == HEAP_SERVICE_CALL_RUN_KIND_ADDRESS)) {
		word = m_memory.readRamRecordWord(m_heapAllocator.managementOffset() + HEAP_SERVICE_RESIDENT_OFFSET
			+ static_cast<u32>(HeapServiceResidentField::SourceCycles) + address - HEAP_SERVICE_CALL_CYCLES_ADDRESS);
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
	const u32 management = RAM_BASE + m_heapAllocator.managementOffset();
	if (kind == MemoryAccessKind::Value) {
		admitPrivateValueSpan(address, management);
		const Value value = frame.registers.get(source);
		m_memory.writeRamRecordWord(address, valuePayload(value));
		m_memory.writeRamRecordByte(address + VALUE_MEMORY_TAG_OFFSET, static_cast<u8>(valueTag(value)));
		return;
	}
	admitHeapServiceAccess(kind, address);
	const u32 end = management + HEAP_SERVICE_THREAD_OFFSET;
	if (address == HEAP_SERVICE_CALL_FAULT_ADDRESS && kind != MemoryAccessKind::U8) {
		const u32 reason = wordOperand(frame.registers.get(source));
		m_memory.writeRamRecordPair(management + HEAP_SERVICE_RESIDENT_OFFSET + static_cast<u32>(HeapServiceResidentField::SourceBase),
			reason, HEAP_SERVICE_RESULT_FAULT);
		// Fixed frames never own open captures; a private fault retires
		// the whole activation before the issuer takes the ordinary trap.
		do m_heapServiceView.leaveFrame(); while (heapServiceActive());
		return;
	}
	if ((address < m_memory.ramBusEnd() || address >= end)
		&& address - (management + HEAP_SERVICE_FIRMWARE_DATA_OFFSET) >= RUNTIME_MANAGEMENT_SIZE - HEAP_SERVICE_FIRMWARE_DATA_OFFSET)
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
	if (word != static_cast<u32>(HeapServiceProjection::PublishRoots))
		throw BMSX_RUNTIME_ERROR("Unknown heap projection store command.");
	publishHeapRemarkHead();
	publishHeapRootBanks();

}
