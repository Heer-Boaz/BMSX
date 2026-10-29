`timescale 1ns/1ps
// IMGDEC input-header, payload and GP0 packet producer. The enclosing device
// owns the DATA FIFOs, the received-input count and the final DATA-read/DONE
// rule. input_exhausted means that count has reached INPUT_WORD_COUNT AND the
// input FIFO is empty; it is not a guessed size of a source image.
//
// header_valid/header_ready transfers all THREE header words atomically to the
// enclosing output FIFO. header_ready must be asserted only when the FIFO can
// accept that complete group; word_ready accepts one payload word. The output
// FIFO supplies output_has_space even while arbitration holds word_ready low,
// because the completed-stage fault check depends on FIFO capacity, not on a
// consumer's willingness to read. permit gates input consumption and FIFO
// publication; an already issued history read can still complete internally.
// Supervisor quiescence and state save must account for that internal step.
// There is no CPU/DMA/MMIO interface or timing claim.
//
// A partial token and its 4096-word history remain live across the texture to
// CLUT transition. Counts, destinations and sizes remain full 32-bit words;
// texture+CLUT and output counts wrap at 32 bits as specified by Book I.
// Producer/consumer division follows the streaming history/FIFO separation in
// AMD Vitis' LZ decompressor, not that library's byte-level token format:
// https://github.com/Xilinx/Vitis_Libraries/blob/v2024.2_rel/data_compression/L1/include/hw/lz_decompress.hpp
module imgdec_stream (
 input wire clk,reset_n,stream_start,permit,
 input wire [31:0] texture_destination,texture_size,clut_destination,
 input wire input_valid,output wire input_ready,input wire [31:0] input_word,
 input wire input_exhausted,
 output wire header_valid,input wire header_ready,
 output wire [31:0] header_word0,header_word1,header_word2,
 output wire word_valid,input wire word_ready,output wire [31:0] word_data,
 input wire output_has_space,
 output wire [31:0] decoded_words,output reg [31:0] expected_output_words,
 output wire [31:0] payload_run_remaining,payload_stage_remaining,output wire payload_literal,
 output reg production_complete,output wire format_fault
);
 localparam [3:0] MAGIC=0,TEX_COUNT=1,CLUT_COUNT=2,TEX_HEADER=3,TEX_PAYLOAD=4,
  CLUT_HEADER=5,CLUT_PAYLOAD=6,FINISH=7,COMPLETE=8,FAULT=9,IDLE=10;
 reg [3:0] state;
 reg [31:0] tex_count,clut_count,tex_dest_latched,tex_size_latched,clut_dest_latched;
 wire payload_phase=state==TEX_PAYLOAD || state==CLUT_PAYLOAD;
 wire [31:0] endpoint=state==TEX_PAYLOAD ? tex_count : tex_count+clut_count;
 assign payload_stage_remaining=endpoint-decoded_words;
 wire boundary=payload_phase && decoded_words==endpoint;
 wire payload_active=reset_n && !stream_start && permit && payload_phase && !boundary;
 wire payload_input_active=payload_active && output_has_space;
 wire p_input_ready,p_output_valid,p_between,p_needs_input,p_fault;
 reg local_fault;
 assign format_fault=local_fault || p_fault;
 wire [31:0] p_output_word;
 wire p_output_ready=payload_active && word_ready;
 imgdec_payload payload(.clk(clk),.reset_n(reset_n),.stream_start(stream_start),
  .input_valid(input_valid && payload_input_active),.input_ready(p_input_ready),.input_word(input_word),
  .output_valid(p_output_valid),.output_ready(p_output_ready),.output_word(p_output_word),
  .between_tokens(p_between),.needs_input(p_needs_input),.run_remaining(payload_run_remaining),.literal_mode(payload_literal),
  .format_fault(p_fault),.decoded_words(decoded_words));
 assign input_ready=reset_n && !stream_start && permit &&
  (state==MAGIC || state==TEX_COUNT || state==CLUT_COUNT || (payload_input_active && p_input_ready));
 assign header_valid=reset_n && !stream_start && permit && (state==TEX_HEADER || state==CLUT_HEADER);
 assign header_word0=32'ha0000000;
 assign header_word1=state==TEX_HEADER ? tex_dest_latched : clut_dest_latched;
 assign header_word2=state==TEX_HEADER ? tex_size_latched : 32'h00010010;
 assign word_valid=payload_active && p_output_valid;
 assign word_data=p_output_word;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   state<=IDLE;tex_count<=0;clut_count<=0;tex_dest_latched<=0;tex_size_latched<=0;clut_dest_latched<=0;
   expected_output_words<=0;production_complete<=0;local_fault<=0;
  end else if(stream_start) begin
   state<=MAGIC;tex_count<=0;clut_count<=0;
   tex_dest_latched<=texture_destination;tex_size_latched<=texture_size;clut_dest_latched<=clut_destination;
   expected_output_words<=0;production_complete<=0;local_fault<=0;
  end else if(permit) begin
   case(state)
    MAGIC,TEX_COUNT,CLUT_COUNT: begin
     if(input_valid && input_ready) begin
      if(state==MAGIC) begin
       if(input_word==32'h31444d49) state<=TEX_COUNT;
       else begin local_fault<=1;state<=FAULT;end
      end else if(state==TEX_COUNT) begin tex_count<=input_word;state<=CLUT_COUNT;end
      else begin
       clut_count<=input_word;
       expected_output_words<=tex_count+32'd3+(input_word==0 ? 32'd0 : input_word+32'd3);
       state<=TEX_HEADER;
      end
     end else if(input_exhausted) begin local_fault<=1;state<=FAULT;end
    end
    TEX_HEADER: if(header_ready) state<=TEX_PAYLOAD;
    CLUT_HEADER: if(header_ready) state<=CLUT_PAYLOAD;
    TEX_PAYLOAD,CLUT_PAYLOAD: begin
     if(p_fault) begin local_fault<=1;state<=FAULT;end
     else if(boundary) begin
      if(state==TEX_PAYLOAD && clut_count!=0) state<=CLUT_HEADER;
      else state<=FINISH;
     end else if(output_has_space && p_needs_input && !input_valid && input_exhausted) begin
      local_fault<=1;state<=FAULT;
     end
    end
    FINISH: if(output_has_space) begin
     if(!p_between || input_valid) begin local_fault<=1;state<=FAULT;end
     else if(input_exhausted) begin production_complete<=1;state<=COMPLETE;end
    end
    default: begin end
   endcase
  end
 end
endmodule
