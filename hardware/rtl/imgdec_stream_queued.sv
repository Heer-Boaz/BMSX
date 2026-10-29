`timescale 1ns/1ps
// Integration trial: the stream producer's atomic 3-word headers and single
// payload words enter the real 64-word output FIFO. The FIFO supports future
// 16-word payload batches, but this producer does not build them yet; neither
// this module nor its handshakes implement Book I batch timing, MMIO, DMA,
// DATA retention, DONE, IRQ or supervisor quiescence.
module imgdec_stream_queued (
 input wire clk,reset_n,stream_start,permit,
 input wire [31:0] texture_destination,texture_size,clut_destination,
 input wire input_valid,output wire input_ready,input wire [31:0] input_word,
 input wire input_exhausted,
 output wire output_valid,input wire output_ready,output wire [31:0] output_word,
 output wire [6:0] output_occupancy,
 output wire [31:0] decoded_words,expected_output_words,
 output wire production_complete,format_fault
);
 wire header_valid,header_ready,word_valid,word_ready;
 wire [31:0] header0,header1,header2,word;
 wire push_ready;
 wire [4:0] push_count=header_valid ? 5'd3 : 5'd1;
 wire [511:0] push_words=header_valid ? {416'b0,header2,header1,header0} : {480'b0,word};
 assign header_ready=push_ready;
 assign word_ready=push_ready;
 imgdec_stream stream(.clk(clk),.reset_n(reset_n),.stream_start(stream_start),.permit(permit),
  .texture_destination(texture_destination),.texture_size(texture_size),.clut_destination(clut_destination),
  .input_valid(input_valid),.input_ready(input_ready),.input_word(input_word),.input_exhausted(input_exhausted),
  .header_valid(header_valid),.header_ready(header_ready),.header_word0(header0),.header_word1(header1),.header_word2(header2),
  .word_valid(word_valid),.word_ready(word_ready),.word_data(word),.output_has_space(output_occupancy!=64),
  .decoded_words(decoded_words),.expected_output_words(expected_output_words),.production_complete(production_complete),.format_fault(format_fault));
 imgdec_output_fifo fifo(.clk(clk),.reset_n(reset_n),.clear(stream_start),
  .push_valid(header_valid || word_valid),.push_ready(push_ready),.push_count(push_count),.push_words(push_words),
  .pop_valid(output_valid),.pop_ready(output_ready),.pop_word(output_word),.occupancy(output_occupancy));
endmodule
