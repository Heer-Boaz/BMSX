#include "machine/devices/cartridge/mailbox.h"

#include "machine/devices/cartridge/signals.h"
#include "spec/bmsx/cartridge.h"

namespace bmsx {

void CartridgeMailbox::reset() {
	m_dataWord = 0u;
	m_controlWord = 0u;
	m_irqPending = false;
}

CartridgeMailboxState CartridgeMailbox::captureState() const {
	return CartridgeMailboxState{
		m_dataWord,
		m_controlWord,
		m_irqPending,
	};
}

void CartridgeMailbox::restoreState(const CartridgeMailboxState& state) {
	m_dataWord = state.dataWord;
	m_controlWord = state.controlWord;
	m_irqPending = state.irqPending;
}

u32 CartridgeMailbox::readWord(u32 offset) const {
	switch (offset & ~3u) {
		case CARTRIDGE_MAILBOX_DATA_OFFSET:
			return m_dataWord;
		case CARTRIDGE_MAILBOX_CONTROL_OFFSET:
			return m_controlWord;
		case CARTRIDGE_MAILBOX_STATUS_OFFSET:
			return m_irqPending ? CARTRIDGE_MAILBOX_STATUS_IRQ_PENDING : 0u;
		default:
			return 0u;
	}
}

u32 CartridgeMailbox::writeWord(u32 offset, u32 value) {
	switch (offset) {
		case CARTRIDGE_MAILBOX_DATA_OFFSET:
			m_dataWord = value;
			return 0u;
		case CARTRIDGE_MAILBOX_CONTROL_OFFSET: {
			const u32 previousDreq = dreqLines();
			m_controlWord = value & ~CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER;
			u32 effects = previousDreq == dreqLines()
				? 0u
				: CARTRIDGE_CARD_EFFECT_DREQ_CHANGED;
			if ((value & CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER) != 0u && !m_irqPending) {
				m_irqPending = true;
				effects |= CARTRIDGE_CARD_EFFECT_IRQ_EDGE;
			}
			return effects;
		}
		case CARTRIDGE_MAILBOX_IRQ_ACK_OFFSET:
			if (value != 0u) m_irqPending = false;
			return 0u;
		default:
			return 0u;
	}
}

u32 CartridgeMailbox::dreqLines() const {
	u32 lines = 0u;
	if ((m_controlWord & CARTRIDGE_MAILBOX_CONTROL_DREQ_READ) != 0u) {
		lines |= CARTRIDGE_CARD_DREQ_READ;
	}
	if ((m_controlWord & CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE) != 0u) {
		lines |= CARTRIDGE_CARD_DREQ_WRITE;
	}
	return lines;
}

} // namespace bmsx
