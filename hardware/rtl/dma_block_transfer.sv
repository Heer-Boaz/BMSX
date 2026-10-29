`timescale 1ns/1ps
// Physical transfer of one admitted BMSX DMA block.  The channel register and
// request-gate owners admit the block and retain channel identity; this module
// snapshots the raw address/count/control words and services one word at a time.
// It does not implement DMA channel registers, arbitration or IRQ delivery.
//
// Each read completes before its matching write begins.  A bus fault is recorded
// by the CORE fabric and does not abort the block: its response supplies the
// read word or records the ignored write as specified by Book I.  No access is
// replayed.  A transport timeout is distinct from a bus fault: stop and report
// the last completed address/count state; a timed-out write may already have
// taken effect and must not be automatically retried.
//
// Source and destination selectors independently select cartridge sockets.
// The original scalar address, word, U32 fault-access bits and the raw DMA,
// block-end and socket strobes go to the actual CORE request owner.  The CORE
// fabric must format unaligned non-cartridge words at its scalar boundary;
// this engine does not split or align away the original request.
//
// Reference implementations studied: LiteX DMA retains accepted stream data
// through bus backpressure, while verilog-axi DMA advances descriptor state
// only on the corresponding transfer handshake.
// https://github.com/enjoy-digital/litex/blob/master/litex/soc/cores/dma.py
// https://github.com/alexforencich/verilog-axi/blob/master/rtl/axi_dma_wr.v
module dma_block_transfer (
    input wire clk, reset_n,
    input wire block_valid,
    output wire block_ready,
    input wire [31:0] block_read_address, block_write_address,
    input wire [31:0] block_transfer_count, block_control,
    output wire result_valid,
    output reg [31:0] result_read_address, result_write_address, result_transfer_count,
    output reg result_timeout, result_write_in_doubt,
    output wire req_valid, req_write, req_hold,
    input wire req_ready,
    output wire [31:0] req_address, req_wdata, req_access,
    output wire [2:0] req_size_bytes,
    output wire [3:0] req_be_n,
    output reg [7:0] req_bus_signals,
    output wire req_data_timeout_enable,
    output wire [17:0] req_data_wait_last,
    input wire rsp_valid, rsp_timeout,
    input wire [31:0] rsp_rdata
);
    localparam [2:0] IDLE=0, READ_ISSUE=1, READ_WAIT=2,
        WRITE_ISSUE=3, WRITE_WAIT=4, DONE=5;
    reg [2:0] phase;
    reg [31:0] read_address, write_address, transfer_count, control_word, transfer_word;
    reg [4:0] remaining;
    wire [4:0] programmed_words = {1'b0,block_control[13:10]} + 5'd1;
    wire [4:0] admitted_words = block_transfer_count < programmed_words ?
        block_transfer_count[4:0] : programmed_words;
    wire writing = phase==WRITE_ISSUE;
    wire [3:0] request_selector = writing ? control_word[9:6] : control_word[5:2];

    assign block_ready = reset_n && (phase==IDLE || phase==DONE);
    assign result_valid = reset_n && phase==DONE;
    assign req_valid = reset_n && (phase==READ_ISSUE || phase==WRITE_ISSUE);
    assign req_write = writing;
    assign req_hold = !writing || remaining!=1;
    assign req_address = writing ? write_address : read_address;
    assign req_wdata = transfer_word;
    assign req_access = writing ? 32'h00000402 : 32'h00000401;
    assign req_size_bytes = 3'd4;
    assign req_be_n = 4'b0000;
    assign req_data_timeout_enable = 1'b0;
    assign req_data_wait_last = 18'd0;
    always @* begin
        req_bus_signals = 8'h01;
        if(remaining==1) req_bus_signals[1]=1;
        case(request_selector)
            4'd7,4'd8: req_bus_signals[2]=1;
            4'd9,4'd10: begin req_bus_signals[2]=1;req_bus_signals[3]=1;end
        endcase
    end

    always @(posedge clk or negedge reset_n) begin
        if(!reset_n) begin
            phase<=IDLE;read_address<=0;write_address<=0;transfer_count<=0;
            control_word<=0;transfer_word<=0;remaining<=0;
            result_read_address<=0;result_write_address<=0;result_transfer_count<=0;
            result_timeout<=0;result_write_in_doubt<=0;
        end else case(phase)
            IDLE, DONE: if(block_valid) begin
                read_address<=block_read_address;write_address<=block_write_address;
                transfer_count<=block_transfer_count;control_word<=block_control;
                remaining<=admitted_words;result_timeout<=0;result_write_in_doubt<=0;
                result_read_address<=block_read_address;result_write_address<=block_write_address;
                result_transfer_count<=block_transfer_count;
                phase<=block_transfer_count==0 ? DONE : READ_ISSUE;
            end else phase<=IDLE;
            READ_ISSUE: if(req_ready) phase<=READ_WAIT;
            READ_WAIT: if(rsp_valid) begin
                if(rsp_timeout) begin result_timeout<=1;phase<=DONE;end
                else begin transfer_word<=rsp_rdata;phase<=WRITE_ISSUE;end
            end
            WRITE_ISSUE: if(req_ready) phase<=WRITE_WAIT;
            WRITE_WAIT: if(rsp_valid) begin
                if(rsp_timeout) begin result_timeout<=1;result_write_in_doubt<=1;phase<=DONE;end
                else begin
                    if(control_word[0]) read_address<=read_address+32'd4;
                    if(control_word[1]) write_address<=write_address+32'd4;
                    transfer_count<=transfer_count-32'd1;remaining<=remaining-1'b1;
                    result_read_address<=read_address+(control_word[0] ? 32'd4 : 32'd0);
                    result_write_address<=write_address+(control_word[1] ? 32'd4 : 32'd0);
                    result_transfer_count<=transfer_count-32'd1;
                    phase<=remaining==1 ? DONE : READ_ISSUE;
                end
            end
        endcase
    end
endmodule
