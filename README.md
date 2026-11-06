# tp-web-temps-reel

# Lien du depot github

https://github.com/WilsonSan5/tp-web-temps-reel

# Pour lancer

```
docker compose up -d --build
```

# Description de l'API

L'application est une API REST pour la gestion des commandes et des produits, utilisant un flux d'événements pour la mise à jour en temps réel des commandes.

## Endpoints

### Produits

- `GET /products`: Récupère tous les produits.
- `GET /products/:id`: Récupère un produit par son ID.

### Commandes

- `GET /orders`: Récupère toutes les commandes (ou filtrées par `?userId=1`).
- `GET /orders/:id`: Récupère une commande par son ID.
- `POST /orders`: Crée une nouvelle commande (`{ userId, productId, quantity }`).
- `PATCH /orders/:id/status`: Met à jour le statut d'une commande (`preparing` -> `shipped` -> `delivered`, ou `cancelled` si en préparation).

### Utilisateurs

- `GET /users`: Récupère tous les utilisateurs.
- `GET /users/:id`: Récupère un utilisateur par son ID.

### Flux d'événements (SSE)

- `GET /orders/stream`: Flux d'événements SSE (`order-added`, `order-updated`) pour la mise à jour en temps réel des commandes.

## Structure

- `src/server.ts` : Serveur Express 5 en TypeScript (routes REST, règles métier F1 à F5 et flux SSE).
- `public/index.html` : Interface client de suivi de commandes en temps réel (HTML/JS natif + `EventSource`).
- `data/db.json` : Persistance des utilisateurs, produits et commandes avec `node-json-db`.
- `Dockerfile` & `docker-compose.yml` : Conteneurisation de l'application sur le port `3000`.

## Exemples de requêtes (cURL)

```bash
# Créer une commande (F2)
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{"userId": 1, "productId": 1, "quantity": 1}'

# Expédier la commande #1 (F3 + livraison automatique après 20s F5)
curl -X PATCH http://localhost:3000/orders/1/status \
  -H "Content-Type: application/json" \
  -d '{"status": "shipped"}'

# Annuler une commande en préparation (F4)
curl -X PATCH http://localhost:3000/orders/1/status \
  -H "Content-Type: application/json" \
  -d '{"status": "cancelled"}'
```
