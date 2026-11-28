#pragma once

#include <array>
#include <limits>
#include <span>
#include <vector>

#include "machine/cpu/jit/ir/operations.h"

namespace bmsx {

struct NativeInstruction;

// Identity of captured guest value bits within one value-flow scope. This
// neither names a guest slot nor commits it to a physical host register.
enum class NativeValueId : u16 { None };

struct NativeValueOrigin {
	static constexpr u16 Entry = std::numeric_limits<u16>::max();
	static constexpr u16 Opaque = Entry - 1;
	u16 producer;
	NativeValueRef slot;
	bool operator==(const NativeValueOrigin&) const = default;
};

struct NativeRowValues {
	std::array<NativeValueId, 3> inputs{};
	NativeValueId result{};
};

// A sparse value map shared by field planning (one source run) and type
// specialization (one published block). Resetting a scope gives independent
// identities to incoming slots, even if a preceding source run copied them.
class NativeSlotValues {
public:
	void beginRegion(std::span<const NativeInstruction> instructions);
	void beginScope();
	NativeRowValues advance(const NativeInstruction& instruction, u16 row);
	NativeValueId slot(NativeSlot slot);
	NativeValueId current(int slot) const;
	NativeValueOrigin origin(NativeValueId value) const { return m_origins[static_cast<u16>(value) - 1u]; }

private:
	struct Binding {
		NativeSlot slot;
		u16 producer = NativeValueOrigin::Entry;
		NativeValueId value{};
		u32 generation = 0;
	};
	NativeValueId create(u16 producer, NativeValueRef slot);
	NativeValueId read(Binding& binding);

	std::vector<Binding> m_slots;
	std::vector<NativeValueOrigin> m_origins;
	u32 m_generation = 0;
};

} // namespace bmsx
