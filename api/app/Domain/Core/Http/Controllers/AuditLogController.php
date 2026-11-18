<?php

namespace App\Domain\Core\Http\Controllers;

use App\Domain\Core\Models\AuditLog;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AuditLogController extends Controller
{
    public function index(Request $request): JsonResource
    {
        $this->authorize('audit.view');
        $f = $request->validate([
            'type' => ['nullable', 'string', 'max:60'],
            'id' => ['nullable', 'integer'],
            'event' => ['nullable', 'string', 'max:30'],
            'user_id' => ['nullable', 'integer'],
            'branch_id' => ['nullable', 'integer'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
        ]);

        $logs = AuditLog::query()
            ->with('user:id,username,name')
            ->when($f['type'] ?? null, fn ($q, $v) => $q->where('auditable_type', $v))
            ->when($f['id'] ?? null, fn ($q, $v) => $q->where('auditable_id', $v))
            ->when($f['event'] ?? null, fn ($q, $v) => $q->where('event', $v))
            ->when($f['user_id'] ?? null, fn ($q, $v) => $q->where('user_id', $v))
            ->when($f['branch_id'] ?? null, fn ($q, $v) => $q->where('branch_id', $v))
            ->when($f['from'] ?? null, fn ($q, $v) => $q->where('created_at', '>=', $v))
            ->when($f['to'] ?? null, fn ($q, $v) => $q->where('created_at', '<', now()->parse($v)->addDay()))
            ->orderByDesc('id')
            ->paginate(50)
            ->withQueryString();

        return JsonResource::collection($logs);
    }
}
