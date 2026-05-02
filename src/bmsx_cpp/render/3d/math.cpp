#include "render/3d/math.h"

#include <cmath>
#include <cstring>

namespace bmsx::Render3D {
namespace {

constexpr f32 kPi = 3.14159265358979323846f;

f32 len3(f32 x, f32 y, f32 z) {
	return std::sqrt(x * x + y * y + z * z);
}

f32 len4(f32 x, f32 y, f32 z, f32 w) {
	return std::sqrt(x * x + y * y + z * z + w * w);
}

void mat4Zero(Mat4& out) {
	out = {};
}

void mat3Zero(Mat3& out) {
	out = {};
}

bool invertUpperLeft3Into(Mat3& out, const Mat4& m) {
	const f32 a00 = m[0], a01 = m[1], a02 = m[2];
	const f32 a10 = m[4], a11 = m[5], a12 = m[6];
	const f32 a20 = m[8], a21 = m[9], a22 = m[10];
	const f32 b01 = a22 * a11 - a12 * a21;
	const f32 b11 = -a22 * a10 + a12 * a20;
	const f32 b21 = a21 * a10 - a11 * a20;
	const f32 detRaw = a00 * b01 + a01 * b11 + a02 * b21;
	if (detRaw == 0.0f) {
		mat3Zero(out);
		return false;
	}

	const f32 det = 1.0f / detRaw;
	out[0] = b01 * det;
	out[1] = (-a22 * a01 + a02 * a21) * det;
	out[2] = (a12 * a01 - a02 * a11) * det;
	out[3] = b11 * det;
	out[4] = (a22 * a00 - a02 * a20) * det;
	out[5] = (-a12 * a00 + a02 * a10) * det;
	out[6] = b21 * det;
	out[7] = (-a21 * a00 + a01 * a20) * det;
	out[8] = (a11 * a00 - a01 * a10) * det;
	return true;
}

f32 clampUnit(f32 value) {
	if (value < -1.0f) {
		return -1.0f;
	}
	if (value > 1.0f) {
		return 1.0f;
	}
	return value;
}

u32 f32Bits(f32 value) {
	u32 bits = 0;
	std::memcpy(&bits, &value, sizeof(bits));
	return bits;
}

void normalizePlane(PlanePack& out, size_t i) {
	const f32 nx = out[i];
	const f32 ny = out[i + 1];
	const f32 nz = out[i + 2];
	const f32 length = std::sqrt(nx * nx + ny * ny + nz * nz);
	const f32 inv = length == 0.0f ? 1.0f : 1.0f / length;
	out[i] *= inv;
	out[i + 1] *= inv;
	out[i + 2] *= inv;
	out[i + 3] *= inv;
}

void postRotateColumnPair(Mat4& m, size_t first, size_t second, f32 c, f32 s) {
	const f32 a0 = m[first], a1 = m[first + 1], a2 = m[first + 2], a3 = m[first + 3];
	const f32 b0 = m[second], b1 = m[second + 1], b2 = m[second + 2], b3 = m[second + 3];
	m[first] = a0 * c + b0 * s;
	m[first + 1] = a1 * c + b1 * s;
	m[first + 2] = a2 * c + b2 * s;
	m[first + 3] = a3 * c + b3 * s;
	m[second] = b0 * c - a0 * s;
	m[second + 1] = b1 * c - a1 * s;
	m[second + 2] = b2 * c - a2 * s;
	m[second + 3] = b3 * c - a3 * s;
}

} // namespace

const Mat4 kIdentityMat4{
	1.0f, 0.0f, 0.0f, 0.0f,
	0.0f, 1.0f, 0.0f, 0.0f,
	0.0f, 0.0f, 1.0f, 0.0f,
	0.0f, 0.0f, 0.0f, 1.0f,
};

void mat4SetIdentity(Mat4& out) {
	out = kIdentityMat4;
}

void mat4CopyInto(Mat4& out, const Mat4& src) {
	out = src;
}

void mat4MulInto(Mat4& out, const Mat4& a, const Mat4& b) {
	const f32 b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
	const f32 b4 = b[4], b5 = b[5], b6 = b[6], b7 = b[7];
	const f32 b8 = b[8], b9 = b[9], b10 = b[10], b11 = b[11];
	const f32 b12 = b[12], b13 = b[13], b14 = b[14], b15 = b[15];
	for (size_t i = 0; i < 4; ++i) {
		const f32 ai0 = a[i];
		const f32 ai1 = a[i + 4];
		const f32 ai2 = a[i + 8];
		const f32 ai3 = a[i + 12];
		out[i] = ai0 * b0 + ai1 * b1 + ai2 * b2 + ai3 * b3;
		out[i + 4] = ai0 * b4 + ai1 * b5 + ai2 * b6 + ai3 * b7;
		out[i + 8] = ai0 * b8 + ai1 * b9 + ai2 * b10 + ai3 * b11;
		out[i + 12] = ai0 * b12 + ai1 * b13 + ai2 * b14 + ai3 * b15;
	}
}

void mat4MulAffineInto(Mat4& out, const Mat4& a, const Mat4& b) {
	const f32 a00 = a[0], a01 = a[4], a02 = a[8], a03 = a[12];
	const f32 a10 = a[1], a11 = a[5], a12 = a[9], a13 = a[13];
	const f32 a20 = a[2], a21 = a[6], a22 = a[10], a23 = a[14];
	const f32 b0 = b[0], b1 = b[1], b2 = b[2];
	const f32 b4 = b[4], b5 = b[5], b6 = b[6];
	const f32 b8 = b[8], b9 = b[9], b10 = b[10];
	const f32 b12 = b[12], b13 = b[13], b14 = b[14];

	out[0] = a00 * b0 + a01 * b1 + a02 * b2;
	out[4] = a00 * b4 + a01 * b5 + a02 * b6;
	out[8] = a00 * b8 + a01 * b9 + a02 * b10;
	out[1] = a10 * b0 + a11 * b1 + a12 * b2;
	out[5] = a10 * b4 + a11 * b5 + a12 * b6;
	out[9] = a10 * b8 + a11 * b9 + a12 * b10;
	out[2] = a20 * b0 + a21 * b1 + a22 * b2;
	out[6] = a20 * b4 + a21 * b5 + a22 * b6;
	out[10] = a20 * b8 + a21 * b9 + a22 * b10;
	out[12] = a00 * b12 + a01 * b13 + a02 * b14 + a03;
	out[13] = a10 * b12 + a11 * b13 + a12 * b14 + a13;
	out[14] = a20 * b12 + a21 * b13 + a22 * b14 + a23;
	out[3] = 0.0f;
	out[7] = 0.0f;
	out[11] = 0.0f;
	out[15] = 1.0f;
}

void mat4TransposeInto(Mat4& out, const Mat4& a) {
	if (&out == &a) {
		f32 t = out[1]; out[1] = out[4]; out[4] = t;
		t = out[2]; out[2] = out[8]; out[8] = t;
		t = out[3]; out[3] = out[12]; out[12] = t;
		t = out[6]; out[6] = out[9]; out[9] = t;
		t = out[7]; out[7] = out[13]; out[13] = t;
		t = out[11]; out[11] = out[14]; out[14] = t;
		return;
	}

	out[0] = a[0]; out[1] = a[4]; out[2] = a[8]; out[3] = a[12];
	out[4] = a[1]; out[5] = a[5]; out[6] = a[9]; out[7] = a[13];
	out[8] = a[2]; out[9] = a[6]; out[10] = a[10]; out[11] = a[14];
	out[12] = a[3]; out[13] = a[7]; out[14] = a[11]; out[15] = a[15];
}

void mat4TranslateSelf(Mat4& m, f32 x, f32 y, f32 z) {
	m[12] += m[0] * x + m[4] * y + m[8] * z;
	m[13] += m[1] * x + m[5] * y + m[9] * z;
	m[14] += m[2] * x + m[6] * y + m[10] * z;
	m[15] += m[3] * x + m[7] * y + m[11] * z;
}

void mat4ScaleSelf(Mat4& m, f32 x, f32 y, f32 z) {
	m[0] *= x; m[1] *= x; m[2] *= x; m[3] *= x;
	m[4] *= y; m[5] *= y; m[6] *= y; m[7] *= y;
	m[8] *= z; m[9] *= z; m[10] *= z; m[11] *= z;
}

void mat4RotateXSelf(Mat4& m, f32 radians) {
	const f32 c = std::cos(radians);
	const f32 s = std::sin(radians);
	postRotateColumnPair(m, 4, 8, c, s);
}

void mat4RotateYSelf(Mat4& m, f32 radians) {
	const f32 c = std::cos(radians);
	const f32 s = std::sin(radians);
	const f32 m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3];
	const f32 m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11];
	m[0] = m0 * c - m8 * s;
	m[1] = m1 * c - m9 * s;
	m[2] = m2 * c - m10 * s;
	m[3] = m3 * c - m11 * s;
	m[8] = m0 * s + m8 * c;
	m[9] = m1 * s + m9 * c;
	m[10] = m2 * s + m10 * c;
	m[11] = m3 * s + m11 * c;
}

