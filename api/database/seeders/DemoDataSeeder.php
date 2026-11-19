<?php

namespace Database\Seeders;

use App\Domain\Accounting\Models\Account;
use App\Domain\Accounting\Services\AccountBalances;
use App\Domain\Accounting\Services\CashBookService;
use App\Domain\Accounting\Services\JournalLineData;
use App\Domain\Accounting\Services\LedgerPoster;
use App\Domain\Accounting\Services\VoucherService;
use App\Domain\Arrears\Services\ArrearsService;
use App\Domain\Banking\Models\Bank;
use App\Domain\Banking\Models\BankAccount;
use App\Domain\Banking\Services\BankingService;
use App\Domain\Core\Models\Branch;
use App\Domain\Core\Services\SequenceService;
use App\Domain\Core\Support\BranchContext;
use App\Domain\Customers\Models\Customer;
use App\Domain\Forfeit\Services\ForfeitService;
use App\Domain\Inventory\Models\InventoryItem;
use App\Domain\Masters\Models\ArticleCategory;
use App\Domain\Masters\Models\ArticleCondition;
use App\Domain\Masters\Models\ArticleType;
use App\Domain\Masters\Models\Karat;
use App\Domain\Pawning\Models\PawnTicket;
use App\Domain\Pawning\Services\PartPaymentService;
use App\Domain\Pawning\Services\PawnService;
use App\Domain\Pawning\Services\RedemptionService;
use App\Domain\Pawning\Services\RenewalService;
use App\Domain\Pawning\Services\TicketAdminService;
use App\Domain\Sales\Services\SalesService;
use App\Models\User;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/**
 * LOCAL DEMO DATA — fictional customers and ~5 months of activity in both
 * branches, created day by day through the real services (so every number,
 * journal and status is exactly what the app would produce).
 *
 *   php artisan db:seed --class=DemoDataSeeder
 *
 * Runs only with APP_ENV=local on an empty pawn book. Re-run from scratch with
 * `php artisan migrate:fresh --seed && php artisan db:seed --class=DemoDataSeeder`.
 */
class DemoDataSeeder extends Seeder
{
    private const DAYS = 150;

    private const FIRST = ['Nimal', 'Kamal', 'Sunil', 'Saman', 'Chaminda', 'Ruwan', 'Pradeep', 'Nuwan', 'Kasun', 'Lasith', 'Mahinda', 'Upul',
        'Dilani', 'Nadeesha', 'Chathurika', 'Sanduni', 'Kumari', 'Malani', 'Anoma', 'Iresha', 'Thilini', 'Hasini', 'Shanika', 'Rasika'];

    private const LAST = ['Perera', 'Silva', 'Fernando', 'Jayasinghe', 'Wickramasinghe', 'Bandara', 'Rathnayake', 'Herath', 'Gunawardena',
        'Dissanayake', 'Kumara', 'Rajapaksha', 'Senanayake', 'Wijesinghe', 'Ekanayake', 'Abeysekara', 'Karunaratne', 'Pathirana'];

    private const CITIES = ['001' => ['Balangoda', 'Belihuloya', 'Pinnawala', 'Kaltota', 'Imbulpe', 'Rajawaka'],
        '002' => ['Rathnapura', 'Pelmadulla', 'Kuruwita', 'Eheliyagoda', 'Gilimale', 'Malwala']];

    private const ROADS = ['Main Street', 'Temple Road', 'Station Road', 'Hospital Road', 'School Lane', 'Church Road', 'Lake Road', 'New Town'];

    private const CATEGORIES = ['Chain' => 30, 'Bangle' => 12, 'Brecelet' => 10, 'Pendant' => 10, 'Earing' => 10, "Women's Ring" => 10,
        "Man's Ring" => 6, 'Chain With pendant' => 8, 'Coin' => 2, 'SILVER' => 2];

    private const KARATS = ['B4' => 6, 'B3' => 8, 'B2' => 10, 'B1' => 12, 'B0' => 12, 'A9' => 12, 'A8' => 10, 'A7' => 8, 'A6' => 6, 'A5' => 5, 'A4' => 4, 'A3' => 3, 'A2' => 2, 'A1' => 1, 'A0' => 1];

    private array $stats = [];

    private array $nics = [];

