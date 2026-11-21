#include "machine/cpu/native_ir.h"
#include "machine/cpu/native_ir_values.h"

#include <algorithm>

namespace bmsx {
namespace {

NativeTableAccess* fixedFieldRead(NativeOperation& operation) {
	auto* access = std::get_if<NativeTableAccess>(&operation);
	return access && access->mode == NativeTableMode::Read && access->keyKind == NativeTableKey::Field ? access : nullptr;
}

} // namespace

size_t planNativeFieldReads(std::span<NativeInstruction> instructions, NativeCompilationTier tier) {
	const auto first = std::ranges::find_if(instructions,
		[](NativeInstruction& instruction) { return fixedFieldRead(instruction.operation); });
	if (first == instructions.end()) return instructions.size();

	const auto prefix = static_cast<size_t>(first - instructions.begin());
	auto tail = instructions.subspan(prefix);
	const NativeRunValues values(tail);
	struct Selection {
		u16 consumer = NativeValueOrigin::Input;
		ValueTag tag = ValueTag::Nil;
	};
	std::array<Selection, NATIVE_BLOCK_MAX_INSTRUCTIONS> selections;
	size_t frontier = 0;
	size_t cut = tail.size();
	for (size_t index = 0; index < cut; ++index) {
		auto& operation = tail[index].operation;
		// Fixed-key loads can each acquire a checked fast path. Other
		// checkpoints delimit the native path used by this optimization.
		if (!fixedFieldRead(operation) && nativeOperationFlow(operation) != NativeOperationFlow::Linear) {
			frontier = index + 1;
			continue;
		}
		const auto* arithmetic = std::get_if<NativeArithmetic>(&operation);
		if (!arithmetic || (arithmetic->operation != OpCode::ADD && arithmetic->operation != OpCode::SUB
			&& arithmetic->operation != OpCode::MUL)) continue;
		const auto& hint = std::get<NativeArithmeticHint>(arithmetic->strategy);
		const auto& inputs = values.inputs(index);
		for (size_t operand = 0; operand < 2; ++operand) {
			const auto origin = inputs[operand];
			if (origin.producer < frontier || origin.producer >= index) continue;
			auto* field = fixedFieldRead(tail[origin.producer].operation);
			if (!field) continue;
			if (tier == NativeCompilationTier::ColdImage && !hint.observed)
				cut = std::min<size_t>(cut, origin.producer);
			else if (auto& selection = selections[origin.producer];
				selection.consumer == NativeValueOrigin::Input && field->predictedSlot >= 0 && hint.feedback)
				selection = {static_cast<u16>(index), operand == 0 ? hint.feedback->left : hint.feedback->right};
		}
	}
	for (size_t producer = 0; producer < cut; ++producer)
		if (selections[producer].consumer < cut)
			std::get<NativeTableAccess>(tail[producer].operation).resultTag = selections[producer].tag;
	return prefix + cut;
}

} // namespace bmsx
