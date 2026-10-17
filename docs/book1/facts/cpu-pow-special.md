# CPU POW special-case facts (read-only source extraction)

Scope: the live mirrored `luaPow` owners only, baseline identified by parent as `5a5a26e15`. No tests or executions performed by this extractor; all outcomes below are **source/branch derivations**, not execution evidence. No claim of exhaustive finite-input bit-parity or approximation accuracy. The parent is responsible for paired-owner execution. No output-word narrowing or CPU storage ABI is inferred here.

Primary paths, abbreviated only in this note:

- **TS** = `machine/ts/spec/blua32/pow.ts`.
- **C++** = `machine/cpp/spec/blua32/pow.cpp`.
- **TS words** = `machine/ts/common/float64.ts`.
- **C++ words** = `machine/cpp/common/float64.h`.

`+0` and `-0` denote distinct binary64 zeros. `NaN` below means the owner's NaN return, not payload preservation. `O` means finite odd integer, `E` finite nonzero even integer, `F` finite nonintegral exponent. Unless a row explicitly says otherwise, the earlier zero-exponent and NaN rules take precedence. Every matrix row's mirror disposition is **same**, with both owner line ranges provided. No special-case semantic mismatch was found in these two owners.

## Representation and ordered gates

| Fact derived from live code | Exact TS source | C++ mirror / disposition |
|---|---|---|
| `hx`/`hy` are signed high 32-bit words; `lx`/`ly` are unsigned low 32-bit words. `ix=hx&0x7fffffff`, `iy=hy&0x7fffffff` discard only the sign bit. | TS:61–64; TS words:4–11 | C++:66–69; C++ words:7–16; same |
| High/low-word insertion replaces exactly that word. | TS words:14–23 | C++ words:19–32; same |
| First return is exponent zero, regardless of the base. Next comes either-operand NaN. Then negative-sign-base exponent parity classification; then exponent ±infinity, ±1, +2, +1/2; then special base ±zero, ±infinity, ±1; then ordinary negative-base noninteger rejection and sign choice. | TS:66–148 | C++:71–153; same order |
| The owned implementation is not a call to host `pow`. The +1/2 nonnegative-sign-base shortcut is a host square root call. | TS:16–18, 115–117 | C++:16–18, 120–122; same, `std::sqrt` instead of `Math.sqrt` |

## Exponent zero and NaN (exhaustive precedence)

| Base `x` | Exponent `y` | Result | Exact TS source | C++ mirror / disposition |
|---|---|---|---|---|
| Any base, including either zero, either infinity, or NaN | `+0` or `-0` | `+1` | TS:61–67 | C++:66–72; same |
| NaN | Any nonzero exponent, including NaN or either infinity | NaN | TS:67–73 | C++:72–78; same |
| Any base, including `+1` or `-1` | NaN | NaN | TS:67–73 | C++:72–78; same |

The NaN test examines the binary64 exponent/mantissa word pattern; it does not propagate an input operand. TS returns `NaN` and C++ returns `std::numeric_limits<double>::quiet_NaN()` (TS:69–73; C++:74–78, same NaN outcome). Consequently `NaN**0=1`, but `1**NaN=NaN` in these owners.

## Infinite exponents (every non-NaN base category)

| Base `x` | `y=+infinity` | `y=-infinity` | Exact TS source | C++ mirror / disposition |
|---|---|---|---|---|
| `+1` or `-1` | NaN | NaN | TS:97–100 | C++:102–105; same |
| `+0` or `-0` | `+0` | `+infinity` | TS:97–104 (`ix<0x3ff00000`) | C++:102–109; same |
| Finite `0<abs(x)<1`, either sign | `+0` | `+infinity` | TS:97–104 (`ix<0x3ff00000`) | C++:102–109; same |
| Finite `abs(x)>1`, either sign | `+infinity` | `+0` | TS:97–102 (`ix>=0x3ff00000`, exact unity excluded) | C++:102–107; same |
| `+infinity` or `-infinity` | `+infinity` | `+0` | TS:97–102 | C++:102–107; same |

These outcomes are selected **before** special-base handling or negative-base nonintegral rejection. Every zero in this table comes from the positive `zero=0.0` constant (TS:26, 102, 104; C++:32, 107, 109). Both infinite outcomes are positive (`y` when `y>0`, `-y` when `y<0`). The adjacent comment `inf**+-1 is NaN` is not the tested condition: the actual exact-unity-magnitude test makes **`(±1)**(±infinity)` NaN** (TS:99–100; C++:104–105).

## Explicit finite-exponent shortcuts

These are reached only after the zero/NaN/infinite-exponent gates above.

