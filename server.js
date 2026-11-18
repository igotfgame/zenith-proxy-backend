import http from "node:http";
import path from "node:path";
import { fileURLToPath, createRequire } from "node:module";

import express from "express";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require = createRequire(import.meta.url);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

function dirOf(specifier) {
  return path.dirname(require.resolve(specifier));
}

/*
 * Cross-origin isolation is required by Scramjet for sites
 * that use features such as SharedArrayBuffer.
 */
app.use((req, res, next) => {
  res.setHeader(
    "Cross-Origin-Opener-Policy",
    "same-origin"
  );

  res.setHeader(
    "Cross-Origin-Embedder-Policy",
    "require-corp"
  );

  next();
});

/*
 * Scramjet core + WASM
 */
app.use(
  "/scram/",
  express.static(scramjetPath)
);

/*
 * Scramjet utilities
 */
app.use(
  "/utils/",
  express.static(
    dirOf("@mercuryworkshop/scramjet-utils")
  )
);

/*
 * Scramjet controller
 */
app.use(
  "/controller/",
  express.static(
    dirOf("@mercuryworkshop/scramjet-controller")
  )
);

/*
 * Libcurl transport
 */
app.use(
  "/libcurl/",
  express.static(
    dirOf("@mercuryworkshop/libcurl-transport")
  )
);

/*
 * Zenith frontend
 */
app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/*
 * Health endpoint
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "zenith-scramjet",
    uptime: process.uptime()
  });
});

/*
 * Wisp WebSocket transport.
 *
 * This is the actual transport used by the
 * Scramjet browser engine.
 */
wisp.options.allow_private_ips = false;
wisp.options.allow_loopback_ips = false;

const server = http.createServer(app);

server.on("upgrade", (req, socket, head) => {
  let pathname;

  try {
    pathname = new URL(
      req.url || "/",
      "http://localhost"
    ).pathname;
  } catch {
    socket.end();
    return;
  }

  if (pathname === "/wisp/") {
    req.url = "/wisp/";

    try {
      wisp.routeRequest(req, socket, head);
    } catch (error) {
      console.error("Wisp error:", error);
      socket.end();
    }

    return;
  }

  socket.end();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("================================");
  console.log(" Zenith Scramjet Proxy");
  console.log("================================");
  console.log(`HTTP:  http://0.0.0.0:${PORT}`);
  console.log(`Wisp:  ws://0.0.0.0:${PORT}/wisp/`);
  console.log("Status: ONLINE");
});

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
