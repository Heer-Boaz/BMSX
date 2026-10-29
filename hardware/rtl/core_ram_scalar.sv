`timescale 1ns/1ps
// The CORE RAM datapath accepts the original little-endian scalar, not a
// pre-aligned word. A scalar occupies one or two native x32 DRAM cycles. The
// private-domain request comes only from the internal VM owner and carries a
// 22-bit private byte offset in req_address[21:0]. Public clients retain the
// original complete-address/extent checks and cannot select the private bank.
// The allocator owns private spans; this datapath does not impose guest-visible
// addresses or fabricate a private allocation/fault policy.
// A public request is checked against the complete installed extent before
// issuing either cycle, so a rejected public write does not partially modify
// RAM. The caller retains ownership
// until the single response, including across both cycles and DRAM refresh.
// A system reset suppresses the response and any unissued second cycle; a
// native cycle already accepted by main_dram completes its legal waveform.
//
// Byte-lane realignment and write strobes are used in production bus datapaths:
// https://github.com/alexforencich/verilog-axi/blob/master/rtl/axi_dma_wr.v
module core_ram_scalar (
    input wire clk, power_reset_n, reset_n,
    input wire req_valid,
    output wire req_ready,
    input wire req_write, req_private,
    input wire [31:0] req_address, req_wdata,
    input wire [2:0] req_size_bytes,
    output wire rsp_valid,
    output reg [31:0] rsp_rdata, rsp_fault_code,
    output wire init_done,
    output wire [9:0] ma,
    inout wire [31:0] md,
    output wire ras_n, ras_private_n, we_n, oe_n, oe_private_n,
    output wire [3:0] cas_n
);
    localparam [2:0] IDLE=0, FIRST_ISSUE=1, FIRST_WAIT=2,
        SECOND_ISSUE=3, SECOND_WAIT=4, RESPONSE=5;
    reg [2:0] state;
    reg [31:0] address_word, data_word, first_read;
    reg [2:0] size_bytes;
    reg writing, private_latch;
    wire active_reset_n = power_reset_n && reset_n;
    wire native_ready, native_rsp;
    wire [31:0] native_rdata;
    wire second = state==SECOND_ISSUE || state==SECOND_WAIT;
    wire [2:0] start_lane = {1'b0,address_word[1:0]};
    wire needs_second = start_lane + size_bytes > 4;
    wire [63:0] aligned_data = {32'b0,data_word} << (start_lane * 8);
    wire [7:0] lane_mask = ((8'b1 << size_bytes)-1'b1) << start_lane;
    wire [63:0] read_pair = {native_rdata,first_read} >> (start_lane * 8);
    wire [31:0] first_value = native_rdata >> (start_lane * 8);
    wire [31:0] value_mask = size_bytes==1 ? 32'h000000ff :
                             size_bytes==2 ? 32'h0000ffff : 32'hffffffff;
    wire [32:0] req_end = {1'b0,req_address} + req_size_bytes;

    assign req_ready = active_reset_n && init_done && state==IDLE;
    assign rsp_valid = active_reset_n && state==RESPONSE;
    main_dram dram (
        .clk(clk), .power_reset_n(power_reset_n), .reset_n(reset_n),
        .req_valid(state==FIRST_ISSUE || state==SECOND_ISSUE),
        .req_ready(native_ready), .req_write(writing), .req_private(private_latch),
        .req_address(address_word[21:2] + (second ? 20'd1 : 20'd0)),
        .req_wdata(second ? aligned_data[63:32] : aligned_data[31:0]),
        .req_be_n(second ? ~lane_mask[7:4] : ~lane_mask[3:0]),
        .rsp_valid(native_rsp), .rsp_rdata(native_rdata), .init_done(init_done),
        .ma(ma), .md(md), .ras_n(ras_n), .ras_private_n(ras_private_n), .we_n(we_n), .oe_n(oe_n), .oe_private_n(oe_private_n), .cas_n(cas_n)
    );
    always @(posedge clk or negedge active_reset_n) begin
        if(!active_reset_n) begin
            state<=IDLE;address_word<=0;data_word<=0;size_bytes<=0;
            first_read<=0;writing<=0;private_latch<=0;rsp_rdata<=0;rsp_fault_code<=0;
        end else case(state)
            IDLE: if(req_valid && req_ready) begin
                address_word<=req_address;data_word<=req_wdata;
                size_bytes<=req_size_bytes;writing<=req_write;private_latch<=req_private;
                rsp_rdata<=0;rsp_fault_code<=0;
                if(!req_private && (req_address<32'h08000000 || req_end>33'h008400000)) begin
                    rsp_fault_code<=1;state<=RESPONSE;
                end else state<=FIRST_ISSUE;
            end
            FIRST_ISSUE: if(native_ready) state<=FIRST_WAIT;
            FIRST_WAIT: if(native_rsp) begin
                if(needs_second) begin first_read<=native_rdata;state<=SECOND_ISSUE;end
                else begin
                    if(!writing) rsp_rdata<=first_value & value_mask;
                    state<=RESPONSE;
                end
            end
            SECOND_ISSUE: if(native_ready) state<=SECOND_WAIT;
            SECOND_WAIT: if(native_rsp) begin
                if(!writing) rsp_rdata<=read_pair[31:0] & value_mask;
                state<=RESPONSE;
            end
            RESPONSE: state<=IDLE;
        endcase
    end
endmodule