| Exponent | Base category | Returned expression / derived result | Exact TS source | C++ mirror / disposition |
|---|---|---|---|---|
| `+1` | Any non-NaN base | `x` unchanged, including `-0` and `-infinity` | TS:107–112 | C++:112–117; same |
| `-1` | Any non-NaN base | `1/x`: `+0→+infinity`, `-0→-infinity`, `+infinity→+0`, `-infinity→-0`; ordinary finite reciprocal otherwise | TS:107–109 | C++:112–114; same |
| `+2` | Any non-NaN base | `x*x`: either zero gives `+0`; either infinity gives `+infinity`; finite nonzero multiplication may overflow, become subnormal, or round to `+0` | TS:114 | C++:119; same |
| `+1/2` | Nonnegative sign bit, including `+0` and `+infinity` | `sqrt(x)`: `+0→+0`, `+infinity→+infinity`; positive finite square root otherwise | TS:115–117 | C++:120–122; same |
| `+1/2` | Negative sign bit (`-0`, `-infinity`, ordinary negative finite) | Shortcut is not taken. Later rows give `-0→+0`, `-infinity→+infinity`, negative finite nonzero→NaN. | TS:115–118, 122–144 | C++:120–123, 127–149; same |

## Special bases with finite nonzero exponents (complete sign/parity matrix)

This table summarizes outcomes after applying earlier shortcuts. Those shortcuts agree with the tabulated result; their earlier winning source is shown for `±1` and `+2`/`+1/2` above. Here the controlling special-base branch assigns `z=abs(x)`, reciprocates when `hy<0`, then negates **only** when the base sign bit is negative and `yisint==1`. Only the `-1` base rejects nonintegral exponents inside this branch. The ordinary negative-base domain rejection is later and cannot change zero/infinity results.

| Base | Positive O | Positive E | Positive F | Negative O | Negative E | Negative F | Exact TS source | C++ mirror / disposition |
|---|---|---|---|---|---|---|---|---|
| `+0` | `+0` | `+0` | `+0` | `+infinity` | `+infinity` | `+infinity` | TS:122–127, 136; parity at 80–94 | C++:127–132, 141; 85–99; same |
| `-0` | `-0` | `+0` | `+0` | `-infinity` | `+infinity` | `+infinity` | TS:122–136; parity at 80–94 | C++:127–141; 85–99; same |
| `+infinity` | `+infinity` | `+infinity` | `+infinity` | `+0` | `+0` | `+0` | TS:122–127, 136; parity at 80–94 | C++:127–132, 141; 85–99; same |
| `-infinity` | `-infinity` | `+infinity` | `+infinity` | `-0` | `+0` | `+0` | TS:122–136; parity at 80–94 | C++:127–141; 85–99; same |
| `+1` | `+1` | `+1` | `+1` | `+1` | `+1` | `+1` | TS:122–127, 136 | C++:127–132, 141; same |
| `-1` | `-1` | `+1` | NaN | `-1` | `+1` | NaN | TS:122–136; parity at 80–94 | C++:127–141; 85–99; same |

Notably `(-0)**F` and `(-infinity)**F` are **not** domain NaNs. `(-1)**F` and ordinary negative finite nonzero bases raised to F **are** NaN. The sign of the exponent controls zero versus reciprocal-infinity magnitude for special zero/infinity bases; the sign of an odd exponent does not change its parity.

## Ordinary finite nonzero bases (not ±1)

| Base/exponent condition | Derived branch result/sign | Exact TS source | C++ mirror / disposition |
|---|---|---|---|
| Positive finite base; any finite nonzero exponent | Positive-magnitude route; `s=+1`. Earlier `±1`, `+2`, `+1/2` shortcuts may supply the result instead. | TS:107–118, 140–148 | C++:112–123, 145–153; same |
| Negative finite nonzero base other than `-1`; finite nonintegral exponent | NaN. `n=0` and `yisint=0`, so `(n|yisint)==0`. | TS:80–94, 140–144 | C++:85–99, 145–149; same |
| Negative finite nonzero base; finite odd integer exponent | Magnitude route with `s=-1`; final result negative, including negative infinity or negative zero if overflow/underflow occurs. Earlier `±1` shortcut may instead return directly. | TS:80–94, 107–114, 147–148, 157–158, 235–245, 283 | C++:85–99, 112–119, 152–153, 162–163, 240–250, 288; same |
| Negative finite nonzero base; finite even nonzero integer exponent | Magnitude route with `s=+1`; final result positive, including positive infinity or positive zero. Earlier `+2` shortcut may return directly. | TS:80–94, 114, 147–148, 153–158, 235–245, 283 | C++:85–99, 119, 152–153, 158–163, 240–250, 288; same |

