require("dotenv").config({
  path: require("path").resolve(__dirname, "..", "..", ".env"),
});
const express = require("express");
const cors = require("cors");
const path = require("path");
const { initializeCentralDatabase } = require("../config/initCentralDb");
const { loadTenantConnections } = require("../config/tenantDb");
const app = express();
const StartServer = require("./startServer");
const routes = require("../routing/index");

// â”€â”€ CORS Middleware â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const allowedOrigins = [
  "https://mis-frontend-g6g3.onrender.com",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:3000",
  "http://localhost:5000",
  "http://localhost:5001",
  ...(process.env.FRONTEND_URL || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean),
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ""))) {
        return callback(null, true);
      }
      return callback(new Error("CORS origin is not allowed"));
    },
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Tenant-ID"],
    credentials: true,
    optionsSuccessStatus: 204,
  }),
);

// â”€â”€ Other Middleware â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Increase request body size limits to accomodate larger payloads
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(
  "/uploads",
  express.static(path.join(__dirname, "..", "..", "uploads")),
);

// â”€â”€ Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use("/v1", routes); // Registering v1 routes under /v1 path

// â”€â”€ Error Handling â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

// â”€â”€ 404 Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Run DB migrations automatically on startup unless disabled
const { exec } = require("child_process");
const PORT = Number(process.env.PORT) || 5000;
const migrationsCwd = path.resolve(__dirname, "..", "..");

const startApp = () => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`
â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
â•‘  ðŸš€ Multi-Tenant School Management System  â•‘
â•‘     Server running on port ${PORT}       â•‘
â•‘     Environment: ${(process.env.NODE_ENV || "development").padEnd(18)}â•‘
â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  `);
  });
};

const enableAutoMigrate =
  process.env.ENABLE_AUTO_MIGRATE &&
  process.env.ENABLE_AUTO_MIGRATE.toLowerCase() === "true";

async function initApp() {
  try {
    await initializeCentralDatabase();
    await loadTenantConnections();
  } catch (err) {
    console.error("Central database initialization failed:", err.message);
  }

  if (!enableAutoMigrate) {
    console.log(
      "Auto-migration is disabled by default. Set ENABLE_AUTO_MIGRATE=true to enable it.",
    );
    startApp();
    return;
  }

  console.log("Running DB migrations before starting server...");
  exec("npx db-migrate up --env " + (process.env.NODE_ENV === "production" ? "production" : "dev"), { cwd: migrationsCwd }, (err, stdout, stderr) => {
    if (err) {
      console.error("Migration error:", err);
      console.error(stderr);
      // still start the app even if migrations fail, to allow manual intervention
      startApp();
      return;
    }
    console.log(stdout);
    console.log("Migrations completed. Starting server.");
    startApp();
  });
}

initApp();