    public function run(): void
    {
        if (! app()->environment('local')) {
            throw new RuntimeException('Demo data is for local development only (APP_ENV=local).');
        }
        if (! str_starts_with((string) DB::connection()->getDatabaseName(), 'sampath_new')) {
            throw new RuntimeException('Refusing to add demo data to database '.DB::connection()->getDatabaseName().'.');
        }
        if (PawnTicket::withoutBranchScope()->exists()) {
            throw new RuntimeException('Pawn tickets already exist. Run `php artisan migrate:fresh --seed` first for a clean demo.');
        }

        mt_srand(20261118);   // same data every run
        // Real today, captured BEFORE the simulated clock starts moving.
        $end = CarbonImmutable::today();
        $start = $end->subDays(self::DAYS);
        $branches = Branch::orderBy('code')->get();
        $staff = $this->staff($branches);

        $this->at($start->setTime(8, 0));
        $this->setupBanks($branches, $staff);
        foreach ($branches as $b) {
            $this->as($staff[$b->code]['manager'], $b);
            app(LedgerPoster::class)->post([
                JournalLineData::debit('cash', '3000000', 'Opening cash float'),
                JournalLineData::credit('head_office_current', '3000000', 'Opening cash float'),
            ], 'Opening cash float from head office', $start->toDateString());
            $this->customers($b, 45);
            $this->openingTickets($b, 8, $start);
        }

        for ($day = $start; $day->lte($end); $day = $day->addDay()) {
            $isToday = $day->equalTo($end);
            foreach ($branches as $b) {
                $this->simulateDay($b, $day, $staff[$b->code], $isToday);
            }
            if ($day->day === 1 || $isToday) {
                $this->command?->info("  … {$day->toDateString()}");
            }
        }

        Carbon::setTestNow();
        Auth::logout();
        app(BranchContext::class)->set(null);

        $this->command?->table(['What', 'Count'], collect($this->stats)->map(fn ($v, $k) => [$k, $v])->values()->all());
    }

    // ------------------------------------------------------------------ one business day

    private function simulateDay(Branch $b, CarbonImmutable $day, array $staff, bool $isToday): void
    {
        $weekday = $day->dayOfWeek;   // 0 = Sunday
        if ($weekday === 0) {
            return;                   // closed on Sundays
        }

        // Morning: cashier serves customers.
        $this->at($day->setTime(9, 30));
        $this->as($staff['cashier'], $b);

        // Head office sends cash when the safe runs low.
        $cashId = Account::system('cash')->id;
        if ((float) app(AccountBalances::class)->balance($cashId, $b->id, $day->subDay()->toDateString()) < 1500000) {
            $this->at($day->setTime(8, 45));
            $this->as($staff['manager'], $b);
            app(LedgerPoster::class)->post([
                JournalLineData::debit('cash', '3000000', 'Cash received from head office'),
                JournalLineData::credit('head_office_current', '3000000', 'Cash received from head office'),
            ], 'Cash from head office', $day->toDateString());
            $this->count('head office cash top-ups');
            $this->as($staff['cashier'], $b);
        }

        for ($i = 0, $n = mt_rand(2, 4); $i < $n; $i++) {
            $this->at($day->setTime(9 + $i, mt_rand(0, 59)));
            $this->newPawn($b);
        }
        for ($i = 0, $n = mt_rand(1, 4); $i < $n; $i++) {
            $this->at($day->setTime(10 + $i, mt_rand(0, 59)));
            $this->randomPayment();
        }

        // Arrears letters every Monday and Thursday.
        if (in_array($weekday, [1, 4], true)) {
            $this->at($day->setTime(14, 0));
            foreach ([1, 2, 3] as $letter) {
                $due = app(ArrearsService::class)->due($letter)->pluck('ticket.id')->all();
                if ($due) {
                    $r = app(ArrearsService::class)->issue($due, $letter);
                    $this->count("letter {$letter} issued", count($r['letters']));
                }
            }
        }

        // Manager: reminders, forfeit, stock, sales (Wednesdays / Saturdays).
        if (in_array($weekday, [3, 6], true)) {
            $this->at($day->setTime(15, 0));
            $this->as($staff['manager'], $b);
            $this->forfeitCycle($day);
            $this->as($staff['cashier'], $b);
            $this->sellSomething();
        }

        // Expenses: cashier raises, accountant approves.
        if ($weekday === 5) {
            $this->at($day->setTime(16, 0));
            $this->expense($b, $staff, '5120', mt_rand(6000, 14000), 'CEB', 'Electricity bill');
            $this->expense($b, $staff, '5126', mt_rand(1500, 5000), 'Lanka Stationers', 'Receipt books and toner');
            if ($day->day <= 7) {
                $this->expense($b, $staff, '5123', 55000, 'Building owner', 'Monthly rent');
                $this->expense($b, $staff, '5122', mt_rand(3000, 6000), 'SLT', 'Telephone & internet');
            }
            if (mt_rand(1, 4) === 1) {
                $this->expense($b, $staff, '5124', mt_rand(1000, 4000), 'Staff', 'Travelling to head office', 'petty_cash');
            }
        }

        // Saturday: excess cash to the bank.
        if ($weekday === 6) {
            $this->at($day->setTime(16, 30));
            $this->as($staff['manager'], $b);
            $cash = (float) app(AccountBalances::class)->balance(Account::system('cash')->id, $b->id, $day->toDateString());
            $bank = BankAccount::first();
            if ($bank && $cash > 4000000) {
                $amount = (string) (floor(($cash - 2500000) / 100000) * 100000);
                app(BankingService::class)->transfer(Account::system('cash')->id, $bank->account_id, $amount, $day->toDateString(), 'Cash deposited to bank');
                $this->count('bank deposits');
            }
        }

        // Evening: close the day (today stays open so you can work in it).
        if (! $isToday) {
            $this->at($day->setTime(18, 30));
            $this->as($staff['manager'], $b);
            $book = app(CashBookService::class)->day($b->id, $day->toDateString());
            $counted = mt_rand(1, 12) === 1 ? (float) $book['closing'] - mt_rand(1, 20) * 10 : (float) $book['closing'];
            app(CashBookService::class)->close($b->id, $day->toDateString(), (string) $counted);
            $this->count('days closed');
        }
    }