## Exact representable exponent parity classifier

The classifier runs only for a **negative sign bit** base (`hx<0`), including `-0` and `-infinity`, and uses exponent magnitude words, not the exponent's sign. NaNs have already returned; zero exponents have already returned. Although infinities are assigned `yisint=2`, they return through the infinite-exponent gate, so this is not a claim that infinities are integral.

| Exponent-magnitude range / predicate | Exact classification operation and implication | Exact TS source | C++ mirror / disposition |
|---|---|---|---|
| `0<abs(y)<1` (`iy<0x3ff00000`) | Initial `yisint=0` is retained: nonintegral. | TS:80–84 | C++:85–89; same |
| `1<=abs(y)<2^21` (`k=0..20`) | Requires `ly==0`; `j=iy>>(20-k)` and `(j<<(20-k))==iy` must reconstruct all high-word bits. If integral, `yisint=2-(j&1)`, i.e. odd→1, even→2; otherwise 0. | TS:84–91 | C++:89–96; same |
| `2^21<=abs(y)<2^53` (`k=21..52`) | `j=ly >>> (52-k)`; reconstructing `ly` after left shift is required. Thus discarded low significand bits must all be zero. If integral, parity is `j&1`; otherwise 0. At `k=52`, the shift is zero and **every** represented number in `[2^52,2^53)` is integral, with low-word bit 0 deciding odd/even. | TS:84–88 | C++:89–93; C++ unsigned `ly` right shift and uint32 reconstruction match TS unsigned right shift plus signed-int32 reconstruction comparison; same |
| Finite `abs(y)>=2^53` (`iy>=0x43400000`) | Unconditionally `yisint=2`. All represented binary64 integers here are even; there is no representable odd integer at or above `2^53`. Largest positive representable odd integer is `2^53-1`; signs do not affect parity. This is a representation derivation, not an execution result. | TS:27, 80–88 | C++:33, 85–93; same |

The boundary `2^52` is where all represented finite values become integral; `2^53` is where all represented finite values become even. The classifier's exact bit tests, not host integer coercion or decimal spelling, determine the negative-base sign and domain outcome.

## Large-exponent shortcuts: exact raw predicates, overflow/underflow signs

The following is entered only after all earlier special cases and negative-finite noninteger rejection. `huge=1e300`, `tiny=1e-300` (TS:28; C++:34). Expressions `huge*huge` and `tiny*tiny` supply positive infinity and positive zero respectively; prefixed `s` supplies the sign when present. These are source arithmetic derivations pending paired execution.

**Do not replace the raw high-word comparisons with the adjacent comments' mathematically strict `abs(y)>2^31` / `abs(y)>2^64`: the low word is not consulted.**

| Reached predicate | Outcome | Exact TS source | C++ mirror / disposition |
|---|---|---|---|
| Outer `iy>0x41e00000` | Enters large-exponent path. Exact first included positive magnitude is words `41e00001:00000000`, i.e. `2^31+2^11`; exponents with high word exactly `41e00000`, including nonzero low word, do not enter. | TS:150–151 | C++:155–156; same |
| Inner `iy>0x43f00000` | Enters largest-exponent shortcut. Exact first included finite positive magnitude is words `43f00001:00000000`, i.e. `2^64+2^44`. All finite values entering this shortcut have even parity, so omission of `s` cannot discard a negative result sign. | TS:82–83, 152 | C++:87–88, 157; same |
| Inner path; `ix<=0x3fefffff` (here `abs(x)<1`) | Negative exponent→`+infinity`; positive exponent→`+0`. | TS:152–153 | C++:157–158; same |
| Inner path; `ix>=0x3ff00000` (here `abs(x)>1`, unity already returned) | Positive exponent→`+infinity`; negative exponent→`+0`. | TS:152–154 | C++:157–159; same |
| Outer path, inner did not return; `ix<0x3fefffff` | Negative exponent→`s*huge*huge` (signed infinity); positive exponent→`s*tiny*tiny` (signed zero). Exact base cutoff: `abs(x)<1-2^-21`. | TS:151–157 | C++:156–162; same |
| Outer path, inner did not return; `ix>0x3ff00000` | Positive exponent→signed infinity; negative exponent→signed zero. Exact first included base magnitude is `1+2^-20` (`3ff00001:00000000`). | TS:151–158 | C++:156–163; same |
| Outer path, none of the above return | Near-unity logarithm route: high word is `0x3fefffff` or `0x3ff00000`; unity itself has already returned. No special zero/infinity result is forced here. | TS:159–167 | C++:164–172; same |

