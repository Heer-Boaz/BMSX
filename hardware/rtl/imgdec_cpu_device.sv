`timescale 1ns/1ps
// CPU-side IMGDEC register/DATA owner around the physical batched stream.
// `access_index` is already decoded to the nine word registers in Book I;
// the CPU/bus owner supplies alignment/access-size faults. A held CPU write
// remains valid until access_ready. DMA ownership inputs only exclude CPU DATA
// accesses: no DMA word path, block-boundary request latching or supervisor
// quiescence/state transfer is implemented. The registered interrupt pulse is
// presented to the external central IRQ bank, which is not reset here.
//
// The decoder can take multiple physical clocks to prepare a batch; this test
// owner does not claim the public batch deadline or same-cycle read/IRQ timing.
// A detected format fault withdraws new writes and request lines immediately;
// the following clock latches terminal status and the central IRQ pulse.
// It does not discard FIFO contents or DATA on DONE/FORMAT_FAULT. START resets
// the stream and DATA but retains the full programming words and CONTROL[31:1].
// Decode history may advance before a batch is publicly committed; the stream
// owner documents the unresolved supervisor/visibility boundary.
// FIFO/readiness separation follows OpenTitan's UART register/FIFO datapaths:
// https://github.com/lowRISC/opentitan/blob/master/hw/ip/uart/rtl/uart_core.sv
module imgdec_cpu_device (
 input wire clk,reset_n,
 input wire access_valid,access_write,input wire [3:0] access_index,
 input wire [31:0] access_wdata,output wire access_ready,
 output reg [31:0] access_rdata,output wire access_read_only_fault,
 input wire dma_owns_read,dma_owns_write,
 output wire input_request,output_request,output reg irq_pulse,
 output wire [31:0] input_words_received,decoded_words,
 output wire [5:0] input_occupancy,output wire [6:0] output_occupancy
);
 reg [31:0] input_count_word,texture_destination,texture_size,clut_destination,control_word;
 reg [31:0] data_word,received,read_count;
 reg active,done,fault,waiting_data_write;
 wire [31:0] expected_output;
 wire stream_input_ready,stream_output_valid,stream_complete,stream_fault;
 wire [31:0] stream_output_word;
 wire [31:0] input_remaining=input_count_word-received;
 wire [31:0] output_remaining=expected_output-read_count;
 wire [31:0] input_block=input_remaining<16 ? input_remaining : 32'd16;
 wire [31:0] output_block=output_remaining<16 ? output_remaining : 32'd16;
 assign input_request=active && !stream_fault && input_remaining!=0 && (32'd32-input_occupancy)>=input_block;
 assign output_request=active && !stream_fault && output_remaining!=0 && output_occupancy>=output_block;
 wire config_write=access_write && access_index<5;
 wire data_write=access_write && access_index==6;
 wire data_read=!access_write && access_index==6;
 wire cpu_data_ready=active && !stream_fault && received<input_count_word && stream_input_ready && !dma_owns_write &&
  (!waiting_data_write || input_request);
 assign access_ready=reset_n && (config_write ? !active : data_write ? cpu_data_ready : 1'b1);
 assign access_read_only_fault=access_valid && access_ready && access_write &&
  (access_index==5 || access_index==7 || access_index==8);
 wire accepted=access_valid && access_ready;
 wire do_write_data=accepted && data_write;
 wire do_read_data=accepted && data_read && !dma_owns_read;
 wire start=accepted && config_write && access_index==4 && access_wdata[0];
 wire read_take=do_read_data && stream_output_valid;
 wire [31:0] next_read_count=read_count+read_take;
 wire done_read=do_read_data && next_read_count==expected_output && stream_complete;
 assign input_words_received=received;
 always @* case(access_index)
  0:access_rdata=input_count_word;
  1:access_rdata=texture_destination;
  2:access_rdata=texture_size;
  3:access_rdata=clut_destination;
  4:access_rdata=control_word;
  5:access_rdata={27'b0,fault,output_request,input_request,done,active};
  6:access_rdata=(!dma_owns_read && stream_output_valid) ? stream_output_word : data_word;
  7:access_rdata=received;
  8:access_rdata=decoded_words;
  default:access_rdata=32'b0;
 endcase
 imgdec_stream_batched stream(.clk(clk),.reset_n(reset_n),.stream_start(start),.permit(active),
  .texture_destination(texture_destination),.texture_size(texture_size),.clut_destination(clut_destination),
  .input_write_valid(do_write_data),.input_write_ready(stream_input_ready),.input_write_word(access_wdata),
  .input_finished(received==input_count_word),.input_occupancy(input_occupancy),
  .output_valid(stream_output_valid),.output_ready(do_read_data),.output_word(stream_output_word),
  .output_occupancy(output_occupancy),.decoded_words(decoded_words),.expected_output_words(expected_output),
  .production_complete(stream_complete),.format_fault(stream_fault));
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   input_count_word<=0;texture_destination<=0;texture_size<=0;clut_destination<=0;control_word<=0;
   data_word<=0;received<=0;read_count<=0;active<=0;done<=0;fault<=0;irq_pulse<=0;waiting_data_write<=0;
  end else begin
   irq_pulse<=0;
   if(!access_valid || !data_write || accepted) waiting_data_write<=0;
   else waiting_data_write<=1;
   if(start) begin
    control_word<=access_wdata & 32'hfffffffe;
    data_word<=0;received<=0;read_count<=0;active<=1;done<=0;fault<=0;
   end else begin
    if(accepted && config_write) case(access_index)
     0:input_count_word<=access_wdata;
     1:texture_destination<=access_wdata;
     2:texture_size<=access_wdata;
     3:clut_destination<=access_wdata;
     4:control_word<=access_wdata;
     default:begin end
    endcase
    if(do_write_data) begin data_word<=access_wdata;received<=received+1'b1;end
    if(read_take) begin data_word<=stream_output_word;read_count<=next_read_count;end
    if(active && stream_fault) begin active<=0;done<=0;fault<=1;irq_pulse<=1;end
    else if(done_read) begin active<=0;done<=1;fault<=0;irq_pulse<=1;end
   end
  end
 end
endmodule
