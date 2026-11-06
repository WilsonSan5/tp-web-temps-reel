import path from "path";
import express from "express";
import cors from "cors";
import { JsonDB, Config } from "node-json-db";

type User = {
  id: number;
  name: string;
  username: string;
  email: string;
};
type Product = {
  id: number;
  name: string;
  stock: number;
};
// quantité disponible
type Status = "preparing" | "shipped" | "delivered" | "cancelled";
type Order = {
  id: number;
  userId: User["id"];
  productId: Product["id"];
  quantity: number;
  status: Status;
  createdAt: string;
};

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

const db = new JsonDB(new Config("data/db", true, true, "/"));

async function initDb() {
  try {
    await db.getData("/users");
  } catch {
    await db.push("/users", [
      { id: 1, name: "Alice", username: "alice", email: "alice@gmail.com" },
      { id: 2, name: "Bob", username: "bob", email: "bob@gmail.com" },
    ]);
    await db.push("/products", [
      { id: 1, name: "Clavier", stock: 10 },
      { id: 2, name: "Souris", stock: 15 },
      { id: 3, name: "Ecran", stock: 5 },
    ]);
    await db.push("/orders", []);
  }
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// --- Routes de lecture ---
app.get("/users", async (_req, res) => {
  const users = await db.getData("/users");
  res.json(users);
});

app.get("/products", async (_req, res) => {
  const products = await db.getData("/products");
  res.json(products);
});

app.get("/orders", async (req, res) => {
  const orders: Order[] = await db.getData("/orders");
  if (req.query.userId) {
    const userId = Number(req.query.userId);
    res.json(orders.filter((o) => o.userId === userId));
    return;
  }
  res.json(orders);
});

app.get("/orders/:id", async (req, res) => {
  const orders: Order[] = await db.getData("/orders");
  const order = orders.find((o) => o.id === Number(req.params.id));
  if (!order) {
    res.status(404).json({ error: "Commande introuvable" });
    return;
  }
  res.json(order);
});

// --- F2. Créer une commande ---
app.post("/orders", async (req, res) => {
  const { userId, productId, quantity } = req.body;

  if (
    !userId ||
    !productId ||
    !quantity ||
    typeof quantity !== "number" ||
    quantity <= 0
  ) {
    res.status(400).json({ error: "Champs manquants ou invalides" });
    return;
  }

  const users: User[] = await db.getData("/users");
  const products: Product[] = await db.getData("/products");
  const orders: Order[] = await db.getData("/orders");

  const user = users.find((u) => u.id === Number(userId));
  const product = products.find((p) => p.id === Number(productId));

  if (!user || !product) {
    res.status(404).json({ error: "Client ou produit inexistant" });
    return;
  }

  if (product.stock < quantity) {
    res.status(400).json({ error: "Stock insuffisant" });
    return;
  }

  // Diminue le stock du produit
  product.stock -= quantity;
  await db.push("/products", products);

  const newOrder: Order = {
    id: orders.length > 0 ? Math.max(...orders.map((o) => o.id)) + 1 : 1,
    userId: user.id,
    productId: product.id,
    quantity,
    status: "preparing",
    createdAt: new Date().toISOString(),
  };

  await db.push("/orders[]", newOrder);
  res.status(201).json(newOrder);
});

app.patch("/orders/:id/status", async (req, res) => {
  const orderId = Number(req.params.id);
  const { status } = req.body as { status?: Status };

  const orders: Order[] = await db.getData("/orders");
  const order = orders.find((o) => o.id === orderId);

  if (!order) {
    res.status(404).json({ error: "Commande introuvable" });
    return;
  }

  if (status === "cancelled") {
    if (order.status !== "preparing") {
      res
        .status(400)
        .json({ error: "Seule une commande en préparation peut être annulée" });
      return;
    }

    order.status = "cancelled";
    const products: Product[] = await db.getData("/products");
    const product = products.find((p) => p.id === order.productId);
    if (product) {
      product.stock += order.quantity;
      await db.push("/products", products);
    }

    await db.push("/orders", orders);
    res.json(order);
    return;
  }

  const nextStatus: Partial<Record<Status, Status>> = {
    preparing: "shipped",
    shipped: "delivered",
  };

  if (!status || nextStatus[order.status] !== status) {
    res.status(400).json({ error: "Transition de statut invalide" });
    return;
  }

  order.status = status;
  await db.push("/orders", orders);

  if (status === "shipped") {
    setTimeout(async () => {
      const currentOrders: Order[] = await db.getData("/orders");
      const target = currentOrders.find((o) => o.id === orderId);
      if (target && target.status === "shipped") {
        target.status = "delivered";
        await db.push("/orders", currentOrders);
      }
    }, 20_000);
  }

  res.json(order);
});

initDb().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`http://localhost:${PORT}`);
  });
});