The high-word near-unity bands are `[1-2^-21,1)` and `[1,1+2^-20)` in represented magnitudes, not a symmetric tolerance inferred from the comments (TS:157–158; C++:162–163, same).

## General-path overflow, underflow, and subnormals

These facts concern the live branch computations, not an exact real-number criterion for every finite input.

| Condition / support fact | Exact branch outcome or mechanism | Exact TS source | C++ mirror / disposition |
|---|---|---|---|
| Subnormal finite nonzero base enters the ordinary logarithm path (`ix<0x00100000`) | `ax*=2^53`, `n-=53`, and refresh high word before normalization. Input subnormals are explicitly supported; they are not pre-flushed to zero by this algorithm. | TS:27, 168–177 | C++:33, 173–182; same |
| General path computes split-log exponent product | `y1` has low word zeroed; `p_l=(y-y1)*t1+y*t2`, `p_h=y1*t1`, `z=p_l+p_h`; range gates inspect this computed `z`. | TS:228–234 | C++:233–239; same |
| Computed positive `z>1024` | Return `s*huge*huge`: infinity with sign `s`. Exact raw gate is `j>=0x40900000` then nonzero `((j-0x40900000)|i)`. | TS:235–237 | C++:240–242; same |
| Computed `z==1024` | Overflow iff `p_l+ovt>z-p_h`; otherwise continue to reconstruction. `ovt=8.0085662595372944372e-17`. | TS:44, 235–240 | C++:50, 240–245; same |
| Computed negative `z<-1075` | Return `s*tiny*tiny`: zero with sign `s`. Exact magnitude gate `((j&0x7fffffff)>=0x4090cc00)` is reached only after the preceding positive-overflow branch did not match; inequality against negative boundary uses `((j-0xc090cc00)|i)`. | TS:241–243 | C++:246–248; same |
| Computed `z==-1075` | Underflow-to-zero iff `p_l<=z-p_h`; otherwise continue to reconstruction. | TS:241–245 | C++:246–250; same |
| Reconstruction reaches exponent-word result `(j>>20)<=0` | Construct a normal-range intermediate with exponent offset `54`, then multiply by `5.55111512312578270212e-17` (`2^-54`), supporting rounded subnormal output and possibly zero. No blanket output-subnormal flush is present. | TS:273–277 | C++:278–282; same; C++ unsigned shift/cast preserves TS 32-bit `n<<20` word arithmetic |
| Reconstructed ordinary or subnormal magnitude `z` | Final `return s*z` preserves the selected odd-negative-base sign, including when magnitude rounds to zero. | TS:278–283 | C++:283–288; same |

### Complete signed-zero output rule (source-derived consolidation)

For the full special-case tree and magnitude/sign route above, a negative zero result arises only from one of these negative-sign-base/odd-integer cases; NaNs and zero exponents have already won where applicable:

| Negative-zero-producing class | Exact controlling sources | C++ mirror / disposition |
|---|---|---|
| `(-0)**y` with positive odd integral `y` (including the direct `y=1` return) | TS:107–112, 122–136, 80–94 | C++:112–117, 127–141, 85–99; same |
| `(-infinity)**y` with negative odd integral `y` (including direct `y=-1` reciprocal) | TS:107–109, 122–136, 80–94 | C++:112–114, 127–141, 85–99; same |
| Ordinary negative finite nonzero base, odd integral exponent, with magnitude rounded/forced to zero | TS:107–109, 147–148, 157–158, 241–245, 273–283 | C++:112–114, 152–153, 162–163, 246–250, 278–288; same |

Every other zero selected by the special gates is `+0`: zero outputs for either infinite exponent; positive-zero base with positive finite exponent; negative-zero base with positive finite even/nonintegral exponent; positive-infinite base with negative finite exponent; negative-infinite base with negative finite even/nonintegral exponent; the square shortcut; and ordinary positive/even-negative-base magnitude underflow. This is derived from the concrete `zero`, `abs`, reciprocal, parity, multiplication, and `s` operations above, not imported host-`pow` folklore.

## Execution handoff (not run by extractor)

High-value paired-owner checks follow directly from the branch matrix: `NaN**±0`; `±1**±infinity`; `-0**±0.5`, `-infinity**±0.5`; negative finite/nonintegral domain rejection; odd/even parity immediately below and at `2^52` and `2^53`; both signs of zero from reciprocal, special-base, square and underflow routes; subnormal input/output; large-exponent high-word boundaries (nonzero-low-word values sharing the boundary high word included); and computed range-boundary examples. These are suggested execution targets, not claims that execution occurred.
