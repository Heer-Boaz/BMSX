`timescale 1ns/1ps
// APU's 131072 little-endian x32 sample words over U32's 256K x16 pins.
// The word index is the transfer offset's native bits18:2. Low halfword goes
// first; masks and data latch with the request and survive both sub-transfers.
// LiteX wishbone.DownConverter uses the same sub-address/lane separation and
// reports a wide completion after its final narrow access:
// https://github.com/enjoy-digital/litex/blob/master/litex/soc/interconnect/wishbone.py
//
// APU/global reset starts a real full-depth zero-write sweep. No external
// request is admitted until every halfword write has completed. The underlying
// pin controller finishes an accepted warm-reset write before reuse; this owner
// discards that request's response and restarts clearing from halfword zero.
// This storage owner does not implement voices, transfer FIFO or APU MMIO.
module apu_sample_store (
    input wire clk, reset_n, power_reset_n,
    input wire req_valid,
    output wire req_ready,
    input wire req_write,
    input wire [16:0] req_word_address,
    input wire [31:0] req_wdata,
    input wire [3:0] req_be_n,
    output reg rsp_valid,
    output reg [31:0] rsp_rdata,
    output wire memory_ready,
    output wire [17:0] mem_address,
    inout wire [15:0] mem_data,
    output wire mem_ce_n, mem_oe_n, mem_we_n,
    output wire [1:0] mem_be_n
);
    localparam [2:0] CLEAR=0, CLEAR_DRAIN=1, IDLE=2,
        LOW_ISSUE=3, LOW_WAIT=4, HIGH_ISSUE=5, HIGH_WAIT=6;
    reg [2:0] state;
    reg [1:0] reset_release, clear_pending;
    reg [17:0] clear_address;
    reg [16:0] word_address;
    reg write_latch;
    reg [31:0] write_data;
    reg [3:0] write_mask;
    reg [15:0] low_data;
    wire requested_reset_n = reset_n && power_reset_n;
    wire local_reset_n = reset_release[1];
    wire clearing = state==CLEAR || state==CLEAR_DRAIN;
    wire high_half = state==HIGH_ISSUE || state==HIGH_WAIT;
    wire sram_req_valid = local_reset_n &&
        (state==CLEAR || state==LOW_ISSUE || state==HIGH_ISSUE);
    wire sram_req_ready, sram_rsp_valid;
    wire [15:0] sram_rsp_rdata;
    wire sram_write = clearing || write_latch;
    wire [17:0] sram_address = clearing ? clear_address : {word_address,high_half};
    wire [15:0] sram_wdata = clearing ? 16'd0 : high_half ? write_data[31:16] : write_data[15:0];
    wire [1:0] sram_be_n = clearing ? 2'b00 : high_half ? write_mask[3:2] : write_mask[1:0];
    wire clear_accept = state==CLEAR && sram_req_ready;

    assign memory_ready = local_reset_n && !clearing;
    assign req_ready = memory_ready && state==IDLE;

    async_sram #(.DATA_WIDTH(16), .ADDRESS_WIDTH(18)) pins (
        .clk(clk), .reset_n(reset_n), .power_reset_n(power_reset_n),
        .req_valid(sram_req_valid), .req_ready(sram_req_ready),
        .req_write(sram_write), .req_address(sram_address),
        .req_wdata(sram_wdata), .req_be_n(sram_be_n),
        .rsp_valid(sram_rsp_valid), .rsp_rdata(sram_rsp_rdata),
        .mem_address(mem_address), .mem_data(mem_data),
        .mem_ce_n(mem_ce_n), .mem_oe_n(mem_oe_n), .mem_we_n(mem_we_n), .mem_be_n(mem_be_n)
    );

    always @(posedge clk or negedge requested_reset_n) begin
        if (!requested_reset_n) reset_release<=0;
        else reset_release<={reset_release[0],1'b1};
    end

    always @(posedge clk or negedge local_reset_n) begin
        if (!local_reset_n) begin
            state<=CLEAR; clear_address<=0; clear_pending<=0;
            word_address<=0; write_latch<=0; write_data<=0; write_mask<=4'hf;
            low_data<=0; rsp_valid<=0; rsp_rdata<=0;
        end else begin
            rsp_valid<=0;
            if (clearing) begin
                case ({clear_accept,sram_rsp_valid})
                    2'b10: clear_pending<=clear_pending+1'b1;
                    2'b01: clear_pending<=clear_pending-1'b1;
                    default: begin end
                endcase
            end
            case (state)
                CLEAR: if (clear_accept) begin
                    if (clear_address==18'h3ffff) state<=CLEAR_DRAIN;
                    else clear_address<=clear_address+1'b1;
                end
                CLEAR_DRAIN: if (sram_rsp_valid && clear_pending==1) state<=IDLE;
                IDLE: if (req_valid) begin
                    word_address<=req_word_address;
                    write_latch<=req_write; write_data<=req_wdata; write_mask<=req_be_n;
                    state<=LOW_ISSUE;
                end
                LOW_ISSUE: if (sram_req_ready) state<=LOW_WAIT;
                LOW_WAIT: if (sram_rsp_valid) begin
                    low_data<=sram_rsp_rdata; state<=HIGH_ISSUE;
                end
                HIGH_ISSUE: if (sram_req_ready) state<=HIGH_WAIT;
                HIGH_WAIT: if (sram_rsp_valid) begin
                    rsp_rdata<=write_latch ? 32'd0 : {sram_rsp_rdata,low_data};
                    rsp_valid<=1; state<=IDLE;
                end
            endcase
        end
    end
endmodule
