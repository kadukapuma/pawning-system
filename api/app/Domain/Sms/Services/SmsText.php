<?php

namespace App\Domain\Sms\Services;

/** How a message is encoded and how many SMS parts it is billed as. */
final class SmsText
{
    /** GSM 03.38 basic characters (one unit each). */
    private const GSM = "@£\$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

    /** Extension characters (two units each). */
    private const GSM_EXTENDED = "^{}\\[~]|€\f";

    public static function isUnicode(string $text): bool
    {
        foreach (mb_str_split($text) as $char) {
            if (mb_strpos(self::GSM, $char) === false && mb_strpos(self::GSM_EXTENDED, $char) === false) {
                return true;
            }
        }

        return false;
    }

    /** @return array{unicode: bool, length: int, segments: int} */
    public static function measure(string $text): array
    {
        $unicode = self::isUnicode($text);

        if ($unicode) {
            // UTF-16 code units: characters outside the BMP (emoji) count twice.
            $length = intdiv(strlen(mb_convert_encoding($text, 'UTF-16BE', 'UTF-8')), 2);
            [$single, $multi] = [70, 67];
        } else {
            $length = 0;
            foreach (mb_str_split($text) as $char) {
                $length += mb_strpos(self::GSM_EXTENDED, $char) === false ? 1 : 2;
            }
            [$single, $multi] = [160, 153];
        }

        return [
            'unicode' => $unicode,
            'length' => $length,
            'segments' => $length <= $single ? 1 : (int) ceil($length / $multi),
        ];
    }
}
