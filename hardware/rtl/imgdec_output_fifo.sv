`timescale 1ns/1ps
// The output FIFO admits complete 1..16-word batches atomically. Sixteen
// interleaved 4-word banks permit one write per bank even when a batch wraps
// around the 64-word ring. A simultaneous pop reads the old front word.
// Like OpenTitan's synchronous FIFO, availability is based on registered
// occupancy, with no empty bypass or speculative same-edge space reuse:
// https://github.com/lowRISC/opentitan/blob/master/hw/ip/prim/rtl/prim_fifo_sync.sv
// DATA retention, CPU/DMA arbitration, START/DONE and IMGDEC timing are owned
// by the device around this FIFO, not by the storage primitive.
module imgdec_output_fifo (
 input wire clk, reset_n, clear,
 input wire push_valid, output wire push_ready,
 input wire [4:0] push_count, input wire [511:0] push_words,
 output wire pop_valid, input wire pop_ready, output wire [31:0] pop_word,
 output reg [6:0] occupancy
);
 reg [5:0] write_ptr, read_ptr;
 wire push = push_valid && push_ready;
 wire pop = pop_valid && pop_ready;
 assign push_ready = reset_n && !clear && ({2'b0,push_count} <= 7'd64 - occupancy);
 assign pop_valid = reset_n && !clear && occupancy != 0;
 wire [31:0] bank_read [0:15];
 assign pop_word = bank_read[read_ptr[3:0]];
 genvar b;
 generate for (b=0;b<16;b=b+1) begin: bank
  reg [31:0] words[0:3];
  wire [3:0] offset = b - write_ptr[3:0];
  wire [5:0] address = write_ptr + offset;
  assign bank_read[b] = words[read_ptr[5:4]];
  always @(posedge clk) begin
   if (push && {1'b0,offset} < push_count)
    words[address[5:4]] <= push_words[offset*32 +: 32];
  end
 end endgenerate
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   write_ptr<=0;read_ptr<=0;occupancy<=0;
  end else if(clear) begin
   write_ptr<=0;read_ptr<=0;occupancy<=0;
  end else begin
   if(push) write_ptr<=write_ptr+push_count;
   if(pop) read_ptr<=read_ptr+1'b1;
   case({push,pop})
    2'b10: occupancy<=occupancy+push_count;
    2'b01: occupancy<=occupancy-1'b1;
    2'b11: occupancy<=occupancy+push_count-1'b1;
    default: begin end
   endcase
  end
 end
endmodule
