`timescale 1ns/1ps
// Binary64 CPU/GEO arithmetic service. One transaction at a time retains its
// requesting owner, operation and both IEEE-754 operands until result acceptance.
// Concurrent clients alternate at transaction admission; an unaccepted result
// is held by the selected arithmetic engine and blocks subsequent operations.
//
// Operations: 0 add, 1 subtract, 2 multiply, 3 divide. Subtraction reverses B's
// sign before addition. Special-value classification, gradual underflow and
// round-to-nearest/ties-even are handled by the three retained arithmetic
// engines. Their NaN payload/sign is not a CPU value-store representation.
// CPU/GEO callers retain their own result and canonicalize Number NaNs at the
// value producer where required. No result is replaced with zero.
//
// The arithmetic engines are from dawsonjon/fpu at the revision in
// ../third_party/dawson_fpu/ORIGIN.txt. FAST_ADDER selects the explicit
// parallel-alignment derivative; zero retains the unmodified adder. The
// default serial divider is the minimally corrected derivative, not the
// unmodified upstream divider whose subnormal rounding case is incorrect.
// FAST_MULDIV selects parallel normalization and a shorter radix-2 divider.
// Each engine has separate ready/valid
// streams for A, B and result. reset_n must be asserted for a clock edge, since
// the selected arithmetic engines use synchronous reset. This unit does not
// implement modulo, floor division, POW, operand type dispatch or the
// published CPU cycle accounting. Latency depends on operands and operation.
module core_binary64_service #(parameter FAST_ADDER=0, FAST_MULDIV=0) (
 input wire clk,reset_n,
 input wire cpu_valid,output wire cpu_ready,input wire [1:0] cpu_op,input wire cpu_sqrt,
 input wire [63:0] cpu_a,cpu_b,
 output wire cpu_rsp_valid,input wire cpu_rsp_ready,output wire [63:0] cpu_rsp,
 input wire geo_valid,output wire geo_ready,input wire [1:0] geo_op,input wire geo_sqrt,
 input wire [63:0] geo_a,geo_b,
 output wire geo_rsp_valid,input wire geo_rsp_ready,output wire [63:0] geo_rsp
);
 localparam [1:0] IDLE=0,INPUT_A=1,INPUT_B=2,RESULT=3;
 reg [1:0] state,op;
 reg owner,prefer_geo,sqrt_select;
 reg [63:0] operand_a,operand_b;
 wire select_geo=geo_valid && (!cpu_valid || prefer_geo);
 wire chosen_valid=cpu_valid || geo_valid;
 assign cpu_ready=reset_n && state==IDLE && !select_geo;
 assign geo_ready=reset_n && state==IDLE && select_geo;

 wire [63:0] add_z,mul_z,div_z,sqrt_z;
 wire sqrt_a_ack,sqrt_z_valid;
 wire add_a_ack,add_b_ack,add_z_valid;
 wire mul_a_ack,mul_b_ack,mul_z_valid;
 wire div_a_ack,div_b_ack,div_z_valid;
 wire add_select=!sqrt_select && op[1]==0,mul_select=!sqrt_select && op==2,div_select=!sqrt_select && op==3;
 wire a_ack=sqrt_select ? sqrt_a_ack : add_select ? add_a_ack : mul_select ? mul_a_ack : div_a_ack;
 wire b_ack=add_select ? add_b_ack : mul_select ? mul_b_ack : div_b_ack;
 wire z_valid=sqrt_select ? sqrt_z_valid : add_select ? add_z_valid : mul_select ? mul_z_valid : div_z_valid;
 wire [63:0] z=sqrt_select ? sqrt_z : add_select ? add_z : mul_select ? mul_z : div_z;
 wire take_z=state==RESULT && (owner ? geo_rsp_ready : cpu_rsp_ready);
 assign cpu_rsp_valid=reset_n && state==RESULT && !owner && z_valid;
 assign geo_rsp_valid=reset_n && state==RESULT && owner && z_valid;
 assign cpu_rsp=z;
 assign geo_rsp=z;

 core_binary64_sqrt sqrt_unit(.clk(clk),.reset_n(reset_n),.req_valid(state==INPUT_A && sqrt_select),
  .req_ready(sqrt_a_ack),.req_a(operand_a),.rsp_valid(sqrt_z_valid),.rsp_ready(take_z && sqrt_select),.rsp(sqrt_z));

 generate if(FAST_ADDER) begin: parallel_align
 double_adder_fast add(.clk(clk),.rst(!reset_n),.input_a(operand_a),.input_b(operand_b),
  .input_a_stb(state==INPUT_A && add_select),.input_b_stb(state==INPUT_B && add_select),
  .input_a_ack(add_a_ack),.input_b_ack(add_b_ack),.output_z(add_z),.output_z_stb(add_z_valid),.output_z_ack(take_z && add_select));
 end else begin: serial_align
 double_adder add(.clk(clk),.rst(!reset_n),.input_a(operand_a),.input_b(operand_b),
  .input_a_stb(state==INPUT_A && add_select),.input_b_stb(state==INPUT_B && add_select),
  .input_a_ack(add_a_ack),.input_b_ack(add_b_ack),.output_z(add_z),.output_z_stb(add_z_valid),.output_z_ack(take_z && add_select));
 end endgenerate
 generate if(FAST_MULDIV) begin: parallel_muldiv
 double_multiplier_fast mul(.clk(clk),.rst(!reset_n),.input_a(operand_a),.input_b(operand_b),
  .input_a_stb(state==INPUT_A && mul_select),.input_b_stb(state==INPUT_B && mul_select),
  .input_a_ack(mul_a_ack),.input_b_ack(mul_b_ack),.output_z(mul_z),.output_z_stb(mul_z_valid),.output_z_ack(take_z && mul_select));
 double_divider_fast div(.clk(clk),.rst(!reset_n),.input_a(operand_a),.input_b(operand_b),
  .input_a_stb(state==INPUT_A && div_select),.input_b_stb(state==INPUT_B && div_select),
  .input_a_ack(div_a_ack),.input_b_ack(div_b_ack),.output_z(div_z),.output_z_stb(div_z_valid),.output_z_ack(take_z && div_select));
 end else begin: serial_muldiv
 double_multiplier mul(.clk(clk),.rst(!reset_n),.input_a(operand_a),.input_b(operand_b),
  .input_a_stb(state==INPUT_A && mul_select),.input_b_stb(state==INPUT_B && mul_select),
  .input_a_ack(mul_a_ack),.input_b_ack(mul_b_ack),.output_z(mul_z),.output_z_stb(mul_z_valid),.output_z_ack(take_z && mul_select));
 double_divider_corrected div(.clk(clk),.rst(!reset_n),.input_a(operand_a),.input_b(operand_b),
  .input_a_stb(state==INPUT_A && div_select),.input_b_stb(state==INPUT_B && div_select),
  .input_a_ack(div_a_ack),.input_b_ack(div_b_ack),.output_z(div_z),.output_z_stb(div_z_valid),.output_z_ack(take_z && div_select));
 end endgenerate

 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   state<=IDLE;op<=0;owner<=0;prefer_geo<=0;sqrt_select<=0;operand_a<=0;operand_b<=0;
  end else case(state)
   IDLE: if(chosen_valid) begin
    owner<=select_geo;prefer_geo<=!select_geo;
    op<=select_geo ? geo_op : cpu_op;
    sqrt_select<=select_geo ? geo_sqrt : cpu_sqrt;
    operand_a<=select_geo ? geo_a : cpu_a;
    operand_b<=select_geo ? {geo_b[63] ^ (geo_op==1),geo_b[62:0]} : {cpu_b[63] ^ (cpu_op==1),cpu_b[62:0]};
    state<=INPUT_A;
   end
   INPUT_A: if(a_ack) state<=sqrt_select ? RESULT : INPUT_B;
   INPUT_B: if(b_ack) state<=RESULT;
   RESULT: if(z_valid && take_z) state<=IDLE;
  endcase
 end
endmodule
