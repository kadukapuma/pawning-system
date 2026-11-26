<?php

namespace App\Domain\Sms\Services;

use App\Domain\Core\Support\BranchContext;
use App\Domain\Customers\Models\Customer;
use App\Domain\Pawning\Models\PawnTicket;
use App\Domain\Sms\Enums\SmsType;
use Illuminate\Database\Eloquent\Builder;

/** A typed message to one customer or a group. */
class BulkSms
{
    public const AUDIENCES = ['customer', 'active_tickets', 'overdue', 'all'];

    public function __construct(
        private SmsDispatcher $dispatcher,
        private TemplateRenderer $templates,
        private SmsValues $values,
        private BranchContext $branch,
    ) {}

    /**
     * @param  array{audience: string, customer_id?: ?int, all_branches?: bool, messages: array<string, ?string>}  $input
     * @return array{recipients: int, no_mobile: int, segments: int, sample: ?string}
     */
    public function preview(array $input): array
    {
        $result = ['recipients' => 0, 'no_mobile' => 0, 'segments' => 0, 'sample' => null];

        $this->each($input, function (Customer $c) use ($input, &$result) {
            $template = $this->templates->pick($input['messages'], $c->sms_language);
            if (! $template || NotifyLkClient::internationalNumber($c->phone1) === null) {
                $result['no_mobile']++;

                return;
            }
            $text = $this->templates->render($template['body'], $this->values->for($c, $this->branchFor($c, $input)));
            $result['recipients']++;
            $result['segments'] += SmsText::measure($text)['segments'];
            $result['sample'] ??= $text;
        });

        return $result;
    }

    /**
     * Queue the message for everyone. $batch comes from the client, so a
     * double click cannot queue the same send twice.
     */
    public function queue(array $input, string $batch): int
    {
        $this->dispatcher->assertEnabled();
        $queued = 0;

        $this->each($input, function (Customer $c) use ($input, $batch, &$queued) {
            $branch = $this->branchFor($c, $input);
            $message = $this->dispatcher->queue(
                new SmsCandidate(SmsType::Custom, "bulk:{$batch}:{$c->id}", $c, $branch?->id ?? $c->branch_id, $this->values->for($c, $branch)),
                bodies: $input['messages'],
                batch: $batch,
            );
            $queued += $message ? 1 : 0;
        });

        return $queued;
    }

    private function each(array $input, callable $callback): void
    {
        $this->recipients($input)->with('branch')->chunkById(200, fn ($customers) => $customers->each($callback));
    }

    /** One branch's customers are written to as that branch. */
    private function branchFor(Customer $c, array $input)
    {
        return empty($input['all_branches']) ? ($this->branch->branch() ?? $c->branch) : $c->branch;
    }

    private function recipients(array $input): Builder
    {
        if ($input['audience'] === 'customer') {
            return Customer::query()->whereKey($input['customer_id']);
        }
        $branchId = empty($input['all_branches']) ? $this->branch->requireId() : null;
        // Blacklisted and inactive customers never get group messages.
        $query = Customer::query()->where('status', Customer::STATUS_ACTIVE);

        if ($input['audience'] === 'all') {
            return $query->when($branchId, fn ($q) => $q->where('branch_id', $branchId));
        }

        $tickets = PawnTicket::withoutBranchScope()->active()
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->when($input['audience'] === 'overdue', fn ($q) => $q->where('maturity_date', '<', today()));

        return $query->whereIn('id', $tickets->select('customer_id'));
    }
}
