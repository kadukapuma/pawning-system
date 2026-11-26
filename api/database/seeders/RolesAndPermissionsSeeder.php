<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Spatie\Permission\Models\Permission;
use Spatie\Permission\Models\Role;
use Spatie\Permission\PermissionRegistrar;

class RolesAndPermissionsSeeder extends Seeder
{
    /** Every permission in the system, grouped by module. */
    public const PERMISSIONS = [
        // Customers
        'customers.view', 'customers.manage', 'customers.set_limits',
        // Pawning
        'pawn.view', 'pawn.create', 'pawn.create_opening', 'pawn.cancel', 'pawn.part_payment',
        'pawn.renew', 'pawn.redeem', 'pawn.block', 'pawn.discount', 'pawn.stock_check',
        // Arrears & forfeit
        'arrears.view', 'arrears.issue_letters', 'forfeit.manage_promises', 'forfeit.queue',
        'forfeit.execute', 'forfeit.transfer_stock',
        // Inventory & sales
        'inventory.view', 'sales.create', 'sales.void',
        // Accounting
        'accounting.view', 'vouchers.create', 'vouchers.approve', 'day_closing.close',
        'journals.manage', 'accounts.manage',
        // Banking
        'banking.view', 'banking.manage', 'banking.reconcile',
        // Reports
        'reports.view', 'reports.all_branches',
        // SMS
        'sms.view', 'sms.send', 'sms.bulk', 'sms.settings',
        // Masters & admin
        'masters.manage', 'schemes.manage', 'karat_rates.manage',
        'users.manage', 'branches.manage', 'audit.view',
    ];

    public function run(): void
    {
        app(PermissionRegistrar::class)->forgetCachedPermissions();

        foreach (self::PERMISSIONS as $name) {
            Permission::findOrCreate($name, 'web');
        }

        // DatabaseSeeder runs WithoutModelEvents, so spatie's auto cache-flush doesn't fire.
        app(PermissionRegistrar::class)->forgetCachedPermissions();

        $all = self::PERMISSIONS;
        $views = array_values(array_filter($all, fn ($p) => str_ends_with($p, '.view')));

        $roles = [
            // super_admin also bypasses every check via Gate::before (phase 3).
            'super_admin' => $all,
            'head_office' => array_values(array_diff($all, ['users.manage', 'branches.manage'])),
            'branch_manager' => [
                'customers.view', 'customers.manage', 'customers.set_limits',
                'pawn.view', 'pawn.create', 'pawn.create_opening', 'pawn.cancel', 'pawn.part_payment',
                'pawn.renew', 'pawn.redeem', 'pawn.block', 'pawn.discount', 'pawn.stock_check',
                'arrears.view', 'arrears.issue_letters', 'forfeit.manage_promises', 'forfeit.queue',
                'forfeit.execute', 'forfeit.transfer_stock',
                'inventory.view', 'sales.create', 'sales.void',
                'accounting.view', 'vouchers.create', 'vouchers.approve', 'day_closing.close',
                'banking.view', 'banking.manage', 'reports.view',
                'sms.view', 'sms.send', 'sms.bulk',
            ],
            'cashier' => [
                'customers.view', 'customers.manage',
                'pawn.view', 'pawn.create', 'pawn.part_payment', 'pawn.renew', 'pawn.redeem',
                'arrears.view', 'arrears.issue_letters', 'forfeit.manage_promises',
                'inventory.view', 'sales.create', 'vouchers.create', 'reports.view',
                'sms.view', 'sms.send',
            ],
            'valuer' => [
                'customers.view', 'pawn.view', 'pawn.create', 'pawn.stock_check', 'inventory.view',
            ],
            'accountant' => [
                'customers.view', 'pawn.view', 'inventory.view',
                'accounting.view', 'vouchers.create', 'vouchers.approve', 'day_closing.close',
                'journals.manage', 'accounts.manage',
                'banking.view', 'banking.manage', 'banking.reconcile',
                'reports.view', 'reports.all_branches',
            ],
            'auditor' => array_values(array_unique(array_merge($views, ['reports.all_branches', 'audit.view']))),
        ];

        foreach ($roles as $roleName => $permissions) {
            Role::findOrCreate($roleName, 'web')->syncPermissions($permissions);
        }
    }
}