    // ------------------------------------------------------------------ actions

    private function newPawn(Branch $b): void
    {
        $customer = Customer::where('branch_id', $b->id)->inRandomOrder()->first();
        $items = [];
        for ($i = 0, $n = mt_rand(1, 10) <= 7 ? 1 : mt_rand(2, 3); $i < $n; $i++) {
            $items[] = $this->randomItem();
        }

        $this->try('pawns', function () use ($customer, $items) {
            $pawn = app(PawnService::class);
            $value = (float) $pawn->quote($items)['assessed_value'];
            $amount = max(1000, floor($value * mt_rand(40, 80) / 100 / 100) * 100);
            $maxTerm = $pawn->quote($items, (string) $amount)['max_term'];
            $months = max(1, min($maxTerm, [1, 1, 2, 3, 3, 6][mt_rand(0, 5)]));
            $pawn->create(['customer_id' => $customer->id, 'items' => $items, 'amount' => $amount, 'months' => $months]);
        });
    }

    private function randomPayment(): void
    {
        $ticket = PawnTicket::active()->where('is_blocked', false)->whereNull('forfeit_queued_at')
            ->where('pawn_date', '<', today())->inRandomOrder()->first();
        if (! $ticket) {
            return;
        }

        $roll = mt_rand(1, 100);
        if ($roll <= 45) {                                   // redeem
            $this->try('redemptions', fn () => app(RedemptionService::class)->redeem($ticket->id, '0'));
        } elseif ($roll <= 80) {                             // part payment
            $this->try('part payments', function () use ($ticket) {
                $quote = app(PartPaymentService::class)->quote($ticket, '0');
                $interest = (float) $quote['statement']['interest'] + (float) $quote['statement']['letter_charge'];
                $amount = round($interest + (float) $ticket->principal_current * mt_rand(5, 40) / 100, -2);

                return app(PartPaymentService::class)->pay($ticket->id, (string) max(500, $amount), '0', mt_rand(1, 3));
            });
        } elseif ($roll <= 95) {                             // renewal
            $this->try('renewals', function () use ($ticket) {
                $months = mt_rand(1, 3);
                $limit = (float) (app(RenewalService::class)->quote($ticket, '0', '0', $months)['preview']['month_options'][$months] ?? 0);
                $extra = $limit > 1000 && mt_rand(0, 1) ? floor($limit * mt_rand(10, 50) / 100 / 100) * 100 : 0;

                return app(RenewalService::class)->renew($ticket->id, (string) $extra, '0', $months);
            });
        } else {                                             // block one now and then
            $this->try('blocked', fn () => app(TicketAdminService::class)->setBlocked($ticket->id, true, 'Customer reported ID card lost — verify identity'));
        }
    }

