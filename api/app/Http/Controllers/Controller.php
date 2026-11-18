<?php

namespace App\Http\Controllers;

use Illuminate\Foundation\Auth\Access\AuthorizesRequests;

abstract class Controller
{
    // $this->authorize('permission.name') — spatie registers every permission as a gate.
    use AuthorizesRequests;
}
