// server.js
// Zenith Fast Proxy
// Node.js 18+

const express = require("express");
const { request } = require("undici");

const app = express();

const PORT = process.env.PORT || 3000;

// Domains Zenith is allowed to proxy.
// Add more domains here as needed.
const ALLOWED_HOSTS = [
  "duckduckgo.com",
  "www.duckduckgo.com"
];

function isAllowed(url) {
  try {
    const parsed = new URL(url);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return false;
    }

    return ALLOWED_HOSTS.some(
      host =>
        parsed.hostname === host ||
        parsed.hostname.endsWith("." + host)
    );
  } catch {
    return false;
  }
}

app.get("/", (req, res) => {
  res.json({
    name: "Zenith Proxy",
    status: "online",
    version: "1.0.0"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime()
  });
});

app.get("/proxy", async (req, res) => {
  const target = req.query.url;

  if (!target) {
    return res.status(400).json({
      error: "Missing url parameter"
    });
  }

  if (!isAllowed(target)) {
    return res.status(403).json({
      error: "This domain is not allowed by the Zenith proxy."
    });
  }

  try {
    const response = await request(target, {
      method: "GET",

      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/156 Safari/537.36",
        "accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9"
      },

      maxRedirections: 5,

      headersTimeout: 10000,
      bodyTimeout: 30000
    });

    res.status(response.statusCode);

    const contentType = response.headers["content-type"];

    if (contentType) {
      res.setHeader("content-type", contentType);
    }

    // Don't let the upstream connection hang around unnecessarily.
    res.setHeader("cache-control", "no-store");

    // Stream the response directly to the browser.
    // This is much faster than buffering the entire page.
    response.body.pipe(res);

  } catch (error) {
    console.error("Proxy error:", error);

    if (!res.headersSent) {
      res.status(502).json({
        error: "Unable to reach the requested website."
      });
    } else {
      res.end();
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Zenith Proxy running on port ${PORT}`);
});;
