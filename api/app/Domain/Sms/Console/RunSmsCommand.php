<?php

namespace App\Domain\Sms\Console;

use App\Domain\Sms\Enums\SmsType;
use App\Domain\Sms\Models\SmsRule;
use App\Domain\Sms\Services\ReminderFinder;
use App\Domain\Sms\Services\SmsDispatcher;
use Illuminate\Console\Command;
use Throwable;

/** Scheduled every minute: queue today's automatic reminders, then deliver the outbox. */
class RunSmsCommand extends Command
{
    protected $signature = 'sms:run';

    protected $description = 'Queue automatic SMS reminders that are due and send queued messages';

    public function handle(ReminderFinder $finder, SmsDispatcher $dispatcher): int
    {
        if (! $dispatcher->enabled()) {
            $this->info('SMS is switched off.');

            return self::SUCCESS;
        }
        $status = self::SUCCESS;

        foreach (SmsType::reminders() as $type) {
            $rule = SmsRule::for($type);
            if ($rule->mode !== SmsType::MODE_AUTO || $rule->last_run_on?->isToday() || now()->format('H:i') < ($rule->send_time ?? '09:00')) {
                continue;
            }
            try {
                $queued = $finder->find($rule)->filter(fn ($c) => $dispatcher->queue($c) !== null)->count();
                $rule->update(['last_run_on' => today()]);
                $this->info("{$type->label()}: {$queued} queued.");
            } catch (Throwable $e) {
                // One broken reminder type must not stop the others; it is retried next minute.
                report($e);
                $this->error("{$type->label()}: {$e->getMessage()}");
                $status = self::FAILURE;
            }
        }

        $result = $dispatcher->flush(limit: 100, seconds: 50);
        $this->info("Sent {$result['sent']}, failed {$result['failed']}.");

        return $status;
    }
}
