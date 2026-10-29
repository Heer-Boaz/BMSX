`timescale 1ns/1ps
// APU command staging and 16-entry captured-command FIFO. This owner covers
// the current Book I 21-word register representation; source binding, live
// slot banks, playback/fade, fault latching and service scheduling are separate.
// The upstream LOCAL endpoint decodes staging indices 0..20 and CMD as 21.
// For CMD writes, timeline_ready is supplied by the service owner after all
// output-frame edges due through the bus-access cycle have been rendered.
// Staging and CMD reads do not wait for that gate. No other fallback or
// fabricated completion timing is provided here.
//
// A valid nonzero command snapshots all 21 words then restores staging
// defaults. Zero is a no-op. An unsupported raw command raises BAD_CMD and
// clears staging without enqueueing. A full FIFO overwrites its oldest entry.
// If a dequeue and enqueue coincide, the downstream accepts the pre-edge
// oldest entry first and the enqueue occupies the now-free position.
//
// command_valid/command_consume is a dequeue handshake, not a conventional
// stall-stable ready/valid output: when the FIFO is full and a new command
// arrives without a dequeue, the oldest entry is replaced by specification.
// A downstream consumer may sample the head only when it asserts consume.
// As with OpenTitan prim_fifo_sync, FIFO state and payload are separate, with
// ring pointers and explicit capacity; BMSX deliberately differs at overflow:
// https://github.com/lowRISC/opentitan/blob/master/hw/ip/prim/rtl/prim_fifo_sync.sv
module apu_command_ingress (
    input wire clk,reset_n,
    input wire access_valid,access_write,input wire [4:0] access_index,
    input wire [31:0] access_wdata,input wire timeline_ready,
    output wire access_ready,output reg response_valid,output reg [31:0] response_data,
    output reg fault_raise,output reg [31:0] fault_detail,
    output wire [3:0] selected_slot,output wire [4:0] queued_count,
    output wire command_valid,input wire command_consume,
    output wire [31:0] command_word,output wire [671:0] command_parameters
);
    localparam [4:0] CMD_INDEX=21;
    localparam [671:0] STAGING_DEFAULTS =
        (672'h00010000 << (11*32)) | // RATE_STEP_Q16
        (672'h00001000 << (12*32)) | // GAIN_Q12
        (672'h00004000 << (15*32)) | // FILTER_B0_B1
        (672'h00000800 << (20*32));  // GENERATOR_DUTY_Q12
    reg [671:0] staging;
    reg [671:0] fifo_parameters [0:15];
    reg [31:0] fifo_commands [0:15];
    reg [3:0] head,tail;
    reg [4:0] count;
    wire accept=access_valid && access_ready;
    wire command_write=accept && access_write && access_index==CMD_INDEX;
    wire valid_command=access_wdata>=1 && access_wdata<=5;
    wire enqueue=command_write && valid_command;
    wire dequeue=command_consume && command_valid;
    assign access_ready=reset_n && (!(access_write && access_index==CMD_INDEX) || timeline_ready);
    assign selected_slot=staging[10*32 +:4];
    assign queued_count=count;
    assign command_valid=count!=0;
    assign command_word=fifo_commands[head];
    assign command_parameters=fifo_parameters[head];

    // Command snapshot storage only needs one synchronous write port.
    always @(posedge clk) if(reset_n && enqueue) begin
        fifo_commands[tail]<=access_wdata;
        fifo_parameters[tail]<=staging;
    end
    always @(posedge clk or negedge reset_n) begin
        if(!reset_n) begin
            staging<=STAGING_DEFAULTS;head<=0;tail<=0;count<=0;
            response_valid<=0;response_data<=0;fault_raise<=0;fault_detail<=0;
        end else begin
            response_valid<=accept;fault_raise<=0;
            if(accept) begin
                if(access_index==CMD_INDEX) response_data<=0;
                else response_data<=staging[access_index*32 +:32];
                if(access_write) begin
                    if(access_index!=CMD_INDEX) staging[access_index*32 +:32]<=access_wdata;
                    else if(access_wdata!=0) begin
                        staging<=STAGING_DEFAULTS;
                        if(!valid_command) begin fault_raise<=1;fault_detail<=access_wdata;end
                    end
                end
            end
            if(enqueue) tail<=tail+1'b1;
            if(dequeue || (enqueue && count==16 && !dequeue)) head<=head+1'b1;
            if(enqueue && !dequeue && count!=16) count<=count+1'b1;
            else if(dequeue && !enqueue) count<=count-1'b1;
        end
    end
endmodule
