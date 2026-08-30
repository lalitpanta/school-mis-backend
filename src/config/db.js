const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const useSsl = String(process.env.DB_SSL || "").toLowerCase() === "true";
const rejectUnauthorized =
  String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").toLowerCase() !==
  "false";

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: useSsl ? { rejectUnauthorized } : false,
  min: parseInt(process.env.DB_POOL_MIN, 10),
  max: parseInt(process.env.DB_POOL_MAX, 10),
  idleTimeoutMillis: 30000, // close idle clients after 30s
  connectionTimeoutMillis: 2000, // fail fast if DB unreachable
});

// Test connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error(" Database connection failed:", err.message);
    process.exit(1);
  }
  release();
  console.log("PostgreSQL connected successfully");
});

module.exports = pool;
