```javascript
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.disable("x-powered-by");

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

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
// Health
// ------------------------------------------------------------

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "zenith-proxy-backend",
    version: "4.0.0",
    uptime: process.uptime()
  });
});

app.get("/healthz", (req, res) => {
  res.status(200).send("OK");
});

app.get("/api/status", (req, res) => {
  res.status(200).json({
    name: "Zenith Proxy",
    status: "online",
    version: "4.0.0",
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
    version: "4.0.0",
    endpoints: {
      health: "/health",
      proxy: "/proxy?url=https://example.com"
    }
  });
});

// ------------------------------------------------------------
// Target validation
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
// Rewrite HTML so relative links work through the proxy
// ------------------------------------------------------------

function rewriteHtml(html, targetUrl) {
  try {
    const base = new URL(targetUrl);

    // Make relative links absolute.
    html = html.replace(
      /(\s(?:href|src|action)=["'])(?!https?:|data:|javascript:|#|mailto:|tel:|\/{2})/gi,
      `$1${base.origin}/`
    );

    // Convert root-relative URLs into absolute URLs.
    html = html.replace(
      /(\s(?:href|src|action)=["'])\/(?!\/)/gi,
      `$1${base.origin}/`
    );

    // Remove frame restrictions from HTML.
    html = html.replace(
      /<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi,
      ""
    );

    html = html.replace(
      /<meta[^>]+http-equiv=["']?X-Frame-Options["']?[^>]*>/gi,
      ""
    );

    return html;
  } catch {
    return html;
  }
}

// ------------------------------------------------------------
// Proxy
// ------------------------------------------------------------

app.get("/proxy", async (req, res) => {
  const target = String(
    req.query.url || ""
  ).trim();

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

  console.log(
    `[PROXY] ${target}`
  );

  try {
    const response = await fetch(target, {
      method: "GET",
      redirect: "follow",

      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/156.0 Safari/537.36",

        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",

        "Accept-Language":
          "en-US,en;q=0.9",

        "Cache-Control":
          "no-cache"
      }
    });

    const finalUrl =
      response.url || target;

    const contentType =
      response.headers.get(
        "content-type"
      ) || "text/plain";

    res.status(
      response.status
    );

    res.setHeader(
      "Content-Type",
      contentType
    );

    res.setHeader(
      "Access-Control-Allow-Origin",
      "*"
    );

    // Don't pass these headers through.
    res.removeHeader(
      "Content-Security-Policy"
    );

    res.removeHeader(
      "Content-Security-Policy-Report-Only"
    );

    res.removeHeader(
      "X-Frame-Options"
    );

    res.removeHeader(
      "Frame-Options"
    );

    res.removeHeader(
      "Cross-Origin-Opener-Policy"
    );

    res.removeHeader(
      "Cross-Origin-Embedder-Policy"
    );

    res.removeHeader(
      "Cross-Origin-Resource-Policy"
    );

    const body =
      await response.arrayBuffer();

    let buffer =
      Buffer.from(body);

    // --------------------------------------------------------
    // HTML rewriting
    // --------------------------------------------------------

    if (
      contentType
        .toLowerCase()
        .includes("text/html")
    ) {
      let html =
        buffer.toString("utf8");

      html =
        rewriteHtml(
          html,
          finalUrl
        );

      buffer =
        Buffer.from(
          html,
          "utf8"
        );
    }

    res.send(buffer);

  } catch (error) {

    console.error(
      "[PROXY ERROR]",
      error
    );

    if (!res.headersSent) {
      res.status(502).json({
        error:
          "Zenith could not reach the requested website.",
        details:
          String(error?.message || error)
      });
    }
  }
});

// ------------------------------------------------------------
// 404
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

app.use(
  (error, req, res, next) => {

    console.error(
      "[SERVER ERROR]",
      error
    );

    if (res.headersSent) {
      return next(error);
    }

    res.status(500).json({
      error:
        "Internal server error"
    });
  }
);

// ------------------------------------------------------------
// Start
// ------------------------------------------------------------

const server =
  app.listen(
    PORT,
    "0.0.0.0",
    () => {

      console.log(
        "================================"
      );

      console.log(
        "       ZENITH PROXY BACKEND"
      );

      console.log(
        "================================"
      );

      console.log(
        `Server listening on port ${PORT}`
      );

      console.log(
        `Health endpoint: /health`
      );

      console.log(
        `Proxy endpoint: /proxy?url=...`
      );

      console.log(
        "Status: ONLINE"
      );
    }
  );

// ------------------------------------------------------------
// Shutdown
// ------------------------------------------------------------

function shutdown(signal) {

  console.log(
    `${signal} received. Shutting down...`
  );

  server.close(
    () => {

      console.log(
        "Zenith server stopped."
      );

      process.exit(0);
    }
  );

  setTimeout(
    () => {
      process.exit(1);
    },
    10000
  );
}

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);
```
