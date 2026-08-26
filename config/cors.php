<?php

/*
 * L'application de bureau charge son interface depuis le disque (file://) :
 * ses appels a l'API sont donc, du point de vue du navigateur embarque, des
 * requetes d'origine differente, et l'origine annoncee est « null ».
 *
 * L'authentification se fait par jeton porteur et non par cookie de session :
 * aucun identifiant n'est envoye automatiquement par le navigateur, ce qui
 * rend l'ouverture ci-dessous sans consequence. `supports_credentials` reste
 * a false, ce qui interdit justement l'envoi automatique de cookies.
 */

return [
    'paths' => ['api/*'],
    'allowed_methods' => ['*'],
    'allowed_origins' => ['*'],
    'allowed_origins_patterns' => [],
    'allowed_headers' => ['*'],
    'exposed_headers' => [],
    'max_age' => 3600,
    'supports_credentials' => false,
];
