`timescale 1ns/1ps
// Cartridge-local x16 SRAM scalar owner. A request contains the original byte
// offset, full scalar width (1, 2 or 4), direction and little-endian value.
// For writes, the frontend may accept the last
// bus portion only when this owner can accept its commit. Other card masters
// must not access this SRAM until rsp_valid or the drain after warm reset.
//
// Capacity is a property of the actual card, not a CPU-side probe. The entire
// scalar is checked before any physical write; a tail write does nothing. Reads
// beyond capacity return zero, while an incomplete tail supplies its remaining
// low-order bytes. Each scalar uses up to three native x16 operations.
// Warm reset blocks admission and abandons its bus response, but never aborts a
// committed write or a physical SRAM pulse. Only power_reset_n initializes the
// waveform engine; power loss cannot promise completion. During initial power-on
// the owner clears installed SRAM before admitting a request, so warm reset
// retains the existing contents. CAPACITY_BYTES may be zero or odd; a card
// with no RAM has no clear cycles and its write requests complete unchanged.
// ADDRESS_WIDTH and CAPACITY_BYTES describe the fitted memory/decoder; its
// physical address and bank pins must cover the installed capacity.
//
// The SRAM timing owner is the existing async_sram module. The 256K x16 ISSI
// -10 BLL part and its pin model exercise a 33.8688 MHz implementation; the
// configurable native address width does not assert a particular card size or
// qualify external parts, ASIC timing, routing, brownout or powered behavior.
// LiteX's production DMA writer retains byte masks alongside native data:
// https://github.com/enjoy-digital/litex/blob/master/litex/soc/cores/dma.py
module cart_ram_scalar #(
    parameter integer ADDRESS_WIDTH = 18,
    parameter [32:0] CAPACITY_BYTES = 33'd524288
) (
    input wire clk, power_reset_n, reset_n,
    input wire req_valid,
    output wire req_ready,
    input wire req_write,
    input wire [31:0] req_offset,
    input wire [2:0] req_size_bytes,
    input wire [31:0] req_wdata,
    output wire rsp_valid,
    output reg [31:0] rsp_rdata,
    output wire init_done,
    output wire busy,
    inout wire [15:0] mem_data,
    output wire [ADDRESS_WIDTH-1:0] mem_address,
    output wire mem_ce_n, mem_oe_n, mem_we_n,
    output wire [1:0] mem_be_n
);
    localparam [2:0] CLEAR_ISSUE=0, CLEAR_WAIT=1, IDLE=2,
        ACCESS_ISSUE=3, ACCESS_WAIT=4, RESPONSE=5;
    reg [2:0] state;
    reg [ADDRESS_WIDTH-1:0] clear_address;
    reg [31:0] next_offset, data_word;
    reg [2:0] remaining, byte_index, issued_bytes;
    reg abandoned, write_word;
    wire response_reset_n = power_reset_n && reset_n;
    wire sram_ready, sram_rsp;
    wire [15:0] sram_rdata;
    wire clearing = state==CLEAR_ISSUE;
    wire issuing = clearing || state==ACCESS_ISSUE;
    wire [2:0] count_this_word = next_offset[0] || remaining==1 ? 1 : 2;
    wire [31:0] shifted_data = data_word >> (byte_index * 8);
    wire [15:0] native_data = next_offset[0] ? {shifted_data[7:0],8'b0} : shifted_data[15:0];
    wire [1:0] native_be_n = next_offset[0] ? 2'b01 : remaining==1 ? 2'b10 : 2'b00;
    wire [ADDRESS_WIDTH-1:0] native_address = clearing ? clear_address : next_offset[ADDRESS_WIDTH:1];
    wire [ADDRESS_WIDTH-1:0] last_clear_address = (CAPACITY_BYTES - 1'b1) >> 1;
    wire [32:0] read_available = CAPACITY_BYTES - {1'b0,req_offset};
    wire [15:0] sampled_part = next_offset[0] ? {8'b0,sram_rdata[15:8]} : sram_rdata;
    wire [31:0] sampled_bytes = issued_bytes==1 ? {24'b0,sampled_part[7:0]} : {16'b0,sampled_part};

    assign init_done = state!=CLEAR_ISSUE && state!=CLEAR_WAIT;
    assign req_ready = power_reset_n && reset_n && state==IDLE;
    assign rsp_valid = power_reset_n && reset_n && state==RESPONSE && !abandoned;
    assign busy = state!=IDLE && state!=RESPONSE;

    async_sram #(.DATA_WIDTH(16),.ADDRESS_WIDTH(ADDRESS_WIDTH)) sram (
        .clk(clk),.power_reset_n(power_reset_n),.reset_n(power_reset_n),
        .req_valid(issuing),.req_ready(sram_ready),.req_write(clearing || write_word),
        .req_address(native_address),.req_wdata(clearing ? 16'b0 : native_data),
        .req_be_n(clearing ? 2'b00 : native_be_n),
        .rsp_valid(sram_rsp),.rsp_rdata(sram_rdata),
        .mem_data(mem_data),.mem_address(mem_address),.mem_ce_n(mem_ce_n),
        .mem_oe_n(mem_oe_n),.mem_we_n(mem_we_n),.mem_be_n(mem_be_n)
    );

    // Response ownership is lost on a warm-reset edge, independently of the
    // commit datapath, even if reset is later released before the write ends.
    always @(posedge clk or negedge response_reset_n) begin
        if(!response_reset_n) abandoned<=1;
        else if(req_valid && req_ready) abandoned<=0;
    end

    always @(posedge clk or negedge power_reset_n) begin
        if(!power_reset_n) begin
            state<=CAPACITY_BYTES==0 ? IDLE : CLEAR_ISSUE;
            clear_address<=0;next_offset<=0;
            data_word<=0;remaining<=0;byte_index<=0;issued_bytes<=0;write_word<=0;rsp_rdata<=0;
        end else case(state)
            CLEAR_ISSUE: if(sram_ready) state<=CLEAR_WAIT;
            CLEAR_WAIT: if(sram_rsp) begin
                if(clear_address==last_clear_address) state<=IDLE;
                else begin clear_address<=clear_address+1'b1;state<=CLEAR_ISSUE;end
            end
            IDLE: if(req_valid && req_ready) begin
                rsp_rdata<=0;write_word<=req_write;
                if(req_write && ({1'b0,req_offset}+req_size_bytes)>CAPACITY_BYTES) state<=RESPONSE;
                else if(!req_write && {1'b0,req_offset}>=CAPACITY_BYTES) state<=RESPONSE;
                else begin
                    next_offset<=req_offset;data_word<=req_wdata;
                    remaining<=!req_write && read_available<req_size_bytes ? read_available[2:0] : req_size_bytes;
                    byte_index<=0;state<=ACCESS_ISSUE;
                end
            end
            ACCESS_ISSUE: if(sram_ready) begin
                issued_bytes<=count_this_word;state<=ACCESS_WAIT;
            end
            ACCESS_WAIT: if(sram_rsp) begin
                if(!write_word) rsp_rdata<=rsp_rdata | (sampled_bytes << (byte_index * 8));
                if(remaining==issued_bytes) state<=RESPONSE;
                else begin
                    remaining<=remaining-issued_bytes;
                    next_offset<=next_offset+issued_bytes;
                    byte_index<=byte_index+issued_bytes;
                    state<=ACCESS_ISSUE;
                end
            end
            RESPONSE: state<=IDLE;
        endcase
    end
endmodule