void mat4RotateZSelf(Mat4& m, f32 radians) {
	const f32 c = std::cos(radians);
	const f32 s = std::sin(radians);
	postRotateColumnPair(m, 0, 4, c, s);
}

void mat4QuatToMat4Into(Mat4& out, const Quat& q) {
	f32 x = q.x, y = q.y, z = q.z, w = q.w;
	const f32 length = len4(x, y, z, w);
	const f32 inv = length == 0.0f ? 1.0f : 1.0f / length;
	x *= inv;
	y *= inv;
	z *= inv;
	w *= inv;

	const f32 xx = x * x, yy = y * y, zz = z * z;
	const f32 xy = x * y, xz = x * z, yz = y * z;
	const f32 wx = w * x, wy = w * y, wz = w * z;
	out[0] = 1.0f - 2.0f * (yy + zz); out[1] = 2.0f * (xy + wz); out[2] = 2.0f * (xz - wy); out[3] = 0.0f;
	out[4] = 2.0f * (xy - wz); out[5] = 1.0f - 2.0f * (xx + zz); out[6] = 2.0f * (yz + wx); out[7] = 0.0f;
	out[8] = 2.0f * (xz + wy); out[9] = 2.0f * (yz - wx); out[10] = 1.0f - 2.0f * (xx + yy); out[11] = 0.0f;
	out[12] = 0.0f; out[13] = 0.0f; out[14] = 0.0f; out[15] = 1.0f;
}

