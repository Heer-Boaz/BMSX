#pragma once

#include "machine/devices/cartridge/contracts.h"

namespace bmsx {

class CartridgeMailbox {
public:
	void reset();
	CartridgeMailboxState captureState() const;
	void restoreState(const CartridgeMailboxState& state);
	u32 readWord(u32 offset) const;
	u32 writeWord(u32 offset, u32 value);
	u32 dreqLines() const;

private:
	u32 m_dataWord = 0u;
	u32 m_controlWord = 0u;
	bool m_irqPending = false;
};

} // namespace bmsx
