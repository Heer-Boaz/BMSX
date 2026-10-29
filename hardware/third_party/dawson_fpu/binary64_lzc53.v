// SPDX-License-Identifier: MIT
// Parallel leading-zero count for a nonzero 53-bit IEEE significand.
// Used by the Dawson multiplier/divider derivatives during normalization.
// The 64-bit tree is a physical datapath; zero input has no consuming use.
module binary64_lzc53(input wire [52:0] value, output wire [5:0] count);
 wire [63:0] x0={value,11'b0};
 wire a=!(|x0[63:32]); wire [63:0] x1=a?x0<<32:x0;
 wire b=!(|x1[63:48]); wire [63:0] x2=b?x1<<16:x1;
 wire c=!(|x2[63:56]); wire [63:0] x3=c?x2<<8:x2;
 wire d=!(|x3[63:60]); wire [63:0] x4=d?x3<<4:x3;
 wire e=!(|x4[63:62]); wire [63:0] x5=e?x4<<2:x4;
 wire f=!x5[63];
 assign count={a,b,c,d,e,f};
endmodule
