<?php

namespace App\Domain\Sms\Http\Controllers;

use App\Domain\Core\Support\BranchContext;
use App\Domain\Sms\Enums\SmsType;
use App\Domain\Sms\Models\SmsMessage;
use App\Domain\Sms\Models\SmsRule;
use App\Domain\Sms\Models\SmsSetting;
use App\Domain\Sms\Models\SmsTemplate;
use App\Domain\Sms\Services\NotifyLkClient;
use App\Domain\Sms\Services\SmsDispatcher;
use App\Domain\Sms\Services\SmsGatewayException;
use App\Domain\Sms\Services\SmsText;
use App\Domain\Sms\Services\TemplateRenderer;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** SMS setup by an administrator: switches, schedules, message texts and a test send. */
class SmsSettingsController extends Controller
{
    public function __construct(private TemplateRenderer $templates, private NotifyLkClient $client) {}

    public function show(): JsonResponse
    {
        $this->authorize('sms.settings');
        $settings = SmsSetting::current();
        $rules = SmsRule::all()->keyBy('type');
        $bodies = SmsTemplate::all()->groupBy('type');

        return response()->json(['data' => [
            'enabled' => $settings->enabled,
            'default_language' => $settings->default_language,
            'configured' => $this->client->configured(),
            'sender_id' => $this->client->senderId(),
            'rules' => collect(SmsType::configurable())->map(
                fn (SmsType $t) => $this->ruleData($t, $rules->get($t->value), $bodies->get($t->value)?->pluck('body', 'language')->all() ?? [])
            ),
        ]]);
    }

    public function update(Request $request): JsonResponse
    {
        $this->authorize('sms.settings');
        $data = $request->validate([
            'enabled' => ['required', 'boolean'],
            'default_language' => ['required', Rule::in(SmsType::LANGUAGES)],
        ]);
        SmsSetting::current()->update($data + ['updated_by' => auth()->id()]);

        return $this->show();
    }

    public function updateRule(Request $request, string $type): JsonResponse
    {
        $this->authorize('sms.settings');
        $type = $this->configurableType($type);
        $range = $type->offsetRange();

        $data = $request->validate([
            'mode' => ['required', Rule::in($type->modes())],
            'offsets' => $range ? ['required', 'array', 'min:1', 'max:6'] : ['nullable'],
            'offsets.*' => $range ? ['integer', 'distinct', "between:{$range[0]},{$range[1]}"] : ['nullable'],
            'send_time' => $type->isReminder() ? ['required', 'date_format:H:i'] : ['nullable'],
            'templates' => ['required', 'array:'.implode(',', SmsType::LANGUAGES)],
            'templates.*' => ['nullable', 'string', 'max:1000'],
        ], ['offsets.required' => 'Enter at least one number of days.']);

        foreach ($data['templates'] as $language => $body) {
            if ($unknown = $this->templates->unknown((string) $body, $type)) {
                throw ValidationException::withMessages([
                    "templates.{$language}" => 'This message cannot use {'.implode('}, {', $unknown).'}.',
                ]);
            }
        }

        DB::transaction(function () use ($type, $data, $range) {
            foreach ($data['templates'] as $language => $body) {
                $body = trim((string) $body);
                $existing = SmsTemplate::where('type', $type->value)->where('language', $language)->first();
                if ($body === '') {
                    $existing?->delete();
                } else {
                    ($existing ?? new SmsTemplate(['type' => $type->value, 'language' => $language]))
                        ->fill(['body' => $body, 'updated_by' => auth()->id()])->save();
                }
            }

            // A type that is switched on needs text every customer can fall back to.
            if ($data['mode'] !== SmsType::MODE_OFF && ! $this->templates->templateFor($type, null)) {
                throw ValidationException::withMessages(['templates.en' => 'Write the message in English or in the default language.']);
            }

            SmsRule::for($type)->update([
                'mode' => $data['mode'],
                'offsets' => $range ? array_values(array_map('intval', $data['offsets'])) : null,
                'send_time' => $type->isReminder() ? $data['send_time'] : null,
                'updated_by' => auth()->id(),
            ]);
        });

        return $this->show();
    }

    /** How a text will look and what it costs, with example values. */
    public function preview(Request $request): JsonResponse
    {
        abort_unless($request->user()->can('sms.settings') || $request->user()->can('sms.bulk'), 403);
        $data = $request->validate([
            'type' => ['required', Rule::enum(SmsType::class)],
            'body' => ['nullable', 'string', 'max:1000'],
        ]);
        $type = SmsType::from($data['type']);
        $text = $this->templates->render((string) ($data['body'] ?? ''), $this->templates->sample());

        return response()->json(['data' => SmsText::measure($text) + [
            'text' => $text,
            'unknown' => $this->templates->unknown((string) ($data['body'] ?? ''), $type),
        ]]);
    }

    /** Sends one real SMS, even while the master switch is off. */
    public function test(Request $request, SmsDispatcher $dispatcher, BranchContext $branch): JsonResponse
    {
        $this->authorize('sms.settings');
        $data = $request->validate([
            'phone' => ['required', 'string', fn ($attribute, $value, $fail) => NotifyLkClient::internationalNumber($value) ?? $fail('Enter a Sri Lankan mobile number.')],
            'message' => ['required', 'string', 'max:612'],
        ]);

        $message = $dispatcher->store([
            'branch_id' => $branch->requireId(),
            'type' => SmsType::Custom->value,
            'language' => 'en',
            'phone' => $data['phone'],
            'body' => $data['message'],
        ]);
        $message = $dispatcher->send($message->id, evenIfDisabled: true);

        return response()->json(['data' => [
            'sent' => $message->status === SmsMessage::SENT,
            'error' => $message->error,
        ]]);
    }

    public function account(): JsonResponse
    {
        $this->authorize('sms.settings');

        try {
            return response()->json(['data' => $this->client->account() + ['error' => null]]);
        } catch (SmsGatewayException $e) {
            return response()->json(['data' => ['active' => false, 'balance' => null, 'error' => $e->getMessage()]]);
        }
    }

    private function configurableType(string $value): SmsType
    {
        $type = SmsType::tryFrom($value);
        abort_if(! $type || $type === SmsType::Custom, 404);

        return $type;
    }

    private function ruleData(SmsType $type, ?SmsRule $rule, array $bodies): array
    {
        return [
            'type' => $type->value,
            'label' => $type->label(),
            'is_reminder' => $type->isReminder(),
            'modes' => $type->modes(),
            'offset_range' => $type->offsetRange(),
            'placeholders' => $type->placeholders(),
            'mode' => $rule?->mode ?? SmsType::MODE_OFF,
            'offsets' => $rule?->days() ?? [],
            'send_time' => $rule?->send_time,
            'templates' => array_merge(array_fill_keys(SmsType::LANGUAGES, ''), $bodies),
        ];
    }
}