    private function forfeitCycle(CarbonImmutable $day): void
    {
        $forfeit = app(ForfeitService::class);

        foreach ($forfeit->reminders() as $r) {
            $t = $r['ticket'];
            if (! $r['promise'] && mt_rand(1, 100) <= 35) {
                $this->try('promises', fn () => $forfeit->promise($t, $day->addDays(mt_rand(5, 14))->toDateString(), 'Customer called, will pay after salary'));
            } elseif (mt_rand(1, 100) <= 70) {
                $res = $forfeit->queue([$t->id]);
                $this->count('queued for forfeit', count($res['queued']));
            }
        }

        $queued = PawnTicket::active()->whereNotNull('forfeit_queued_at')->where('forfeit_queued_at', '<', $day->subDays(3))->pluck('id')->all();
        if ($queued) {
            $this->count('forfeited', count($forfeit->forfeit($queued)['forfeitures']));
        }

        $awaiting = $forfeit->awaitingTransfer()->pluck('id')->all();
        if ($awaiting) {
            $forfeit->transfer($awaiting, 'Weekly transfer');
            $this->count('stock transfers');
        }
    }

    private function sellSomething(): void
    {
        $items = InventoryItem::where('status', 'in_stock')->inRandomOrder()->limit(mt_rand(0, 2))->get();
        foreach ($items as $item) {
            $price = (string) round((float) $item->sale_price * mt_rand(95, 105) / 100, -2);
            $card = mt_rand(1, 4) === 1 ? $price : '0';
            $this->try('sales', fn () => app(SalesService::class)->create([
                'lines' => [['inventory_item_id' => $item->id, 'unit_price' => $price]],
                'customer_name' => self::FIRST[mt_rand(0, count(self::FIRST) - 1)].' '.self::LAST[mt_rand(0, count(self::LAST) - 1)],
                'paid_cash' => $card === '0' ? $price : '0', 'paid_card' => $card,
            ]));
        }
    }

    private function expense(Branch $b, array $staff, string $accountCode, int $amount, string $party, string $desc, string $type = 'expense'): void
    {
        $this->as($staff['cashier'], $b);
        $v = app(VoucherService::class)->create([
            'type' => $type, 'voucher_date' => today()->toDateString(), 'account_id' => Account::where('code', $accountCode)->value('id'),
            'cash_account_id' => Account::system('cash')->id, 'amount' => $amount, 'party_name' => $party, 'description' => $desc,
        ]);
        $this->as($staff['accountant'], $b);
        mt_rand(1, 15) === 1 ? app(VoucherService::class)->reject($v, 'Bill missing') : app(VoucherService::class)->approve($v);
        $this->count('vouchers');
    }

    // ------------------------------------------------------------------ setup

    /** @return array<string, array{cashier: User, manager: User, accountant: User}> */
    private function staff($branches): array
    {
        $accountant = User::where('username', 'accountant')->first() ?? User::where('username', 'admin')->firstOrFail();
        $out = [];
        foreach ($branches as $b) {
            $cashier = User::where('username', "cashier{$b->code}")->first();
            $manager = User::where('username', "manager{$b->code}")->first();
            if (! $cashier || ! $manager) {
                throw new RuntimeException("Demo users cashier{$b->code} / manager{$b->code} are missing — run DemoUsersSeeder first (needs SEED_DEMO_PASSWORD).");
            }
            $out[$b->code] = ['cashier' => $cashier, 'manager' => $manager, 'accountant' => $accountant];
        }

        return $out;
    }

    private function setupBanks($branches, array $staff): void
    {
        $banks = ['7010' => ['Bank of Ceylon', ['001' => 'Balangoda', '002' => 'Rathnapura']],
            '7135' => ["People's Bank", ['001' => 'Balangoda', '002' => 'Rathnapura']],
            '7083' => ['Hatton National Bank', ['001' => 'Balangoda', '002' => 'Rathnapura']],
            '7278' => ['Sampath Bank', ['001' => 'Balangoda', '002' => 'Rathnapura']]];

        foreach ($banks as $code => [$name, $brs]) {
            $bank = Bank::firstOrCreate(['code' => $code], ['name' => $name, 'is_active' => true]);
            foreach ($brs as $brCode => $brName) {
                $bank->branches()->firstOrCreate(['code' => $brCode === '001' ? '045' : '112'], ['name' => $brName]);
            }
        }

        foreach ($branches as $b) {
            $this->as($staff[$b->code]['manager'], $b);
            $hnb = Bank::where('code', '7083')->first()->branches()->where('name', $b->name === 'Balangoda' ? 'Balangoda' : 'Rathnapura')->first();
            app(BankingService::class)->createBankAccount([
                'bank_branch_id' => $hnb->id, 'account_no' => ($b->code === '001' ? '045' : '112').'0100'.mt_rand(10000, 99999),
                'account_name' => "Sampath Pawning {$b->name}",
            ]);
        }
    }

