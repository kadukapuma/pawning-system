<?php

use App\Domain\Customers\Models\Customer;
use App\Domain\Sms\Models\SmsMessage;
use App\Domain\Sms\Models\SmsRule;
use App\Domain\Sms\Models\SmsSetting;
use App\Domain\Sms\Models\SmsTemplate;
use App\Domain\Sms\Services\NotifyLkClient;
use App\Domain\Sms\Services\SmsDispatcher;
use App\Domain\Sms\Services\SmsText;
use Carbon\Carbon;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

/*
 * Pawn on 1 Nov for 1 month → matures 1 Dec. Notify.lk is always faked.
 */

beforeEach(function () {
    Carbon::setTestNow('2026-11-01 10:00:00');
    config(['services.notifylk' => [
        'url' => 'https://sms.test/api/v1/send', 'user_id' => 'test-user', 'api_key' => 'test-secret-key',
        'sender_id' => 'TestSender', 'ca_bundle' => '/no/such/file.crt',
    ]]);
    Http::preventStrayRequests();

    $this->cashier = userWithRole('branch_manager');
    $this->admin = userWithRole('head_office');
    $this->customer = Customer::create([
        'branch_id' => branch()->id, 'code' => 'C001SMS', 'title' => 'Mr', 'first_name' => 'Kamal', 'last_name' => 'Silva',
        'nic' => '851112223V', 'address_line1' => 'No 9', 'phone1' => '0719998887', 'date_of_birth' => '1985-11-01',
    ]);
});

afterEach(fn () => Carbon::setTestNow());

function gatewayAccepts(): void
{
    Http::fake(['sms.test/*' => Http::response(['status' => 'success', 'data' => 'Sent'])]);
}

function smsOn(array $modes = []): void
{
    SmsSetting::current()->update(['enabled' => true]);
    foreach ($modes as $type => $mode) {
        SmsRule::where('type', $type)->firstOrFail()->update(['mode' => $mode]);
    }
}

function today_(string $date, string $time = '10:00'): void
{
    Carbon::setTestNow("{$date} {$time}:00");
}

function sentBodies(string $type): array
{
    return SmsMessage::withoutBranchScope()->where('type', $type)->orderBy('id')->pluck('body')->all();
}

it('ships switched off and sends nothing', function () {
    Http::fake();
    expect(SmsSetting::current()->enabled)->toBeFalse()
        ->and(SmsRule::where('mode', '!=', 'off')->count())->toBe(0);

    pawn(40000, 1);
    today_('2026-11-30');
    $this->artisan('sms:run')->assertSuccessful();

    expect(SmsMessage::withoutBranchScope()->count())->toBe(0);
    Http::assertNothingSent();
});

it('sends a slip after a pawn and after a part payment', function () {
    gatewayAccepts();
    smsOn(['slip_pawn' => 'auto', 'slip_part_payment' => 'auto']);

    $ticket = pawn(40000, 1);
    today_('2026-11-10');
    $response = api_('POST', "/pawn-tickets/{$ticket['id']}/part-payment", ['amount' => 5000, 'months' => 1])->assertCreated();

    expect($response->json('data'))->not->toHaveKey('ticket')
        ->and(sentBodies('slip_pawn')[0])->toContain($ticket['receipt_no'])->toContain('40,000.00')
        ->and(sentBodies('slip_part_payment')[0])->toContain('5,000.00')
        ->and(SmsMessage::withoutBranchScope()->pluck('status')->unique()->all())->toBe(['sent']);

    Http::assertSent(fn (Request $r) => $r->method() === 'POST'
        && $r['to'] === '94719998887' && $r['sender_id'] === 'TestSender' && ! isset($r['type']));
});

