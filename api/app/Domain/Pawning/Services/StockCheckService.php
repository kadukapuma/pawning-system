<?php

namespace App\Domain\Pawning\Services;

use App\Domain\Core\Support\BranchContext;
use App\Domain\Pawning\Models\PawnTicket;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Vault audit (old StockDetailsCheckController / checkbox_stock): staff scan
 * or type each packet's stock number; anything active but not scanned by the
 * end of the session is "missing" and must be investigated.
 */
class StockCheckService
{
    public function __construct(private BranchContext $branch) {}

    public function current(): ?object
    {
        return DB::table('stock_check_sessions')->where('branch_id', $this->branch->requireId())->where('status', 'open')->first();
    }

    public function start(?string $notes): object
    {
        if ($this->current()) {
            throw ValidationException::withMessages(['session' => 'A stock check is already open in this branch. Complete it first.']);
        }
        $id = DB::table('stock_check_sessions')->insertGetId([
            'branch_id' => $this->branch->requireId(), 'started_at' => now(), 'started_by' => auth()->id(),
            'status' => 'open', 'notes' => $notes, 'created_at' => now(), 'updated_at' => now(),
        ]);

        return DB::table('stock_check_sessions')->find($id);
    }

    /** Mark one packet as present. Returns the ticket that was found. */
    public function scan(int $sessionId, string $code): array
    {
        $session = $this->openSession($sessionId);
        $ticket = PawnTicket::with('customer:id,full_name')->active()->number($code)->first();
        if (! $ticket) {
            throw ValidationException::withMessages(['code' => "No active ticket with number \"{$code}\" in this branch."]);
        }

        $already = DB::table('stock_check_lines')->where('session_id', $session->id)->where('pawn_ticket_id', $ticket->id)->exists();
        if (! $already) {
            DB::table('stock_check_lines')->insert([
                'session_id' => $session->id, 'pawn_ticket_id' => $ticket->id, 'checked_at' => now(), 'checked_by' => auth()->id(),
            ]);
            $ticket->forceFill(['stock_checked_at' => now()])->saveQuietly();
        }

        return ['ticket' => ['id' => $ticket->id, 'receipt_no' => $ticket->receipt_no, 'stock_no' => $ticket->stock_no,
            'customer' => $ticket->customer?->full_name], 'already_checked' => $already];
    }

    public function complete(int $sessionId): object
    {
        $session = $this->openSession($sessionId);
        DB::table('stock_check_sessions')->where('id', $session->id)->update(['status' => 'completed', 'completed_at' => now(), 'updated_at' => now()]);

        return DB::table('stock_check_sessions')->find($session->id);
    }

    /** Session summary: counts, what was checked and what is missing. */
    public function summary(int $sessionId): array
    {
        $session = DB::table('stock_check_sessions')->where('id', $sessionId)->where('branch_id', $this->branch->requireId())->first()
            ?? abort(404);
        $checkedIds = DB::table('stock_check_lines')->where('session_id', $session->id)->pluck('pawn_ticket_id');

        $missing = PawnTicket::with('customer:id,full_name')->active()
            ->where('pawn_date', '<=', $session->completed_at ?? now())
            ->whereNotIn('id', $checkedIds)->orderBy('stock_no')
            ->get(['id', 'receipt_no', 'stock_no', 'customer_id', 'principal_current', 'pawn_date', 'net_weight']);

        $checked = DB::table('stock_check_lines as l')->join('pawn_tickets as t', 't.id', '=', 'l.pawn_ticket_id')
            ->leftJoin('users as u', 'u.id', '=', 'l.checked_by')->where('l.session_id', $session->id)->orderByDesc('l.checked_at')
            ->get(['t.id', 't.receipt_no', 't.stock_no', 'l.checked_at', 'u.name as checked_by']);

        return [
            'session' => $session,
            'checked_count' => $checked->count(),
            'missing_count' => $missing->count(),
            'checked' => $checked,
            'missing' => $missing->map(fn ($t) => ['id' => $t->id, 'receipt_no' => $t->receipt_no, 'stock_no' => $t->stock_no,
                'customer' => $t->customer?->full_name, 'principal_current' => $t->principal_current, 'pawn_date' => $t->pawn_date->toDateString(),
                'net_weight' => $t->net_weight]),
        ];
    }

    public function history(): array
    {
        return DB::table('stock_check_sessions as s')->leftJoin('users as u', 'u.id', '=', 's.started_by')
            ->where('s.branch_id', $this->branch->requireId())->orderByDesc('s.started_at')->limit(20)
            ->get(['s.*', 'u.name as started_by_name',
                DB::raw('(SELECT COUNT(*) FROM stock_check_lines l WHERE l.session_id = s.id) as checked_count')])->all();
    }

    private function openSession(int $id): object
    {
        $session = DB::table('stock_check_sessions')->where('id', $id)->where('branch_id', $this->branch->requireId())->lockForUpdate()->first();
        if (! $session) {
            abort(404);
        }
        if ($session->status !== 'open') {
            throw ValidationException::withMessages(['session' => 'This stock check is already completed.']);
        }

        return $session;
    }
}