void mat4FromTRSInto(Mat4& out, const Vec3* translation, const Quat* rotation, const Vec3* scale) {
	if (rotation) {
		mat4QuatToMat4Into(out, *rotation);
	} else {
		mat4SetIdentity(out);
	}
	if (scale) {
		mat4ScaleSelf(out, scale->x, scale->y, scale->z);
	}
	if (translation) {
		mat4SetTranslationSelf(out, translation->x, translation->y, translation->z);
	}
}

void mat4PerspectiveInto(Mat4& out, f32 fovRad, f32 aspect, f32 nearPlane, f32 farPlane) {
	const f32 f = 1.0f / std::tan(fovRad * 0.5f);
	const f32 nf = 1.0f / (nearPlane - farPlane);
	out[0] = f / aspect; out[1] = 0.0f; out[2] = 0.0f; out[3] = 0.0f;
	out[4] = 0.0f; out[5] = f; out[6] = 0.0f; out[7] = 0.0f;
	out[8] = 0.0f; out[9] = 0.0f; out[10] = (farPlane + nearPlane) * nf; out[11] = -1.0f;
	out[12] = 0.0f; out[13] = 0.0f; out[14] = 2.0f * farPlane * nearPlane * nf; out[15] = 0.0f;
}

void mat4OrthographicInto(Mat4& out, f32 left, f32 right, f32 bottom, f32 top, f32 nearPlane, f32 farPlane) {
	const f32 lr = 1.0f / (left - right);
	const f32 bt = 1.0f / (bottom - top);
	const f32 nf = 1.0f / (nearPlane - farPlane);
	out[0] = -2.0f * lr; out[1] = 0.0f; out[2] = 0.0f; out[3] = 0.0f;
	out[4] = 0.0f; out[5] = -2.0f * bt; out[6] = 0.0f; out[7] = 0.0f;
	out[8] = 0.0f; out[9] = 0.0f; out[10] = 2.0f * nf; out[11] = 0.0f;
	out[12] = (left + right) * lr; out[13] = (top + bottom) * bt; out[14] = (farPlane + nearPlane) * nf; out[15] = 1.0f;
}

void mat4FisheyeInto(Mat4& out, f32 fovRad, f32, f32 nearPlane, f32 farPlane) {
	const f32 f = 1.0f / std::tan(fovRad * 0.5f);
	const f32 nf = 1.0f / (nearPlane - farPlane);
	out[0] = f; out[1] = 0.0f; out[2] = 0.0f; out[3] = 0.0f;
	out[4] = 0.0f; out[5] = f; out[6] = 0.0f; out[7] = 0.0f;
	out[8] = 0.0f; out[9] = 0.0f; out[10] = (farPlane + nearPlane) * nf; out[11] = -1.0f;
	out[12] = 0.0f; out[13] = 0.0f; out[14] = 2.0f * farPlane * nearPlane * nf; out[15] = 0.0f;
}

void mat4PanoramaInto(Mat4& out, f32 hFovRad, f32 aspect, f32 nearPlane, f32 farPlane) {
	const f32 t = std::tan(hFovRad * 0.5f);
	const f32 vFov = std::abs(aspect) > 0.000001f ? 2.0f * std::atan(t / aspect) : hFovRad;
	const f32 sx = 1.0f / t;
	const f32 sy = 1.0f / std::tan(vFov * 0.5f);
	const f32 nf = 1.0f / (nearPlane - farPlane);
	out[0] = sx; out[1] = 0.0f; out[2] = 0.0f; out[3] = 0.0f;
	out[4] = 0.0f; out[5] = sy; out[6] = 0.0f; out[7] = 0.0f;
	out[8] = 0.0f; out[9] = 0.0f; out[10] = (farPlane + nearPlane) * nf; out[11] = -1.0f;
	out[12] = 0.0f; out[13] = 0.0f; out[14] = 2.0f * farPlane * nearPlane * nf; out[15] = 0.0f;
}

void mat4ObliqueInto(Mat4& out,
					f32 left,
					f32 right,
					f32 bottom,
					f32 top,
					f32 nearPlane,
					f32 farPlane,
					f32 alphaRad,
					f32 betaRad) {
	Mat4 ortho{};
	Mat4 shear{};
	mat4OrthographicInto(ortho, left, right, bottom, top, nearPlane, farPlane);
	mat4SetIdentity(shear);
	shear[8] = 1.0f / std::tan(alphaRad);
	shear[9] = 1.0f / std::tan(betaRad);
	mat4MulAffineInto(out, shear, ortho);
}

void mat4AsymmetricFrustumInto(Mat4& out, f32 left, f32 right, f32 bottom, f32 top, f32 nearPlane, f32 farPlane) {
	const f32 rl = right - left;
	const f32 bt = top - bottom;
	const f32 fn = farPlane - nearPlane;
	out[0] = 2.0f * nearPlane / rl; out[1] = 0.0f; out[2] = 0.0f; out[3] = 0.0f;
	out[4] = 0.0f; out[5] = 2.0f * nearPlane / bt; out[6] = 0.0f; out[7] = 0.0f;
	out[8] = (right + left) / rl; out[9] = (top + bottom) / bt; out[10] = -(farPlane + nearPlane) / fn; out[11] = -1.0f;
	out[12] = 0.0f; out[13] = 0.0f; out[14] = -2.0f * farPlane * nearPlane / fn; out[15] = 0.0f;
}

