`timescale 1ns/1ps
// U2's 54 MHz native-word memory scheduler. No beam, texture/pixel decoder,
// renderer algorithm or SYS/DAC CDC lives here. Opaque tags belong to those
// producers and travel unchanged with their raw 32-bit SRAM words.
// As in LiteX VideoFrameBuffer/DMAReader, memory fetch, decoded output and CDC
// are separate owners. This scheduler provides word credits, not pixel deadlines.
//
// Slots0..47: scanout only, preference circuit1,circuit1,circuit2, using the other
// circuit when the preferred one has no queued job. Slot48: direction guard.
// Slots49..62: renderer service; writes cost two slots, reads one, direction
// guards come out of that same budget. No write can start after61. Slot63 is a
// guard. All-write renderer traffic therefore gets seven writes per64 clocks;
// read/texture/mask/blend/copy traffic shares that budget, not a write-only API.
//
// Each scanout circuit has128 RESERVED entries, not separate unbounded job and
// result queues: one entry lasts from job acceptance through issue/result until
// consumption. Every irrevocable SRAM read already owns its result location.
// Capacity is NOT an eight-DAC-sample latency guarantee: behind127 unissued
// jobs, a new job can take256/512 clocks to issue on circuit1/2, plus two to
// deposit its raw result. Decode, output-consumer pacing and CDC are additional.
// The renderer similarly reserves one of128 response entries at SRAM acceptance.
// quiesce stops admission and drains accepted work/results without flushing it.
// Warm reset discards logical jobs/results, while the real SRAM controller still
// finishes a legal active write+hold/read slot. quiescent includes physical pins.
module gfx_memory_scheduler #(
    parameter integer TAG_WIDTH=8
) (
    input wire clk, power_reset_n, reset_n,
    input wire quiesce,
    output wire quiescent,
    input wire [1:0] scan_req_valid,
    output wire [1:0] scan_req_ready,
    input wire [37:0] scan_req_address,
    input wire [2*TAG_WIDTH-1:0] scan_req_tag,
    output wire [1:0] scan_rsp_valid,
    input wire [1:0] scan_rsp_ready,
    output wire [63:0] scan_rsp_data,
    output wire [2*TAG_WIDTH-1:0] scan_rsp_tag,
    input wire render_req_valid,
    output wire render_req_ready,
    input wire render_req_write,
    input wire [18:0] render_req_address,
    input wire [31:0] render_req_wdata,
    input wire [3:0] render_req_be_n,
    input wire [TAG_WIDTH-1:0] render_req_tag,
    output wire render_rsp_valid,
    input wire render_rsp_ready,
    output wire render_rsp_write,
    output wire [31:0] render_rsp_data,
    output wire [TAG_WIDTH-1:0] render_rsp_tag,
    inout wire [31:0] mem_data,
    output wire [18:0] mem_address,
    output wire mem_ce_n, mem_oe_n, mem_we_n,
    output wire [3:0] mem_be_n
);
    wire requested_reset_n=power_reset_n && reset_n;
    reg [1:0] reset_release;
    reg parked;
    wire running=reset_n && reset_release[1];
    reg [5:0] slot;
    reg [1:0] scan_phase;
    reg [18:0] scan_address [0:1][0:127];
    reg [TAG_WIDTH-1:0] scan_tag [0:1][0:127];
    reg [31:0] scan_data [0:1][0:127];
    reg [6:0] scan_tail [0:1], scan_issue [0:1], scan_head [0:1];
    reg [7:0] scan_reserved [0:1], scan_unissued [0:1], scan_completed [0:1];
    reg [TAG_WIDTH-1:0] render_tag [0:127];
    reg [31:0] render_data [0:127];
    reg [127:0] render_write;
    reg [6:0] render_tail, render_head;
    reg [7:0] render_reserved, render_completed;
    // Actual async_sram reads/writes return in order with different latencies.
    // Four metadata entries cover its read pipeline and two-slot write path;
    // no speculative tag overwrite based on a guessed constant latency.
    reg [1:0] response_owner [0:3];
    reg [6:0] response_index [0:3];
    reg [1:0] response_tail, response_head;
    reg [2:0] inflight;
    wire sram_req_ready, sram_rsp_valid;
    wire [31:0] sram_rsp_rdata;
    reg sram_req_valid, sram_req_write;
    reg [18:0] sram_req_address;
    reg [31:0] sram_req_wdata;
    reg [3:0] sram_req_be_n;
    reg chosen, chosen_scan;
    reg [1:0] chosen_owner;
    reg [6:0] chosen_index;
    wire issue=sram_req_valid && sram_req_ready;
    wire returned=running && sram_rsp_valid;
    wire [1:0] returned_owner=response_owner[response_head];
    wire [6:0] returned_index=response_index[response_head];
    wire render_pop=render_rsp_valid && render_rsp_ready;
    wire render_issue=issue && chosen_owner==2;
    wire render_return=returned && returned_owner==2;
    wire [1:0] scan_pop=scan_rsp_valid & scan_rsp_ready;
    wire [1:0] scan_accept=scan_req_valid & scan_req_ready;
    wire renderer_window=slot>=49 && slot<=62 && (!render_req_write || slot<=61);

    genvar lane;
    generate for(lane=0;lane<2;lane=lane+1) begin : circuit
        assign scan_req_ready[lane]=running && !quiesce &&
            (scan_reserved[lane]<128 || scan_pop[lane]);
        assign scan_rsp_valid[lane]=running && scan_completed[lane]!=0;
        assign scan_rsp_data[lane*32+:32]=scan_data[lane][scan_head[lane]];
        assign scan_rsp_tag[lane*TAG_WIDTH+:TAG_WIDTH]=scan_tag[lane][scan_head[lane]];
    end endgenerate
    assign render_req_ready=running && !quiesce && renderer_window &&
        (render_reserved<128 || render_pop) && sram_req_ready;
    assign render_rsp_valid=running && render_completed!=0;
    assign render_rsp_data=render_data[render_head];
    assign render_rsp_tag=render_tag[render_head];
    assign render_rsp_write=render_write[render_head];
    assign quiescent=scan_reserved[0]==0 && scan_reserved[1]==0 &&
        render_reserved==0 && inflight==0 && parked && mem_ce_n && mem_we_n;

    always @* begin
        chosen=0;chosen_scan=scan_phase==2;chosen_owner=0;chosen_index=0;
        sram_req_valid=0;sram_req_write=0;sram_req_address=0;
        sram_req_wdata=0;sram_req_be_n=0;
        if(running && slot<48) begin
            if(scan_unissued[chosen_scan]!=0) chosen=1;
            else if(scan_unissued[!chosen_scan]!=0) begin chosen=1;chosen_scan=!chosen_scan;end
            if(chosen) begin
                chosen_owner={1'b0,chosen_scan};chosen_index=scan_issue[chosen_scan];
                sram_req_valid=1;sram_req_address=scan_address[chosen_scan][scan_issue[chosen_scan]];
            end
        end else if(running && !quiesce && renderer_window &&
                    (render_reserved<128 || render_pop)) begin
            chosen_owner=2;chosen_index=render_tail;
            sram_req_valid=render_req_valid;sram_req_write=render_req_write;
            sram_req_address=render_req_address;sram_req_wdata=render_req_wdata;
            sram_req_be_n=render_req_be_n;
        end
    end

    async_sram memory (.clk(clk),.power_reset_n(power_reset_n),.reset_n(reset_n),
        .req_valid(sram_req_valid),.req_ready(sram_req_ready),.req_write(sram_req_write),
        .req_address(sram_req_address),.req_wdata(sram_req_wdata),.req_be_n(sram_req_be_n),
        .rsp_valid(sram_rsp_valid),.rsp_rdata(sram_rsp_rdata),.mem_data(mem_data),
        .mem_address(mem_address),.mem_ce_n(mem_ce_n),.mem_oe_n(mem_oe_n),
        .mem_we_n(mem_we_n),.mem_be_n(mem_be_n));

    // One whole inactive clock also covers the SRAM's output-disable delay;
    // especially after a warm-reset read, CE high alone is not yet high-Z.
    always @(posedge clk or negedge power_reset_n) begin
        if(!power_reset_n) parked<=0;
        else parked<=mem_ce_n && mem_oe_n && mem_we_n;
    end

    always @(posedge clk or negedge requested_reset_n) begin
        if(!requested_reset_n) begin
            reset_release<=0;slot<=0;scan_phase<=0;
            response_head<=0;response_tail<=0;inflight<=0;
            render_tail<=0;render_head<=0;render_reserved<=0;render_completed<=0;
            for(integer n=0;n<2;n=n+1) begin
                scan_tail[n]<=0;scan_issue[n]<=0;scan_head[n]<=0;
                scan_reserved[n]<=0;scan_unissued[n]<=0;scan_completed[n]<=0;
            end
        end else begin
            reset_release<={reset_release[0],1'b1};
            if(running) begin
                slot<=slot+1'b1;
                if(slot<48) scan_phase<=scan_phase==2 ? 2'd0 : scan_phase+1'b1;
                if(issue) begin
                    response_owner[response_tail]<=chosen_owner;
                    response_index[response_tail]<=chosen_index;
                    response_tail<=response_tail+1'b1;
                end
                if(returned) begin
                    response_head<=response_head+1'b1;
                    case(returned_owner)
                        0:scan_data[0][returned_index]<=sram_rsp_rdata;
                        1:scan_data[1][returned_index]<=sram_rsp_rdata;
                        2:render_data[returned_index]<=sram_rsp_rdata;
                    endcase
                end
                case({issue,returned})
                    2'b10:inflight<=inflight+1'b1;
                    2'b01:inflight<=inflight-1'b1;
                endcase
                for(integer n=0;n<2;n=n+1) begin
                    if(scan_accept[n]) begin
                        scan_address[n][scan_tail[n]]<=scan_req_address[n*19+:19];
                        scan_tag[n][scan_tail[n]]<=scan_req_tag[n*TAG_WIDTH+:TAG_WIDTH];
                        scan_tail[n]<=scan_tail[n]+1'b1;
                    end
                    if(issue && chosen_owner==n) scan_issue[n]<=scan_issue[n]+1'b1;
                    if(scan_pop[n]) scan_head[n]<=scan_head[n]+1'b1;
                    case({scan_accept[n],scan_pop[n]})
                        2'b10:scan_reserved[n]<=scan_reserved[n]+1'b1;
                        2'b01:scan_reserved[n]<=scan_reserved[n]-1'b1;
                    endcase
                    case({scan_accept[n],issue && chosen_owner==n})
                        2'b10:scan_unissued[n]<=scan_unissued[n]+1'b1;
                        2'b01:scan_unissued[n]<=scan_unissued[n]-1'b1;
                    endcase
                    case({returned && returned_owner==n,scan_pop[n]})
                        2'b10:scan_completed[n]<=scan_completed[n]+1'b1;
                        2'b01:scan_completed[n]<=scan_completed[n]-1'b1;
                    endcase
                end
                if(render_issue) begin
                    render_tag[render_tail]<=render_req_tag;
                    render_write[render_tail]<=render_req_write;
                    render_tail<=render_tail+1'b1;
                end
                if(render_pop) render_head<=render_head+1'b1;
                case({render_issue,render_pop})
                    2'b10:render_reserved<=render_reserved+1'b1;
                    2'b01:render_reserved<=render_reserved-1'b1;
                endcase
                case({render_return,render_pop})
                    2'b10:render_completed<=render_completed+1'b1;
                    2'b01:render_completed<=render_completed-1'b1;
                endcase
            end
        end
    end
endmodule
