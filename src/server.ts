import path from "path";
import express from "express";
import cors from "cors";

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
const publicPath = path.join(__dirname, "../public");

app.use(cors());
app.use(express.json());
app.use(express.static(publicPath));

// Sert explicitement public/index.html sur la route racine
app.get("/", (_req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

const PORT = Number(process.env.PORT) || 3000;

export const server = app.listen(PORT, "0.0.0.0", () =>
  console.log(`http://localhost:${PORT}`),
);
