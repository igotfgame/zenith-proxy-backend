import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// CORS
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

// Health check
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

// Status
app.get("/api/status", (req, res) => {
  res.status(200).json({
    status: "online",
    service: "Zenith Proxy",
    version: "1.0.0"
  });
});

// Homepage
app.get("/", (req, res) => {
  res.status(200).json({
    name: "Zenith Proxy Backend",
    status: "online",
    health: "/health",
    proxy: "/proxy?url=https%3A%2F%2Fduckduckgo.com"
  });
});

// URL validation
function isValidUrl(value) {
  try {
    const url = new URL(value);

    return (
      url.protocol === "http:" ||
      url.protocol === "https:"
    );
  } catch {
    return false;
  }
}

// Proxy
app.get("/proxy", async (req, res) => {
  const target = String(req.query.url || "").trim();

  if (!target) {
    return res.status(400).json({
      error: "Missing url parameter"
    });
  }

  if (!isValidUrl(target)) {
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
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",

        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",

        "Accept-Language":
          "en-US,en;q=0.9"
      }
    });

    const contentType =
      response.headers.get("content-type") ||
      "text/plain";

    const body =
      await response.arrayBuffer();

    res.status(response.status);

    res.setHeader(
      "Content-Type",
      contentType
    );

    res.removeHeader(
      "X-Frame-Options"
    );

    res.removeHeader(
      "Content-Security-Policy"
    );

    res.send(Buffer.from(body));

  } catch (error) {
    console.error(
      "Zenith proxy error:",
      error
    );

    res.status(502).json({
      error:
        "Unable to reach the requested website."
    });
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    path: req.path
  });
});

// Error handler
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

// Start server
const server = app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      "================================"
    );

    console.log(
      "       ZENITH PROXY"
    );

    console.log(
      "================================"
    );

    console.log(
      `Server listening on port ${PORT}`
    );

    console.log(
      "Health: /health"
    );

    console.log(
      "Proxy: /proxy?url=..."
    );

    console.log(
      "Status: ONLINE"
    );

    console.log(
      "================================"
    );
  }
);

// Graceful shutdown
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
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);
