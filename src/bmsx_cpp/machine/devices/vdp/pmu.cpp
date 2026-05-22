#include "machine/devices/vdp/pmu.h"

namespace bmsx {

namespace {

void resetPmuBank(VdpPmuBank& bank) {
	bank.xQ16 = 0u;
	bank.yQ16 = 0u;
	bank.scaleXQ16 = VDP_PMU_Q16_ONE;
	bank.scaleYQ16 = VDP_PMU_Q16_ONE;
	bank.control = 0u;
}

} // namespace

VdpPmuUnit::VdpPmuUnit() {
	reset();
}

void VdpPmuUnit::reset() {
	for (VdpPmuBank& bank : m_banks) {
		resetPmuBank(bank);
	}
	m_selectedBank = 0u;
}

void VdpPmuUnit::selectBank(u32 bank) {
	m_selectedBank = bank & 0xffu;
}

void VdpPmuUnit::writeSelectedBankRegister(VdpPmuRegister pmuRegister, u32 value) {
	VdpPmuBank& bank = m_banks[m_selectedBank];
	switch (pmuRegister) {
		case VdpPmuRegister::X:
			bank.xQ16 = value;
			break;
		case VdpPmuRegister::Y:
			bank.yQ16 = value;
			break;
		case VdpPmuRegister::ScaleX:
			bank.scaleXQ16 = value;
			break;
		case VdpPmuRegister::ScaleY:
			bank.scaleYQ16 = value;
			break;
		case VdpPmuRegister::Control:
			bank.control = value;
			break;
	}
}

void VdpPmuUnit::writeRegisterWindow(VdpPmuRegisterWindow& target) const {
	const VdpPmuBank& bank = m_banks[m_selectedBank];
	target.bank = m_selectedBank;
	target.x = bank.xQ16;
	target.y = bank.yQ16;
	target.scaleX = bank.scaleXQ16;
	target.scaleY = bank.scaleYQ16;
	target.control = bank.control;
}

void VdpPmuUnit::captureBankWords(BankWords& target) const {
	for (size_t bankIndex = 0; bankIndex < VDP_PMU_BANK_COUNT; ++bankIndex) {
		const VdpPmuBank& bank = m_banks[bankIndex];
		const size_t base = bankIndex * VDP_PMU_BANK_WORD_STRIDE;
		target[base + VDP_PMU_BANK_X_WORD] = bank.xQ16;
		target[base + VDP_PMU_BANK_Y_WORD] = bank.yQ16;
		target[base + VDP_PMU_BANK_SCALE_X_WORD] = bank.scaleXQ16;
		target[base + VDP_PMU_BANK_SCALE_Y_WORD] = bank.scaleYQ16;
		target[base + VDP_PMU_BANK_CONTROL_WORD] = bank.control;
	}
}

void VdpPmuUnit::restoreBankWords(u32 selectedBank, const BankWords& words) {
	for (size_t bankIndex = 0; bankIndex < VDP_PMU_BANK_COUNT; ++bankIndex) {
		VdpPmuBank& bank = m_banks[bankIndex];
		const size_t base = bankIndex * VDP_PMU_BANK_WORD_STRIDE;
		bank.xQ16 = words[base + VDP_PMU_BANK_X_WORD];
		bank.yQ16 = words[base + VDP_PMU_BANK_Y_WORD];
		bank.scaleXQ16 = words[base + VDP_PMU_BANK_SCALE_X_WORD];
		bank.scaleYQ16 = words[base + VDP_PMU_BANK_SCALE_Y_WORD];
		bank.control = words[base + VDP_PMU_BANK_CONTROL_WORD];
	}
	selectBank(selectedBank);
}

} // namespace bmsx
