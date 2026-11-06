import path from "path";
import express, { type Response } from "express";
import cors from "cors";
import { JsonDB, Config } from "node-json-db";

type User = { id: number; name: string; username: string; email: string };
type Product = { id: number; name: string; stock: number };
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
const db = new JsonDB(new Config("data/db", true, true, "/"));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// --- SSE côté serveur ---
const clients = new Set<Response>();

app.get("/orders/stream", (_req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  clients.add(res);
  res.on("close", () => clients.delete(res));
});

let id = 0;
function broadcast(event: string, data: unknown) {
  const msg = `id: ${++id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

function scheduleDelivery(orderId: number) {
  setTimeout(async () => {
    const orders = (await db.getData("/orders")) as Order[];
    const order = orders.find((o) => o.id === orderId);
    if (order && order.status === "shipped") {
      order.status = "delivered";
      await db.push("/orders", orders);
      broadcast("order-updated", order);
    }
  }, 20_000);
}

async function initDb() {
  try {
    const orders = (await db.getData("/orders")) as Order[];
    orders
      .filter((o) => o.status === "shipped")
      .forEach((o) => scheduleDelivery(o.id));
  } catch {
    await db.push("/users", [
      { id: 1, name: "Alice", username: "alice", email: "alice@gmail.com" },
      { id: 2, name: "Bob", username: "bob", email: "bob@gmail.com" },
    ] satisfies User[]);
    await db.push("/products", [
      { id: 1, name: "Clavier", stock: 10 },
      { id: 2, name: "Souris", stock: 15 },
      { id: 3, name: "Ecran", stock: 5 },
    ] satisfies Product[]);
    await db.push("/orders", [] satisfies Order[]);
  }
}

// --- Routes REST ---
app.get("/users", async (_req, res) => {
  res.json((await db.getData("/users")) as User[]);
});

app.get("/users/:id", async (req, res) => {
  const users = (await db.getData("/users")) as User[];
  const user = users.find((u) => u.id === Number(req.params.id));
  if (!user) {
    res.status(404).json({ error: "Utilisateur introuvable" });
    return;
  }
  res.json(user);
});

app.get("/products", async (_req, res) => {
  res.json((await db.getData("/products")) as Product[]);
});

app.get("/products/:id", async (req, res) => {
  const products = (await db.getData("/products")) as Product[];
  const product = products.find((p) => p.id === Number(req.params.id));
  if (!product) {
    res.status(404).json({ error: "Produit introuvable" });
    return;
  }
  res.json(product);
});

app.get("/orders", async (req, res) => {
  const orders = (await db.getData("/orders")) as Order[];
  if (req.query.userId) {
    res.json(orders.filter((o) => o.userId === Number(req.query.userId)));
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

app.post("/orders", async (req, res) => {
  const { userId, productId, quantity } = req.body as Partial<Order>;
  if (
    typeof userId !== "number" ||
    typeof productId !== "number" ||
    typeof quantity !== "number" ||
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    res.status(400).json({ error: "Champs invalides" });
    return;
  }

  const users = (await db.getData("/users")) as User[];
  const products = (await db.getData("/products")) as Product[];
  const orders = (await db.getData("/orders")) as Order[];

  const user = users.find((u) => u.id === userId);
  const product = products.find((p) => p.id === productId);
  if (!user || !product || product.stock < quantity) {
    res
      .status(400)
      .json({ error: "Client/produit invalide ou stock insuffisant" });
    return;
  }

  product.stock -= quantity;
  await db.push("/products", products);

  const newOrder: Order = {
    id: orders.length > 0 ? Math.max(...orders.map((o) => o.id)) + 1 : 1,
    userId,
    productId,
    quantity,
    status: "preparing",
    createdAt: new Date().toISOString(),
  };

  orders.push(newOrder);
  await db.push("/orders", orders);
  broadcast("order-added", newOrder);
  res.status(201).json(newOrder);
});

app.patch("/orders/:id/status", async (req, res) => {
  const orderId = Number(req.params.id);
  const { status } = req.body as { status?: Status };
  const orders = (await db.getData("/orders")) as Order[];
  const order = orders.find((o) => o.id === orderId);

  if (!order) {
    res.status(404).json({ error: "Commande introuvable" });
    return;
  }

  if (status === "cancelled") {
    if (order.status !== "preparing") {
      res.status(400).json({ error: "Annulation impossible" });
      return;
    }
    order.status = "cancelled";
    const products = (await db.getData("/products")) as Product[];
    const product = products.find((p) => p.id === order.productId);
    if (product) {
      product.stock += order.quantity;
      await db.push("/products", products);
    }
  } else {
    const next: Partial<Record<Status, Status>> = {
      preparing: "shipped",
      shipped: "delivered",
    };
    if (!status || next[order.status] !== status) {
      res.status(400).json({ error: "Transition invalide" });
      return;
    }
    order.status = status;
    if (status === "shipped") scheduleDelivery(order.id);
  }

  await db.push("/orders", orders);
  broadcast("order-updated", order);
  res.json(order);
});

initDb().then(() => {
  app.listen(PORT, "0.0.0.0", () => console.log(`http://localhost:${PORT}`));
});
