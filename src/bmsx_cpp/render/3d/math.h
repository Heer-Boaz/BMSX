#pragma once

#include "common/primitives.h"
#include <array>

namespace bmsx::Render3D {

using Mat4 = std::array<f32, 16>;
using Mat3 = std::array<f32, 9>;
using PlanePack = std::array<f32, 24>;
using Quat = Vec4;

struct Basis {
	Vec3 right{};
	Vec3 up{};
	Vec3 forward{};
};

extern const Mat4 kIdentityMat4;

void mat4SetIdentity(Mat4& out);
void mat4CopyInto(Mat4& out, const Mat4& src);
void mat4MulInto(Mat4& out, const Mat4& a, const Mat4& b);
void mat4MulAffineInto(Mat4& out, const Mat4& a, const Mat4& b);
void mat4TransposeInto(Mat4& out, const Mat4& a);

void mat4TranslateSelf(Mat4& m, f32 x, f32 y, f32 z);
void mat4ScaleSelf(Mat4& m, f32 x, f32 y, f32 z);
void mat4RotateXSelf(Mat4& m, f32 radians);
void mat4RotateYSelf(Mat4& m, f32 radians);
void mat4RotateZSelf(Mat4& m, f32 radians);

void mat4QuatToMat4Into(Mat4& out, const Quat& q);
void mat4FromTRSInto(Mat4& out, const Vec3* translation, const Quat* rotation, const Vec3* scale);
void mat4PerspectiveInto(Mat4& out, f32 fovRad, f32 aspect, f32 nearPlane, f32 farPlane);
void mat4OrthographicInto(Mat4& out, f32 left, f32 right, f32 bottom, f32 top, f32 nearPlane, f32 farPlane);
void mat4FisheyeInto(Mat4& out, f32 fovRad, f32 aspect, f32 nearPlane, f32 farPlane);
void mat4PanoramaInto(Mat4& out, f32 hFovRad, f32 aspect, f32 nearPlane, f32 farPlane);
void mat4ObliqueInto(Mat4& out,
					f32 left,
					f32 right,
					f32 bottom,
					f32 top,
					f32 nearPlane,
					f32 farPlane,
					f32 alphaRad,
					f32 betaRad);
void mat4AsymmetricFrustumInto(Mat4& out, f32 left, f32 right, f32 bottom, f32 top, f32 nearPlane, f32 farPlane);
void mat4IsometricInto(Mat4& out, f32 scale);
void mat4InfinitePerspectiveInto(Mat4& out, f32 fovRad, f32 aspect, f32 nearPlane);

void mat4ExtractScaleInto(Vec3& out, const Mat4& m);
f32 mat4MaxScale(const Mat4& m);
void mat4InvertAffineInto(Mat4& out, const Mat4& m);
void mat4InvertInto(Mat4& out, const Mat4& a);
void mat4LookAtInto(Mat4& out, const Vec3& eye, const Vec3& target, const Vec3& up);
void mat4InvertRigidInto(Mat4& out, const Mat4& m);
void mat4ViewFromBasisInto(Mat4& out, const Vec3& pos, const Vec3& right, const Vec3& up, const Vec3& back);
void mat4SkyboxFromViewInto(Mat4& out, const Mat4& view);
void mat4SetTranslationSelf(Mat4& m, f32 x, f32 y, f32 z);
void mat4GetTranslationInto(Vec3& out, const Mat4& m);
void mat4SetRotationSelfFromQuat(Mat4& m, const Quat& q);
void mat4ViewRightUpInto(const Mat4& view, Vec3& outRight, Vec3& outUp);
void mat4AffineViewEyeInto(Vec3& out, const Mat4& view, const Mat4& inverseLinear);
void mat4Normal3Into(Mat3& out, const Mat4& model);
void mat4TransformPoint3Into(Vec3& out, const Mat4& m, f32 x, f32 y, f32 z);
void mat4TransformDir3Into(Vec3& out, const Mat4& m, f32 x, f32 y, f32 z);

u16 float32ToFloat16(f32 value);
bool isMatrixMirrored(const Mat4& mat);
void transformBoundingSphereCenterInto(Vec3& out, const Mat4& matrix, const Vec3& center);
f32 transformedBoundingSphereRadius(const Mat4& matrix, f32 radius);
f32 translationDistanceSquared(const Mat4& matrix, const Vec3& point);

void vec4Set(Vec4& out, f32 x, f32 y, f32 z, f32 w);
void vec4FromArrayInto(Vec4& out, const std::array<f32, 4>& arr);
void vec4ToArrayInto(std::array<f32, 4>& out, const Vec4& v);

void vec3Set(Vec3& out, f32 x, f32 y, f32 z);
void vec3Assign(Vec3& out, const Vec3& data);
void vec3AddInto(Vec3& out, const Vec3& a, const Vec3& b);
void vec3AddSelf(Vec3& out, const Vec3& b);
void vec3SubInto(Vec3& out, const Vec3& a, const Vec3& b);
void vec3SubSelf(Vec3& out, const Vec3& b);
void vec3ScaleInto(Vec3& out, const Vec3& a, f32 scale);
void vec3ScaleSelf(Vec3& out, f32 scale);
f32 vec3Dot(const Vec3& a, const Vec3& b);
void vec3CrossInto(Vec3& out, const Vec3& a, const Vec3& b);
f32 vec3Len(const Vec3& a);
void vec3NormalizeInto(Vec3& out, const Vec3& a);
void vec3TruncInto(Vec3& out, const Vec3& a);
bool vec3EqualsArray(const std::array<f32, 3>& a, const std::array<f32, 3>& b);
void vec3RotateAroundAxisInto(Vec3& out, const Vec3& v, const Vec3& axis, f32 angle);

void extractFrustumPlanesInto(PlanePack& out, const Mat4& viewProjection);
bool sphereInFrustumPacked(const PlanePack& planes, const Vec3& center, f32 radius);

void quatIdentityInto(Quat& out);
void quatFromEulerInto(Quat& out, f32 rx, f32 ry, f32 rz);
void quatToEulerInto(Vec3& outEuler, const Quat& q);
void quatFromAxisAngleInto(Quat& out, const Vec3& axis, f32 angle);
void quatMulInto(Quat& out, const Quat& a, const Quat& b);
void quatNormalizeInto(Quat& out, const Quat& q);
void quatRotateVecInto(Vec3& out, const Quat& q, const Vec3& v);
void quatBasisInto(Basis& out, const Quat& q);
void quatFromBasisInto(Quat& out, const Vec3& forward, const Vec3& up);
void quatSlerpInto(Quat& out, const Quat& a, const Quat& b, f32 t);

} // namespace bmsx::Render3D
