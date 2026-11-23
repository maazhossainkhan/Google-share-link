<?php
$config = require __DIR__ . '/config.php';
$code = isset($_GET['code']) ? trim($_GET['code']) : '';

if (!preg_match('/^[A-Za-z0-9_-]{5,12}$/', $code)) {
    http_response_code(404);
    exit('Canvau link not found.');
}

if (!function_exists('curl_init')) {
    http_response_code(503);
    exit('Canvau redirect requires the PHP cURL extension.');
}

$endpoint = rtrim($config['supabase_url'], '/') . '/functions/v1/canvau-redirect?code=' . rawurlencode($code);
$location = null;
$curl = curl_init($endpoint);
curl_setopt_array($curl, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT => 6,
    CURLOPT_TIMEOUT => 12,
    CURLOPT_HTTPHEADER => [
        'apikey: ' . $config['publishable_key'],
        'Authorization: Bearer ' . $config['publishable_key'],
        'Accept: text/html',
    ],
    CURLOPT_HEADERFUNCTION => function ($handle, $header) use (&$location) {
        if (stripos($header, 'Location:') === 0) {
            $location = trim(substr($header, 9));
        }
        return strlen($header);
    },
]);
$body = curl_exec($curl);
$status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
$error = curl_error($curl);
curl_close($curl);

if (($status === 302 || $status === 301) && $location && filter_var($location, FILTER_VALIDATE_URL)) {
    $scheme = strtolower((string) parse_url($location, PHP_URL_SCHEME));
    if ($scheme === 'http' || $scheme === 'https') {
        header('Cache-Control: no-store');
        header('Referrer-Policy: no-referrer');
        header('Location: ' . $location, true, 302);
        exit;
    }
}

http_response_code($status >= 400 ? $status : 503);
header('Content-Type: text/plain; charset=utf-8');
if ($status === 404) {
    echo 'This Canvau short link was not found.';
} elseif ($status === 410) {
    echo 'This Canvau short link has expired or been disabled.';
} else {
    echo 'Canvau could not redirect this link right now. Please try again later.';
    if ($error) error_log('Canvau cURL: ' . $error);
}
