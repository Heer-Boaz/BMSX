#include "machine/cpu/native_ir.h"

namespace bmsx {
namespace {

bool readsFixedField(const NativeTableAccess& access) {
	return access.mode == NativeTableMode::Read && access.keyKind == NativeTableKey::Field;
}

} // namespace

size_t selectNativeFieldPaths(std::span<NativeInstruction> instructions, NativeCompilationTier tier) {
	NativeTableAccess* producer = nullptr;
	size_t producerIndex = 0;
	NativeArithmetic* previous = nullptr;
	for (size_t index = 0; index < instructions.size(); ++index) {
		auto& row = instructions[index];
		auto* access = std::get_if<NativeTableAccess>(&row.operation);
		if (previous && access && access->mode == NativeTableMode::Write && access->keyKind == NativeTableKey::Field
			&& access->value == previous->result)
			std::get<NativeArithmeticHint>(previous->strategy).resultFeedsStore = true;

		auto* arithmetic = std::get_if<NativeArithmetic>(&row.operation);
		previous = nullptr;
		if (arithmetic && (arithmetic->operation == OpCode::ADD
			|| arithmetic->operation == OpCode::SUB || arithmetic->operation == OpCode::MUL)) {
			previous = arithmetic;
			if (producer && (arithmetic->left == producer->value || arithmetic->right == producer->value)) {
				const auto& hint = std::get<NativeArithmeticHint>(arithmetic->strategy);
				if (tier == NativeCompilationTier::ColdImage && !hint.observed)
					return producerIndex; // Leave the unobserved producer in the warm tier.
				if (producer->predictedSlot >= 0 && hint.feedback)
					producer->resultTag = arithmetic->left == producer->value ? hint.feedback->left : hint.feedback->right;
				producer = nullptr;
			}
		}

		// A returning helper can spend more than its fixed prefix or replace
		// the register window. A candidate only spans an admitted native path.
		if (producer && (nativeOperationFlow(row.operation) != NativeOperationFlow::Linear
			|| (producer->value >= static_cast<int>(row.slots.writes.first) && producer->value < row.slots.writes.end())))
			producer = nullptr;
		if (access && readsFixedField(*access)) {
			producer = access;
			producerIndex = index;
		}
	}
	return instructions.size();
}

} // namespace bmsx
