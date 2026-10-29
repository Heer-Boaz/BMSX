`timescale 1ns/1ps
// Atomic DMA_WRITE publication over the serial APU sample-store datapath.
// Unpublished words stay in staging; no backing SRAM byte changes before the
// exact 32*N deadline. Committed words forward until their physical write ACK.
// Each output edge can reserve an ordered snapshot of the committed prefix,
// including a due batch on that edge. Subsequent batches neither forward nor
// drain past the oldest live snapshot. Multiple overdue frames therefore keep
// distinct historical memory views without a second copy of sample SRAM.
//
// This is a memory owner, not APU MMIO/FIFO admission or a decoder. start_ready
// reserves the whole pending batch. Its caller must report a missed mandatory
// start rather than silently granting more public transfer time. An epoch must
// end only after its last read response. The write queue and sixteen snapshot
// fences are finite: snapshot_overflow exposes an unaccepted edge, and neither
// capacity nor arbitrary missed frame deadlines is a completed APU guarantee.
//
// References: CVA6 wt_dcache_wbuffer retains dirty/in-flight forwarding data;
// verilog-axis axis_fifo separates written and committed pointer ownership.
// https://github.com/openhwgroup/cva6/blob/master/core/cache_subsystem/wt_dcache_wbuffer.sv
// https://github.com/alexforencich/verilog-axis/blob/master/rtl/axis_fifo.v
module apu_upload_commit (
    input wire clk, reset_n, power_reset_n,
    input wire stage_valid,
    input wire [3:0] stage_index,
    input wire [31:0] stage_word,
    input wire start_valid,
    output wire start_ready,
    input wire [4:0] start_words,
    input wire cancel,
    input wire [16:0] live_word_address,
    output reg batch_busy,
    output wire publish_valid,
    output wire [4:0] publish_words,
    output wire [16:0] publish_base,
    output reg commit_valid,
    output reg [4:0] commit_words,
    output reg [16:0] commit_base, commit_next_address,
    input wire epoch_begin, epoch_end,
    output wire epoch_active,
    output wire snapshot_ready, snapshot_overflow,
    output wire [4:0] snapshots_pending,
    output wire snapshot_change_valid,
    output wire [16:0] snapshot_change_first, snapshot_change_last,
    output wire [6:0] queued_words, epoch_words,
    input wire read_valid,
    output wire read_ready,
    input wire [16:0] read_word_address,
    output reg read_rsp_valid,
    output reg [31:0] read_rsp_word,
    input wire memory_ready,
    output wire store_req_valid,
    input wire store_req_ready,
    output wire store_req_write,
    output wire [16:0] store_req_word_address,
    output wire [31:0] store_req_wdata,
    output wire [3:0] store_req_be_n,
    input wire store_rsp_valid,
    input wire [31:0] store_rsp_rdata
);
    localparam [1:0] IDLE=0, WRITE_WAIT=1, READ_WAIT=2;
    reg [1:0] state;
    reg [31:0] staging [0:15];
    reg [31:0] words [0:63];
    reg [16:0] addresses [0:63];
    reg [5:0] head, tail;
    reg [6:0] count;
    reg [6:0] snapshot_prefix [0:15];
    // Publications between frame edges belong to that frame's decoder
    // provenance, independently of when the renderer actually reaches it.
    // Sparse or wrapped intervals conservatively invalidate extra checkpoints;
    // they never alter the architecturally retained current/previous samples.
    reg snapshot_changed [0:15];
    reg [16:0] snapshot_first [0:15], snapshot_last [0:15];
    reg changes_valid;
    reg [16:0] changes_first, changes_last;
    wire [17:0] publication_end={1'b0,live_word_address}+pending_words;
    wire publication_wrap=publication_end[17] && publication_end[16:0]!=0;
    wire [16:0] publication_first=publication_wrap ? 17'd0 : live_word_address;
    wire [16:0] publication_last=publication_wrap ? 17'h1ffff : publication_end[16:0]-1'b1;
    wire [16:0] merged_first=due && (!changes_valid || publication_first<changes_first) ? publication_first : changes_first;
    wire [16:0] merged_last=due && (!changes_valid || publication_last>changes_last) ? publication_last : changes_last;
    reg [3:0] snapshot_head, snapshot_tail;
    reg [4:0] snapshot_count;
    reg [4:0] pending_words;
    reg [9:0] remaining_clocks;
    wire local_reset_n = reset_n && power_reset_n;
    wire due = batch_busy && remaining_clocks==1;
    wire retire = state==WRITE_WAIT && store_rsp_valid;
    wire [4:0] publishing_words = due ? pending_words : 5'd0;
    wire [7:0] reserved_words = {1'b0,count}+publishing_words+start_words-retire;
    wire snapshot_pop=epoch_end && epoch_active;
    wire snapshot_push=epoch_begin && snapshot_ready;
    // Ending the oldest snapshot may expose only the NEXT saved prefix; it
    // must not drain writes that happened after that next frame's edge.
    wire opening_or_point_read=!epoch_active || (snapshot_pop && snapshot_count==1);
    wire [3:0] next_snapshot_head=snapshot_head+1'b1;
    wire [6:0] eligible_words=opening_or_point_read ? count :
        snapshot_pop ? snapshot_prefix[next_snapshot_head] : snapshot_prefix[snapshot_head];
    wire physical_slot_free = state==IDLE || retire;
    wire [5:0] service_head = head+retire;
    wire drain = physical_slot_free && eligible_words>retire;
    reg hit;
    reg [31:0] hit_word;
    reg [5:0] lookup_index;
    reg [16:0] due_offset;
    integer i;

    assign queued_words=count;
    assign epoch_active=snapshot_count!=0;
    assign snapshots_pending=snapshot_count;
    // A pop exposes the next view on this edge, matching eligible_words.
    // Replacing the final view or capturing the first view exposes the just-
    // captured publication range, including a batch due on this same edge.
    assign snapshot_change_valid=snapshot_pop ?
        (snapshot_count>1 ? snapshot_changed[next_snapshot_head] :
            snapshot_push && (changes_valid || due)) :
        epoch_active ? snapshot_changed[snapshot_head] :
            snapshot_push && (changes_valid || due);
    assign snapshot_change_first=(snapshot_pop && snapshot_count==1) || (!epoch_active && snapshot_push) ? merged_first :
        snapshot_pop ? snapshot_first[next_snapshot_head] : snapshot_first[snapshot_head];
    assign snapshot_change_last=(snapshot_pop && snapshot_count==1) || (!epoch_active && snapshot_push) ? merged_last :
        snapshot_pop ? snapshot_last[next_snapshot_head] : snapshot_last[snapshot_head];
    assign snapshot_ready=local_reset_n && (snapshot_count<16 || snapshot_pop);
    assign snapshot_overflow=local_reset_n && epoch_begin && !snapshot_ready;
    // Decoder invalidation and epoch capture consume this pre-edge boundary;
    // registered commit_* below records that the same edge has completed.
    assign publish_valid=due;
    assign publish_words=pending_words;
    assign publish_base=live_word_address;
    assign epoch_words=epoch_active ? snapshot_prefix[snapshot_head] : count;
    assign start_ready=memory_ready && (!batch_busy || due) && reserved_words<=64;
    assign read_ready=memory_ready && state!=READ_WAIT &&
        (hit || (physical_slot_free && !drain && store_req_ready));
    assign store_req_valid=memory_ready && physical_slot_free &&
        (drain || (read_valid && !hit));
    assign store_req_write=drain;
    assign store_req_word_address=drain ? addresses[service_head] : read_word_address;
    assign store_req_wdata=words[service_head];
    assign store_req_be_n=4'b0000;

    // FIFO order is publication order. A later matching word supersedes an
    // earlier one, but only inside this render's immutable prefix.
    always @* begin
        hit=0; hit_word=0; lookup_index=0;
        for (integer n=0; n<64; n=n+1) begin
            lookup_index=head+n;
            if (n<eligible_words && addresses[lookup_index]==read_word_address) begin
                hit=1; hit_word=words[lookup_index];
            end
        end
        due_offset=read_word_address-live_word_address;
        if (due && opening_or_point_read && due_offset<pending_words) begin
            hit=1; hit_word=staging[due_offset[3:0]];
        end
    end

    always @(posedge clk or negedge local_reset_n) begin
        if (!local_reset_n) begin
            state<=IDLE; head<=0; tail<=0; count<=0;
            snapshot_head<=0;snapshot_tail<=0;snapshot_count<=0;
            pending_words<=0; remaining_clocks<=0; batch_busy<=0;
            changes_valid<=0; changes_first<=0; changes_last<=0;
            commit_valid<=0; commit_words<=0; commit_base<=0; commit_next_address<=0;
            read_rsp_valid<=0; read_rsp_word<=0;
            for(i=0;i<16;i=i+1) begin
                snapshot_prefix[i]<=0; snapshot_changed[i]<=0;
                snapshot_first[i]<=0; snapshot_last[i]<=0;
            end
        end else begin
            commit_valid<=0; read_rsp_valid<=0;
            if (stage_valid) staging[stage_index]<=stage_word;
            if (due) begin
                for (i=0; i<16; i=i+1) begin
                    if (i<pending_words) begin
                        words[(tail+i)&63]<=staging[i];
                        addresses[(tail+i)&63]<=live_word_address+i;
                    end
                end
                tail<=tail+pending_words;
                commit_valid<=1; commit_words<=pending_words;
                commit_base<=live_word_address;
                commit_next_address<=live_word_address+pending_words;
            end
            if (retire) head<=head+1'b1;
            count<=count+publishing_words-retire;

            if(retire) begin
                for(i=0;i<16;i=i+1)
                    if(snapshot_prefix[i]!=0) snapshot_prefix[i]<=snapshot_prefix[i]-1'b1;
            end
            if(snapshot_pop) snapshot_head<=snapshot_head+1'b1;
            if(snapshot_push) begin
                snapshot_prefix[snapshot_tail]<=count+publishing_words-retire;
                snapshot_changed[snapshot_tail]<=changes_valid || due;
                snapshot_first[snapshot_tail]<=merged_first;
                snapshot_last[snapshot_tail]<=merged_last;
                snapshot_tail<=snapshot_tail+1'b1;
            end
            if(snapshot_push) changes_valid<=0;
            else if(due) begin
                changes_valid<=1; changes_first<=merged_first; changes_last<=merged_last;
            end
            case({snapshot_push,snapshot_pop})
                2'b10:snapshot_count<=snapshot_count+1'b1;
                2'b01:snapshot_count<=snapshot_count-1'b1;
            endcase

            if (due || cancel) begin
                batch_busy<=0; remaining_clocks<=0;
            end else if (batch_busy) remaining_clocks<=remaining_clocks-1'b1;
            if (start_valid && start_ready) begin
                batch_busy<=1; pending_words<=start_words;
                remaining_clocks<={start_words,5'b00000};
            end

            if (read_valid && read_ready && hit) begin
                read_rsp_valid<=1; read_rsp_word<=hit_word;
            end
            case (state)
                IDLE: if (store_req_valid && store_req_ready)
                    state<=store_req_write ? WRITE_WAIT : READ_WAIT;
                WRITE_WAIT: if (store_rsp_valid) begin
                    if (store_req_valid && store_req_ready)
                        state<=store_req_write ? WRITE_WAIT : READ_WAIT;
                    else state<=IDLE;
                end
                READ_WAIT: if (store_rsp_valid) begin
                    read_rsp_valid<=1; read_rsp_word<=store_rsp_rdata;
                    state<=IDLE;
                end
            endcase
        end
    end
endmodule