void mat4IsometricInto(Mat4& out, f32 scale) {
	const f32 sqrt2 = std::sqrt(2.0f);
	const f32 sqrt6 = std::sqrt(6.0f);
	out[0] = scale * sqrt2 * 0.5f; out[1] = -scale * sqrt2 * 0.5f; out[2] = 0.0f; out[3] = 0.0f;
	out[4] = scale * sqrt2 / sqrt6; out[5] = scale * sqrt2 / sqrt6; out[6] = -scale * 2.0f / sqrt6; out[7] = 0.0f;
	out[8] = 0.0f; out[9] = 0.0f; out[10] = 0.0f; out[11] = 0.0f;
	out[12] = 0.0f; out[13] = 0.0f; out[14] = 0.0f; out[15] = 1.0f;
}

void mat4InfinitePerspectiveInto(Mat4& out, f32 fovRad, f32 aspect, f32 nearPlane) {
	const f32 f = 1.0f / std::tan(fovRad * 0.5f);
	out[0] = f / aspect; out[1] = 0.0f; out[2] = 0.0f; out[3] = 0.0f;
	out[4] = 0.0f; out[5] = f; out[6] = 0.0f; out[7] = 0.0f;
	out[8] = 0.0f; out[9] = 0.0f; out[10] = -1.0f; out[11] = -1.0f;
	out[12] = 0.0f; out[13] = 0.0f; out[14] = -2.0f * nearPlane; out[15] = 0.0f;
}

void mat4ExtractScaleInto(Vec3& out, const Mat4& m) {
	out.x = len3(m[0], m[1], m[2]);
	out.y = len3(m[4], m[5], m[6]);
	out.z = len3(m[8], m[9], m[10]);
}

f32 mat4MaxScale(const Mat4& m) {
	Vec3 scale{};
	mat4ExtractScaleInto(scale, m);
	f32 result = scale.x;
	if (scale.y > result) {
		result = scale.y;
	}
	if (scale.z > result) {
		result = scale.z;
	}
	return result == 0.0f ? 1.0f : result;
}

void mat4InvertAffineInto(Mat4& out, const Mat4& m) {
	Mat3 inv{};
	if (!invertUpperLeft3Into(inv, m)) {
		mat4Zero(out);
		return;
	}

	const f32 m00 = inv[0], m01 = inv[1], m02 = inv[2];
	const f32 m10 = inv[3], m11 = inv[4], m12 = inv[5];
	const f32 m20 = inv[6], m21 = inv[7], m22 = inv[8];
	out[0] = m00; out[1] = m01; out[2] = m02; out[3] = 0.0f;
	out[4] = m10; out[5] = m11; out[6] = m12; out[7] = 0.0f;
	out[8] = m20; out[9] = m21; out[10] = m22; out[11] = 0.0f;
	const f32 tx = m[12], ty = m[13], tz = m[14];
	out[12] = -(m00 * tx + m10 * ty + m20 * tz);
	out[13] = -(m01 * tx + m11 * ty + m21 * tz);
	out[14] = -(m02 * tx + m12 * ty + m22 * tz);
	out[15] = 1.0f;
}

void mat4InvertInto(Mat4& out, const Mat4& a) {
	const f32 a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
	const f32 a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
	const f32 a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
	const f32 a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
	const f32 b00 = a00 * a11 - a01 * a10;
	const f32 b01 = a00 * a12 - a02 * a10;
	const f32 b02 = a00 * a13 - a03 * a10;
	const f32 b03 = a01 * a12 - a02 * a11;
	const f32 b04 = a01 * a13 - a03 * a11;
	const f32 b05 = a02 * a13 - a03 * a12;
	const f32 b06 = a20 * a31 - a21 * a30;
	const f32 b07 = a20 * a32 - a22 * a30;
	const f32 b08 = a20 * a33 - a23 * a30;
	const f32 b09 = a21 * a32 - a22 * a31;
	const f32 b10 = a21 * a33 - a23 * a31;
	const f32 b11 = a22 * a33 - a23 * a32;
	const f32 detRaw = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
	if (detRaw == 0.0f) {
		mat4Zero(out);
		return;
	}

	const f32 det = 1.0f / detRaw;
	out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
	out[1] = (-a01 * b11 + a02 * b10 - a03 * b09) * det;
	out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
	out[3] = (-a21 * b05 + a22 * b04 - a23 * b03) * det;
	out[4] = (-a10 * b11 + a12 * b08 - a13 * b07) * det;
	out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
	out[6] = (-a30 * b05 + a32 * b02 - a33 * b01) * det;
	out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
	out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
	out[9] = (-a00 * b10 + a01 * b08 - a03 * b06) * det;
	out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
	out[11] = (-a20 * b04 + a21 * b02 - a23 * b00) * det;
	out[12] = (-a10 * b09 + a11 * b07 - a12 * b06) * det;
	out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
	out[14] = (-a30 * b03 + a31 * b01 - a32 * b00) * det;
	out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
}

