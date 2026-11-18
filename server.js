import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// ------------------------------------------------------------
// Basic settings
// ------------------------------------------------------------

app.disable("x-powered-by");

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ------------------------------------------------------------
// CORS
// ------------------------------------------------------------

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

// ------------------------------------------------------------
// Frontend
// ------------------------------------------------------------

const publicPath = path.join(__dirname, "public");

app.use(express.static(publicPath));

// ------------------------------------------------------------
// Health checks
// ------------------------------------------------------------

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "zenith-proxy-backend",
    uptime: process.uptime()
  });
});

app.get("/healthz", (req, res) => {
  res.status(200).send("OK");
});

// ------------------------------------------------------------
// API status
// ------------------------------------------------------------

app.get("/api/status", (req, res) => {
  res.status(200).json({
    name: "Zenith Proxy",
    status: "online",
    version: "3.0.0",
    uptime: process.uptime()
  });
});

// ------------------------------------------------------------
// Homepage
// ------------------------------------------------------------

app.get("/", (req, res) => {
  res.status(200).json({
    name: "Zenith Proxy",
    status: "online",
    version: "3.0.0",
    health: "/health"
  });
});

// ------------------------------------------------------------
// Simple URL proxy
// ------------------------------------------------------------

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1"
]);

function isSafeTarget(target) {
  try {
    const url = new URL(target);

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return false;
    }

    const hostname = url.hostname.toLowerCase();

    if (BLOCKED_HOSTS.has(hostname)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------
// Proxy endpoint
// ------------------------------------------------------------

app.get("/proxy", async (req, res) => {
  const target = String(req.query.url || "").trim();

  if (!target) {
    return res.status(400).json({
      error: "Missing url parameter"
    });
  }

  if (!isSafeTarget(target)) {
    return res.status(400).json({
      error: "Invalid target URL"
    });
  }

  try {
    const response = await fetch(target, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/156 Safari/537.36",

        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",

        "Accept-Language":
          "en-US,en;q=0.9"
      }
    });

    res.status(response.status);

    const contentType =
      response.headers.get("content-type") || "";

    if (contentType) {
      res.setHeader(
        "Content-Type",
        contentType
      );
    }

    const cacheControl =
      response.headers.get("cache-control");

    if (cacheControl) {
      res.setHeader(
        "Cache-Control",
        cacheControl
      );
    }

    // Remove headers that commonly prevent
    // proxied content from being displayed.
    res.removeHeader(
      "Content-Security-Policy"
    );

    res.removeHeader(
      "X-Frame-Options"
    );

    const body = await response.arrayBuffer();

    res.send(Buffer.from(body));

  } catch (error) {
    console.error(
      "Zenith proxy error:",
      error
    );

    if (!res.headersSent) {
      res.status(502).json({
        error:
          "Unable to reach the requested website."
      });
    }
  }
});

// ------------------------------------------------------------
// 404 handler
// ------------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    path: req.path
  });
});

// ------------------------------------------------------------
// Error handler
// ------------------------------------------------------------

app.use((error, req, res, next) => {
  console.error(
    "Zenith server error:",
    error
  );

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    error: "Internal server error"
  });
});

// ------------------------------------------------------------
// Start server
// ------------------------------------------------------------

const server = app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "================================"
    );

    console.log(
      " Zenith Proxy Backend"
    );

    console.log(
      "================================"
    );

    console.log(
      `Server listening on port ${PORT}`
    );

    console.log(
      `Health: http://0.0.0.0:${PORT}/health`
    );

    console.log(
      "Status: ONLINE"
    );
  }
);

// ------------------------------------------------------------
// Graceful shutdown
// ------------------------------------------------------------

function shutdown(signal) {
  console.log(
    `${signal} received. Shutting down...`
  );

  server.close(() => {
    console.log(
      "Zenith server stopped."
    );

    process.exit(0);
  });

  setTimeout(() => {
    process.exit(1);
  }, 10000);
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);