it('saves the payment even when the gateway is down, and lets staff retry', function () {
    Http::fake(fn () => throw new ConnectionException('cURL error 28: timed out for https://sms.test/?api_key=test-secret-key'));
    smsOn(['slip_pawn' => 'auto']);

    pawn(40000, 1);
    $message = SmsMessage::withoutBranchScope()->sole();

    expect($message->status)->toBe('failed')
        ->and($message->error)->toBe('Could not reach Notify.lk (cURL error 28).');

    Http::swap(new Factory);
    gatewayAccepts();
    api_('POST', "/sms/messages/{$message->id}/retry")->assertOk()->assertJsonPath('data.status', 'sent');
});

it('never shows credentials in a refusal', function () {
    Http::fake(['sms.test/*' => Http::response(['status' => 'error', 'errors' => ['bad key test-secret-key']], 401)]);
    smsOn(['slip_pawn' => 'auto']);

    pawn(40000, 1);

    expect(SmsMessage::withoutBranchScope()->sole()->error)->toContain('HTTP 401')->not->toContain('test-secret-key');
});

it('sends due reminders on the chosen days only once, catching up at most three days', function () {
    gatewayAccepts();
    pawn(40000, 1);
    smsOn(['due_reminder' => 'auto']);          // 7 and 1 days before 1 Dec

    today_('2026-11-23');                        // 8 days before: nothing
    $this->artisan('sms:run')->assertSuccessful();
    expect(sentBodies('due_reminder'))->toHaveCount(0);

    today_('2026-11-25');                        // 6 days before: the 7-day reminder, one day late
    $this->artisan('sms:run')->assertSuccessful();
    $this->artisan('sms:run')->assertSuccessful();
    today_('2026-11-26');
    $this->artisan('sms:run')->assertSuccessful();
    expect(sentBodies('due_reminder'))->toHaveCount(1);

    today_('2026-11-30');
    $this->artisan('sms:run')->assertSuccessful();
    expect(sentBodies('due_reminder'))->toHaveCount(2)
        ->and(sentBodies('due_reminder')[1])->toContain('Mr Kamal Silva')->toContain('2026-12-01');
});

it('waits for the send time', function () {
    gatewayAccepts();
    smsOn(['birthday' => 'auto']);

    today_('2026-11-01', '08:59');
    $this->artisan('sms:run')->assertSuccessful();
    expect(sentBodies('birthday'))->toHaveCount(0);

    today_('2026-11-01', '09:00');
    $this->artisan('sms:run')->assertSuccessful();
    expect(sentBodies('birthday'))->toBe(['Happy Birthday Kamal! Best wishes from Sampath Pawning Center.']);
});

it('greets 29 February birthdays on the 28th in other years', function () {
    $this->customer->update(['date_of_birth' => '1992-02-29']);
    smsOn(['birthday' => 'manual']);

    today_('2027-02-28');

    expect(api_('GET', '/sms/due/birthday')->assertOk()->json('data.items'))->toHaveCount(1);
});

it('does not message every old overdue ticket when arrears reminders are switched on', function () {
    gatewayAccepts();
    pawn(40000, 1);
    smsOn(['arrears_reminder' => 'auto']);       // 1, 14 and 28 days after

    today_('2027-01-10');                         // 40 days overdue
    $this->artisan('sms:run')->assertSuccessful();
    expect(sentBodies('arrears_reminder'))->toHaveCount(0);

    today_('2026-12-15');                         // 14 days overdue
    SmsRule::where('type', 'arrears_reminder')->update(['last_run_on' => null]);
    $this->artisan('sms:run')->assertSuccessful();
    expect(sentBodies('arrears_reminder'))->toHaveCount(1);
});

