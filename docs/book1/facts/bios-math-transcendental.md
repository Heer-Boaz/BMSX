# Frozen source facts: eleven Math angle/transcendental interfaces

**Historical snapshot.** The radian `sin`/`cos`/`tan` facts, dependencies and
phase-quantized results below were superseded on2026-10-19 by
`machine/bios/math/trig.lua`. The named phase-word/Q16 primitive is unchanged;
ordinary radian calls no longer use it. See the current disposition in
[bios-math.md](bios-math.md); do not use T02/T04's old radian conversion as the
current API. The other eight interfaces were not changed by that repair.

2026-10-18, HEAD fd0895c39. Root independently opened the actual files/ranges
below. This sheet is extraction, not public prose, execution or an accuracy
claim. No architecture manuscript or historical manual used. No disagreement
found in the inspected paired numeric/word/call boundaries; this is not an
all-optimizer/native/all-input parity claim. Do not add unsupported guarantees.

## T01 Shared representation and source-function boundary

- These eleven exported entries are ordinary BIOS source functions, not new
  registers or GTE commands. Every successful path returns exactly one Number.
  All have one fixed formal except atan(y,x) and log(value,base), which have
  two. No varargs. Missing fixed params become nil; surplus fixed-call params
  are not retained. Actual export/bodies: machine/bios/math.lua:92-279,349-379;
  paired reached frame producers machine/ts/machine/cpu/cpu.ts:3272-3296 and
  machine/cpp/machine/cpu/cpu.cpp:3017-3042. This does not promise all shortened
  source spellings satisfy static arity checks.
- Numeric operations use the one binary64 Number representation, not a new
  integer/fixed-point result kind. Arithmetic with nonnumbers (including nil,
  false, numeric-looking Strings) supplies NaN; it does not parse text or
  raise an arithmetic type fault on these paths. Mixed nonnumber/Number
  ordering is false. Source pairs: machine/ts/machine/cpu/cpu.ts:2551-2586,
  2701-2735,3589-3596; machine/ts/machine/cpu/value_slots.ts:128-130;
  machine/cpp/machine/cpu/cpu_dispatch.inl:171-213,356-384;
  machine/cpp/machine/cpu/value.h:132-148. Numeric NaN is unordered; signed
  zeros compare equal. Canonical CPU and earlier elementary Math section own
  these shared operator/call definitions.
- In this sheet T(x) is the existing private truncation: if x<0 return
  -D(-x,1), else D(x,1). D(a,b) computes q=a/b, truncates q toward zero to t,
  then returns t-1 iff t>q, else t. Not a new public entry. Sources
  machine/bios/math.lua:27-32,40-42; paired D owners
  machine/ts/spec/blua32/numeric.ts:1-5 and machine/cpp/spec/blua32/numeric.h:7-11.
- Bitwise operands convert to 32-bit words; finite fractions truncate and wrap
  modulo2^32, nonnumeric arithmetic NaN/infinities convert to zero. AND's
  result is the signed interpretation; SHR is signed with count masked31.
  Sources machine/ts/machine/cpu/cpu.ts:2551-2567,2590-2604;
  machine/cpp/machine/cpu/cpu_dispatch.inl:222-267;
  machine/cpp/machine/cpu/value.h:199-229. Distinguish the represented phase
  bits from an unsigned Number guarantee.

## T02 Constants and retained dependencies

machine/bios/math.lua:1,3-21 defines/retains these constants and the sine helper:
pi literal3.141592653589793238462643383279502884; h=pi*0.5; tau=pi*2;
degree factor=180/pi; radian factor=pi/180; phase factor=4294967296/tau;
output factor=1/65536; quarter=0x40000000; huge=1/0; nan=0/0;
ln2=0.69314718055994530942; inv_ln2=1.44269504088896340736;
ln10=2.30258509299404568402; sqrt_half=0.70710678118654752440;
sqrt_two=1.41421356237309504880; overflow=709.782712893384;
underflow=-745.133219101941; two_pow_16=65536.
These literal spellings are stored Numbers, not promises of all decimal digits.
The eleven bodies reference these lexical values and retained private functions
rather than looking up public math.pi/math.sqrt/math.atan/math.floor entries.
Actual dependencies: machine/bios/math.lua:33-42,92-279; sine import:1 and
machine/bios/math/sin.lua:1-64. No scoped body calls global error or validates
argument types. There are numerical special branches, not new explicit error
Strings. Do not infer independence from ordinary CPU/IRQ/memory faults.

## T03 Angular conversion

- math.deg(value) returns value*(180/pi), converting radian scale to degrees.
  math.rad(value) returns value*(pi/180), degrees to radian scale. One result
  each, no optional defaults, magnitude reduction, fixed-point conversion or
  domain branch. Sources machine/bios/math.lua:3,6-7,92-98,356,368.
- Finite numerical results follow those floating equations; infinities retain
  their sign, either zero sign is preserved, NaN/nonnumbers yield NaN. These
  are source-derived operator consequences, not new runtime observations.
  Sources same bodies/constants plus paired T01 arithmetic.

