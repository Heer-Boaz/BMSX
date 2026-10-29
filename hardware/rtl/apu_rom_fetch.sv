`timescale 1ns/1ps
// U4 external source-word reader. The voice/source owner supplies an aligned
// word and the raw BusSignals byte, including the socket already bound at PLAY
// (or the live source-register write). This unit neither rebinds a voice to
// SELECT nor admits main/cartridge RAM as a playback source. Byte assembly,
// codec caches and voice scheduling are upstream of this word transport.
module apu_rom_fetch (
    input wire clk, reset_n,
    input wire req_valid,
    output wire req_ready,
    input wire [31:0] req_address,
    input wire [7:0] req_bus_signals,
    input wire req_data_timeout_enable,
    input wire [17:0] req_data_wait_last,
    output wire rsp_valid,
    input wire rsp_ready,
    output reg [31:0] rsp_data, rsp_fault_code,
    output reg rsp_timeout,
    output wire req_apu,
    input wire gnt_apu,
    inout wire [31:0] sys_ad,
    inout wire sys_as_n, sys_rd_n, sys_wr_n,
    inout wire [3:0] sys_be_n,
    input wire sys_ready_n
);
    localparam [1:0] IDLE=0, ISSUE=1, WAIT_REPLY=2, REPLY=3;
    reg [1:0] state;
    reg [31:0] address_word;
    reg [7:0] signals_word;
    reg timeout_enable;
    reg [17:0] wait_last;
    wire master_ready, master_rsp, master_timeout, master_oe;
    wire [31:0] master_data, master_fault, master_ad;
    wire master_as_n, master_rd_n, master_wr_n;
    wire [3:0] master_be_n;
    assign req_ready = reset_n && state==IDLE;
    assign rsp_valid = reset_n && state==REPLY;
    assign req_apu = reset_n && (state==ISSUE || state==WAIT_REPLY);
    assign sys_ad = gnt_apu && master_oe ? master_ad : 32'bz;
    assign sys_as_n = gnt_apu ? master_as_n : 1'bz;
    assign sys_rd_n = gnt_apu ? master_rd_n : 1'bz;
    assign sys_wr_n = gnt_apu ? master_wr_n : 1'bz;
    assign sys_be_n = gnt_apu ? master_be_n : 4'bz;
    system_bus_master master (
        .clk(clk),.reset_n(reset_n),.req_valid(state==ISSUE && gnt_apu),.req_ready(master_ready),
        .req_write(1'b0),.req_addr(address_word),.req_wdata(32'd0),.req_be_n(4'd0),
        .req_header_be_n(4'hf),.req_meta({24'd0,signals_word}),.bus_busy(),
        .req_data_timeout_enable(timeout_enable),.req_data_wait_last(wait_last),
        .rsp_valid(master_rsp),.rsp_rdata(master_data),.rsp_fault_code(master_fault),
        .rsp_timeout(master_timeout),.bus_ad_in(sys_ad),.bus_ad_out(master_ad),.bus_ad_oe(master_oe),
        .bus_as_n(master_as_n),.bus_rd_n(master_rd_n),.bus_wr_n(master_wr_n),
        .bus_be_n(master_be_n),.bus_ready_n(sys_ready_n)
    );
    always @(posedge clk or negedge reset_n) begin
        if(!reset_n) begin
            state<=IDLE;address_word<=0;signals_word<=0;timeout_enable<=0;wait_last<=0;
            rsp_data<=0;rsp_fault_code<=0;rsp_timeout<=0;
        end else case(state)
            IDLE: if(req_valid) begin
                address_word<=req_address;signals_word<=req_bus_signals;
                timeout_enable<=req_data_timeout_enable;wait_last<=req_data_wait_last;state<=ISSUE;
            end
            ISSUE: if(gnt_apu && master_ready) state<=WAIT_REPLY;
            WAIT_REPLY: if(master_rsp) begin
                rsp_data<=master_data;rsp_fault_code<=master_fault;rsp_timeout<=master_timeout;state<=REPLY;
            end
            REPLY: if(rsp_ready) state<=IDLE;
        endcase
    end
endmodule