it('warns of forfeiture after letter 3 and reminds about a promise', function () {
    gatewayAccepts();
    $id = pawn(40000, 1)['id'];
    foreach (['2026-12-01' => 1, '2026-12-15' => 2, '2026-12-29' => 3] as $date => $letter) {
        today_($date);
        api_('POST', '/arrears/letters/issue', ['letter_no' => $letter, 'ticket_ids' => [$id]])->assertOk();
    }
    smsOn(['forfeit_warning' => 'auto', 'promise_reminder' => 'auto']);

    today_('2027-01-12');
    $this->artisan('sms:run')->assertSuccessful();
    expect(sentBodies('forfeit_warning'))->toHaveCount(1);

    api_('POST', "/pawn-tickets/{$id}/promises", ['promise_date' => '2027-01-20'])->assertCreated();
    today_('2027-01-19');
    $this->artisan('sms:run')->assertSuccessful();

    expect(sentBodies('promise_reminder'))->toHaveCount(1)
        ->and(sentBodies('promise_reminder')[0])->toContain('2027-01-20')
        ->and(sentBodies('forfeit_warning'))->toHaveCount(1);
});

it('lists due reminders for staff and sends only the ones they pick', function () {
    gatewayAccepts();
    smsOn(['birthday' => 'manual']);

    $this->artisan('sms:run')->assertSuccessful();   // manual types are never sent automatically
    expect(sentBodies('birthday'))->toHaveCount(0);

    $item = api_('GET', '/sms/due/birthday')->assertOk()->json('data.items.0');
    expect($item['status'])->toBeNull();

    api_('POST', '/sms/due/birthday', ['keys' => [$item['key']]])->assertOk()->assertJsonPath('data.queued', 1);
    api_('POST', '/sms/due/birthday', ['keys' => [$item['key']]])->assertOk()->assertJsonPath('data.queued', 0);

    expect(sentBodies('birthday'))->toHaveCount(1)
        ->and(api_('GET', '/sms/due/birthday')->json('data.items.0.status'))->toBe('sent');
});

it('uses the customer language, falls back to the default, and sends unicode', function () {
    gatewayAccepts();
    smsOn(['birthday' => 'auto']);
    $this->customer->update(['sms_language' => 'si']);

    $this->artisan('sms:run')->assertSuccessful();      // no Sinhala text yet → English
    expect(SmsMessage::withoutBranchScope()->sole()->language)->toBe('en');

    SmsMessage::withoutBranchScope()->delete();
    SmsRule::where('type', 'birthday')->update(['last_run_on' => null]);
    SmsTemplate::create(['type' => 'birthday', 'language' => 'si', 'body' => 'සුභ උපන්දිනයක් {first_name}']);
    $this->artisan('sms:run')->assertSuccessful();

    expect(sentBodies('birthday'))->toBe(['සුභ උපන්දිනයක් Kamal']);
    Http::assertSent(fn (Request $r) => ($r['type'] ?? null) === 'unicode');
});

it('lets an administrator change rules and rejects unknown placeholders', function () {
    $body = ['mode' => 'auto', 'offsets' => [10, 3], 'send_time' => '08:30', 'templates' => ['en' => 'Due {maturity_date}', 'si' => '', 'ta' => '']];

    api_('PUT', '/sms/rules/due_reminder', ['templates' => ['en' => 'Pay {promise_date}']] + $body, $this->admin)
        ->assertJsonValidationErrors('templates.en');
    api_('PUT', '/sms/rules/due_reminder', ['templates' => ['en' => '']] + $body, $this->admin)
        ->assertJsonValidationErrors('templates.en');
    api_('PUT', '/sms/rules/slip_pawn', ['mode' => 'manual'] + $body, $this->admin)->assertJsonValidationErrors('mode');
    api_('PUT', '/sms/rules/due_reminder', $body, $this->admin)->assertOk();

    $rule = SmsRule::where('type', 'due_reminder')->firstOrFail();
    expect($rule->days())->toBe([10, 3])->and($rule->send_time)->toBe('08:30');

    api_('PUT', '/sms/settings', ['enabled' => true, 'default_language' => 'ta'], $this->admin)
        ->assertOk()->assertJsonPath('data.enabled', true);
});

