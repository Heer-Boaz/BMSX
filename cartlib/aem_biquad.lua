-- aem_biquad.lua
-- Authoring-time Audio Event Map biquad design. The APU consumes only packed raw coefficients.

local apu<const> = require('cartlib/apu')

local design_coefficients<const> = function(filter_type, frequency, q, gain)
	local omega<const> = 2 * math.pi * frequency / apu.output_sample_rate_hz
	local sin_omega<const> = math.sin(omega)
	local cos_omega<const> = math.cos(omega)
	local alpha<const> = sin_omega / (2 * q)
	local b0
	local b1
	local b2
	local a0
	local a1
	local a2

	if filter_type == 'lowpass' then
		b0 = (1 - cos_omega) * 0.5
		b1 = 1 - cos_omega
		b2 = b0
		a0 = 1 + alpha
		a1 = -2 * cos_omega
		a2 = 1 - alpha
	elseif filter_type == 'highpass' then
		b0 = (1 + cos_omega) * 0.5
		b1 = -(1 + cos_omega)
		b2 = b0
		a0 = 1 + alpha
		a1 = -2 * cos_omega
		a2 = 1 - alpha
	elseif filter_type == 'bandpass' then
		b0 = sin_omega * 0.5
		b1 = 0
		b2 = -b0
		a0 = 1 + alpha
		a1 = -2 * cos_omega
		a2 = 1 - alpha
	elseif filter_type == 'notch' then
		b0 = 1
		b1 = -2 * cos_omega
		b2 = 1
		a0 = 1 + alpha
		a1 = b1
		a2 = 1 - alpha
	elseif filter_type == 'allpass' then
		b0 = 1 - alpha
		b1 = -2 * cos_omega
		b2 = 1 + alpha
		a0 = b2
		a1 = b1
		a2 = b0
	elseif filter_type == 'peaking' then
		local amplitude<const> = 10 ^ (gain / 40)
		b0 = 1 + alpha * amplitude
		b1 = -2 * cos_omega
		b2 = 1 - alpha * amplitude
		a0 = 1 + alpha / amplitude
		a1 = b1
		a2 = 1 - alpha / amplitude
	elseif filter_type == 'lowshelf' then
		local amplitude<const> = 10 ^ (gain / 40)
		local two_sqrt_amplitude_alpha<const> = 2 * math.sqrt(amplitude) * alpha
		b0 = amplitude * ((amplitude + 1) - (amplitude - 1) * cos_omega + two_sqrt_amplitude_alpha)
		b1 = 2 * amplitude * ((amplitude - 1) - (amplitude + 1) * cos_omega)
		b2 = amplitude * ((amplitude + 1) - (amplitude - 1) * cos_omega - two_sqrt_amplitude_alpha)
		a0 = (amplitude + 1) + (amplitude - 1) * cos_omega + two_sqrt_amplitude_alpha
		a1 = -2 * ((amplitude - 1) + (amplitude + 1) * cos_omega)
		a2 = (amplitude + 1) + (amplitude - 1) * cos_omega - two_sqrt_amplitude_alpha
	else
		local amplitude<const> = 10 ^ (gain / 40)
		local two_sqrt_amplitude_alpha<const> = 2 * math.sqrt(amplitude) * alpha
		b0 = amplitude * ((amplitude + 1) + (amplitude - 1) * cos_omega + two_sqrt_amplitude_alpha)
		b1 = -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cos_omega)
		b2 = amplitude * ((amplitude + 1) + (amplitude - 1) * cos_omega - two_sqrt_amplitude_alpha)
		a0 = (amplitude + 1) - (amplitude - 1) * cos_omega + two_sqrt_amplitude_alpha
		a1 = 2 * ((amplitude - 1) - (amplitude + 1) * cos_omega)
		a2 = (amplitude + 1) - (amplitude - 1) * cos_omega - two_sqrt_amplitude_alpha
	end

	local normalization<const> = 1 / a0
	return b0 * normalization, b1 * normalization, b2 * normalization, a1 * normalization, a2 * normalization
end

local design<const> = function(filter)
	local b0<const>, b1<const>, b2<const>, a1<const>, a2<const> = design_coefficients(filter.type, filter.frequency, filter.q, filter.gain)
	local b0_word<const> = apu.encode_filter_coefficient(b0)
	local b1_word<const> = apu.encode_filter_coefficient(b1)
	local b2_word<const> = apu.encode_filter_coefficient(b2)
	local a1_word<const> = apu.encode_filter_coefficient(a1)
	local a2_word<const> = apu.encode_filter_coefficient(a2)
	return apu.filter_control_enable, apu.pack_filter_coefficients(b0_word, b1_word), apu.pack_filter_coefficients(b2_word, a1_word), a2_word
end

return {
	design = design,
}
