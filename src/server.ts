import path from "path";
import express from "express";
import cors from "cors";
import { initDb, pool, query } from "./db";

export type User = {
  id: number;
  name: string;
  username: string;
  email: string;
};

export type Product = {
  id: number;
  name: string;
  stock: number; // quantité disponible
};

export type Status = "preparing" | "shipped" | "delivered" | "cancelled";

export type Order = {
  id: number;
  userId: User["id"];
  productId: Product["id"];
  quantity: number;
  status: Status;
  createdAt: string;
};

const VALID_STATUSES: Status[] = [
  "preparing",
  "shipped",
  "delivered",
  "cancelled",
];

const app = express();
const publicPath = path.join(__dirname, "../public");

app.use(cors());
app.use(express.json());
app.use(express.static(publicPath));

// Sert explicitement public/index.html sur http://localhost:3000
app.get("/", (_req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

// ==========================================
// Routes Users
// ==========================================
app.get("/users", async (_req, res) => {
  try {
    const { rows } = await query<User>(
      "SELECT id, name, username, email FROM users ORDER BY id ASC",
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la récupération des utilisateurs" });
  }
});

app.get("/users/:id", async (req, res) => {
  try {
    const { rows } = await query<User>(
      "SELECT id, name, username, email FROM users WHERE id = $1",
      [Number(req.params.id)],
    );
    if (!rows[0]) {
      res.status(404).json({ error: "Utilisateur introuvable" });
      return;
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/users", async (req, res) => {
  const { name, username, email } = req.body as Partial<User>;
  if (!name || !username || !email) {
    res.status(400).json({ error: "Champs requis : name, username, email" });
    return;
  }
  try {
    const { rows } = await query<User>(
      "INSERT INTO users (name, username, email) VALUES ($1, $2, $3) RETURNING id, name, username, email",
      [name, username, email],
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(400).json({ error: "Impossible de créer l'utilisateur (username ou email déjà utilisé)" });
  }
});

// ==========================================
// Routes Products
// ==========================================
app.get("/products", async (_req, res) => {
  try {
    const { rows } = await query<Product>(
      "SELECT id, name, stock FROM products ORDER BY id ASC",
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la récupération des produits" });
  }
});

app.get("/products/:id", async (req, res) => {
  try {
    const { rows } = await query<Product>(
      "SELECT id, name, stock FROM products WHERE id = $1",
      [Number(req.params.id)],
    );
    if (!rows[0]) {
      res.status(404).json({ error: "Produit introuvable" });
      return;
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/products", async (req, res) => {
  const { name, stock } = req.body as Partial<Product>;
  if (!name || stock === undefined || Number(stock) < 0) {
    res.status(400).json({ error: "Champs requis : name, stock (>= 0)" });
    return;
  }
  try {
    const { rows } = await query<Product>(
      "INSERT INTO products (name, stock) VALUES ($1, $2) RETURNING id, name, stock",
      [name, Number(stock)],
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la création du produit" });
  }
});

// ==========================================
// Routes Orders (Suivi de commande)
// ==========================================
const ORDER_SELECT = `
  SELECT
    id,
    user_id AS "userId",
    product_id AS "productId",
    quantity,
    status,
    created_at AS "createdAt"
  FROM orders
`;

app.get("/orders", async (req, res) => {
  try {
    const { userId, status } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (userId) {
      params.push(Number(userId));
      conditions.push(`user_id = $${params.length}`);
    }
    if (status) {
      params.push(String(status));
      conditions.push(`status = $${params.length}`);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await query<Order>(
      `${ORDER_SELECT} ${whereClause} ORDER BY id DESC`,
      params,
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la récupération des commandes" });
  }
});

app.get("/orders/:id", async (req, res) => {
  try {
    const { rows } = await query<Order>(`${ORDER_SELECT} WHERE id = $1`, [
      Number(req.params.id),
    ]);
    if (!rows[0]) {
      res.status(404).json({ error: "Commande introuvable" });
      return;
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/orders", async (req, res) => {
  const { userId, productId, quantity } = req.body as Partial<Order>;
  if (!userId || !productId || !quantity || Number(quantity) <= 0) {
    res
      .status(400)
      .json({ error: "Champs requis : userId, productId, quantity (> 0)" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Vérifie le stock disponible
    const productRes = await client.query<Product>(
      "SELECT id, name, stock FROM products WHERE id = $1 FOR UPDATE",
      [Number(productId)],
    );
    const product = productRes.rows[0];
    if (!product) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Produit introuvable" });
      return;
    }
    if (product.stock < Number(quantity)) {
      await client.query("ROLLBACK");
      res
        .status(400)
        .json({ error: `Stock insuffisant (disponible : ${product.stock})` });
      return;
    }

    // Décrémente le stock
    await client.query(
      "UPDATE products SET stock = stock - $1 WHERE id = $2",
      [Number(quantity), Number(productId)],
    );

    // Crée la commande à l'état "preparing"
    const orderRes = await client.query<Order>(
      `INSERT INTO orders (user_id, product_id, quantity, status)
       VALUES ($1, $2, $3, 'preparing')
       RETURNING id, user_id AS "userId", product_id AS "productId", quantity, status, created_at AS "createdAt"`,
      [Number(userId), Number(productId), Number(quantity)],
    );

    await client.query("COMMIT");
    res.status(201).json(orderRes.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(400).json({ error: "Erreur lors de la création de la commande (vérifiez userId et productId)" });
  } finally {
    client.release();
  }
});

app.patch("/orders/:id/status", async (req, res) => {
  const orderId = Number(req.params.id);
  const { status } = req.body as { status?: Status };

  if (!status || !VALID_STATUSES.includes(status)) {
    res.status(400).json({
      error: `Statut invalide. Valeurs acceptées : ${VALID_STATUSES.join(", ")}`,
    });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const currentRes = await client.query<Order>(
      `${ORDER_SELECT} WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    const currentOrder = currentRes.rows[0];
    if (!currentOrder) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Commande introuvable" });
      return;
    }

    // Si on annule une commande qui n'était pas déjà annulée, on recrédite le stock
    if (status === "cancelled" && currentOrder.status !== "cancelled") {
      await client.query(
        "UPDATE products SET stock = stock + $1 WHERE id = $2",
        [currentOrder.quantity, currentOrder.productId],
      );
    }

    const updatedRes = await client.query<Order>(
      `UPDATE orders
       SET status = $1
       WHERE id = $2
       RETURNING id, user_id AS "userId", product_id AS "productId", quantity, status, created_at AS "createdAt"`,
      [status, orderId],
    );

    await client.query("COMMIT");
    res.json(updatedRes.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Erreur lors de la mise à jour du statut" });
  } finally {
    client.release();
  }
});

const PORT = Number(process.env.PORT) || 3000;

initDb()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Serveur démarré sur http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Erreur d'initialisation de la base PostgreSQL :", err);
    process.exit(1);
  });
