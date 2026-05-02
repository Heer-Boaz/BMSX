#include "machine/devices/vdp/pmu.h"

#include "machine/devices/vdp/fixed_point.h"

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

void VdpPmuUnit::reset() {
	for (VdpPmuBank& bank : m_banks) {
		resetPmuBank(bank);
	}
	m_selectedBank = 0u;
}

void VdpPmuUnit::selectBank(u32 bank) {
	m_selectedBank = bank & 0xffu;
}

void VdpPmuUnit::writeSelectedBankRegister(VdpPmuRegister reg, u32 value) {
	VdpPmuBank& bank = m_banks[m_selectedBank];
	switch (reg) {
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

VdpPmuRegisterWindow VdpPmuUnit::registerWindow() const {
	const VdpPmuBank& bank = m_banks[m_selectedBank];
	VdpPmuRegisterWindow window;
	window.bank = m_selectedBank;
	window.x = bank.xQ16;
	window.y = bank.yQ16;
	window.scaleX = bank.scaleXQ16;
	window.scaleY = bank.scaleYQ16;
	window.control = bank.control;
	return window;
}

VdpPmuUnit::BankWords VdpPmuUnit::captureBankWords() const {
	BankWords words{};
	for (size_t bankIndex = 0; bankIndex < VDP_PMU_BANK_COUNT; ++bankIndex) {
		const VdpPmuBank& bank = m_banks[bankIndex];
		const size_t base = bankIndex * VDP_PMU_BANK_WORD_STRIDE;
		words[base + VDP_PMU_BANK_X_WORD] = bank.xQ16;
		words[base + VDP_PMU_BANK_Y_WORD] = bank.yQ16;
		words[base + VDP_PMU_BANK_SCALE_X_WORD] = bank.scaleXQ16;
		words[base + VDP_PMU_BANK_SCALE_Y_WORD] = bank.scaleYQ16;
		words[base + VDP_PMU_BANK_CONTROL_WORD] = bank.control;
	}
	return words;
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

VdpResolvedBlitPmu VdpPmuUnit::resolveBlit(f32 dstX, f32 dstY, f32 scaleX, f32 scaleY, u32 pmuBank, f32 parallaxWeight) const {
	if (parallaxWeight == 0.0f) {
		return VdpResolvedBlitPmu{dstX, dstY, scaleX, scaleY};
	}
	const VdpPmuBank& bank = m_banks[pmuBank & 0xffu];
	const f32 bankScaleX = decodeSignedQ16_16(bank.scaleXQ16);
	const f32 bankScaleY = decodeSignedQ16_16(bank.scaleYQ16);
	const f32 resolvedScaleFactorX = 1.0f + (bankScaleX - 1.0f) * parallaxWeight;
	const f32 resolvedScaleFactorY = 1.0f + (bankScaleY - 1.0f) * parallaxWeight;
	const f32 resolvedScaleX = scaleX * resolvedScaleFactorX;
	const f32 resolvedScaleY = scaleY * resolvedScaleFactorY;
	const f32 resolvedDstX = dstX + decodeSignedQ16_16(bank.xQ16) * parallaxWeight;
	const f32 resolvedDstY = dstY + decodeSignedQ16_16(bank.yQ16) * parallaxWeight;
	return VdpResolvedBlitPmu{resolvedDstX, resolvedDstY, resolvedScaleX, resolvedScaleY};
}

} // namespace bmsx
