`timescale 1ns/1ps
// Alternative compact VM-slot owner, NOT an adapter for cpu_value_store's
// 68-bit raw interface. Its own raw 64-bit slot is copied without decoding or
// normalization. The Number producer is a different operation: on entry to
// this owner all IEEE-754 NaNs become 7ff8000000000000; every other Number,
// including signed zero and infinities, keeps its bits. The convention matches
// the existing C++ valueFromNumber representation, but object handles, all
// other value producers, the loader and the collector are not implemented.
//
// qNaN tag bits are {sign, bits 50:48}; a nonzero tag identifies a non-Number.
// All 64-bit patterns have deterministic classification, even patterns that
// a Number producer would not emit. A raw copy must not re-canonicalize them.
// Slot indices use 8 bytes, in a private region whose allocation belongs to
// the VM. Two 32-bit transfers retain the same CORE reservation: other access
// owners must honor req_hold. Reset or a word fault may leave partial data;
// neither operation is transactional. No VM integration, memory budget,
// latency, physical timing or complete Number semantics are claimed.
// See https://github.com/WebKit/WebKit/blob/main/Source/JavaScriptCore/runtime/JSCJSValue.h
// and the project's existing machine/cpp/machine/cpu/value.h representation.
module cpu_compact_slot_word_store (
 input wire clk, reset_n,
 input wire [31:0] region_base,
 input wire mem_valid, output wire mem_ready, input wire mem_write, mem_number,
 input wire [31:0] mem_address, input wire [63:0] mem_wdata,
 output wire mem_rsp_valid, input wire mem_rsp_ready,
 output wire [63:0] mem_rsp_data, output wire mem_rsp_is_number,
 output wire req_valid, input wire req_ready, output wire req_write, req_hold,
 output wire [31:0] req_address, req_wdata,
 input wire rsp_valid, input wire [31:0] rsp_rdata, rsp_fault_code, input wire rsp_timeout,
 output reg fault_valid, output reg [31:0] fault_address, fault_code,
 output reg fault_timeout, fault_write, fault_words_completed
);
 localparam [2:0] IDLE=0, ISSUE=1, WAIT_WORD=2, COMPLETE=3, HOLD_RESPONSE=4, FAULT=5;
 reg [2:0] state;
 reg word_index, write_latch;
 reg [31:0] address_latch;
 reg [63:0] data_latch, read_latch;
 wire input_nan=(&mem_wdata[62:52]) && (|mem_wdata[51:0]);
 wire tagged_qnan=(&read_latch[62:51]) && (read_latch[63] || (|read_latch[50:48]));
 assign req_valid=reset_n && state==ISSUE;
 assign req_write=write_latch;
 assign req_hold=!word_index;
 assign req_address=address_latch+{29'd0,word_index,2'b00};
 assign req_wdata=word_index ? data_latch[63:32] : data_latch[31:0];
 assign mem_ready=reset_n && state==COMPLETE;
 assign mem_rsp_valid=reset_n && (state==HOLD_RESPONSE || state==COMPLETE && !write_latch);
 assign mem_rsp_data=read_latch;
 assign mem_rsp_is_number=!tagged_qnan;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   state<=IDLE; word_index<=0; write_latch<=0; address_latch<=0; data_latch<=0; read_latch<=0;
   fault_valid<=0; fault_address<=0; fault_code<=0; fault_timeout<=0; fault_write<=0; fault_words_completed<=0;
  end else case(state)
   IDLE: if(mem_valid) begin
    address_latch<=region_base+(mem_address<<3);
    data_latch<=mem_number && input_nan ? 64'h7ff8000000000000 : mem_wdata;
    write_latch<=mem_write; word_index<=0; state<=ISSUE;
   end
   ISSUE: if(req_ready) state<=WAIT_WORD;
   WAIT_WORD: if(rsp_valid) begin
    if(rsp_fault_code!=0 || rsp_timeout) begin
     fault_valid<=1; fault_address<=req_address; fault_code<=rsp_fault_code;
     fault_timeout<=rsp_timeout; fault_write<=write_latch; fault_words_completed<=word_index; state<=FAULT;
    end else begin
     if(!write_latch) begin
      if(!word_index) read_latch[31:0]<=rsp_rdata;
      else read_latch[63:32]<=rsp_rdata;
     end
     if(word_index) state<=COMPLETE;
     else begin word_index<=1; state<=ISSUE; end
    end
   end
   COMPLETE: if(mem_valid) begin
    if(write_latch || mem_rsp_ready) state<=IDLE;
    else state<=HOLD_RESPONSE;
   end
   HOLD_RESPONSE: if(mem_rsp_ready) state<=IDLE;
  endcase
 end
endmodule
