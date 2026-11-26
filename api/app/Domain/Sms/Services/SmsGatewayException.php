<?php

namespace App\Domain\Sms\Services;

/** Sending failed. The message is safe to show staff (no credentials or URLs). */
class SmsGatewayException extends \RuntimeException {}
