<?php

namespace App\Domain\Sms\Services;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/** The Notify.lk HTTP API. Credentials come from .env and never leave the server. */
class NotifyLkClient
{
    public function configured(): bool
    {
        return $this->config('url') && $this->config('user_id') && $this->config('api_key') && $this->config('sender_id');
    }

    public function senderId(): ?string
    {
        return $this->config('sender_id') ?: null;
    }

    /** 0771234567 / +94771234567 → 94771234567; null when it is not a Sri Lankan mobile. */
    public static function internationalNumber(?string $phone): ?string
    {
        $digits = preg_replace('/[\s()+-]+/', '', (string) $phone);

        return preg_match('/\A(?:0|94)?(7[0-9]{8})\z/', $digits, $m) ? '94'.$m[1] : null;
    }

    /** @throws SmsGatewayException */
    public function send(string $phone, string $message): void
    {
        $this->assertConfigured();
        $to = self::internationalNumber($phone) ?? throw new SmsGatewayException('Not a valid mobile number.');

        $body = [
            'user_id' => $this->config('user_id'),
            'api_key' => $this->config('api_key'),
            'sender_id' => $this->config('sender_id'),
            'to' => $to,
            'message' => $message,
        ];
        if (SmsText::isUnicode($message)) {
            $body['type'] = 'unicode';
        }

        // POST keeps the API key out of web server access logs.
        $this->call(fn () => $this->http()->asForm()->post($this->config('url'), $body));
    }

    /**
     * @return array{active: bool, balance: ?string}
     *
     * @throws SmsGatewayException
     */
    public function account(): array
    {
        $this->assertConfigured();
        $url = preg_replace('#/send/?$#', '/status', $this->config('url'));

        $data = $this->call(fn () => $this->http()->get($url, [
            'user_id' => $this->config('user_id'),
            'api_key' => $this->config('api_key'),
        ]))->json('data');

        return [
            'active' => (bool) ($data['active'] ?? false),
            'balance' => isset($data['acc_balance']) ? (string) $data['acc_balance'] : null,
        ];
    }

    /** @param  callable(): Response  $request */
    private function call(callable $request): Response
    {
        try {
            $response = $request();
        } catch (ConnectionException $e) {
            // The original message contains the request URL, so only keep the cURL error number.
            $code = preg_match('/cURL error (\d+)/', $e->getMessage(), $m) ? " (cURL error {$m[1]})" : '';

            throw new SmsGatewayException("Could not reach Notify.lk{$code}.");
        }

        if (! $response->successful() || $response->json('status') !== 'success') {
            $detail = $response->json('errors') ?? $response->json('message') ?? $response->json('data');
            $detail = is_array($detail) ? json_encode($detail) : (string) $detail;

            throw new SmsGatewayException(mb_substr(trim("Notify.lk refused the request (HTTP {$response->status()}). ".$this->redact($detail)), 0, 500));
        }

        return $response;
    }

    private function http(): PendingRequest
    {
        $request = Http::acceptJson()->connectTimeout(5)->timeout(10);
        $bundle = $this->config('ca_bundle');

        // A bundle path from another server (e.g. Linux hosting) is ignored where it does not exist.
        return $bundle && is_file($bundle) ? $request->withOptions(['verify' => $bundle]) : $request;
    }

    private function redact(string $text): string
    {
        return str_replace(array_filter([$this->config('api_key'), $this->config('user_id')]), '***', $text);
    }

    private function assertConfigured(): void
    {
        if (! $this->configured()) {
            throw new SmsGatewayException('Notify.lk is not set up. Fill the NOTIFYLK_ values in the server .env file.');
        }
    }

    private function config(string $key): string
    {
        return (string) config("services.notifylk.{$key}");
    }
}
