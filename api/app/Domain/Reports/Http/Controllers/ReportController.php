<?php

namespace App\Domain\Reports\Http\Controllers;

use App\Domain\Core\Support\BranchContext;
use App\Domain\Pawning\Services\StockCheckService;
use App\Domain\Reports\Services\ReportService;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ReportController extends Controller
{
    public function __construct(private ReportService $reports, private BranchContext $branch) {}

    private function branchFilter(Request $request): ?int
    {
        if ($request->query('branch') === 'all') {
            $this->authorize('reports.all_branches');

            return null;
        }

        return $this->branch->requireId();
    }

    /** Dashboard is available to every signed-in user (it shows their branch). */
    public function dashboard(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->reports->dashboard($this->branchFilter($request))]);
    }

    public function index(): JsonResponse
    {
        $this->authorize('reports.view');

        return response()->json(['data' => collect(ReportService::REPORTS)->map(fn ($t, $k) => ['key' => $k, 'title' => $t])->values()]);
    }

    public function show(Request $request, string $report): JsonResponse|StreamedResponse
    {
        $this->authorize('reports.view');
        $d = $request->validate([
            'from' => ['nullable', 'date'], 'to' => ['nullable', 'date', 'after_or_equal:from'],
            'format' => ['nullable', Rule::in(['json', 'csv'])],
        ]);
        abort_unless(isset(ReportService::REPORTS[$report]), 404, 'Unknown report.');

        $from = $d['from'] ?? today()->startOfMonth()->toDateString();
        $to = $d['to'] ?? today()->toDateString();
        $result = $this->reports->run($report, $this->branchFilter($request), $from, $to);

        return ($d['format'] ?? 'json') === 'csv' ? $this->csv($result) : response()->json(['data' => $result]);
    }

    /** CSV with a UTF-8 BOM so Excel opens it with the right encoding. */
    private function csv(array $r): StreamedResponse
    {
        $name = "{$r['report']}_{$r['from']}_{$r['to']}.csv";

        return response()->streamDownload(function () use ($r) {
            $out = fopen('php://output', 'w');
            fwrite($out, "\xEF\xBB\xBF");
            fputcsv($out, [$r['title'], "{$r['from']} to {$r['to']}"]);
            fputcsv($out, array_column($r['columns'], 'label'));
            foreach ($r['rows'] as $row) {
                fputcsv($out, array_map(fn ($c) => $this->cell($row->{$c['key']} ?? ''), $r['columns']));
            }
            fputcsv($out, array_map(fn ($c) => $r['totals'][$c['key']] ?? '', $r['columns']));
            fclose($out);
        }, $name, ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    /** Neutralise spreadsheet formula injection in text cells. */
    private function cell(mixed $v): string
    {
        $s = (string) $v;

        return $s !== '' && in_array($s[0], ['=', '+', '-', '@'], true) && ! is_numeric($s) ? "'".$s : $s;
    }

    // ---------------------------------------------------------------- vault stock check

    public function stockCheck(StockCheckService $checks): JsonResponse
    {
        $this->authorize('pawn.stock_check');
        $current = $checks->current();

        return response()->json(['data' => [
            'current' => $current ? $checks->summary($current->id) : null,
            'history' => $checks->history(),
            'active_tickets' => DB::table('pawn_tickets')->where('branch_id', $this->branch->requireId())->where('status', 'active')->count(),
        ]]);
    }

    public function startStockCheck(Request $request, StockCheckService $checks): JsonResponse
    {
        $this->authorize('pawn.stock_check');

        return response()->json(['data' => $checks->start($request->input('notes'))], 201);
    }

    public function scan(Request $request, int $session, StockCheckService $checks): JsonResponse
    {
        $this->authorize('pawn.stock_check');
        $code = $request->validate(['code' => ['required', 'string', 'max:30']])['code'];

        return response()->json(['data' => $checks->scan($session, trim($code))]);
    }

    public function completeStockCheck(int $session, StockCheckService $checks): JsonResponse
    {
        $this->authorize('pawn.stock_check');
        $checks->complete($session);

        return response()->json(['data' => $checks->summary($session)]);
    }

    public function stockCheckSummary(int $session, StockCheckService $checks): JsonResponse
    {
        $this->authorize('pawn.stock_check');

        return response()->json(['data' => $checks->summary($session)]);
    }
}
