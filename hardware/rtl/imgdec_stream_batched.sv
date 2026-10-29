`timescale 1ns/1ps
// IMGDEC stream, 32-word input store, 16-word batch staging and 64-word
// output FIFO. The enclosing device owns the exact received/count equality,
// CPU/DMA arbitration, DATA latch, DONE, IRQ, service deadlines and supervisor
// snapshots. input_finished means the configured input count has been received.
// Input has one producer and no independent popper while a batch is staged.
// The current stage and run, input availability, 16-word bound and registered
// output free space set each batch length. Output FIFO occupancy and the public
// decoded count change together on commit. For a literal, staging reads ahead
// without releasing FIFO entries; the input read pointer advances on commit.
// Payload history advances internally during staging, before public commit;
// stopping/restoring this partial hardware state is not yet implemented.
// The physical preparation takes multiple clocks and does not claim Book I's
// output deadline. A stopped clock or paused producer can defer publication.
// FIFO principles: https://github.com/lowRISC/opentitan/blob/master/hw/ip/prim/rtl/prim_fifo_sync.sv
// LZ history separation: https://github.com/Xilinx/Vitis_Libraries/blob/v2024.2_rel/data_compression/L1/include/hw/lz_decompress.hpp
module imgdec_stream_batched (
 input wire clk,reset_n,stream_start,permit,
 input wire [31:0] texture_destination,texture_size,clut_destination,
 input wire input_write_valid,output wire input_write_ready,input wire [31:0] input_write_word,
 input wire input_finished,output wire [5:0] input_occupancy,
 output wire output_valid,input wire output_ready,output wire [31:0] output_word,
 output wire [6:0] output_occupancy,
 output reg [31:0] decoded_words,output wire [31:0] expected_output_words,
 output wire production_complete,format_fault
);
 localparam [1:0] SELECT=0,COLLECT=1,COMMIT=2;
 reg [1:0] batch_state;
 reg [4:0] batch_size,batch_index;
 reg batch_literal;
 reg [511:0] batch_words;
 reg [31:0] input_words[0:31];
 reg [4:0] input_write_ptr,input_read_ptr;
 reg [5:0] input_count;
 wire [4:0] input_read_address=input_read_ptr + ((batch_state==COLLECT && batch_literal) ? batch_index : 5'd0);
 wire input_available=input_count!=0;
 wire stream_input_ready; wire stream_input_valid=input_available;
 wire fifo_ready;
 wire input_push=input_write_valid && input_write_ready;
 wire input_take=stream_input_valid && stream_input_ready && !(batch_state==COLLECT && batch_literal);
 wire [5:0] input_pop_count=(batch_state==COMMIT && permit && fifo_ready && batch_literal) ? {1'b0,batch_size} : {5'b0,input_take};
 assign input_write_ready=reset_n && !stream_start && input_count!=32;
 assign input_occupancy=input_count;
 always @(posedge clk) if(input_push) input_words[input_write_ptr]<=input_write_word;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin input_write_ptr<=0;input_read_ptr<=0;input_count<=0;end
  else if(stream_start) begin input_write_ptr<=0;input_read_ptr<=0;input_count<=0;end
  else begin
   if(input_push) input_write_ptr<=input_write_ptr+1'b1;
   if(input_pop_count!=0) input_read_ptr<=input_read_ptr+input_pop_count;
   input_count<=input_count+input_push-input_pop_count;
  end
 end
 wire header_valid,word_valid,stream_word_ready,stream_complete,stream_fault;
 wire [31:0] h0,h1,h2,stream_word,stream_decoded,run_remaining,stage_remaining;
 wire literal_mode;
 wire stream_permit=permit && batch_state!=COMMIT;
 wire [6:0] output_free=7'd64-output_occupancy;
 wire [31:0] bounded_run=run_remaining<stage_remaining ? run_remaining : stage_remaining;
 wire [31:0] bounded_output=bounded_run<output_free ? bounded_run : output_free;
 wire [31:0] bounded_max=bounded_output<16 ? bounded_output : 32'd16;
 wire [4:0] next_batch_size=literal_mode && input_count<bounded_max ? input_count[4:0] : bounded_max[4:0];
 wire header_push=header_valid && batch_state==SELECT;
 wire batch_push=batch_state==COMMIT && permit;
 wire fifo_push=header_push || batch_push;
 wire [4:0] fifo_push_count=header_push ? 5'd3 : batch_size;
 wire [511:0] fifo_push_words=header_push ? {416'd0,h2,h1,h0} : batch_words;
 assign stream_word_ready=batch_state==COLLECT && permit;
 assign production_complete=stream_complete;
 assign format_fault=stream_fault;
 imgdec_stream stream(.clk(clk),.reset_n(reset_n),.stream_start(stream_start),.permit(stream_permit),
  .texture_destination(texture_destination),.texture_size(texture_size),.clut_destination(clut_destination),
  .input_valid(stream_input_valid),.input_ready(stream_input_ready),.input_word(input_words[input_read_address]),
  .input_exhausted(input_finished && !input_available),
  .header_valid(header_valid),.header_ready(fifo_ready && batch_state==SELECT),
  .header_word0(h0),.header_word1(h1),.header_word2(h2),
  .word_valid(word_valid),.word_ready(stream_word_ready),.word_data(stream_word),
  .output_has_space(output_occupancy!=64),.decoded_words(stream_decoded),
  .expected_output_words(expected_output_words),.payload_run_remaining(run_remaining),
  .payload_stage_remaining(stage_remaining),.payload_literal(literal_mode),
  .production_complete(stream_complete),.format_fault(stream_fault));
 imgdec_output_fifo fifo(.clk(clk),.reset_n(reset_n),.clear(stream_start),
  .push_valid(fifo_push),.push_ready(fifo_ready),.push_count(fifo_push_count),.push_words(fifo_push_words),
  .pop_valid(output_valid),.pop_ready(output_ready),.pop_word(output_word),.occupancy(output_occupancy));
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin batch_state<=SELECT;batch_size<=0;batch_index<=0;batch_literal<=0;decoded_words<=0;end
  else if(stream_start) begin batch_state<=SELECT;batch_size<=0;batch_index<=0;batch_literal<=0;decoded_words<=0;end
  else if(permit) begin
   case(batch_state)
    SELECT: if(word_valid && next_batch_size!=0) begin
     batch_size<=next_batch_size;batch_index<=0;batch_literal<=literal_mode;batch_state<=COLLECT;
    end
    COLLECT: if(word_valid && stream_word_ready) begin
     batch_words[batch_index*32+:32]<=stream_word;
     if(batch_index+1'b1==batch_size) batch_state<=COMMIT;
     else batch_index<=batch_index+1'b1;
    end
    COMMIT: if(fifo_ready) begin decoded_words<=decoded_words+batch_size;batch_state<=SELECT;end
   endcase
  end
 end
endmodule
