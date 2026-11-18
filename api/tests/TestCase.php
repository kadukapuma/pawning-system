<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use RuntimeException;

abstract class TestCase extends BaseTestCase
{
    /** Seed reference data (roles, branches, masters, accounts) after each refresh. */
    protected bool $seed = true;

    protected function setUp(): void
    {
        parent::setUp();

        // Safety net: RefreshDatabase wipes the database, so never run against a real one.
        $database = (string) config('database.connections.'.config('database.default').'.database');
        if (! str_ends_with($database, '_testing')) {
            throw new RuntimeException("Refusing to run tests against database [{$database}]. Use a *_testing database.");
        }
    }
}
