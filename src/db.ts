import { Pool, type QueryResult, type QueryResultRow } from "pg";
import dotenv from "dotenv";

dotenv.config();

export const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.POSTGRES_USER || "postgres",
  password: process.env.POSTGRES_PASSWORD || "postgres",
  database: process.env.POSTGRES_DB || "tp_note",
});

export const query = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> => pool.query<T>(text, params);

export async function initDb(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      status TEXT NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing', 'shipped', 'delivered', 'cancelled')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Données de démonstration si la base est vide
  const { rows: existingUsers } = await query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM users",
  );
  if (Number(existingUsers[0]?.count) === 0) {
    await query(`
      INSERT INTO users (name, username, email) VALUES
        ('Alice Martin', 'alice', 'alice@example.com'),
        ('Bob Dupont', 'bob', 'bob@example.com');

      INSERT INTO products (name, stock) VALUES
        ('Clavier mécanique', 15),
        ('Souris sans fil', 30),
        ('Écran 27 pouces', 8);

      INSERT INTO orders (user_id, product_id, quantity, status) VALUES
        (1, 1, 1, 'preparing'),
        (2, 2, 2, 'shipped');
    `);
  }
}
