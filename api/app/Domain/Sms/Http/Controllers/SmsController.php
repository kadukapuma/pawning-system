<?php

namespace App\Domain\Sms\Http\Controllers;

use App\Domain\Pawning\Models\PawnTransaction;
use App\Domain\Sms\Enums\SmsType;
use App\Domain\Sms\Models\SmsMessage;
use App\Domain\Sms\Models\SmsRule;
use App\Domain\Sms\Services\BulkSms;
use App\Domain\Sms\Services\NotifyLkClient;
use App\Domain\Sms\Services\ReminderFinder;
use App\Domain\Sms\Services\SlipNotifier;
use App\Domain\Sms\Services\SmsCandidate;
use App\Domain\Sms\Services\SmsDispatcher;
use App\Domain\Sms\Services\TemplateRenderer;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** Day-to-day SMS work: history, due reminders, slips and bulk messages. */
class SmsController extends Controller
{
    public function __construct(private SmsDispatcher $dispatcher) {}

    /** What is switched on, for the screens staff use. */
    public function status(): JsonResponse
    {
        $this->authorize('sms.view');
        $rules = SmsRule::all()->keyBy('type');

        return response()->json(['data' => [
            'enabled' => $this->dispatcher->enabled(),
            'types' => collect(SmsType::cases())->map(fn (SmsType $t) => [
                'type' => $t->value,
                'label' => $t->label(),
                'is_reminder' => $t->isReminder(),
                'mode' => $rules->get($t->value)?->mode ?? SmsType::MODE_OFF,
                'offsets' => $rules->get($t->value)?->days() ?? [],
            ]),
        ]]);
    }

    // ---------------------------------------------------------------- history

    public function messages(Request $request): AnonymousResourceCollection
    {
        $this->authorize('sms.view');
        $f = $request->validate([
            'status' => ['nullable', Rule::in(SmsMessage::STATUSES)],
            'type' => ['nullable', Rule::enum(SmsType::class)],
            'from' => ['nullable', 'date'], 'to' => ['nullable', 'date'],
            'q' => ['nullable', 'string', 'max:100'],
        ]);
        $q = trim((string) ($f['q'] ?? ''));

        $messages = SmsMessage::with(['customer', 'ticket', 'creator:id,name'])
            ->when($f['status'] ?? null, fn ($query, $v) => $query->where('status', $v))
            ->when($f['type'] ?? null, fn ($query, $v) => $query->where('type', $v))
            ->when($f['from'] ?? null, fn ($query, $d) => $query->where('created_at', '>=', $d))
            ->when($f['to'] ?? null, fn ($query, $d) => $query->where('created_at', '<', now()->parse($d)->addDay()))
            ->when($q !== '', fn ($query) => $query->where(fn ($w) => $w
                ->where('phone', 'like', addcslashes($q, '%_\\').'%')
                ->orWhereHas('customer', fn ($c) => $c->search($q))))
            ->orderByDesc('id')
            ->paginate(25)
            ->withQueryString();

        return JsonResource::collection($messages->through(fn (SmsMessage $m) => [
            'id' => $m->id,
            'type' => $m->type,
            'label' => SmsType::tryFrom($m->type)?->label() ?? $m->type,
            'phone' => $m->phone,
            'body' => $m->body,
            'segments' => $m->segments,
            'status' => $m->status,
            'error' => $m->error,
            'customer' => $m->customer ? ['id' => $m->customer->id, 'name' => $m->customer->full_name] : null,
            'ticket' => $m->ticket ? ['id' => $m->ticket->id, 'receipt_no' => $m->ticket->receipt_no] : null,
            'created_by' => $m->creator?->name,
            'created_at' => $m->created_at->toIso8601String(),
            'sent_at' => $m->sent_at?->toIso8601String(),
        ]));
    }

    public function retry(SmsMessage $message): JsonResponse
    {
        $this->authorize('sms.send');
        $this->dispatcher->assertEnabled();
        $changed = SmsMessage::whereKey($message->id)->where('status', SmsMessage::FAILED)
            ->update(['status' => SmsMessage::QUEUED, 'error' => null, 'queued_at' => now()]);
        if (! $changed) {
            throw ValidationException::withMessages(['sms' => 'Only failed messages can be retried.']);
        }
        $sent = $this->dispatcher->send($message->id);

        return response()->json(['data' => ['status' => $sent?->status ?? SmsMessage::QUEUED, 'error' => $sent?->error]]);
    }

    public function cancel(SmsMessage $message): JsonResponse
    {
        $this->authorize('sms.send');
        $changed = SmsMessage::whereKey($message->id)->where('status', SmsMessage::QUEUED)
            ->update(['status' => SmsMessage::CANCELLED, 'error' => 'Cancelled by '.auth()->user()->name.'.']);
        if (! $changed) {
            throw ValidationException::withMessages(['sms' => 'Only messages still waiting can be cancelled.']);
        }

        return response()->json(['data' => ['ok' => true]]);
    }

    /** Fallback when the server scheduler is not running. */
    public function flush(): JsonResponse
    {
        $this->authorize('sms.send');
        $this->dispatcher->assertEnabled();
        $result = $this->dispatcher->flush(limit: 20, seconds: 20);

        return response()->json(['data' => $result + ['waiting' => SmsMessage::where('status', SmsMessage::QUEUED)->count()]]);
    }

    // ---------------------------------------------------------------- reminders

