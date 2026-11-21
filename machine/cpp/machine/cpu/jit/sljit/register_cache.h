#pragma once

#include <array>
#include <limits>
#include <optional>
#include <span>

#include "common/primitives.h"
#include "machine/cpu/value.h"
#include "sljitLir.h"

namespace bmsx {

struct NativeRegisterHost {
	sljit_s32 reg;
	bool calleeSaved;
};

// Host registers hold payloads, not guest values. An exact tag can travel
// with a binding; a raw binding leaves the tag authoritative in guest memory.
class NativeRegisterCache {
public:
	static constexpr int capacity = SLJIT_NUMBER_OF_REGISTERS + SLJIT_NUMBER_OF_FLOAT_REGISTERS;
	struct Binding {
		int guest = -1;
		std::optional<ValueTag> tag;
		bool wordDirty = false, tagDirty = false;
		u32 lastUse = 0;
		int nextUse = std::numeric_limits<int>::max();
	};
	using State = std::array<Binding, capacity>;
	struct Operand {
		sljit_s32 reg;
		ValueTag tag;
		int slot;
	};

	NativeRegisterCache(sljit_compiler* compiler, sljit_s32 words, sljit_s32 tags,
		std::span<const NativeRegisterHost> integers, std::span<const NativeRegisterHost> floats);

	void beginInstruction();
	// A read's tag must have been proved by the entry/admission or instruction.
	// guard emits only the missing proof, not a repeated check of a known tag.
	sljit_jump* guard(int guest, ValueTag tag, sljit_s32 scratch) const;
	void emitWord(int guest, sljit_s32 destination) const;
	void emitTag(int guest, sljit_s32 destination) const;
	Operand read(int guest, ValueTag tag);
	// Acquire after all inputs: with a full bank the destination may reuse an
	// input register. The old guest value is published before that overwrite.
	Operand write(int guest, ValueTag tag);
	void nextUse(int guest, int distance);
	void discardRange(int first, int end);
	void publishRange(int first, int end);
	void publish();
	void spillCall(bool reload, sljit_sw stackOffset) const;

	const State& state() const { return m_state; }
	const Binding* binding(int guest) const {
		const int slot = find(guest);
		return slot < 0 ? nullptr : &m_state[slot];
	}
	void setState(const State& state);
	void emitState(const State& state) const;
	bool samePublication(const State& left, const State& right) const;
	// The edge has already admitted the target's logical proofs. Transfer
	// only reconciles locations and publishes lanes not retained by the edge.
	void transferTo(const State& target, sljit_s32 integerScratch, sljit_s32 floatScratch);

private:
	int find(int guest) const;
	int allocate(int guest, ValueTag tag, bool destination);
	Operand operand(int slot);
	bool floating(int slot) const { return slot >= static_cast<int>(m_integers.size()); }
	const NativeRegisterHost& host(int slot) const;
	void load(int slot, int guest) const;
	void store(int slot, const Binding& binding, bool word, bool tag) const;
	void movePayload(int destination, sljit_s32 source, bool sourceFloat) const;

	sljit_compiler* m_compiler;
	sljit_s32 m_words, m_tags;
	std::span<const NativeRegisterHost> m_integers, m_floats;
	State m_state{};
	std::array<bool, capacity> m_pinned{};
	u32 m_clock = 0;
};

} // namespace bmsx
