import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import * as db from "./db";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Route d'accueil
app.get("/", (_req, res) => {
  res.json({ message: "API REST Express (TypeScript + PostgreSQL) opérationnelle" });
});

// Route de vérification de l'état de l'API et de la connexion PostgreSQL
app.get("/health", async (_req, res) => {
  try {
    const result = await db.query("SELECT NOW() AS current_time");
    res.json({
      status: "ok",
      database: "connected",
      timestamp: result.rows[0]?.current_time,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      status: "error",
      database: "disconnected",
      error: message,
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