void mat4LookAtInto(Mat4& out, const Vec3& eye, const Vec3& target, const Vec3& up) {
	f32 fx = target.x - eye.x;
	f32 fy = target.y - eye.y;
	f32 fz = target.z - eye.z;
	const f32 fLen = len3(fx, fy, fz);
	const f32 fInv = fLen == 0.0f ? 1.0f : 1.0f / fLen;
	fx *= fInv;
	fy *= fInv;
	fz *= fInv;

	f32 rx = fy * up.z - fz * up.y;
	f32 ry = fz * up.x - fx * up.z;
	f32 rz = fx * up.y - fy * up.x;
	f32 rLen = len3(rx, ry, rz);
	if (rLen < 0.00000001f) {
		const f32 altX = std::abs(fx) < 0.99f ? 1.0f : 0.0f;
		const f32 altY = std::abs(fx) < 0.99f ? 0.0f : 1.0f;
		rx = fy * 0.0f - fz * altY;
		ry = fz * altX - fx * 0.0f;
		rz = fx * altY - fy * altX;
		rLen = len3(rx, ry, rz);
	}
	const f32 rInv = rLen == 0.0f ? 1.0f : 1.0f / rLen;
	rx *= rInv;
	ry *= rInv;
	rz *= rInv;

	const Vec3 right{ rx, ry, rz };
	const Vec3 viewUp{ ry * fz - rz * fy, rz * fx - rx * fz, rx * fy - ry * fx };
	const Vec3 back{ -fx, -fy, -fz };
	mat4ViewFromBasisInto(out, eye, right, viewUp, back);
}

void mat4InvertRigidInto(Mat4& out, const Mat4& m) {
	const f32 r00 = m[0], r01 = m[1], r02 = m[2];
	const f32 r10 = m[4], r11 = m[5], r12 = m[6];
	const f32 r20 = m[8], r21 = m[9], r22 = m[10];
	const f32 tx = m[12], ty = m[13], tz = m[14];
	out[0] = r00; out[1] = r10; out[2] = r20; out[3] = 0.0f;
	out[4] = r01; out[5] = r11; out[6] = r21; out[7] = 0.0f;
	out[8] = r02; out[9] = r12; out[10] = r22; out[11] = 0.0f;
	out[12] = -(out[0] * tx + out[4] * ty + out[8] * tz);
	out[13] = -(out[1] * tx + out[5] * ty + out[9] * tz);
	out[14] = -(out[2] * tx + out[6] * ty + out[10] * tz);
	out[15] = 1.0f;
}

void mat4ViewFromBasisInto(Mat4& out, const Vec3& pos, const Vec3& right, const Vec3& up, const Vec3& back) {
	out[0] = right.x; out[4] = right.y; out[8] = right.z; out[12] = -(right.x * pos.x + right.y * pos.y + right.z * pos.z);
	out[1] = up.x; out[5] = up.y; out[9] = up.z; out[13] = -(up.x * pos.x + up.y * pos.y + up.z * pos.z);
	out[2] = back.x; out[6] = back.y; out[10] = back.z; out[14] = -(back.x * pos.x + back.y * pos.y + back.z * pos.z);
	out[3] = 0.0f; out[7] = 0.0f; out[11] = 0.0f; out[15] = 1.0f;
}

void mat4SkyboxFromViewInto(Mat4& out, const Mat4& view) {
	out[0] = view[0]; out[1] = view[4]; out[2] = view[8]; out[3] = 0.0f;
	out[4] = view[1]; out[5] = view[5]; out[6] = view[9]; out[7] = 0.0f;
	out[8] = view[2]; out[9] = view[6]; out[10] = view[10]; out[11] = 0.0f;
	out[12] = 0.0f; out[13] = 0.0f; out[14] = 0.0f; out[15] = 1.0f;
}

void mat4SetTranslationSelf(Mat4& m, f32 x, f32 y, f32 z) {
	m[12] = x;
	m[13] = y;
	m[14] = z;
}

void mat4GetTranslationInto(Vec3& out, const Mat4& m) {
	out.x = m[12];
	out.y = m[13];
	out.z = m[14];
}

void mat4SetRotationSelfFromQuat(Mat4& m, const Quat& q) {
	f32 x = q.x, y = q.y, z = q.z, w = q.w;
	const f32 length = len4(x, y, z, w);
	const f32 inv = length == 0.0f ? 1.0f : 1.0f / length;
	x *= inv;
	y *= inv;
	z *= inv;
	w *= inv;

	const f32 xx = x * x, yy = y * y, zz = z * z;
	const f32 xy = x * y, xz = x * z, yz = y * z;
	const f32 wx = w * x, wy = w * y, wz = w * z;
	m[0] = 1.0f - 2.0f * (yy + zz); m[1] = 2.0f * (xy + wz); m[2] = 2.0f * (xz - wy); m[3] = 0.0f;
	m[4] = 2.0f * (xy - wz); m[5] = 1.0f - 2.0f * (xx + zz); m[6] = 2.0f * (yz + wx); m[7] = 0.0f;
	m[8] = 2.0f * (xz + wy); m[9] = 2.0f * (yz - wx); m[10] = 1.0f - 2.0f * (xx + yy); m[11] = 0.0f;
}

void mat4ViewRightUpInto(const Mat4& view, Vec3& outRight, Vec3& outUp) {
	outRight.x = view[0];
	outRight.y = view[4];
	outRight.z = view[8];
	outUp.x = view[1];
	outUp.y = view[5];
	outUp.z = view[9];
}

void mat4Normal3Into(Mat3& out, const Mat4& model) {
	Mat3 inv{};
	if (!invertUpperLeft3Into(inv, model)) {
		mat3Zero(out);
		return;
	}

	out[0] = inv[0]; out[1] = inv[3]; out[2] = inv[6];
	out[3] = inv[1]; out[4] = inv[4]; out[5] = inv[7];
	out[6] = inv[2]; out[7] = inv[5]; out[8] = inv[8];
}

