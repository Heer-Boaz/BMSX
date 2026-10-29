`timescale 1ns/1ps
// The fetched instruction's physical operand-field decode. Inputs are the
// already fetched big-endian instruction words; the preceding fetch owner has
// resolved alignment and bus faults. One WIDE word extends the body fields.
// Register/constant addressing, global-name binding, branch execution, CP0,
// VM value representation and exception entry are separate owners. Nested
// WIDE is identified, not executed: a conditional skip must still be able to
// discard the eight-byte instruction without a hard halt.
// This one-entry pipeline holds the complete decode on downstream stalls and
// can admit the next instruction as the previous one is consumed.
// Ibex separates its instruction fetch/decode interface from execution:
// https://github.com/lowRISC/ibex/blob/master/doc/03_reference/instruction_decode_execute.rst
module cpu_instruction_decode (
 input wire clk,reset_n,
 input wire req_valid,output wire req_ready,input wire [31:0] req_pc,req_prefix,req_body,input wire req_wide,
 output reg rsp_valid,input wire rsp_ready,
 output reg [31:0] rsp_pc,rsp_next_pc,output reg [5:0] rsp_opcode,
 output reg [13:0] rsp_a,output reg [14:0] rsp_b,rsp_c,output reg [25:0] rsp_bx,
 output reg [31:0] rsp_sbx,rsp_rkb,rsp_rkc,rsp_branch_target,
 output reg [7:0] rsp_disp,output reg rsp_wide,rsp_nested_wide,rsp_reserved_memory
);
 wire [5:0] op=req_body[23:18],al=req_body[17:12],bl=req_body[11:6],cl=req_body[5:0];
 wire [7:0] ext=req_body[31:24];
 wire [5:0] wa=req_wide ? req_prefix[17:12] : 6'd0;
 wire [5:0] wb=req_wide ? req_prefix[11:6] : 6'd0;
 wire [5:0] wc=req_wide ? req_prefix[5:0] : 6'd0;
 wire uses_disp=op==6'd4 || op==6'd12 || op==6'd13;
 wire uses_bx=op==6'd2 || op==6'd11 || (op>=6'd40 && op<=6'd43) || (op>=6'd54 && op<=6'd57);
 wire [13:0] a=uses_disp || uses_bx ? {2'b0,wa,al} : {wa,ext[7:6],al};
 wire [14:0] b=uses_disp ? {3'b0,wb,bl} : {wb,uses_bx ? 3'd0 : ext[5:3],bl};
 wire [14:0] c=uses_disp ? {3'b0,wc,cl} : {wc,uses_bx ? 3'd0 : ext[2:0],cl};
 wire [25:0] bx={wb,uses_bx ? ext : 8'd0,bl,cl};
 wire [31:0] sbx=req_wide ? {{6{bx[25]}},bx} : {{12{bx[19]}},bx[19:0]};
 wire [31:0] rkb=req_wide ? {{17{b[14]}},b} : {{23{b[8]}},b[8:0]};
 wire [31:0] rkc=req_wide ? {{17{c[14]}},c} : {{23{c[8]}},c[8:0]};
 wire [31:0] next_pc=req_pc+(req_wide ? 32'd8:32'd4);
 wire memory_kind=op==6'd4 || op==6'd12 || op==6'd49 || op==6'd50;
 assign req_ready=reset_n && (!rsp_valid || rsp_ready);
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   rsp_valid<=0;rsp_pc<=0;rsp_next_pc<=0;rsp_opcode<=0;rsp_a<=0;rsp_b<=0;rsp_c<=0;rsp_bx<=0;
   rsp_sbx<=0;rsp_rkb<=0;rsp_rkc<=0;rsp_branch_target<=0;rsp_disp<=0;rsp_wide<=0;
   rsp_nested_wide<=0;rsp_reserved_memory<=0;
  end else if(req_ready) begin
   rsp_valid<=req_valid;
   if(req_valid) begin
    rsp_pc<=req_pc;rsp_next_pc<=next_pc;rsp_opcode<=op;rsp_a<=a;rsp_b<=b;rsp_c<=c;rsp_bx<=bx;
    rsp_sbx<=sbx;rsp_rkb<=rkb;rsp_rkc<=rkc;rsp_branch_target<=next_pc+(sbx<<2);
    rsp_disp<=ext;rsp_wide<=req_wide;rsp_nested_wide<=req_wide && op==0;
    rsp_reserved_memory<=memory_kind && c>15'd5;
   end
  end
 end
endmodule
