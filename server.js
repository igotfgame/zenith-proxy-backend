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

const express = require("express");
const { request } = require("undici");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1"
]);

function isSafeTarget(target) {
  try {
    const url = new URL(target);

    if (!["http:", "https:"].includes(url.protocol)) {
      return false;
    }

    if (BLOCKED_HOSTS.has(url.hostname.toLowerCase())) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function rewriteUrl(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

app.get("/", (req, res) => {
  res.json({
    name: "Zenith Proxy",
    status: "online",
    version: "2.0.0"
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

  if (!isSafeTarget(target)) {
    return res.status(400).json({
      error: "Invalid target URL"
    });
  }

  try {
    const upstream = await request(target, {
      method: "GET",

      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/156 Safari/537.36",

        "accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",

        "accept-language": "en-US,en;q=0.9",

        "accept-encoding": "identity"
      },

      maxRedirections: 5,

      headersTimeout: 15000,
      bodyTimeout: 60000
    });

    res.status(upstream.statusCode);

    const headers = upstream.headers;

    /*
     * Forward useful response headers.
     */
    const allowedHeaders = [
      "content-type",
      "content-length",
      "content-encoding",
      "last-modified",
      "etag",
      "cache-control",
      "expires",
      "date"
    ];

    for (const header of allowedHeaders) {
      if (headers[header]) {
        res.setHeader(header, headers[header]);
      }
    }

    /*
     * Prevent the browser from trying to download pages
     * because of upstream headers.
     */
    res.removeHeader("content-security-policy");
    res.removeHeader("content-security-policy-report-only");
    res.removeHeader("x-frame-options");

    const contentType = String(headers["content-type"] || "");

    /*
     * HTML gets streamed through directly.
     *
     * Images, CSS, JS, fonts, video, etc. are also streamed
     * without buffering the entire response in memory.
     */
    if (
      contentType.includes("text/html") ||
      contentType.includes("application/xhtml+xml")
    ) {
      let body = "";

      for await (const chunk of upstream.body) {
        body += chunk.toString("utf8");
      }

      const baseUrl = new URL(target);

      /*
       * Rewrite common relative resource URLs so that images,
       * stylesheets and scripts continue to work through Zenith.
       */
      body = body.replace(
        /(src|href|action)=("([^"]*)"|'([^']*)')/gi,
        (match, attribute, quoted, doubleValue, singleValue) => {
          const original = doubleValue ?? singleValue;

          if (
            !original ||
            original.startsWith("#") ||
            original.startsWith("data:") ||
            original.startsWith("javascript:") ||
            original.startsWith("mailto:")
          ) {
            return match;
          }

          const absolute = rewriteUrl(original, baseUrl.href);

          if (!/^https?:\/\//i.test(absolute)) {
            return match;
          }

          const proxyUrl =
            "/proxy?url=" + encodeURIComponent(absolute);

          const quote = quoted[0];

          return `${attribute}=${quote}${proxyUrl}${quote}`;
        }
      );

      res.send(body);
      return;
    }

    /*
     * Everything else — images, CSS, JavaScript, fonts,
     * JSON, media, etc. — is streamed directly.
     */
    upstream.body.pipe(res);

  } catch (error) {
    console.error("Zenith proxy error:", error);

    if (!res.headersSent) {
      res.status(502).json({
        error: "Unable to reach the requested website.",
        details: error.message
      });
    } else {
      res.end();
    }
  }
});
app.get("/healthz", (req, res) => {
  res.status(200).send("OK");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Zenith Proxy running on port ${PORT}`);
});

app.get("/healthz", (req, res) => {
  res.status(200).send("OK");
});
