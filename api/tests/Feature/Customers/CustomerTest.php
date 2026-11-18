<?php

use App\Domain\Customers\Models\Customer;
use App\Domain\Customers\Services\CustomerExposure;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

function customerPayload(array $overrides = []): array
{
    return $overrides + [
        'title' => 'Mr',
        'first_name' => 'Nimal',
        'last_name' => 'Perera',
        'nic' => '901234567v',
        'address_line1' => 'No 5, Temple Road',
        'city' => 'Balangoda',
        'phone1' => '077 123 4567',
    ];
}

/** Insert an active ticket for exposure tests. */
function activeTicket(Customer $c, float $principal, string $no): void
{
    $scheme = DB::table('pawn_schemes')->where('code', 'A')->first();
    DB::table('pawn_tickets')->insert([
        'branch_id' => branch('001')->id, 'customer_id' => $c->id, 'scheme_id' => $scheme->id,
        'scheme_version_id' => DB::table('pawn_scheme_versions')->where('scheme_id', $scheme->id)->value('id'),
        'receipt_no' => $no, 'ticket_no' => $no, 'stock_no' => $no,
        'pawn_date' => today(), 'cycle_start_date' => today(), 'maturity_date' => today()->addMonths(3),
        'principal_original' => $principal, 'principal_current' => $principal, 'status' => 'active',
        'created_at' => now(), 'updated_at' => now(),
    ]);
}

it('creates a customer with a branch customer code and normalised NIC / phone', function () {
    $this->actingAs(userWithRole('cashier', '002'))->withHeaders(spaHeaders())
        ->postJson('/api/v1/customers', customerPayload())
        ->assertCreated()
        ->assertJsonPath('data.code', 'C002000001')
        ->assertJsonPath('data.nic', '901234567V')
        ->assertJsonPath('data.phone1', '0771234567')
        ->assertJsonPath('data.full_name', 'Nimal Perera')
        ->assertJsonPath('data.status', 'active')
        ->assertJsonPath('data.branch.code', '002')
        ->assertJsonPath('data.exposure.active_tickets', 0);
});

it('validates NIC format, phone and uniqueness', function () {
    $user = userWithRole('cashier');
    $this->actingAs($user)->withHeaders(spaHeaders())
        ->postJson('/api/v1/customers', customerPayload(['nic' => '12345', 'phone1' => '12345']))
        ->assertStatus(422)
        ->assertJsonValidationErrors(['nic', 'phone1']);

    $this->actingAs($user)->withHeaders(spaHeaders())->postJson('/api/v1/customers', customerPayload(['nic' => '199012345678']))->assertCreated();
    $this->actingAs($user)->withHeaders(spaHeaders())
        ->postJson('/api/v1/customers', customerPayload(['nic' => '199012345678']))
        ->assertStatus(422)
        ->assertJsonPath('errors.nic.0', 'A customer with this NIC already exists.');
});

it('searches customers by NIC, name and phone across branches', function () {
    $user = userWithRole('cashier');
    $this->actingAs($user)->withHeaders(spaHeaders())->postJson('/api/v1/customers', customerPayload())->assertCreated();
    $this->actingAs(userWithRole('cashier', '002'))->withHeaders(spaHeaders())
        ->postJson('/api/v1/customers', customerPayload(['first_name' => 'Kamala', 'nic' => '851112223V', 'phone1' => '0719998887']))->assertCreated();

    $search = fn ($q) => $this->actingAs($user)->withHeaders(spaHeaders())->getJson('/api/v1/customers?q='.urlencode($q))->json('data.*.first_name');

    expect($search('9012'))->toBe(['Nimal'])
        ->and($search('kamala'))->toBe(['Kamala'])
        ->and($search('0719'))->toBe(['Kamala'])
        ->and($search(''))->toHaveCount(2);
});

