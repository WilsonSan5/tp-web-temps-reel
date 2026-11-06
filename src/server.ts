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
  stock: number; // quantité disponible
};
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

async function initDb(): Promise<void> {
  try {
    await db.getData("/users");
  } catch {
    const initialUsers: User[] = [
      { id: 1, name: "Alice", username: "alice", email: "alice@gmail.com" },
      { id: 2, name: "Bob", username: "bob", email: "bob@gmail.com" },
    ];
    const initialProducts: Product[] = [
      { id: 1, name: "Clavier", stock: 10 },
      { id: 2, name: "Souris", stock: 15 },
      { id: 3, name: "Ecran", stock: 5 },
    ];
    const initialOrders: Order[] = [];

    await db.push("/users", initialUsers);
    await db.push("/products", initialProducts);
    await db.push("/orders", initialOrders);
  }
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// --- Routes de lecture ---
app.get("/users", async (_req, res) => {
  const users = (await db.getData("/users")) as User[];
  res.json(users);
});

app.get("/products", async (_req, res) => {
  const products = (await db.getData("/products")) as Product[];
  res.json(products);
});

app.get("/orders", async (req, res) => {
  const orders = (await db.getData("/orders")) as Order[];
  if (req.query.userId) {
    const userId = Number(req.query.userId);
    res.json(orders.filter((o) => o.userId === userId));
    return;
  }
  res.json(orders);
});

app.get("/orders/:id", async (req, res) => {
  const orders = (await db.getData("/orders")) as Order[];
  const order = orders.find((o) => o.id === Number(req.params.id));
  if (!order) {
    res.status(404).json({ error: "Commande introuvable" });
    return;
  }
  res.json(order);
});

// --- F2. Créer une commande ---
app.post("/orders", async (req, res) => {
  const { userId, productId, quantity } = req.body as Partial<Order>;

  if (
    typeof userId !== "number" ||
    typeof productId !== "number" ||
    typeof quantity !== "number" ||
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    res.status(400).json({ error: "Champs manquants ou invalides" });
    return;
  }

  const users = (await db.getData("/users")) as User[];
  const products = (await db.getData("/products")) as Product[];
  const orders = (await db.getData("/orders")) as Order[];

  const user = users.find((u) => u.id === userId);
  const product = products.find((p) => p.id === productId);

  if (!user || !product) {
    res.status(404).json({ error: "Client ou produit inexistant" });
    return;
  }

  if (product.stock < quantity) {
    res.status(400).json({ error: "Stock insuffisant" });
    return;
  }

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

// --- F3, F4, F5. Faire évoluer le statut d'une commande ---
app.patch("/orders/:id/status", async (req, res) => {
  const orderId = Number(req.params.id);
  const { status } = req.body as { status?: Status };

  const orders = (await db.getData("/orders")) as Order[];
  const order = orders.find((o) => o.id === orderId);

  if (!order) {
    res.status(404).json({ error: "Commande introuvable" });
    return;
  }

  // F4. Annulation uniquement en préparation + remise en stock
  if (status === "cancelled") {
    if (order.status !== "preparing") {
      res
        .status(400)
        .json({ error: "Seule une commande en préparation peut être annulée" });
      return;
    }

    order.status = "cancelled";
    const products = (await db.getData("/products")) as Product[];
    const product = products.find((p) => p.id === order.productId);
    if (product) {
      product.stock += order.quantity;
      await db.push("/products", products);
    }

    await db.push("/orders", orders);
    res.json(order);
    return;
  }

  // F3. Avance d'un statut à la fois : preparing -> shipped -> delivered
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

  // F5. 20 secondes après son expédition, passe seule au statut livrée
  if (status === "shipped") {
    setTimeout(async () => {
      const currentOrders = (await db.getData("/orders")) as Order[];
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