void mat4TransformPoint3Into(Vec3& out, const Mat4& m, f32 x, f32 y, f32 z) {
	const f32 w = m[3] * x + m[7] * y + m[11] * z + m[15];
	const f32 iw = w == 0.0f ? 1.0f : 1.0f / w;
	out.x = (m[0] * x + m[4] * y + m[8] * z + m[12]) * iw;
	out.y = (m[1] * x + m[5] * y + m[9] * z + m[13]) * iw;
	out.z = (m[2] * x + m[6] * y + m[10] * z + m[14]) * iw;
}

void mat4TransformDir3Into(Vec3& out, const Mat4& m, f32 x, f32 y, f32 z) {
	out.x = m[0] * x + m[4] * y + m[8] * z;
	out.y = m[1] * x + m[5] * y + m[9] * z;
	out.z = m[2] * x + m[6] * y + m[10] * z;
}

u16 float32ToFloat16(f32 value) {
	const u32 x = f32Bits(value);
	const u32 sign = (x >> 16u) & 0x8000u;
	const u32 mantissa = x & 0x007fffffu;
	i32 exponent = static_cast<i32>((x >> 23u) & 0xffu);
	if (exponent == 0xff) {
		return static_cast<u16>(mantissa != 0u ? sign | 0x7e00u : sign | 0x7c00u);
	}

	exponent = exponent - 127 + 15;
	if (exponent <= 0) {
		if (exponent < -10) {
			return static_cast<u16>(sign);
		}
		const u32 m = (mantissa | 0x00800000u) >> static_cast<u32>(1 - exponent);
		return static_cast<u16>(sign | ((m + 0x00000fffu + ((m >> 13u) & 1u)) >> 13u));
	}
	if (exponent >= 0x1f) {
		return static_cast<u16>(sign | 0x7c00u);
	}

	return static_cast<u16>(sign | (static_cast<u32>(exponent) << 10u) | ((mantissa + 0x00000fffu + ((mantissa >> 13u) & 1u)) >> 13u));
}

bool isMatrixMirrored(const Mat4& mat) {
	const f32 m00 = mat[0], m01 = mat[1], m02 = mat[2];
	const f32 m10 = mat[4], m11 = mat[5], m12 = mat[6];
	const f32 m20 = mat[8], m21 = mat[9], m22 = mat[10];
	const f32 det = m00 * (m11 * m22 - m12 * m21) -
					m01 * (m10 * m22 - m12 * m20) +
					m02 * (m10 * m21 - m11 * m20);
	return det < 0.0f;
}

void transformBoundingSphereCenterInto(Vec3& out, const Mat4& matrix, const Vec3& center) {
	out.x = matrix[12] + center.x * matrix[0] + center.y * matrix[4] + center.z * matrix[8];
	out.y = matrix[13] + center.x * matrix[1] + center.y * matrix[5] + center.z * matrix[9];
	out.z = matrix[14] + center.x * matrix[2] + center.y * matrix[6] + center.z * matrix[10];
}

f32 transformedBoundingSphereRadius(const Mat4& matrix, f32 radius) {
	return radius * mat4MaxScale(matrix);
}

f32 translationDistanceSquared(const Mat4& matrix, const Vec3& point) {
	const f32 dx = matrix[12] - point.x;
	const f32 dy = matrix[13] - point.y;
	const f32 dz = matrix[14] - point.z;
	return dx * dx + dy * dy + dz * dz;
}

void vec4Set(Vec4& out, f32 x, f32 y, f32 z, f32 w) {
	out.x = x;
	out.y = y;
	out.z = z;
	out.w = w;
}

void vec4FromArrayInto(Vec4& out, const std::array<f32, 4>& arr) {
	out.x = arr[0];
	out.y = arr[1];
	out.z = arr[2];
	out.w = arr[3];
}

void vec4ToArrayInto(std::array<f32, 4>& out, const Vec4& v) {
	out[0] = v.x;
	out[1] = v.y;
	out[2] = v.z;
	out[3] = v.w;
}

void vec3Set(Vec3& out, f32 x, f32 y, f32 z) {
	out.x = x;
	out.y = y;
	out.z = z;
}

void vec3Assign(Vec3& out, const Vec3& data) {
	out.x = data.x;
	out.y = data.y;
	out.z = data.z;
}

void vec3AddInto(Vec3& out, const Vec3& a, const Vec3& b) {
	out.x = a.x + b.x;
	out.y = a.y + b.y;
	out.z = a.z + b.z;
}

void vec3AddSelf(Vec3& out, const Vec3& b) {
	out.x += b.x;
	out.y += b.y;
	out.z += b.z;
}

void vec3SubInto(Vec3& out, const Vec3& a, const Vec3& b) {
	out.x = a.x - b.x;
	out.y = a.y - b.y;
	out.z = a.z - b.z;
}

void vec3SubSelf(Vec3& out, const Vec3& b) {
	out.x -= b.x;
	out.y -= b.y;
	out.z -= b.z;
}

void vec3ScaleInto(Vec3& out, const Vec3& a, f32 scale) {
	out.x = a.x * scale;
	out.y = a.y * scale;
	out.z = a.z * scale;
}

void vec3ScaleSelf(Vec3& out, f32 scale) {
	out.x *= scale;
	out.y *= scale;
	out.z *= scale;
}

f32 vec3Dot(const Vec3& a, const Vec3& b) {
	return a.x * b.x + a.y * b.y + a.z * b.z;
}

void vec3CrossInto(Vec3& out, const Vec3& a, const Vec3& b) {
	out.x = a.y * b.z - a.z * b.y;
	out.y = a.z * b.x - a.x * b.z;
	out.z = a.x * b.y - a.y * b.x;
}

