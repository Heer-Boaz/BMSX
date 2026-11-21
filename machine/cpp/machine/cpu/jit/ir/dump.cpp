#include "machine/cpu/jit/ir/dump.h"

#include <array>
#include <ostream>

#if defined(BMSX_NATIVE_IR_TRACE)
#include <algorithm>
#include <charconv>
#include <cstdio>
#include <cstdlib>
#include <sstream>
#include <string_view>
#endif

#include "machine/cpu/jit/ir/region.h"

namespace bmsx {
namespace {

struct OperationName {
	const char* operator()(const NativeReplay&) const { return "replay"; }
	const char* operator()(const NativeJump&) const { return "jump"; }
	const char* operator()(const NativeHalt&) const { return "halt"; }
	const char* operator()(const NativeInvalidOperand&) const { return "invalid-operand"; }
	const char* operator()(const NativeExceptionReturn&) const { return "exception-return"; }
	const char* operator()(const NativeReturnSite&) const { return "return"; }
	const char* operator()(const NativeTableAllocation& op) const { return op.record ? "allocate-record" : "allocate-table"; }
	const char* operator()(const NativeConcat&) const { return "concat"; }
	const char* operator()(const NativeConcatRange&) const { return "concat-range"; }
	const char* operator()(const NativeClosure&) const { return "create-closure"; }
	const char* operator()(const NativeLiteral&) const { return "literal"; }
	const char* operator()(const NativeConstantLoad&) const { return "load-constant"; }
	const char* operator()(const NativeMove&) const { return "move"; }
	const char* operator()(const NativeNot&) const { return "not"; }
	const char* operator()(const NativeClearSlots&) const { return "clear-slots"; }
	const char* operator()(const NativePoolRead&) const { return "read-pool"; }
	const char* operator()(const NativeLength&) const { return "length"; }
	const char* operator()(const NativeGlobalAccess&) const { return "global"; }
	const char* operator()(const NativeUpvalueAccess&) const { return "capture"; }
	const char* operator()(const NativeControlAccess&) const { return "control"; }
	const char* operator()(const NativeMemoryAccess&) const { return "memory"; }
	const char* operator()(const NativeTableAccess& op) const {
		if (op.ownFieldAddress) return "load-own-field";
		switch (op.mode) {
		case NativeTableMode::Read: return "table-read";
		case NativeTableMode::Write: return "table-write";
		case NativeTableMode::ReadMethod: return "table-read-method";
		}
		BMSX_UNREACHABLE();
	}
	const char* operator()(const NativeArithmetic&) const { return "arithmetic"; }
	const char* operator()(const NativeTruthBranch&) const { return "branch"; }
	const char* operator()(const NativeComparison&) const { return "compare"; }
	const char* operator()(const NativeCallSite&) const { return "call"; }
	const char* operator()(const NativeVararg&) const { return "vararg"; }
};

void writeValue(std::ostream& out, NativeValueRef operand) {
	if (operand < 0) out << 'K' << -1 - operand;
	else out << 'R' << operand;
}

void writeSlotRange(std::ostream& out, NativeSlotRange range) {
	out << 'R' << range.first;
	if (range.open) out << "..top";
	else if (range.count > 1) out << "..R" << range.end() - 1;
}

void writeRecord(std::ostream& out, const NativeRecordPlan& record) {
	out << " {";
	for (u32 field = 0; field < record.count; ++field) {
		if (field != 0) out << ", ";
		out << 'K' << record.keySelectors[field] << '=';
		writeValue(out, record.operands[field]);
	}
	out << "} required-slots=" << record.requiredSlots << " last-pc=" << record.lastInstructionPc
		<< " last-word=" << record.lastWordPc << " -> pc=" << record.nextPc;
}

void writeNumericPlan(std::ostream& out, const NativeArithmetic& arithmetic) {
	out << " op=" << unsigned(arithmetic.operation);
	const auto& plan = std::get<NativeNumericPlan>(arithmetic.strategy);
	switch (plan.action) {
	case NativeNumericAction::Fault: out << " invalid"; break;
	case NativeNumericAction::Kernel: out << " kernel"; break;
	case NativeNumericAction::Word: out << " word"; break;
	case NativeNumericAction::Float: out << " float"; break;
	}
	if (plan.left) out << " left-tag=" << unsigned(*plan.left);
	if (plan.right && !arithmetic.unary()) out << " right-tag=" << unsigned(*plan.right);
	if (plan.result) out << " result-tag=" << unsigned(*plan.result);
	if (plan.guardLeft) out << " guard-left=" << unsigned(*plan.left);
	if (plan.guardRight) out << " guard-right=" << unsigned(*plan.right);
}

constexpr std::array tagChecks{"guard", "proved", "rejected"};
constexpr std::array wordSources{"dynamic", "integer", "float", "invalid"};
constexpr std::array barriers{"dynamic", "none", "reference"};

// Render the decisions in the finalized plan, without re-deriving them
// from the opcode, speculation feedback or the emitted instructions.
struct OperationPlan {
	std::ostream& out;
	void operator()(const auto&) const {}
	void operator()(const NativeArithmetic& op) const { writeNumericPlan(out, op); }
	void operator()(const NativeJump& op) const { out << " target=" << op.target; }
	void operator()(const NativeLiteral& op) const {
		out << " tag=" << unsigned(valueTag(op.value)) << " word=" << valuePayload(op.value);
	}
	void operator()(const NativeConstantLoad& op) const { out << " K" << op.index; }
	void operator()(const NativeTableAllocation& op) const {
		out << " array=" << op.arraySize << " hash=" << op.hashSize;
	}
	void operator()(const NativeClosure& op) const {
		if ((op.flags & CLOSURE_ADDRESS_REGISTER_FLAG) == 0) out << " address=" << op.address;
		out << " flags=" << op.flags;
	}
	void operator()(const NativeGlobalAccess& op) const {
		out << (op.access == NativeAccess::Read ? " read" : " write")
			<< (op.bank == NativeGlobalBank::System ? " system=" : " execution=") << op.index;
	}
	void operator()(const NativeMove& op) const {
		if (op.conversion == ValueMoveKind::Copy) {
			if (op.copyTag) out << " copy-tag=" << unsigned(*op.copyTag);
		} else out << " conversion=" << unsigned(op.conversion) << " source-tag=" << tagChecks[unsigned(op.conversionCheck)];
	}
	void operator()(const NativeNot& op) const {
		if (op.sourceTruthy) out << " constant=" << (*op.sourceTruthy ? "false" : "true");
	}
	void operator()(const NativeTruthBranch& op) const {
		out << " target=" << op.target << (op.takeOnTruthy ? " when-truthy" : " when-false");
	}
	void operator()(const NativeComparison& op) const {
		constexpr std::array strategies{"word", "float", "kernel"};
		out << " op=" << unsigned(op.operation) << " strategy=" << strategies[unsigned(op.strategy)]
			<< (op.skipOnMatch ? " skip-on-match" : " skip-on-miss");
	}
	void operator()(const NativeTableAccess& op) const {
		if (op.keyKind == NativeTableKey::Field && (!op.ownFieldAddress || op.receiverCheck == NativeTagCheck::Rejected))
			out << " K" << op.key;
		if (op.keyKind == NativeTableKey::Integer) out << " key=" << op.key;
		out << " receiver=" << tagChecks[unsigned(op.receiverCheck)];
		if (op.receiverCheck == NativeTagCheck::Rejected) return;
		if (op.mode == NativeTableMode::Write) {
			constexpr std::array nilPlans{"dynamic", "nil", "present"};
			out << " barrier=" << barriers[unsigned(op.store.barrier)] << " value=" << nilPlans[unsigned(op.store.nilValue)];
		} else if (op.readPlan == NativeTableReadPlan::OneHopIndex) out << " check-one-hop";
		else if (op.readPlan == NativeTableReadPlan::OwnSlot) out << " own-only";
	}
	void operator()(const NativeMemoryAccess& op) const {
		constexpr std::array modes{"load", "store", "store-words"};
		out << ' ' << modes[unsigned(op.mode)]
			<< " address=" << tagChecks[unsigned(op.addressCheck)] << " displacement=" << op.displacement
			<< " format=" << unsigned(op.format);
		if (op.mode == NativeMemoryMode::Store) out << " source-word=" << wordSources[unsigned(op.store)];
		if (op.mode == NativeMemoryMode::StoreWords) out << " words=" << op.wordCount;
	}
	void operator()(const NativePoolRead& op) const { out << " index-word=" << wordSources[unsigned(op.indexPlan)]; }
	void operator()(const NativeControlAccess& op) const {
		constexpr std::array modes{"read-word", "read-zero", "write-word", "consume-word", "read-fault", "write-semantic"};
		out << " field=" << op.field << " mode=" << modes[unsigned(op.mode)];
		if (op.checkPrivilege) out << " guard-privilege";
		if (op.mode == NativeControlMode::WriteWord || op.mode == NativeControlMode::ConsumeWord)
			out << " source-word=" << wordSources[unsigned(op.operand)];
	}
	void operator()(const NativeUpvalueAccess& op) const {
		out << (op.access == NativeAccess::Read ? " read" : " write") << " capture=" << op.capture;
		if (op.access == NativeAccess::Write) out << " barrier=" << barriers[unsigned(op.barrier)];
	}
	void operator()(const NativeCallSite& op) const {
		out << " supplied=" << op.supplied << " results=" << op.requested;
	}
	void operator()(const NativeVararg& op) const {
		if (op.requested == 0) out << " no-results";
	}
};

void writeExit(std::ostream& out, const NativeIrExit& exit) {
	out << " kind=" << unsigned(exit.exit) << " pc=" << exit.currentPc
		<< " last-word=" << exit.lastPc << " next=" << exit.nextPc << " charge=" << exit.cycles << " top=" << exit.registerTop;
	if (exit.exit == NativeBlockExit::ProfileReady) out << " rebuild=" << exit.operands.feedback.sourcePc;
	if (exit.exit == NativeBlockExit::ReadField && exit.operands.table.reusePeerWord)
		out << " layout-peer=" << *exit.operands.table.reusePeerWord << " rebuild=" << exit.operands.table.sourcePc;
	if (exit.exit == NativeBlockExit::ScalarBoundary && exit.operands.replay.arithmetic) {
		const auto [left, right] = *exit.operands.replay.arithmetic;
		out << " assumed=" << unsigned(left) << ',' << unsigned(right);
	}
	out << '\n';
}

} // namespace

void dumpNativeIr(std::ostream& out, const NativeIrRegion& region) {
	const auto blocks = region.blocks();
	out << "region required-slots=" << region.requiredSlots() << '\n';
	for (size_t index = 0; index < blocks.size(); ++index) {
		const auto& block = blocks[index];
		out << "block b" << index << " pc=" << block.firstPc
			<< " admit-cycles=" << block.admissionCycles << " replay=r" << block.entryReplay << '\n';
		for (auto type : block.entryTypes)
			out << "  admit R" << type.slot << " tag=" << unsigned(type.tag) << '\n';
		for (size_t edge = 0; edge < block.successors.size(); ++edge) {
			const auto target = block.successors[edge];
			if (target == blocks.size() || (edge != 0 && target == block.successors[0]
				&& block.edgeReplay[edge] == block.edgeReplay[0])) continue;
			out << "  edge b" << target;
			if (!blocks[target].entryTypes.empty()) out << (block.provesEntryTo(target) ? " proven" : " checked");
			if (const auto replay = block.edgeReplay[edge]) out << " replay=r" << *replay;
			out << '\n';
		}
		for (size_t row = 0; row < block.instructions.size(); ++row) {
			const auto& inst = block.instructions[row];
			const auto* tableAccess = std::get_if<NativeTableAccess>(&inst.operation);
			const bool rejectedField = tableAccess && tableAccess->receiverCheck == NativeTagCheck::Rejected;
			if (tableAccess && tableAccess->ownFieldAddress && !rejectedField) {
				const unsigned id = *tableAccess->ownFieldAddress;
				const auto& address = block.ownFieldAddresses[id];
				if (address.definingRow == row) {
					out << "  @" << inst.pc << " %addr" << id << " = checked-own-field ";
					writeValue(out, address.receiver);
					out << ", K" << address.key << " miss=e" << unsigned(*inst.slow);
					if (tableAccess->receiverCheck == NativeTagCheck::Dynamic) out << " guard-table";
					if (address.lastUseRow) out << " through=@" << block.instructions[*address.lastUseRow].pc;
					out << '\n';
				}
			}

			out << "  @" << inst.pc << ' ';
			const auto& writes = inst.slots.writes;
			if (writes.count != 0 || writes.open) {
				writeSlotRange(out, writes);
				out << " = ";
			}
			out << (rejectedField ? "table-semantic" : std::visit(OperationName{}, inst.operation));
			if (tableAccess && tableAccess->ownFieldAddress && !rejectedField) {
				out << " %addr" << unsigned(*tableAccess->ownFieldAddress);
				if (tableAccess->resultTag) out << " tag=" << unsigned(*tableAccess->resultTag);
				else out << " present";
			} else {
				for (const auto operand : inst.slots.reads) {
					if (operand == NATIVE_NO_OPERAND) continue;
					out << ' ';
					writeValue(out, operand);
				}
			}
			const auto& readsRange = inst.slots.readsRange;
			if (readsRange.count != 0 || readsRange.open) {
				out << " reads=";
				writeSlotRange(out, readsRange);
			}
			if (const auto* allocation = std::get_if<NativeTableAllocation>(&inst.operation); allocation && allocation->record)
				writeRecord(out, region.recordPlans()[*allocation->record]);
			std::visit(OperationPlan{out}, inst.operation);
			if (row + 1 == block.instructions.size()) {
				if (block.taken) out << " taken=e" << unsigned(*block.taken);
				if (block.hasFusedJump)
					out << " fused-jump-pc=" << block.terminal.currentPc << " jump-target=" << block.terminal.nextPc
						<< " jump-cycles=" << unsigned(block.fusedJumpCycles) << " before-jump=e" << unsigned(*block.beforeFusedJump);
				if (block.completedCall)
					out << " builtin-tag=" << tagChecks[unsigned(std::get<NativeCallSite>(inst.operation).calleeCheck)]
						<< " completed-call=e" << unsigned(*block.completedCall);
			}
			if (inst.slow) out << " miss=e" << unsigned(*inst.slow);
			if (inst.replay) out << " replay=e" << unsigned(*inst.replay);
			if (inst.feedback) out << " profile-ready=e" << unsigned(*inst.feedback);
			out << '\n';
		}
		const auto exits = region.sideExits(block);
		for (size_t id = 0; id < exits.size(); ++id) {
			out << "  e" << id;
			writeExit(out, exits[id]);
		}
		out << "  terminal";
		writeExit(out, block.terminal);
	}
	const auto replays = region.admissionReplays();
	for (size_t id = 0; id < replays.size(); ++id) {
		const auto& replay = replays[id];
		out << "r" << id << " replay next=" << replay.nextPc;
		if (replay.operands.replay.hasCompletedInstruction)
			out << " completed=" << replay.currentPc << " last-word=" << replay.lastPc;
		out << '\n';
	}
}

#if defined(BMSX_NATIVE_IR_TRACE)
void traceNativeIr(const NativeIrRegion& region) {
	const char* selection = std::getenv("BMSX_NATIVE_IR");
	if (!selection) return;
	std::string_view filter(selection);
	const auto blocks = region.blocks();
	if (filter != "all") {
		if (filter.starts_with("0x")) filter.remove_prefix(2);
		u32 pc;
		const auto end = filter.data() + filter.size();
		const auto parsed = std::from_chars(filter.data(), end, pc, 16);
		if (parsed.ec != std::errc{} || parsed.ptr != end || !std::ranges::any_of(blocks, [&](const auto& block) {
			return (block.hasFusedJump && block.terminal.currentPc == pc)
				|| std::ranges::any_of(block.instructions, [&](const auto& row) { return row.pc == pc; });
		})) return;
	}
	std::ostringstream output;
	output << "native-ir pc=" << blocks.front().firstPc << '\n';
	dumpNativeIr(output, region);
	const auto text = std::move(output).str();
	// Write one whole region, including when the compiler runs on the worker.
	std::fwrite(text.data(), 1, text.size(), stderr);
}
#endif

} // namespace bmsx
