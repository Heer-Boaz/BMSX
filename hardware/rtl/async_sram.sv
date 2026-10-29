`timescale 1ns/1ps
// Native-word interface to the fitted -10 ISSI BLL asynchronous SRAMs:
// GFX: DATA_WIDTH=32, ADDRESS_WIDTH=19 (two 512Kx16 parts), clk=54MHz.
// APU: DATA_WIDTH=16, ADDRESS_WIDTH=18 (one 256Kx16 part), clk=33.8688MHz.
// Reads enable every byte and complete one rising edge after acceptance;
// consecutive reads issue/capture every clock. req_be_n masks writes only.
// No response backpressure or extra request queue exists.
//
// A write occupies two rising-edge slots. Address/data/mask latch at acceptance;
// WE falls at the intervening falling edge and rises at the next falling edge.
// Thus its low pulse is one full period and address/data hold for another half
// period before completion/next acceptance. OE remains high for both slots.
// Direction changes insert one full high-Z slot, including unsolicited changes
// while req_valid is held waiting for req_ready. The previous response can occur
// on that guard's opening edge. No pin is driven from an unaccepted request.
//
// At 54 MHz: period18.519ns, halfperiod9.259ns. The -10 grade requires tAA/tRC 10ns,
// tPWE1/tAW/tPWB/tSCE 8ns, tSD 6ns, tHA/tHD 0ns and tHZOE/tHZCE<=4ns. WE uses a
// falling-edge output register, NOT combinational clock gating. Closing ASIC
// pad/PCB delay, clock duty/skew, read hold and these half-cycle paths is required;
// simulation of ideal pins does not replace those constraints. At 33.8688 MHz the
// same waveform has more margin. power_reset_n is the internal ASIC-POR domain,
// not an extra PCB pin. Only actual power reset initializes the waveform flops.
// Warm reset_n blocks admission/old responses immediately but completes a live
// write and its half-slot hold, or finishes the current read slot, before park.
// It does not erase or undo external SRAM writes.
module async_sram #(
    parameter integer DATA_WIDTH = 32,
    parameter integer ADDRESS_WIDTH = 19,
    parameter integer BYTES = DATA_WIDTH / 8
) (
    input wire clk, power_reset_n, reset_n,
    input wire req_valid,
    output wire req_ready,
    input wire req_write,
    input wire [ADDRESS_WIDTH-1:0] req_address,
    input wire [DATA_WIDTH-1:0] req_wdata,
    input wire [BYTES-1:0] req_be_n,
    output wire rsp_valid,
    output reg [DATA_WIDTH-1:0] rsp_rdata,
    inout wire [DATA_WIDTH-1:0] mem_data,
    output reg [ADDRESS_WIDTH-1:0] mem_address,
    output wire mem_ce_n, mem_oe_n,
    output reg mem_we_n,
    output wire [BYTES-1:0] mem_be_n
);
    localparam [1:0] IDLE=0, READ=1, WRITE_FIRST=2, WRITE_SECOND=3;
    reg [1:0] state;
    reg [1:0] reset_release;
    reg response_valid;
    wire admission_reset_n = power_reset_n && reset_n;
    reg [DATA_WIDTH-1:0] write_data;
    reg [BYTES-1:0] write_be_n;
    wire data_drive = state == WRITE_FIRST || state == WRITE_SECOND;
    assign mem_data = data_drive ? write_data : {DATA_WIDTH{1'bz}};
    assign mem_ce_n = state == IDLE;
    assign mem_oe_n = state != READ;
    assign mem_be_n = state == READ ? {BYTES{1'b0}} :
        data_drive ? write_be_n : {BYTES{1'b1}};
    assign rsp_valid = reset_n && reset_release[1] && response_valid;
    assign req_ready = reset_n && reset_release[1] &&
        (state == IDLE || (state == READ && !req_write) ||
         (state == WRITE_SECOND && req_write));

    always @(negedge clk or negedge power_reset_n) begin
        if (!power_reset_n) mem_we_n <= 1;
        else mem_we_n <= state != WRITE_FIRST;
    end

    always @(posedge clk or negedge admission_reset_n) begin
        if (!admission_reset_n) reset_release <= 0;
        else reset_release <= {reset_release[0], 1'b1};
    end

    always @(posedge clk or negedge power_reset_n) begin
        if (!power_reset_n) begin
            state <= IDLE;
            write_data <= 0;
            write_be_n <= {BYTES{1'b1}};
            mem_address <= 0;
            response_valid <= 0;
            rsp_rdata <= 0;
        end else begin
            response_valid <= 0;
            if (state == READ && reset_n && reset_release[1]) begin
                rsp_rdata <= mem_data;
                response_valid <= 1;
            end else if (state == WRITE_SECOND && reset_n && reset_release[1]) begin
                rsp_rdata <= 0;
                response_valid <= 1;
            end
            if (state == WRITE_FIRST) state <= WRITE_SECOND;
            else if (req_valid && req_ready) begin
                mem_address <= req_address;
                if (req_write) begin
                    write_data <= req_wdata;
                    write_be_n <= req_be_n;
                    state <= WRITE_FIRST;
                end else state <= READ;
            end else state <= IDLE;
        end
    end
endmodule