f32 vec3Len(const Vec3& a) {
	return len3(a.x, a.y, a.z);
}

void vec3NormalizeInto(Vec3& out, const Vec3& a) {
	const f32 length = vec3Len(a);
	const f32 inv = length == 0.0f ? 1.0f : 1.0f / length;
	out.x = a.x * inv;
	out.y = a.y * inv;
	out.z = a.z * inv;
}

void vec3TruncInto(Vec3& out, const Vec3& a) {
	out.x = std::trunc(a.x);
	out.y = std::trunc(a.y);
	out.z = std::trunc(a.z);
}

bool vec3EqualsArray(const std::array<f32, 3>& a, const std::array<f32, 3>& b) {
	return a[0] == b[0] && a[1] == b[1] && a[2] == b[2];
}

void vec3RotateAroundAxisInto(Vec3& out, const Vec3& v, const Vec3& axis, f32 angle) {
	const f32 length = len3(axis.x, axis.y, axis.z);
	const f32 inv = length == 0.0f ? 1.0f : 1.0f / length;
	const f32 ax = axis.x * inv;
	const f32 ay = axis.y * inv;
	const f32 az = axis.z * inv;
	const f32 c = std::cos(angle);
	const f32 s = std::sin(angle);
	const f32 crossX = ay * v.z - az * v.y;
	const f32 crossY = az * v.x - ax * v.z;
	const f32 crossZ = ax * v.y - ay * v.x;
	const f32 dot = ax * v.x + ay * v.y + az * v.z;
	out.x = v.x * c + crossX * s + ax * dot * (1.0f - c);
	out.y = v.y * c + crossY * s + ay * dot * (1.0f - c);
	out.z = v.z * c + crossZ * s + az * dot * (1.0f - c);
}

void extractFrustumPlanesInto(PlanePack& out, const Mat4& viewProjection) {
	const Mat4& m = viewProjection;
	out[0] = m[3] + m[0]; out[1] = m[7] + m[4]; out[2] = m[11] + m[8]; out[3] = m[15] + m[12];
	out[4] = m[3] - m[0]; out[5] = m[7] - m[4]; out[6] = m[11] - m[8]; out[7] = m[15] - m[12];
	out[8] = m[3] + m[1]; out[9] = m[7] + m[5]; out[10] = m[11] + m[9]; out[11] = m[15] + m[13];
	out[12] = m[3] - m[1]; out[13] = m[7] - m[5]; out[14] = m[11] - m[9]; out[15] = m[15] - m[13];
	out[16] = m[3] + m[2]; out[17] = m[7] + m[6]; out[18] = m[11] + m[10]; out[19] = m[15] + m[14];
	out[20] = m[3] - m[2]; out[21] = m[7] - m[6]; out[22] = m[11] - m[10]; out[23] = m[15] - m[14];
	for (size_t i = 0; i < out.size(); i += 4) {
		normalizePlane(out, i);
	}
}

bool sphereInFrustumPacked(const PlanePack& planes, const Vec3& center, f32 radius) {
	const f32 bias = radius * 0.01f;
	for (size_t i = 0; i < planes.size(); i += 4) {
		const f32 d = planes[i] * center.x + planes[i + 1] * center.y + planes[i + 2] * center.z + planes[i + 3];
		if (d < -(radius + bias)) {
			return false;
		}
	}
	return true;
}

void quatIdentityInto(Quat& out) {
	out.x = 0.0f;
	out.y = 0.0f;
	out.z = 0.0f;
	out.w = 1.0f;
}

void quatFromEulerInto(Quat& out, f32 rx, f32 ry, f32 rz) {
	const f32 cx = std::cos(rx * 0.5f), sx = std::sin(rx * 0.5f);
	const f32 cy = std::cos(ry * 0.5f), sy = std::sin(ry * 0.5f);
	const f32 cz = std::cos(rz * 0.5f), sz = std::sin(rz * 0.5f);
	out.w = cz * cy * cx + sz * sy * sx;
	out.x = cz * cy * sx - sz * sy * cx;
	out.y = cz * sy * cx + sz * cy * sx;
	out.z = sz * cy * cx - cz * sy * sx;
}

void quatToEulerInto(Vec3& outEuler, const Quat& q) {
	const f32 length = len4(q.x, q.y, q.z, q.w);
	const f32 inv = length == 0.0f ? 1.0f : 1.0f / length;
	const f32 x = q.x * inv;
	const f32 y = q.y * inv;
	const f32 z = q.z * inv;
	const f32 w = q.w * inv;
	const f32 sinr = 2.0f * (w * x + y * z);
	const f32 cosr = 1.0f - 2.0f * (x * x + y * y);
	const f32 sinp = 2.0f * (w * y - z * x);
	const f32 siny = 2.0f * (w * z + x * y);
	const f32 cosy = 1.0f - 2.0f * (y * y + z * z);
	outEuler.x = std::atan2(sinr, cosr);
	if (std::abs(sinp) >= 1.0f) {
		outEuler.y = sinp < 0.0f ? -kPi * 0.5f : kPi * 0.5f;
	} else {
		outEuler.y = std::asin(sinp);
	}
	outEuler.z = std::atan2(siny, cosy);
}

