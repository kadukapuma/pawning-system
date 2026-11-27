<?php

use App\Domain\Printing\Models\PrintDesign;
use App\Models\User;

function admin(): User
{
    return User::where('username', 'admin')->first();
}

function sampleTemplate(array $o = []): array
{
    return $o + [
        'version' => 1,
        'paper' => ['width_mm' => 148, 'height_mm' => 210, 'margin_x_mm' => 8, 'margin_y_mm' => 8],
        'font' => ['family' => 'Arial, sans-serif', 'size' => 10],
        'elements' => [
            ['id' => 't1', 'type' => 'text', 'x' => 10, 'y' => 10, 'w' => 100, 'h' => 8, 'text' => '{{company.name}}', 'bold' => true, 'sneaky' => 'dropped'],
            ['id' => 'tb', 'type' => 'table', 'x' => 10, 'y' => 30, 'w' => 128, 'h' => 40, 'table' => [
                'source' => 'items', 'showHeader' => true,
                'columns' => [['key' => 'article', 'label' => 'Article', 'width' => 60], ['key' => 'value', 'width' => 40, 'align' => 'right']],
            ]],
        ],
    ];
}

it('prints with the standard layout until a design is activated', function () {
    $this->actingAs(userWithRole('cashier'))->withHeaders(spaHeaders())
        ->getJson('/api/v1/print-designs/pawn_ticket')
        ->assertOk()
        ->assertJsonPath('data.template', null)
        ->assertJsonPath('data.branch.name', branch('001')->name);
});

it('saves a draft, activates it and removes it', function () {
    $this->actingAs(admin())->withHeaders(spaHeaders());

    $this->putJson('/api/v1/admin/print-designs/pawn_ticket', ['active' => false, 'template' => sampleTemplate()])
        ->assertSuccessful()->assertJsonPath('data.active', false);   // 201 on the first save
    // A draft does not change printing.
    $this->getJson('/api/v1/print-designs/pawn_ticket')->assertJsonPath('data.template', null);

    $this->putJson('/api/v1/admin/print-designs/pawn_ticket', ['active' => true, 'template' => sampleTemplate()])->assertOk();
    $active = $this->getJson('/api/v1/print-designs/pawn_ticket')->assertOk()->json('data.template');
    expect($active['elements'][0]['text'])->toBe('{{company.name}}')
        // Keys not in the rules are never stored.
        ->and($active['elements'][0])->not->toHaveKey('sneaky');

    $this->getJson('/api/v1/admin/print-designs')->assertOk()->assertJsonPath('data.0.document_key', 'pawn_ticket');

    $this->deleteJson('/api/v1/admin/print-designs/pawn_ticket')->assertOk();
    expect(PrintDesign::count())->toBe(0);
    $this->getJson('/api/v1/print-designs/pawn_ticket')->assertJsonPath('data.template', null);
});

it('rejects invalid templates and unknown documents', function () {
    $this->actingAs(admin())->withHeaders(spaHeaders());

    $this->putJson('/api/v1/admin/print-designs/pawn_ticket', ['active' => true, 'template' => sampleTemplate(['version' => 2])])
        ->assertStatus(422)->assertJsonValidationErrors('template.version');

    $bad = sampleTemplate();
    $bad['elements'][0]['type'] = 'script';
    $this->putJson('/api/v1/admin/print-designs/pawn_ticket', ['active' => true, 'template' => $bad])
        ->assertStatus(422)->assertJsonValidationErrors('template.elements.0.type');

    $this->putJson('/api/v1/admin/print-designs/hp_agreement', ['active' => true, 'template' => sampleTemplate()])->assertNotFound();
});

it('lets only users with print_designs.manage manage designs', function () {
    $this->actingAs(userWithRole('cashier'))->withHeaders(spaHeaders());

    $this->getJson('/api/v1/admin/print-designs')->assertForbidden();
    $this->putJson('/api/v1/admin/print-designs/pawn_ticket', ['active' => true, 'template' => sampleTemplate()])->assertForbidden();
    $this->deleteJson('/api/v1/admin/print-designs/pawn_ticket')->assertForbidden();
});