## T04 sin/cos/tan and actual quarter-wave lookup

- math.sin(radians): scaled=radians*(4294967296/(pi*2)); pass T(scaled)&0xffffffff
  to retained sine helper; multiply returned integer by1/65536. Source
  machine/bios/math.lua:5,8-10,100-103,373.
- math.cos(radians): helper receives (T(scaled)+0x40000000)&0xffffffff; then
  output multiplied by1/65536. The offset is BEFORE the bitwise conversion.
  Source machine/bios/math.lua:105-108,355 and T02 constants.
- math.tan(radians): angle=T(scaled)&0xffffffff FIRST; numerator=helper(angle),
  denominator=helper((angle+quarter)&0xffffffff). If denominator==0, return
  -huge if numerator<0, otherwise +huge; else numerator/denominator. No
  conversion to normalized sine/cosine Numbers is needed before the ratio.
  Source machine/bios/math.lua:110-120,375 and T02 constants.
- Actual helper is a quarter-wave ROM lookup plus interpolation, not GTE.
  machine/bios/math/sin.lua:2-36 has257 word entries, first0,last65536.
  Constants quarter0x40000000, fractionmask0x3fffff, shift22, one65536 at:38-41.
  Procedure at:43-64:
  1. quadrant=(angle>>30)&3; phase=angle&0x3fffffff.
  2. Odd quadrant: phase=quarter-phase.
  3. Set value65536; if phase!=quarter: index=(phase>>22)&255,
     fraction=phase&0x3fffff, base=lut[index], delta=lut[index+1]-base,
     value=base+((delta*fraction)>>22).
  4. If quadrant>=2 return0-value; else value.
  It has no input-magnitude reduction loop: arithmetic, branches and at most
  two LUT word reads per helper invocation; tan calls it twice, sin/cos once.
  Sources same full helper and caller bodies, paired bitwise T01.
- A helper turn uses the32 phase bits with quarter0x40000000; fractional phase
  is discarded at T before word wrap. Finite sin/cos outputs are multiples
  of1/65536; this algorithm does not promise ideal sine/cosine values or a
  uniform mathematical error bound. Sources machine/bios/math.lua:8-10,100-108
  and helper2-64. Exact257 table contents remain in source; no analytic
  approximation bound has been extracted or executed here.
- NaN, either infinity, or a nonnumeric radians argument reaches wordzero.
  sin returns0; cos ALSO returns0, since NaN/infinity plus quarter remains
  nonfinite until its later word conversion. tan first creates anglezero,
  then its denominator uses the quarter offset and returns65536, so ratio0.
  These are source/paired-boundary deductions, not stock-Lua type rejection
  or a claim cos(nonnumber)==cos(0). Sources actual bodies100-120, helper43-64,
  private T27-32 and paired conversion T01.

## T05 atan and inverse angles

- Define retained P(v)=(pi*0.25*v)+(0.273*v*(1-abs(v))). Its abs is retained
  local elementary abs, not a public math.abs lookup. A(v): if v>1 return
  h-P(1/v); else if v< -1 return -h-P(1/v); else P(v). Sources
  machine/bios/math.lua:33-38,147-160 and T02 constants. P/A are notation,
  not exported functions or proposed cartridge helpers.
- math.atan(y,x): x==nil selects A(y) (one-argument use including explicit nil).
  Else if y~=y or x~=x returnnan. Else x>0 -> A(y/x). Else x<0 -> A(y/x)+pi
  if y>=0, otherwise A(y/x)-pi. Else y>0 ->h; else y<0 -> -h; else literal0.
  Exactly this order. Sources machine/bios/math.lua:162-184,353.
- Returned angles use radian scale from P/h/pi. This is the actual polynomial
  and quadrant algorithm, not a correctly-rounded or all-infinity atan2
  guarantee. The two-argument zero-axis branch returns literal positive0 for
  both zero y signs and zero x signs. False is not nil: atan(1,false) returns h
  via the axis branch because mixed comparisons with x fail. For numeric NaN,
  the explicit self-inequality branch returnsnan. For one-argument nonnumbers,
  P arithmetic producesNaN. Sources147-184, pairedT01. Do not generalize
  nonnumeric axes to rejection or numeric coercion.
- math.asin(value): return retained atan(value, retained sqrt(1-(value*value))).
  math.acos(value): return h-retained asin(value). One Number each, radian
  scale. Numeric inputs outside[-1,1] yieldNaN through sqrt/atan; no explicit
  inverse-domain error. Sources machine/bios/math.lua:123-145,162-193,351-352.
  No uniform inverse-trig accuracy/range guarantee is extracted. Missing/
  nonnumeric operands reachNaN through the actual arithmetic and calls, not
  a type error. Work includes sqrt normalization/eight refinements below;
  do not label all inverse-angle work fixed time.

## T06 sqrt

