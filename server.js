require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Koneksi PostgreSQL (Railway inject DATABASE_URL otomatis)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Buat tabel otomatis saat server start
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sensor_log (
      id        SERIAL PRIMARY KEY,
      timestamp TIMESTAMPTZ NOT NULL,
      suhu      FLOAT NOT NULL,
      kelembaban FLOAT NOT NULL,
      relay     VARCHAR(3) NOT NULL DEFAULT 'OFF',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  console.log("Database siap!");
}
initDB();

// ── API: Terima data dari ESP32 ──
// GET /api/log?timestamp=...&suhu=...&kelembaban=...&relay=...
app.get("/api/log", async (req, res) => {
  const { timestamp, suhu, kelembaban, relay } = req.query;

  if (!timestamp || !suhu || !kelembaban) {
    return res.status(400).json({ error: "Parameter tidak lengkap" });
  }

  try {
    await pool.query(
      "INSERT INTO sensor_log (timestamp, suhu, kelembaban, relay) VALUES ($1, $2, $3, $4)",
      [timestamp, parseFloat(suhu), parseFloat(kelembaban), relay || "OFF"]
    );
    res.send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("DB Error");
  }
});

// ── API: Ambil data terbaru ──
app.get("/api/data", async (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  try {
    const result = await pool.query(
      "SELECT * FROM sensor_log ORDER BY timestamp DESC LIMIT $1",
      [limit]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: Statistik ──
app.get("/api/stats", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*)         AS total_data,
        ROUND(AVG(suhu)::numeric, 1)        AS avg_suhu,
        ROUND(MAX(suhu)::numeric, 1)        AS max_suhu,
        ROUND(MIN(suhu)::numeric, 1)        AS min_suhu,
        ROUND(AVG(kelembaban)::numeric, 1)  AS avg_kelembaban,
        COUNT(*) FILTER (WHERE relay = 'ON') AS total_relay_on
      FROM sensor_log
    `);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server jalan di port ${PORT}`));