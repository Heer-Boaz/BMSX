#pragma once

#include <array>
#include <limits>
#include <optional>
#include <span>
#include <utility>

#include "common/primitives.h"
#include "machine/cpu/value.h"
#include "machine/cpu/jit/ir/liveness.h"
#include "machine/cpu/jit/sljit/abi.h"

namespace bmsx {

struct NativeWordConstraints;

// A host register holds a payload or a dynamic tag. A proved tag needs
// no register; exits materialize each dirty plane at its guest address.
class NativeRegisterCache {
public:
	static constexpr int capacity = NativeBlockAbi::registerCacheCapacity;
	struct Binding {
		int guest = -1;
		std::optional<ValueTag> tag;
		bool dirty = false, immediateTagDirty = false;
		bool tagLane = false;
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
	// The shared bank is the trailing R0..R3 in the region ABI. A fixed use
	// displaces only its binding; an unconstrained temp prefers a free register.
	void reserveScratch(unsigned fixed);
	void applyConstraints(const NativeWordConstraints& constraints);
	sljit_s32 acquireScratch();
	// A read's tag must have been proved by the entry/admission or instruction.
	// guard emits only the missing proof, not a repeated check of a known tag.
	sljit_jump* guard(int guest, ValueTag tag, sljit_s32 scratch) const;
	struct RawResult { sljit_s32 word, tag; sljit_sw wordOffset, tagOffset; };
	RawResult writeRaw(int guest, NativeOperandDemand demand);
	std::pair<sljit_s32, sljit_sw> wordOperand(int guest, sljit_s32 floatBitsScratch) const;
	void emitWord(int guest, sljit_s32 destination) const;
	void emitTag(int guest, sljit_s32 destination) const;
	Operand read(int guest, ValueTag tag);
	// Acquire after all inputs: with a full bank the destination may reuse an
	// input register. The old guest value is published before that overwrite.
	Operand write(int guest, ValueTag tag);
	template<class NextUse> void beginInstruction(NextUse nextUse) {
		beginInstruction();
		const size_t count = m_integers.size() + m_floats.size();
		for (size_t slot = 0; slot < count; ++slot)
			if (m_state[slot].guest >= 0) m_state[slot].nextUse = nextUse(m_state[slot].guest);
	}
	void discardRange(int first, int end);
	void publishRange(int first, int end);
	void publish();
	void rebase(int displacement);
	enum class FrameSlots { MayChange, Unchanged };
	void spillCall(bool reload, sljit_sw stackOffset, FrameSlots slots) const;

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
	int find(int guest, bool tagLane = false) const;
	int allocate(int guest, std::optional<ValueTag> tag, bool destination);
	Operand operand(int slot);
	bool floating(int slot) const { return slot >= static_cast<int>(m_integers.size()); }
	const NativeRegisterHost& host(int slot) const;
	void load(int slot, int guest) const;
	void store(int slot, const Binding& binding, bool dirty, bool immediateTag) const;
	void movePayload(int destination, sljit_s32 source, bool sourceFloat) const;

	sljit_compiler* m_compiler;
	sljit_s32 m_words, m_tags;
	std::span<const NativeRegisterHost> m_integers, m_floats;
	State m_state{};
	std::array<bool, capacity> m_pinned{}, m_reserved{};
	unsigned m_scratchMask = 0;
	const NativeWordConstraints* m_constraints = nullptr;
	u32 m_clock = 0;
};

} // namespace bmsx
