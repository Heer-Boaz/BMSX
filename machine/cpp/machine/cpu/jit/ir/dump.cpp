#include "machine/cpu/jit/ir/dump.h"

#include <ostream>

#include "machine/cpu/jit/ir/region.h"

namespace bmsx {
namespace {

struct OperationName {
	const char* operator()(const NativeReplay&) const { return "replay"; }
	const char* operator()(const NativeJump&) const { return "jump"; }
	const char* operator()(const NativeHalt&) const { return "halt"; }
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
		return op.ownFieldAddress ? "load-own-field" : op.mode == NativeTableMode::Write ? "table-write" : "table-read";
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

void writeRecord(std::ostream& out, const NativeRecordPlan& record) {
	out << " {";
	for (u32 field = 0; field < record.count; ++field) {
		if (field != 0) out << ", ";
		out << 'K' << record.keySelectors[field] << '=';
		writeValue(out, record.operands[field]);
	}
	out << "} -> pc=" << record.nextPc;
}

void writeNumericPlan(std::ostream& out, const NativeArithmetic& arithmetic) {
	out << " op=" << unsigned(arithmetic.operation);
	const auto* plan = std::get_if<NativeNumericPlan>(&arithmetic.strategy);
	if (!plan) return;
	switch (plan->action) {
	case NativeNumericAction::Fault: out << " invalid"; break;
	case NativeNumericAction::Kernel: out << " kernel"; break;
	case NativeNumericAction::Word: out << " word"; break;
	case NativeNumericAction::Float: out << " float"; break;
	}
	if (plan->guardLeft) out << " guard-left=" << unsigned(*plan->left);
	if (plan->guardRight) out << " guard-right=" << unsigned(*plan->right);
}

} // namespace

void dumpNativeIr(std::ostream& out, const NativeIrRegion& region) {
	const auto blocks = region.blocks();
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
			if (tableAccess && tableAccess->ownFieldAddress) {
				const unsigned id = *tableAccess->ownFieldAddress;
				const auto& address = block.ownFieldAddresses[id];
				if (address.definingRow == row) {
					out << "  @" << inst.pc << " %addr" << id << " = checked-own-field ";
					writeValue(out, address.receiver);
					out << ", K" << address.key << " miss=e" << unsigned(*inst.slow);
					if (tableAccess->receiverCheck == NativeTagCheck::Dynamic) out << " guard-table";
					if (address.temporary) out << " retain";
					out << '\n';
				}
			}

			out << "  @" << inst.pc << ' ';
			if (inst.slots.writes.count == 1 && !inst.slots.writes.open)
				out << 'R' << inst.slots.writes.first << " = ";
			out << std::visit(OperationName{}, inst.operation);
			if (tableAccess && tableAccess->ownFieldAddress) {
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
			if (tableAccess && tableAccess->readPlan == NativeTableReadPlan::OneHopIndex) out << " check-one-hop";
			if (const auto* constant = std::get_if<NativeConstantLoad>(&inst.operation)) out << " K" << constant->index;
			if (const auto* arithmetic = std::get_if<NativeArithmetic>(&inst.operation))
				writeNumericPlan(out, *arithmetic);
			if (inst.slow) out << " miss=e" << unsigned(*inst.slow);
			if (inst.replay) out << " replay=e" << unsigned(*inst.replay);
			if (inst.feedback) out << " profile-ready=e" << unsigned(*inst.feedback);
			if (const auto* allocation = std::get_if<NativeTableAllocation>(&inst.operation); allocation && allocation->record)
				writeRecord(out, region.recordPlans()[*allocation->record]);
			out << '\n';
		}
		const auto exits = region.sideExits(block);
		for (size_t id = 0; id < exits.size(); ++id) {
			const auto& exit = exits[id];
			out << "  e" << id << " kind=" << unsigned(exit.exit) << " pc=" << exit.currentPc
				<< " last-word=" << exit.lastPc << " next=" << exit.nextPc << " charge=" << exit.cycles;
			if (exit.exit == NativeBlockExit::ProfileReady) out << " rebuild=" << exit.operands.feedback.sourcePc;
			if (exit.exit == NativeBlockExit::ReadField && exit.operands.table.reusePeerWord)
				out << " layout-peer=" << *exit.operands.table.reusePeerWord << " rebuild=" << exit.operands.table.sourcePc;
			if (exit.exit == NativeBlockExit::ScalarBoundary && exit.operands.replay.arithmetic) {
				const auto [left, right] = *exit.operands.replay.arithmetic;
				out << " assumed=" << unsigned(left) << ',' << unsigned(right);
			}
			out << '\n';
		}
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

} // namespace bmsx
