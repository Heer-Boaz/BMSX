#include "machine/cpu/cpu.h"
#include "common/hash_fnv.h"

#include <algorithm>

namespace bmsx {

// No result record is needed to start assembly: an existing interned result
// can succeed even when the arena cannot hold another copy.
void CPU::advanceConcat(CallFrame& frame) {
	auto& job = m_concat;
	if (job.registersLeft) {
		const u32 count = std::min(job.registersLeft, static_cast<u32>(instructionBudgetRemaining));
		instructionBudgetRemaining -= count;
		job.registersLeft -= count;
		for (const u32 stop = job.nextRegister + count; job.nextRegister < stop; ++job.nextRegister) {
			const Value v = frame.registers.get(job.nextRegister);
			const u32 n = valueIsString(v) ? static_cast<u32>(m_stringPool.byteLength(asStringId(v)))
				: static_cast<u32>(valueToString(v, m_stringPool).size());
			if (n >= MAIN_RAM_SIZE - job.length) {
				instructionBudgetRemaining -= static_cast<int>(MAIN_RAM_SIZE + job.registersLeft);
				m_currentInstructionPc = job.instructionPc;
				job.length = job.registersLeft = 0;
				throw LuaOutOfMemorySignal{};
			}
			job.length += n;
			if (n) job.sources.push_back({v, n});
		}
		if (job.registersLeft) return;
		job.bytes.reserve(job.length);
	}
	const u32 start = static_cast<u32>(job.bytes.size());
	u32 amount = std::min(job.length - start, static_cast<u32>(instructionBudgetRemaining));
	instructionBudgetRemaining -= amount;
	while (amount) {
		const auto part = job.sources[job.source];
		const u32 n = std::min(amount, part.bytes - job.offset);
		if (valueIsString(part.value)) {
			m_stringPool.appendBytes(job.bytes, asStringId(part.value), job.offset, n);
		} else {
			const auto spelling = valueToString(part.value, m_stringPool);
			job.bytes.append(spelling, job.offset, n);
		}
		amount -= n;
		job.offset += n;
		if (job.offset == part.bytes) { ++job.source; job.offset = 0; }
	}
	job.hash = fnv1a32(std::string_view(job.bytes).substr(start), job.hash);
	if (job.bytes.size() != job.length) return;
	// Drop the pending instruction before interning: allocation may raise a
	// guest fault. Its completed bytes stay borrowed until intern returns.
	job.length = 0;
	m_currentInstructionPc = job.instructionPc;
	const auto result = m_stringPool.intern(job.bytes, job.hash);
	frame.registers.set(job.destination, valueString(result));
	frame.extendTop(job.destination + 1);
	job.bytes.clear(); job.sources.clear();
}

template<class Operand>
void CPU::concatenateValues(CallFrame& frame, int destination, int count, Operand operand) {
	const auto oversized = [&] {
		instructionBudgetRemaining -= static_cast<int>(MAIN_RAM_SIZE);
		throw LuaOutOfMemorySignal{};
	};
	u32 firstBytes = 0, stringBytes = 0, conversions = 0;
	for (int i = 0; i < count; ++i) {
		const auto value = operand(i);
		if (valueIsString(value)) {
			const u32 n = m_stringPool.byteLength(asStringId(value));
			if (n >= MAIN_RAM_SIZE - stringBytes) oversized();
			if (i == 0) firstBytes = n;
			stringBytes += n;
		} else ++conversions;
	}
	const u32 directBytes = std::min(static_cast<u32>(MAIN_RAM_SIZE) - 1u,
		static_cast<u32>(std::max(INLINE_CONCAT_BYTES, instructionBudgetRemaining)));
	if (stringBytes + conversions * MAX_NON_STRING_TEXT_BYTES > directBytes) {
		auto& job = m_concat;
		job.sources.clear(); job.bytes.clear();
		u32 total = stringBytes;
		for (int i = 0; i < count; ++i) {
			const auto v = operand(i);
			u32 n;
			if (valueIsString(v)) n = m_stringPool.byteLength(asStringId(v));
			else {
				n = static_cast<u32>(valueToString(v, m_stringPool).size());
				if (n >= MAIN_RAM_SIZE - total) oversized();
				total += n;
			}
			if (n) job.sources.push_back({v, n});
		}
		if (total > directBytes) {
			job.bytes.reserve(total);
			job.nextRegister = 0; job.length = total; job.instructionPc = m_currentInstructionPc; job.destination = destination; job.source = job.offset = 0;
			job.hash = FNV1A32_OFFSET_BASIS;
			if (instructionBudgetRemaining > 0) advanceConcat(frame);
			return;
		}
	}
	StringId result;
	if (count == 2 && conversions == 0) {
		const auto a = asStringId(operand(0)), b = asStringId(operand(1));
		instructionBudgetRemaining -= stringBytes;
		result = m_stringPool.internConcat(a, firstBytes, b, stringBytes - firstBytes);
	} else {
		std::string text;
		text.reserve(stringBytes);
		for (int i = 0; i < count; ++i) appendValueString(text, operand(i), m_stringPool);
		instructionBudgetRemaining -= static_cast<int>(text.size());
		result = m_stringPool.intern(text);
	}
	frame.registers.set(destination, valueString(result));
	frame.extendTop(destination + 1);
}

void CPU::executeConcat(CallFrame& frame, int destination, int leftOperand, int rightOperand) {
	const Value left = readRK(*frame.executionImage, frame.registers, leftOperand);
	const Value right = readRK(*frame.executionImage, frame.registers, rightOperand);
	concatenateValues(frame, destination, 2, [&](int i) { return i ? right : left; });
}

void CPU::executeConcatRange(CallFrame& frame, int destination, int base, int count) {
	if (count > INLINE_CONCAT_OPERANDS) {
		auto& job = m_concat;
		job.sources.clear(); job.bytes.clear();
		job.sources.reserve(count);
		job.length = job.source = job.offset = 0;
		job.nextRegister = base; job.registersLeft = count;
		job.instructionPc = m_currentInstructionPc; job.destination = destination;
		job.hash = FNV1A32_OFFSET_BASIS;
		if (instructionBudgetRemaining > 0) advanceConcat(frame);
		return;
	}
	instructionBudgetRemaining -= count;
	concatenateValues(frame, destination, count, [&](int i) { return frame.registers.get(base + i); });
}

} // namespace bmsx