void quatFromAxisAngleInto(Quat& out, const Vec3& axis, f32 angle) {
	Vec3 normalized{};
	vec3NormalizeInto(normalized, axis);
	const f32 half = angle * 0.5f;
	const f32 s = std::sin(half);
	out.x = normalized.x * s;
	out.y = normalized.y * s;
	out.z = normalized.z * s;
	out.w = std::cos(half);
}

void quatMulInto(Quat& out, const Quat& a, const Quat& b) {
	out.w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
	out.x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
	out.y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
	out.z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
}

void quatNormalizeInto(Quat& out, const Quat& q) {
	const f32 s = q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
	if (std::abs(s - 1.0f) < 0.000001f) {
		out = q;
		return;
	}

	const f32 inv = s == 0.0f ? 1.0f : 1.0f / std::sqrt(s);
	out.x = q.x * inv;
	out.y = q.y * inv;
	out.z = q.z * inv;
	out.w = q.w * inv;
}

void quatRotateVecInto(Vec3& out, const Quat& q, const Vec3& v) {
	const f32 uvx = 2.0f * (q.y * v.z - q.z * v.y);
	const f32 uvy = 2.0f * (q.z * v.x - q.x * v.z);
	const f32 uvz = 2.0f * (q.x * v.y - q.y * v.x);
	const f32 uuvx = q.y * uvz - q.z * uvy;
	const f32 uuvy = q.z * uvx - q.x * uvz;
	const f32 uuvz = q.x * uvy - q.y * uvx;
	out.x = v.x + uvx * q.w + uuvx;
	out.y = v.y + uvy * q.w + uuvy;
	out.z = v.z + uvz * q.w + uuvz;
}

void quatBasisInto(Basis& out, const Quat& q) {
	const Vec3 xAxis{ 1.0f, 0.0f, 0.0f };
	const Vec3 yAxis{ 0.0f, 1.0f, 0.0f };
	const Vec3 zAxis{ 0.0f, 0.0f, -1.0f };
	quatRotateVecInto(out.right, q, xAxis);
	quatRotateVecInto(out.up, q, yAxis);
	quatRotateVecInto(out.forward, q, zAxis);
	vec3NormalizeInto(out.right, out.right);
	vec3NormalizeInto(out.up, out.up);
	vec3NormalizeInto(out.forward, out.forward);
}

void quatFromBasisInto(Quat& out, const Vec3& forward, const Vec3& up) {
	f32 rx = up.y * forward.z - up.z * forward.y;
	f32 ry = up.z * forward.x - up.x * forward.z;
	f32 rz = up.x * forward.y - up.y * forward.x;
	const f32 rLen = len3(rx, ry, rz);
	const f32 rInv = rLen == 0.0f ? 1.0f : 1.0f / rLen;
	rx *= rInv;
	ry *= rInv;
	rz *= rInv;
	const f32 ux = forward.y * rz - forward.z * ry;
	const f32 uy = forward.z * rx - forward.x * rz;
	const f32 uz = forward.x * ry - forward.y * rx;
	const f32 m00 = rx, m01 = ry, m02 = rz;
	const f32 m10 = ux, m11 = uy, m12 = uz;
	const f32 m20 = forward.x, m21 = forward.y, m22 = forward.z;
	const f32 tr = m00 + m11 + m22;
	if (tr > 0.0f) {
		const f32 s = std::sqrt(tr + 1.0f) * 2.0f;
		out.w = 0.25f * s;
		out.x = (m21 - m12) / s;
		out.y = (m02 - m20) / s;
		out.z = (m10 - m01) / s;
	} else if ((m00 > m11) && (m00 > m22)) {
		const f32 s = std::sqrt(1.0f + m00 - m11 - m22) * 2.0f;
		out.w = (m21 - m12) / s;
		out.x = 0.25f * s;
		out.y = (m01 + m10) / s;
		out.z = (m02 + m20) / s;
	} else if (m11 > m22) {
		const f32 s = std::sqrt(1.0f + m11 - m00 - m22) * 2.0f;
		out.w = (m02 - m20) / s;
		out.x = (m01 + m10) / s;
		out.y = 0.25f * s;
		out.z = (m12 + m21) / s;
	} else {
		const f32 s = std::sqrt(1.0f + m22 - m00 - m11) * 2.0f;
		out.w = (m10 - m01) / s;
		out.x = (m02 + m20) / s;
		out.y = (m12 + m21) / s;
		out.z = 0.25f * s;
	}
	quatNormalizeInto(out, out);
}

void quatSlerpInto(Quat& out, const Quat& a, const Quat& b, f32 t) {
	f32 cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
	f32 bx = b.x, by = b.y, bz = b.z, bw = b.w;
	if (cos < 0.0f) {
		cos = -cos;
		bx = -bx;
		by = -by;
		bz = -bz;
		bw = -bw;
	}
	if (cos > 0.9995f) {
		out.x = a.x + (bx - a.x) * t;
		out.y = a.y + (by - a.y) * t;
		out.z = a.z + (bz - a.z) * t;
		out.w = a.w + (bw - a.w) * t;
		quatNormalizeInto(out, out);
		return;
	}

	const f32 theta = std::acos(clampUnit(cos));
	const f32 s = std::sin(theta);
	const f32 w1 = std::sin((1.0f - t) * theta) / s;
	const f32 w2 = std::sin(t * theta) / s;
	out.x = a.x * w1 + bx * w2;
	out.y = a.y * w1 + by * w2;
	out.z = a.z * w1 + bz * w2;
	out.w = a.w * w1 + bw * w2;
}

} // namespace bmsx::Render3D
