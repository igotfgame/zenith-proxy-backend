const express = require("express");
const dns = require("dns").promises;
const net = require("net");

const app = express();
const PORT = process.env.PORT || 8080;

// Basic CORS so your Google Apps Script frontend can call the API.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);

    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0] === 0
    );
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();

    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  return true;
}

async function isSafeTarget(url) {
  if (!["http:", "https:"].includes(url.protocol)) {
    return false;
  }

  const hostname = url.hostname;

  // Don't allow localhost-style names.
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    return false;
  }

  const addresses = await dns.lookup(hostname, { all: true });

  return addresses.every(({ address }) => !isPrivateIp(address));
}

app.get("/", (req, res) => {
  res.json({
    name: "Zenith Proxy Backend",
    status: "online",
    version: "1.0.0"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok"
  });
});

app.get("/proxy", async (req, res) => {
  try {
    const target = req.query.url;

    if (!target) {
      return res.status(400).json({
        error: "Missing url parameter"
      });
    }

    let targetUrl;

    try {
      targetUrl = new URL(target);
    } catch {
      return res.status(400).json({
        error: "Invalid URL"
      });
    }

    if (!(await isSafeTarget(targetUrl))) {
      return res.status(403).json({
        error: "Target URL is not allowed"
      });
    }

    const response = await fetch(targetUrl, {
      redirect: "follow",
      headers: {
        "User-Agent": "ZenithProxy/1.0"
      }
    });

    const contentType = response.headers.get("content-type") || "";

    res.status(response.status);
    res.setHeader("Content-Type", contentType);

    const body = await response.arrayBuffer();
    res.send(Buffer.from(body));
  } catch (error) {
    console.error("Proxy error:", error);

    res.status(502).json({
      error: "Unable to retrieve the requested website"
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Zenith Proxy Backend running on port ${PORT}`);
});
