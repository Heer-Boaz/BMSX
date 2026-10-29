`timescale 1ns/1ps
// U1 SYS target for U4's cartridge-ROM source words. The shared CAD controller
// is a distinct owner: this endpoint emits one held read request and accepts
// its response. It does not implement card RAM/mailboxes or a SELECT register.
// HEADER bits7:0 retain the actual initiating BusSignals byte. The word's socket
// is bound by that producer's override, not by the current ordinary selector.
// Unaccepted/withdrawn SYS DATA cancels an outstanding physical ROM read; no
// stale reply survives into another SYS packet. Reads have no rollback effects.
module cart_sys_endpoint (
    input wire clk, reset_n, cs_cart_n,
    input wire [31:0] bus_ad_in,
    input wire bus_as_n, bus_rd_n, bus_wr_n,
    input wire [3:0] bus_be_n,
    output wire [31:0] bus_ad_out,
    output wire bus_ad_oe, bus_ready_drive_low,
    output wire cart_valid,
    input wire cart_ready,
    output wire [31:0] cart_address,
    output wire [7:0] cart_bus_signals,
    output wire cart_cancel,
    input wire cart_rsp_valid,
    input wire [31:0] cart_rdata, cart_fault_code
);
    localparam [2:0] HEADER=0, ADDRESS=1, DATA=2, WAIT_CARD=3, ACK=4, RESPONSE=5;
    reg [2:0] phase;
    reg [31:0] address_word, read_word, response_word;
    reg [7:0] signals_word;
    reg [3:0] operation, byte_enables;
    reg selected, data_seen;
    wire data_read = bus_as_n && !bus_rd_n && bus_wr_n;
    wire data_write = bus_as_n && bus_rd_n && !bus_wr_n;
    wire data_active = data_read || data_write;
    wire full_word = address_word[1:0]==0 && byte_enables==0;
    wire rom_address = address_word>=32'h10000000 && address_word<32'h30000000;
    wire valid_read = data_read && full_word && rom_address && operation==4'hf;
    wire immediate = selected && phase==DATA && data_active && !valid_read;
    wire acknowledge = immediate || selected && phase==ACK && data_read;
    wire response = selected && phase==RESPONSE && bus_as_n && !bus_rd_n && !bus_wr_n;
    assign cart_valid = reset_n && selected && phase==DATA && valid_read;
    assign cart_address = address_word;
    assign cart_bus_signals = signals_word;
    assign cart_cancel = reset_n && phase==WAIT_CARD && !data_read;
    assign bus_ready_drive_low = reset_n && (acknowledge || response);
    assign bus_ad_oe = reset_n && (response || acknowledge && data_read);
    assign bus_ad_out = response ? response_word : phase==ACK ? read_word : 32'd0;
    always @(posedge clk or negedge reset_n) begin
        if(!reset_n) begin
            phase<=HEADER;address_word<=0;read_word<=0;response_word<=0;
            signals_word<=0;operation<=4'hf;byte_enables<=4'hf;selected<=0;data_seen<=0;
        end else if((phase==WAIT_CARD || phase==ACK) && !data_read) begin
            phase<=HEADER;selected<=0;
        end else case(phase)
            HEADER: if(!bus_as_n) begin
                operation<=bus_be_n;signals_word<=bus_ad_in[7:0];
                selected<=0;data_seen<=0;phase<=ADDRESS;
            end
            ADDRESS: begin
                address_word<=bus_ad_in;byte_enables<=bus_be_n;
                selected<=!cs_cart_n;phase<=DATA;
            end
            DATA: begin
                if(data_active) data_seen<=1;
                if(immediate) begin
                    response_word<=!full_word ? 32'd2 : 32'd1;phase<=RESPONSE;
                end else if(cart_valid && cart_ready) phase<=WAIT_CARD;
                else if(data_seen && bus_as_n && bus_rd_n && bus_wr_n) begin phase<=HEADER;selected<=0;end
            end
            WAIT_CARD: if(cart_rsp_valid) begin
                read_word<=cart_rdata;response_word<=cart_fault_code;
                phase<=ACK;
            end
            ACK: phase<=RESPONSE;
            RESPONSE: if(response) begin phase<=HEADER;selected<=0;end
        endcase
    end
endmodule
