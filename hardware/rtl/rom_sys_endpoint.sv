`timescale 1ns/1ps
// U7's read-only SST39VF6401B-70 endpoint. The board ties WE_N high and
// connects the flash's RST_N directly to the shared RESET_N; this unit never
// drives the flash data pins. A production programming image fills all 8 MiB,
// including its zero tail. The other 8 MiB of the public window reads zero.
//
// CORE supplies aligned complete-word transactions; scalar formatting belongs
// to CORE. Invalid read width/alignment reports 2. Every mapped ROM write
// reports UNMAPPED (1), irrespective of lanes. No flash command is generated.
//
// CLK_IO is 33.8688 MHz. Each halfword has four complete address/CE/OE-stable
// clocks (118.1 ns) before capture, followed by one release clock (29.5 ns).
// These exceed the part's 70 ns access and 20 ns high-Z limits before adding
// real pad/PCB/setup budgets. They are not a physical timing-closure claim.
// The shared reset owner guarantees >=500 ns low and >=100 us after power is
// valid. Three sampled release edges allow >=2 full clocks (59 ns) after U7
// observes reset release before launch. U33's 50 ns reset recovery must still
// close at its actual RST_N/CE/OE pins, including distributed reset/pad skew.
module rom_sys_endpoint (
    input wire clk, reset_n, cs_rom_n,
    input wire [31:0] bus_ad_in,
    input wire bus_as_n, bus_rd_n, bus_wr_n,
    input wire [3:0] bus_be_n,
    output wire [31:0] bus_ad_out,
    output wire bus_ad_oe, bus_ready_drive_low,
    input wire [15:0] flash_data,
    output reg [21:0] flash_address,
    output wire flash_ce_n, flash_oe_n
);
    localparam [3:0] HEADER=0, ADDRESS=1, DATA=2, READ_LOW=3,
        RELEASE_LOW=4, READ_HIGH=5, RELEASE_HIGH=6, READ_ACK=7, RESPONSE=8;
    reg [3:0] phase;
    reg [2:0] reset_release;
    reg [31:0] address_word, read_word, response_word;
    reg [3:0] byte_enables;
    reg selected, data_seen;
    reg [1:0] read_clocks;
    wire qualified = reset_release[2];
    wire data_read = bus_as_n && !bus_rd_n && bus_wr_n;
    wire data_write = bus_as_n && bus_rd_n && !bus_wr_n;
    wire full_word = address_word[1:0]==0 && byte_enables==4'b0000;
    wire zero_region = address_word[23];
    wire immediate = data_write || data_read && (!full_word || zero_region);
    wire acknowledge = selected && ((phase==DATA && immediate) ||
        (phase==READ_ACK && data_read));
    wire response = selected && phase==RESPONSE && bus_as_n && !bus_rd_n && !bus_wr_n;
    wire flash_read = qualified && selected && data_read &&
        (phase==READ_LOW || phase==READ_HIGH);
    wire flash_operation = phase==READ_LOW || phase==RELEASE_LOW ||
        phase==READ_HIGH || phase==RELEASE_HIGH || phase==READ_ACK;
    assign flash_ce_n = !flash_read;
    assign flash_oe_n = !flash_read;
    assign bus_ready_drive_low = qualified && (acknowledge || response);
    assign bus_ad_oe = qualified && (response || acknowledge && data_read);
    assign bus_ad_out = response ? response_word : phase==READ_ACK ? read_word : 32'd0;

    always @(posedge clk or negedge reset_n) begin
        if (!reset_n) reset_release <= 0;
        else reset_release <= {reset_release[1:0],1'b1};
    end

    always @(posedge clk or negedge reset_n) begin
        if (!reset_n) begin
            phase<=HEADER;
            address_word<=0;
            byte_enables<=4'hf;
            read_word<=0;
            response_word<=0;
            selected<=0;
            data_seen<=0;
            read_clocks<=0;
            flash_address<=0;
        end else if (!qualified) begin
            phase<=HEADER;
            selected<=0;
        end else if (flash_operation && !data_read) begin
            // Withdrawal aborts a read. Pin gating releases CE/OE immediately;
            // no queued completion or delayed acknowledgement survives it.
            phase<=HEADER;
            selected<=0;
        end else begin
            case (phase)
                HEADER: if (!bus_as_n) begin
                    phase<=ADDRESS;
                    selected<=0;
                    data_seen<=0;
                end
                ADDRESS: begin
                    address_word<=bus_ad_in;
                    byte_enables<=bus_be_n;
                    selected<=!cs_rom_n && bus_ad_in<32'h01000000;
                    phase<=DATA;
                end
                DATA: begin
                    if (data_read || data_write) data_seen<=1;
                    if (acknowledge) begin
                        response_word<=data_write ? 32'd1 : full_word ? 32'd0 : 32'd2;
                        phase<=RESPONSE;
                    end else if (selected && data_read) begin
                        flash_address<={address_word[22:2],1'b0};
                        read_clocks<=0;
                        phase<=READ_LOW;
                    end else if (data_seen && bus_as_n && bus_rd_n && bus_wr_n) begin
                        phase<=HEADER;
                        selected<=0;
                    end
                end
                READ_LOW: if (read_clocks==3) begin
                    read_word[15:0]<=flash_data;
                    phase<=RELEASE_LOW;
                end else read_clocks<=read_clocks+1'b1;
                RELEASE_LOW: begin
                    flash_address<=flash_address+1'b1;
                    read_clocks<=0;
                    phase<=READ_HIGH;
                end
                READ_HIGH: if (read_clocks==3) begin
                    read_word[31:16]<=flash_data;
                    phase<=RELEASE_HIGH;
                end else read_clocks<=read_clocks+1'b1;
                RELEASE_HIGH: phase<=READ_ACK;
                READ_ACK: begin
                    response_word<=0;
                    phase<=RESPONSE;
                end
                RESPONSE: if (response) begin
                    phase<=HEADER;
                    selected<=0;
                end
            endcase
        end
    end
endmodule