math.sqrt(value), one Number, source machine/bios/math.lua:123-145,374:
1. If value<0 returnnan; if value==0 OR value==huge return value unchanged.
2. normalized=value, scale=1. While normalized>=4: normalized*=0.25, scale*=2.
3. While normalized<1: normalized*=4, scale*=0.5.
4. estimate=normalized; exactly8 iterations estimate=(estimate+normalized/estimate)*0.5.
5. Return estimate*scale.
Negative numeric inputs incl -infinity ->NaN; +infinity unchanged; either
zero sign unchanged. For positive finite values normalization uses powers of4
and scale powers of2; normalization work depends on magnitude. NaN and
nonnumeric input skip both normalization loops and refinement arithmetic yields
NaN (no local type error). Sources fullbody plus pairedT01. The eight-step
algorithm defines the approximation; no all-input relative/ULP bound or total
cycle count is stated by this extraction.

## T07 exp

math.exp(value), one Number, source machine/bios/math.lua:195-234,357:
1. value~=value ->nan; value>709.782712893384 ->huge;
   value< -745.133219101941 ->literal0. These threshold tests are strict.
2. value<0 ->1/positive(-value); otherwise positive(value).
positive(v): power=D(v*inv_ln2+0.5,1); reduced=v-power*ln2;
result=series(reduced). While power>=16: result*=65536,power-=16.
Then while power>0: result*=2,power-=1. Returnresult.
series(r): term=1,sum=1; divisor1..16: term=(term*r)/divisor,sum+=term;
returnsum. Exactly16 term updates plus initial1.
Constants machine/bios/math.lua:15-16,20-22; D is retained private floor40-42.
This is ordinary BIOS reduction/series/scaling. Both infinities select explicit
threshold branches; NaN selects explicitselfcheck. Nonnumeric input passes
comparison checks, reachesNaN arithmetic/power, skips scale loops and returnsNaN.
Negative values use a RECIPROCAL of the positive approximant; intermediate
scaling can overflow before the reciprocal. Do not infer accurate subnormal
outputs or imply only the explicit underflow threshold can yieldzero.
No uniform approximation error, all-input correct rounding or fixed total
instruction/cycle count extracted. Work includes16 updates and variable scaling.
Sources exact listed bodies and pairedT01 arithmetic.

## T08 log

Natural helper N(v), machine/bios/math.lua:236-265:
1. v<0 ->nan; v==0 -> -huge; v==huge ->huge (ordered tests).
2. exponent=0,mantissa=v. While mantissa>=sqrt_two: mantissa*=0.5,exponent+=1.
3. While mantissa<sqrt_half: mantissa*=2,exponent-=1.
4. z=(mantissa-1)/(mantissa+1); z2=z*z; term=z; sum=term.
   denominator3,5,...31 (15 iterations): term*=z2; sum+=term/denominator.
5. Return (2*sum)+(exponent*ln2).
Constants machine/bios/math.lua:15,18-19. Negative input/-infinity ->NaN;
either zero -> -infinity; +infinity ->+infinity. NaN/nonnumbers skip the
normalization loops, then arithmetic yieldsNaN without a local type error.
Work magnitude-dependent normalization plus15 series updates. No uniform
accuracy or cycle/termination budget stated by this extraction.

math.log(value,base), machine/bios/math.lua:267-279,361, ONE Number:
FIRST natural=N(value). If base==nil ->natural. Else base==10 ->natural/ln10.
Else base==2 ->natural/ln2. Else ->natural/N(base). Order is exact; false is
supplied base, not default. No explicit base/domain error or guard for base1,
zero, negative, infinity or NaN. Same constants at:15,17. Equations permit
infinity, signedzero andNaN; do not replace by a universal legal-base validator.
For base1, N(1) returns0 so division is byzero; log(1,1) yieldsNaN. For a
nonnumeric base, N(base) yieldsNaN. Both numerator and general-base helper
normalization may add work; no fixed service time.

## T09 Derived finite LUT output bounds (additional source-only check)

Root independently parsed the literal257 entries from
machine/bios/math/sin.lua:2-36: minimum0, maximum65536, nondecreasing, largest
adjacent difference402. For fraction0..0x3fffff, delta*fraction is at most
1686109806, below2147483647. Therefore the signed32 conversion at the
interpolation shift does not wrap this nonnegative product. Its truncated
contribution stays betweenzero anddelta; helper magnitude stays0..65536,
and final sign gives[-65536,65536]. Sources literal table2-36, interpolation/
sign43-64 and paired word conversion T01. This is an exact consequence of the
stored entries and integer bounds, not a measured sine-approximation error.

Thus sin/cos output lies in[-1,1] with steps1/65536. For tan with a nonzero
integer denominator, the finite ratio lies in[-65536,65536]; denominatorzero
still selects the explicit signed-infinity branch. Quantized denominatorzero,
not an exact-real pole test, controls that branch. Sources
machine/bios/math.lua:100-120 and helper bounds above. These are range bounds,
NOT mathematical approximation accuracy or a statement that every possible
value in either interval is reachable.