it('finds a customer by exact NIC', function () {
    $user = userWithRole('cashier');
    $this->actingAs($user)->withHeaders(spaHeaders())->postJson('/api/v1/customers', customerPayload())->assertCreated();

    $this->actingAs($user)->withHeaders(spaHeaders())->getJson('/api/v1/customers/nic/901234567v')
        ->assertOk()->assertJsonPath('data.first_name', 'Nimal');
    $this->actingAs($user)->withHeaders(spaHeaders())->getJson('/api/v1/customers/nic/000000000V')->assertNotFound();
});

it('lets a valuer view but not create customers', function () {
    $valuer = userWithRole('valuer');
    $this->actingAs($valuer)->withHeaders(spaHeaders())->getJson('/api/v1/customers')->assertOk();
    $this->actingAs($valuer)->withHeaders(spaHeaders())->postJson('/api/v1/customers', customerPayload())->assertForbidden();
});

it('changes status with a reason and records it in the audit log', function () {
    $id = $this->actingAs(userWithRole('cashier'))->withHeaders(spaHeaders())
        ->postJson('/api/v1/customers', customerPayload())->json('data.id');

    $this->actingAs(userWithRole('branch_manager'))->withHeaders(spaHeaders())
        ->putJson("/api/v1/customers/{$id}/status", ['status' => 'blacklisted', 'reason' => 'Fake gold'])
        ->assertOk()->assertJsonPath('data.status', 'blacklisted');

    $log = DB::table('audit_logs')->where('auditable_type', 'customer')->where('event', 'status_changed')->first();
    // MySQL JSON does not keep key order.
    expect(json_decode($log->new_values, true))->toEqualCanonicalizing(['status' => 'blacklisted', 'reason' => 'Fake gold']);
});

it('only lets managers set limits, never below current exposure', function () {
    $id = $this->actingAs(userWithRole('cashier'))->withHeaders(spaHeaders())
        ->postJson('/api/v1/customers', customerPayload())->json('data.id');
    $customer = Customer::find($id);
    activeTicket($customer, 40000, '000001');
    activeTicket($customer, 25000, '000002');

    $this->actingAs(userWithRole('cashier'))->withHeaders(spaHeaders())
        ->putJson("/api/v1/customers/{$id}/limits", ['pawn_amount_limit' => 100000])->assertForbidden();

    $manager = userWithRole('branch_manager');
    $this->actingAs($manager)->withHeaders(spaHeaders())
        ->putJson("/api/v1/customers/{$id}/limits", ['pawn_amount_limit' => 50000, 'pawn_count_limit' => 1])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['pawn_amount_limit', 'pawn_count_limit']);

    $this->actingAs($manager)->withHeaders(spaHeaders())
        ->putJson("/api/v1/customers/{$id}/limits", ['pawn_amount_limit' => 100000, 'pawn_count_limit' => 3])
        ->assertOk()
        ->assertJsonPath('data.pawn_amount_limit', '100000.00')
        ->assertJsonPath('data.exposure.active_tickets', 2)
        ->assertJsonPath('data.exposure.outstanding_principal', '65000.00');
});

it('blocks new borrowing over the amount or count limit', function () {
    $customer = Customer::create(customerPayload([
        'branch_id' => branch()->id, 'code' => 'CX1', 'nic' => '901234567V', 'phone1' => '0771234567',
        'pawn_amount_limit' => 100000, 'pawn_count_limit' => 2,
    ]));
    activeTicket($customer, 60000, '000003');
    $policy = app(CustomerExposure::class);

    $policy->assertCanBorrow($customer, '40000');   // exactly at the limit is fine
    expect(fn () => $policy->assertCanBorrow($customer, '40000.01'))->toThrow(ValidationException::class);

    activeTicket($customer, 1000, '000004');
    expect(fn () => $policy->assertCanBorrow($customer, '1'))->toThrow(ValidationException::class, 'limit 2');
    $policy->assertCanBorrow($customer, '1', 0);      // a renewal adds no ticket

    $customer->update(['status' => 'blacklisted']);
    expect(fn () => $policy->assertCanBorrow($customer, '1', 0))->toThrow(ValidationException::class, 'blacklisted');
});
