require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Koneksi PostgreSQL (Railway menginjeksi DATABASE_URL otomatis)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Wajib untuk koneksi aman ke cloud Railway
});

// ── 1. INISIALISASI DATABASE ──
// Otomatis membuat tabel dengan kolom sensor tanah dan format status relay baru
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sensor_log (
        id         SERIAL PRIMARY KEY,
        timestamp  TIMESTAMPTZ NOT NULL,
        suhu       FLOAT NOT NULL,
        kelembaban FLOAT NOT NULL,
        tanah      FLOAT NOT NULL DEFAULT 0,
        relay      VARCHAR(30) NOT NULL DEFAULT 'R1:OFF|R2:OFF', 
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log("Database & Tabel siap! Kolom 'tanah' dan 'relay (varchars)' aktif.");
  } catch (err) {
    console.error("Gagal menginisialisasi database:", err.message);
  }
}
initDB();

// ── 2. API: TERIMA DATA DARI ESP32 ──
// Jalur akses ESP32 mengirim data sensor lewat metode HTTP GET Query String
// Contoh: /api/log?timestamp=...&suhu=28.5&kelembaban=70.2&tanah=45.0&relay=R1:OFF|R2:ON
app.get("/api/log", async (req, res) => {
  const { timestamp, suhu, kelembaban, tanah, relay } = req.query;

  // Validasi parameter wajib dari ESP32
  if (!timestamp || !suhu || !kelembaban || !tanah) {
    return res.status(400).json({ 
      error: "Parameter tidak lengkap. Data 'timestamp', 'suhu', 'kelembaban', dan 'tanah' wajib diisi." 
    });
  }

  try {
    await pool.query(
      `INSERT INTO sensor_log (timestamp, suhu, kelembaban, tanah, relay) 
       VALUES ($1, $2, $3, $4, $5)`,
      [
        timestamp, 
        parseFloat(suhu), 
        parseFloat(kelembaban), 
        parseFloat(tanah), 
        relay || "R1:OFF|R2:OFF"
      ]
    );
    res.send("OK");
  } catch (err) {
    console.error("Gagal menyimpan log data ke PostgreSQL:", err.message);
    res.status(500).send("DB Error");
  }
});

// ── 3. API: AMBIL DATA TERBARU ──
// Digunakan oleh frontend untuk menampilkan visualisasi grafik atau tabel log data terbaru
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

// ── 4. API: STATISTIK ──
// Menyediakan kalkulasi metrik ringkas untuk dashboard monitoring perkebunan cabai Anda
app.get("/api/stats", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*)                                     AS total_data,
        ROUND(AVG(suhu)::numeric, 1)                 AS avg_suhu,
        ROUND(MAX(suhu)::numeric, 1)                 AS max_suhu,
        ROUND(MIN(suhu)::numeric, 1)                 AS min_suhu,
        ROUND(AVG(kelembaban)::numeric, 1)           AS avg_kelembaban,
        ROUND(AVG(tanah)::numeric, 1)                AS avg_tanah,
        ROUND(MAX(tanah)::numeric, 1)                AS max_tanah,
        ROUND(MIN(tanah)::numeric, 1)                AS min_tanah,
        COUNT(*) FILTER (WHERE relay LIKE '%R1:ON%') AS total_siram_jadwal,
        COUNT(*) FILTER (WHERE relay LIKE '%R2:ON%') AS total_siram_otomatis
      FROM sensor_log
    `);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 5. MENJALANKAN SERVER ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server Express berjalan lancar di port ${PORT}`));