it('guards each screen with its permission', function () {
    $cashier = userWithRole('cashier');

    api_('GET', '/sms/settings', [], $cashier)->assertForbidden();
    api_('GET', '/sms/settings')->assertForbidden();                       // branch manager
    api_('POST', '/sms/bulk/preview', [], $cashier)->assertForbidden();
    api_('GET', '/sms/messages', [], userWithRole('valuer'))->assertForbidden();
    api_('GET', '/sms/due/birthday', [], userWithRole('auditor'))->assertForbidden();
    api_('GET', '/sms/messages', [], $cashier)->assertOk();
});

it('keeps message history inside the branch', function () {
    gatewayAccepts();
    smsOn(['slip_pawn' => 'auto']);
    pawn(40000, 1);

    expect(api_('GET', '/sms/messages')->json('data'))->toHaveCount(1)
        ->and(api_('GET', '/sms/messages', [], userWithRole('cashier', '002'))->json('data'))->toBe([]);
});

it('sends a typed message to a group once, skipping blacklisted customers', function () {
    gatewayAccepts();
    smsOn();
    Customer::create([
        'branch_id' => branch()->id, 'code' => 'C001BAD', 'first_name' => 'Bad', 'nic' => '861112223V',
        'address_line1' => 'No 1', 'phone1' => '0712223334', 'status' => 'blacklisted',
    ]);
    $input = ['audience' => 'all', 'messages' => ['en' => 'Dear {first_name}, we are closed on Poya day.']];

    api_('POST', '/sms/bulk/preview', $input)->assertOk()
        ->assertJsonPath('data.recipients', 1)->assertJsonPath('data.segments', 1);
    api_('POST', '/sms/bulk', $input + ['all_branches' => true, 'batch' => (string) Str::uuid()])->assertForbidden();

    $batch = (string) Str::uuid();
    api_('POST', '/sms/bulk', $input + ['batch' => $batch])->assertCreated()->assertJsonPath('data.queued', 1);
    api_('POST', '/sms/bulk', $input + ['batch' => $batch])->assertCreated()->assertJsonPath('data.queued', 0);

    expect(sentBodies('custom'))->toBe(['Dear Kamal, we are closed on Poya day.']);
});

it('sends a test message while switched off but nothing else', function () {
    gatewayAccepts();

    api_('POST', '/sms/test', ['phone' => '0771234567', 'message' => 'Test'], $this->admin)
        ->assertOk()->assertJsonPath('data.sent', true);
    api_('POST', '/sms/bulk', ['audience' => 'all', 'messages' => ['en' => 'Hi'], 'batch' => (string) Str::uuid()])
        ->assertJsonValidationErrors('sms');
});

it('expires reminders that could not be sent within a day', function () {
    gatewayAccepts();
    smsOn(['birthday' => 'manual']);
    $message = app(SmsDispatcher::class)->store([
        'branch_id' => branch()->id, 'type' => 'birthday', 'language' => 'en', 'phone' => '0771234567', 'body' => 'Old',
    ]);

    today_('2026-11-03');
    $this->artisan('sms:run')->assertSuccessful();

    expect($message->fresh()->status)->toBe('cancelled');
    Http::assertNothingSent();
});

it('normalises Sri Lankan mobile numbers', function (string $in, ?string $out) {
    expect(NotifyLkClient::internationalNumber($in))->toBe($out);
})->with([
    ['0771234567', '94771234567'], ['+94 77 123 4567', '94771234567'], ['771234567', '94771234567'],
    ['0452288151', null], ['', null],
]);

it('counts SMS parts', function () {
    expect(SmsText::measure(str_repeat('a', 160))['segments'])->toBe(1)
        ->and(SmsText::measure(str_repeat('a', 161))['segments'])->toBe(2)
        ->and(SmsText::measure(str_repeat('අ', 70))['segments'])->toBe(1)
        ->and(SmsText::measure(str_repeat('අ', 71))['segments'])->toBe(2)
        ->and(SmsText::measure('[x]')['length'])->toBe(5);
});