    public function due(string $type, ReminderFinder $finder, TemplateRenderer $templates): JsonResponse
    {
        $this->authorize('sms.send');
        $rule = $this->reminderRule($type);
        $candidates = $finder->find($rule);
        $existing = SmsMessage::withoutBranchScope()->whereIn('dedupe_key', $candidates->pluck('key'))->get()->keyBy('dedupe_key');

        return response()->json(['data' => [
            'mode' => $rule->mode,
            'items' => $candidates->map(function (SmsCandidate $c) use ($templates, $existing) {
                $message = $existing->get($c->key);
                $template = $templates->templateFor($c->type, $c->customer->sms_language);

                return [
                    'key' => $c->key,
                    'customer' => ['id' => $c->customer->id, 'name' => $c->customer->full_name, 'phone' => $c->customer->phone1],
                    'ticket' => $c->ticket ? ['id' => $c->ticket->id, 'receipt_no' => $c->ticket->receipt_no, 'maturity_date' => $c->ticket->maturity_date->toDateString()] : null,
                    'text' => $message?->body ?? ($template ? $templates->render($template['body'], $c->values) : null),
                    'status' => $message?->status,
                    'problem' => match (true) {
                        NotifyLkClient::internationalNumber($c->customer->phone1) === null => 'No valid mobile number',
                        ! $template && ! $message => 'No message text',
                        default => null,
                    },
                ];
            }),
        ]]);
    }

    /** The client picks who; the text is always rebuilt here. */
    public function sendDue(Request $request, string $type, ReminderFinder $finder): JsonResponse
    {
        $this->authorize('sms.send');
        $this->dispatcher->assertEnabled();
        $rule = $this->reminderRule($type);
        if ($rule->isOff()) {
            throw ValidationException::withMessages(['sms' => 'This message type is switched off.']);
        }
        $keys = $request->validate(['keys' => ['required', 'array', 'min:1', 'max:500'], 'keys.*' => ['string', 'max:100']])['keys'];

        $ids = $finder->find($rule)
            ->filter(fn (SmsCandidate $c) => in_array($c->key, $keys, true))
            ->map(fn (SmsCandidate $c) => $this->dispatcher->queue($c, replaceUnsent: true)?->id)
            ->filter()->values()->all();

        $this->sendAfterResponse($ids);

        return response()->json(['data' => ['queued' => count($ids), 'skipped' => count(array_unique($keys)) - count($ids)]]);
    }

    // ---------------------------------------------------------------- slips

    public function slip(int $transaction, SlipNotifier $slips): JsonResponse
    {
        $this->authorize('sms.send');
        $message = $slips->resend(PawnTransaction::findOrFail($transaction));

        return response()->json(['data' => ['status' => $message->status, 'error' => $message->error]]);
    }

    // ---------------------------------------------------------------- bulk

    public function bulkPreview(Request $request, BulkSms $bulk): JsonResponse
    {
        $this->authorize('sms.bulk');

        return response()->json(['data' => $bulk->preview($this->bulkInput($request))]);
    }

    public function bulkSend(Request $request, BulkSms $bulk): JsonResponse
    {
        $this->authorize('sms.bulk');
        $batch = $request->validate(['batch' => ['required', 'uuid']])['batch'];
        $queued = $bulk->queue($this->bulkInput($request), $batch);

        $this->sendAfterResponse(SmsMessage::withoutBranchScope()->where('batch_ref', $batch)
            ->where('status', SmsMessage::QUEUED)->limit(20)->pluck('id')->all());

        return response()->json(['data' => ['queued' => $queued]], 201);
    }

    private function bulkInput(Request $request): array
    {
        $input = $request->validate([
            'audience' => ['required', Rule::in(BulkSms::AUDIENCES)],
            'customer_id' => ['required_if:audience,customer', 'nullable', 'integer', 'exists:customers,id'],
            'all_branches' => ['sometimes', 'boolean'],
            'messages' => ['required', 'array:'.implode(',', SmsType::LANGUAGES)],
            'messages.*' => ['nullable', 'string', 'max:612'],
        ]);
        if (! empty($input['all_branches'])) {
            $this->authorize('reports.all_branches');
        }
        $templates = app(TemplateRenderer::class);
        if (! $templates->pick($input['messages'], null)) {
            throw ValidationException::withMessages(['messages.en' => 'Write the message in English or in the default language.']);
        }
        foreach ($input['messages'] as $language => $body) {
            if ($unknown = $templates->unknown((string) $body, SmsType::Custom)) {
                throw ValidationException::withMessages(["messages.{$language}" => 'A custom message cannot use {'.implode('}, {', $unknown).'}.']);
            }
        }

        return $input;
    }

    private function reminderRule(string $value): SmsRule
    {
        $type = SmsType::tryFrom($value);
        abort_if(! $type || ! $type->isReminder(), 404);

        return SmsRule::for($type);
    }

    /**
     * Start sending without making staff wait. Anything not reached stays
     * queued for the scheduler.
     *
     * @param  list<int>  $ids
     */
    private function sendAfterResponse(array $ids): void
    {
        if ($ids === []) {
            return;
        }
        dispatch(function () use ($ids) {
            try {
                // Bulk messages for all branches are not limited to the working branch.
                $deadline = microtime(true) + 20;
                foreach ($ids as $id) {
                    if (microtime(true) >= $deadline) {
                        break;
                    }
                    app(SmsDispatcher::class)->send($id);
                }
            } catch (\Throwable $e) {
                report($e);
            }
        })->afterResponse();
    }
}
