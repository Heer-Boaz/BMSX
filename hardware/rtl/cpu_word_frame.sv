`timescale 1ns/1ps
// Physical word-execution and numeric frame-value access candidate.
// The frame/image value-storage owner returns its Number classification and
// 64-bit numeric payload on an accepted read. Non-Number values read as NaN;
// their underlying kind and reference remain wholly with that owner. Numeric
// writeback is committed through that owner and raises the active frame's top
// on the very same accepted edge. No host object representation or new public
// value encoding is implied by the one-bit Number classification.
//
// frame_load installs the current frame's previously retained top. The CPU
// frame scheduler must load/switch frames only when this execute unit is idle,
// and must route each slot request to that frame or its execution image. The
// external storage ports perform a read on read_valid && read_ready and a
// Number write on write_valid && write_ready; any delayed read response is
// retained until accepted. Read responses may also accompany admission. The
// store's physical implementation, allocation, faults, GC and frame switching
// are not implemented here. The serial word unit does not prove the nominal
// one-system-cycle cost in Book I.
//
// Production precedent: PicoRV32 separates register-file ownership and ALU
// operand/execute control, with parameterized register storage implementation.
// https://github.com/YosysHQ/picorv32/blob/main/picorv32.v
module cpu_word_frame (
 input wire clk, reset_n,
 input wire frame_load, input wire [31:0] frame_load_top,
 output reg [31:0] frame_top,
 input wire req_valid, output wire req_ready, output wire select,
 input wire [5:0] req_opcode, input wire [13:0] req_a,
 input wire [14:0] req_b, input wire [31:0] req_rkb, req_rkc,
 output wire slot_read_valid, input wire slot_read_ready,
 output wire slot_read_constant, output wire [14:0] slot_read_index,
 input wire slot_rsp_valid, output wire slot_rsp_ready,
 input wire slot_rsp_is_number, input wire [63:0] slot_rsp_payload,
 output wire slot_write_valid, input wire slot_write_ready,
 output wire [13:0] slot_write_index, output wire [63:0] slot_write_number
);
 wire [63:0] numeric_read=slot_rsp_is_number ? slot_rsp_payload : 64'h7ff8000000000000;
 wire [31:0] written_top={18'd0,slot_write_index}+32'd1;
 cpu_word_execute execute (
  .clk(clk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),.select(select),
  .req_opcode(req_opcode),.req_a(req_a),.req_b(req_b),.req_rkb(req_rkb),.req_rkc(req_rkc),
  .read_valid(slot_read_valid),.read_ready(slot_read_ready),.read_constant(slot_read_constant),
  .read_index(slot_read_index),.read_rsp_valid(slot_rsp_valid),.read_rsp_ready(slot_rsp_ready),
  .read_rsp_number(numeric_read),.write_valid(slot_write_valid),.write_ready(slot_write_ready),
  .write_index(slot_write_index),.write_number(slot_write_number)
 );
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) frame_top<=0;
  else if(frame_load) frame_top<=frame_load_top;
  else if(slot_write_valid && slot_write_ready && written_top>frame_top) frame_top<=written_top;
 end
endmodule