    private function customers(Branch $b, int $count): void
    {
        $seq = app(SequenceService::class);
        for ($i = 0; $i < $count; $i++) {
            $female = mt_rand(0, 1) === 1;
            $first = self::FIRST[$female ? mt_rand(12, 23) : mt_rand(0, 11)];
            $city = self::CITIES[$b->code][mt_rand(0, count(self::CITIES[$b->code]) - 1)];
            Customer::create([
                'branch_id' => $b->id,
                'code' => $seq->next('customer', $b->id),
                'title' => $female ? (mt_rand(0, 1) ? 'Mrs' : 'Miss') : 'Mr',
                'first_name' => $first,
                'last_name' => self::LAST[mt_rand(0, count(self::LAST) - 1)],
                'gender' => $female ? 'female' : 'male',
                'nic' => $this->nic($female),
                'address_line1' => 'No '.mt_rand(1, 250).', '.self::ROADS[mt_rand(0, count(self::ROADS) - 1)],
                'city' => $city,
                'phone1' => '07'.[0, 1, 2, 4, 5, 6, 7, 8][mt_rand(0, 7)].mt_rand(1000000, 9999999),
                'pawn_amount_limit' => mt_rand(1, 10) === 1 ? 500000 : null,
                'status' => 'active',
                'created_by' => auth()->id(),
            ]);
            $this->count('customers');
        }
    }

    private function openingTickets(Branch $b, int $count, CarbonImmutable $start): void
    {
        for ($i = 0; $i < $count; $i++) {
            $customer = Customer::where('branch_id', $b->id)->inRandomOrder()->first();
            $items = [$this->randomItem()];
            $this->try('opening tickets', function () use ($customer, $items, $start, $b, $i) {
                $value = (float) app(PawnService::class)->quote($items)['assessed_value'];

                return app(PawnService::class)->createOpening([
                    'customer_id' => $customer->id, 'items' => $items,
                    'principal' => floor($value * 0.6 / 100) * 100,
                    'pawn_date' => $start->subDays(mt_rand(20, 80))->toDateString(),
                    'months' => mt_rand(3, 6),
                    'legacy_receipt_no' => 'OLD-'.$b->code.'-'.(7000 + $i),
                ]);
            });
        }
    }

    // ------------------------------------------------------------------ helpers

    private function randomItem(): array
    {
        $catName = $this->weighted(self::CATEGORIES);
        $category = ArticleCategory::where('name', $catName)->first();
        $silver = $catName === 'SILVER';
        $type = ArticleType::where('category_id', $category->id)->inRandomOrder()->first();
        // Typical pledges: rings / earrings 1.5–4 g, chains / bangles up to ~12 g.
        $net = $silver ? mt_rand(800, 4000) / 100 : (mt_rand(1, 10) <= 7 ? mt_rand(150, 600) : mt_rand(600, 1200)) / 100;

        return [
            'category_id' => $category->id,
            'article_type_id' => $type?->id,
            'condition_id' => mt_rand(1, 4) === 1 ? ArticleCondition::inRandomOrder()->value('id') : ArticleCondition::where('name', 'Good')->value('id'),
            'karat_id' => Karat::where('code', $silver ? 'SILVER' : $this->weighted(self::KARATS))->value('id'),
            'quantity' => 1,
            'net_weight' => number_format($net, 3, '.', ''),
            'gross_weight' => number_format($net + mt_rand(5, 120) / 100, 3, '.', ''),
        ];
    }

    private function weighted(array $weights): string
    {
        $r = mt_rand(1, array_sum($weights));
        foreach ($weights as $k => $w) {
            if (($r -= $w) <= 0) {
                return (string) $k;
            }
        }

        return (string) array_key_first($weights);
    }

    /** Old-format NIC: YY + day-of-year (+500 for women) + 4 digits + V. */
    private function nic(bool $female): string
    {
        do {
            $nic = sprintf('%02d%03d%04dV', mt_rand(55, 99), mt_rand(1, 365) + ($female ? 500 : 0), mt_rand(0, 9999));
        } while (isset($this->nics[$nic]));
        $this->nics[$nic] = true;

        return $nic;
    }

    private function at(CarbonImmutable $moment): void
    {
        Carbon::setTestNow($moment);
    }

    private function as(User $user, Branch $branch): void
    {
        Auth::setUser($user);
        app(BranchContext::class)->set($branch);
    }

    private function try(string $what, callable $fn): void
    {
        try {
            DB::transaction(fn () => $fn());
            $this->count($what);
        } catch (ValidationException) {
            $this->count("{$what} (refused by rules)");   // e.g. part payment below minimum capital
        }
    }

    private function count(string $what, int $n = 1): void
    {
        if ($n > 0) {
            $this->stats[$what] = ($this->stats[$what] ?? 0) + $n;
        }
    }
}
