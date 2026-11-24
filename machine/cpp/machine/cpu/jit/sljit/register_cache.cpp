#include "machine/cpu/jit/sljit/register_cache.h"

#include <algorithm>
#include <cassert>

namespace bmsx {

NativeRegisterCache::NativeRegisterCache(sljit_compiler* compiler, sljit_s32 words, sljit_s32 tags,
	std::span<const NativeRegisterHost> integers, std::span<const NativeRegisterHost> floats)
	: m_compiler(compiler), m_words(words), m_tags(tags), m_integers(integers), m_floats(floats) {}

const NativeRegisterHost& NativeRegisterCache::host(int slot) const {
	return floating(slot) ? m_floats[slot - m_integers.size()] : m_integers[slot];
}

int NativeRegisterCache::find(int guest, bool tagLane) const {
	for (int slot = 0; slot < static_cast<int>(m_integers.size() + m_floats.size()); ++slot)
		if (m_state[slot].guest == guest && m_state[slot].tagLane == tagLane)
			return slot;
	return -1;
}

void NativeRegisterCache::beginInstruction() {
	m_pinned.fill(false);
}

sljit_jump* NativeRegisterCache::guard(int guest, ValueTag tag, sljit_s32 scratch) const {
	const auto* resident = binding(guest);
	if (resident && resident->tag)
		return resident->tag == tag ? nullptr : sljit_emit_jump(m_compiler, SLJIT_JUMP);
	if (const int lane = find(guest, true); lane >= 0) scratch = host(lane).reg;
	else emitTag(guest, scratch);
	return sljit_emit_cmp(m_compiler, SLJIT_NOT_EQUAL | SLJIT_32, scratch, 0, SLJIT_IMM, static_cast<u8>(tag));
}

void NativeRegisterCache::emitWord(int guest, sljit_s32 destination) const {
	const int slot = find(guest);
	if (slot < 0) {
		sljit_emit_op1(m_compiler, SLJIT_MOV32, destination, 0, SLJIT_MEM1(m_words), guest * sizeof(u32));
	} else if (floating(slot)) {
		sljit_emit_fcopy(m_compiler, SLJIT_COPY32_FROM_F32, host(slot).reg, destination);
	} else if (host(slot).reg != destination) {
		sljit_emit_op1(m_compiler, SLJIT_MOV32, destination, 0, host(slot).reg, 0);
	}
}

void NativeRegisterCache::emitTag(int guest, sljit_s32 destination) const {
	const auto* resident = binding(guest);
	if (resident && resident->tag)
		sljit_emit_op1(m_compiler, SLJIT_MOV32, destination, 0, SLJIT_IMM, static_cast<u8>(*resident->tag));
	else if (const int source = find(guest, true); source >= 0)
		sljit_emit_op1(m_compiler, SLJIT_MOV32, destination, 0, host(source).reg, 0);
	else
		sljit_emit_op1(m_compiler, SLJIT_MOV_U8, destination, 0, SLJIT_MEM1(m_tags), guest);
}

void NativeRegisterCache::movePayload(int destination, sljit_s32 source, bool sourceFloat) const {
	const auto reg = host(destination).reg;
	if (floating(destination)) {
		if (sourceFloat) sljit_emit_fop1(m_compiler, SLJIT_MOV_F32, reg, 0, source, 0);
		else sljit_emit_fcopy(m_compiler, SLJIT_COPY32_TO_F32, reg, source);
	} else if (sourceFloat) {
		sljit_emit_fcopy(m_compiler, SLJIT_COPY32_FROM_F32, source, reg);
	} else {
		sljit_emit_op1(m_compiler, SLJIT_MOV32, reg, 0, source, 0);
	}
}

void NativeRegisterCache::load(int slot, int guest) const {
	const auto offset = static_cast<sljit_sw>(guest) * sizeof(u32);
	if (floating(slot))
		sljit_emit_fop1(m_compiler, SLJIT_MOV_F32, host(slot).reg, 0, SLJIT_MEM1(m_words), offset);
	else
		sljit_emit_op1(m_compiler, SLJIT_MOV32, host(slot).reg, 0, SLJIT_MEM1(m_words), offset);
}

void NativeRegisterCache::store(int slot, const Binding& binding, bool dirty, bool immediateTag) const {
	if (binding.tagLane) {
		if (dirty) sljit_emit_op1(m_compiler, SLJIT_MOV_U8, SLJIT_MEM1(m_tags), binding.guest, host(slot).reg, 0);
		return;
	}
	if (dirty) {
		const auto offset = static_cast<sljit_sw>(binding.guest) * sizeof(u32);
		if (floating(slot))
			sljit_emit_fop1(m_compiler, SLJIT_MOV_F32, SLJIT_MEM1(m_words), offset, host(slot).reg, 0);
		else
			sljit_emit_op1(m_compiler, SLJIT_MOV32, SLJIT_MEM1(m_words), offset, host(slot).reg, 0);
	}
	if (immediateTag)
		sljit_emit_op1(
			m_compiler, SLJIT_MOV_U8, SLJIT_MEM1(m_tags), binding.guest, SLJIT_IMM, static_cast<u8>(*binding.tag));
}

int NativeRegisterCache::allocate(int guest, std::optional<ValueTag> tag, bool destination) {
	const int first = tag == ValueTag::Float ? static_cast<int>(m_integers.size()) : 0;
	const int end = tag == ValueTag::Float ? static_cast<int>(m_integers.size() + m_floats.size())
										   : static_cast<int>(m_integers.size());
	int selected = -1;
	for (int slot = first; slot < end; ++slot) {
		if (m_pinned[slot])
			continue;
		if (m_state[slot].guest < 0) {
			selected = slot;
			break;
		}
		if (selected < 0 || m_state[slot].nextUse > m_state[selected].nextUse ||
			(m_state[slot].nextUse == m_state[selected].nextUse &&
				(m_state[slot].dirty < m_state[selected].dirty ||
					(m_state[slot].dirty == m_state[selected].dirty &&
						m_state[slot].lastUse < m_state[selected].lastUse))))
			selected = slot;
	}
	// Three-operand instructions can reuse a pinned input as the destination.
	// Reads never evict another input still needed by this instruction.
	if (selected < 0 && destination) {
		for (int slot = first; slot < end; ++slot)
			if (selected < 0 || m_state[slot].nextUse > m_state[selected].nextUse ||
				(m_state[slot].nextUse == m_state[selected].nextUse &&
					m_state[slot].lastUse < m_state[selected].lastUse))
				selected = slot;
	}
	assert(selected >= 0);
	const auto& old = m_state[selected];
	if (old.guest >= 0)
		store(selected, old, old.dirty, old.immediateTagDirty);
	m_state[selected] = Binding{.guest = guest, .tag = tag};
	return selected;
}

NativeRegisterCache::Operand NativeRegisterCache::operand(int slot) {
	m_state[slot].lastUse = ++m_clock;
	m_pinned[slot] = true;
	return {host(slot).reg, *m_state[slot].tag, slot};
}

NativeRegisterCache::Operand NativeRegisterCache::read(int guest, ValueTag tag) {
	int slot = find(guest);
	if (slot < 0) {
		slot = allocate(guest, tag, false);
		load(slot, guest);
	} else if (floating(slot) != (tag == ValueTag::Float)) {
		const auto old = m_state[slot];
		const int destination = allocate(guest, tag, false);
		movePayload(destination, host(slot).reg, floating(slot));
		m_state[destination].dirty = old.dirty;
		m_state[destination].immediateTagDirty = old.immediateTagDirty;
		m_state[slot] = {};
		slot = destination;
	}
	m_state[slot].tag = tag;
	return operand(slot);
}

NativeRegisterCache::RawResult NativeRegisterCache::writeRaw(int guest) {
	// Called at a result definition, after all inputs have been consumed.
	beginInstruction();
	discardRange(guest, guest + 1);
	const int payload = allocate(guest, std::nullopt, false);
	m_pinned[payload] = true;
	m_state[payload].dirty = true;
	const int type = allocate(guest, std::nullopt, false);
	m_state[type].tagLane = m_state[type].dirty = true;
	return {host(payload).reg, host(type).reg};
}

NativeRegisterCache::Operand NativeRegisterCache::write(int guest, ValueTag tag) {
	int slot = find(guest);
	const int dynamic = find(guest, true);
	if (dynamic >= 0) m_state[dynamic] = {};
	const bool immediateTagDirty = dynamic >= 0 || slot < 0 || m_state[slot].immediateTagDirty || m_state[slot].tag != tag;
	if (slot >= 0 && floating(slot) != (tag == ValueTag::Float)) {
		m_state[slot] = {};
		slot = -1;
	}
	if (slot < 0)
		slot = allocate(guest, tag, true);
	m_state[slot].tag = tag;
	m_state[slot].dirty = true;
	m_state[slot].immediateTagDirty = immediateTagDirty;
	return operand(slot);
}

void NativeRegisterCache::discardRange(int first, int end) {
	for (auto& binding : m_state)
		if (binding.guest >= first && binding.guest < end)
			binding = {};
}

void NativeRegisterCache::publishRange(int first, int end) {
	for (int slot = 0; slot < static_cast<int>(m_integers.size() + m_floats.size()); ++slot) {
		auto& binding = m_state[slot];
		if (binding.guest < first || binding.guest >= end)
			continue;
		store(slot, binding, binding.dirty, binding.immediateTagDirty);
		binding.dirty = binding.immediateTagDirty = false;
	}
}

void NativeRegisterCache::publish() {
	publishRange(0, std::numeric_limits<int>::max());
}

void NativeRegisterCache::emitState(const State& state) const {
	for (int slot = 0; slot < static_cast<int>(m_integers.size() + m_floats.size()); ++slot) {
		const auto& binding = state[slot];
		if (binding.guest >= 0)
			store(slot, binding, binding.dirty, binding.immediateTagDirty);
	}
}

bool NativeRegisterCache::samePublication(const State& left, const State& right) const {
	// Only dirty planes emit stores. Clean facts and allocation priorities
	// cannot affect a handoff after control has left the native region.
	const size_t count = m_integers.size() + m_floats.size();
	for (size_t slot = 0; slot < count; ++slot) {
		const auto& a = left[slot];
		const auto& b = right[slot];
		if (a.dirty != b.dirty || a.immediateTagDirty != b.immediateTagDirty) return false;
		if ((a.dirty || a.immediateTagDirty) && (a.guest != b.guest || a.tagLane != b.tagLane)) return false;
		if (a.immediateTagDirty && a.tag != b.tag) return false;
	}
	return true;
}

void NativeRegisterCache::setState(const State& state) {
	m_state = state;
	m_clock = 0;
	for (const auto& binding : m_state)
		m_clock = std::max(m_clock, binding.lastUse);
	beginInstruction();
}

void NativeRegisterCache::spillCall(bool reload, sljit_sw stackOffset) const {
	for (int slot = 0; slot < static_cast<int>(m_integers.size() + m_floats.size()); ++slot) {
		if (m_state[slot].guest < 0 || host(slot).calleeSaved)
			continue;
		const auto offset = stackOffset + slot * sizeof(u32);
		if (floating(slot))
			sljit_emit_fop1(m_compiler, SLJIT_MOV_F32, reload ? host(slot).reg : SLJIT_MEM1(SLJIT_SP),
				reload ? 0 : offset, reload ? SLJIT_MEM1(SLJIT_SP) : host(slot).reg, reload ? offset : 0);
		else
			sljit_emit_op1(m_compiler, SLJIT_MOV32, reload ? host(slot).reg : SLJIT_MEM1(SLJIT_SP), reload ? 0 : offset,
				reload ? SLJIT_MEM1(SLJIT_SP) : host(slot).reg, reload ? offset : 0);
	}
}

void NativeRegisterCache::transferTo(const State& target, sljit_s32 integerScratch, sljit_s32 floatScratch) {
	const int count = static_cast<int>(m_integers.size() + m_floats.size());
	std::array<int, capacity> sources;
	sources.fill(-1);
	for (int destination = 0; destination < count; ++destination)
		if (target[destination].guest >= 0)
			sources[destination] = find(target[destination].guest, target[destination].tagLane);

	for (int source = 0; source < count; ++source) {
		const auto& value = m_state[source];
		if (value.guest < 0)
			continue;
		int destination = 0;
		while (destination < count && sources[destination] != source)
			++destination;
		store(source, value, value.dirty && (destination == count || !target[destination].dirty),
			value.immediateTagDirty && (destination == count || !target[destination].immediateTagDirty));
	}
	struct Move {
		int source, destination;
	};
	std::array<Move, capacity> moves;
	int remaining = 0;
	bool savedFloat = false;
	for (int destination = 0; destination < count; ++destination)
		if (target[destination].guest >= 0 && sources[destination] != destination)
			moves[remaining++] = {sources[destination], destination};
	while (remaining != 0) {
		int ready = 0;
		for (; ready < remaining; ++ready) {
			int reader = 0;
			while (reader < remaining && moves[reader].source != moves[ready].destination)
				++reader;
			if (reader == remaining)
				break;
		}
		if (ready == remaining) {
			const int saved = moves[0].destination;
			savedFloat = floating(saved);
			if (savedFloat)
				sljit_emit_fop1(m_compiler, SLJIT_MOV_F32, floatScratch, 0, host(saved).reg, 0);
			else
				sljit_emit_op1(m_compiler, SLJIT_MOV32, integerScratch, 0, host(saved).reg, 0);
			for (int index = 0; index < remaining; ++index)
				if (moves[index].source == saved)
					moves[index].source = -2;
			continue;
		}
		const auto move = moves[ready];
		if (move.source == -1) {
			if (target[move.destination].tagLane)
				sljit_emit_op1(m_compiler, SLJIT_MOV_U8, host(move.destination).reg, 0, SLJIT_MEM1(m_tags), target[move.destination].guest);
			else
				load(move.destination, target[move.destination].guest);
		} else if (move.source == -2)
			movePayload(move.destination, savedFloat ? floatScratch : integerScratch, savedFloat);
		else
			movePayload(move.destination, host(move.source).reg, floating(move.source));
		moves[ready] = moves[--remaining];
	}
	setState(target);
}

} // namespace bmsx
