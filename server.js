import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "undici";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/*
 * EthioDeploy provides the PORT environment variable.
 * Never hard-code the production port.
 */
const PORT = Number(process.env.PORT) || 3000;

/*
 * ============================================================
 * BASIC SECURITY / CORS
 * ============================================================
 */

app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
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


/*
 * ============================================================
 * FRONTEND
 * ============================================================
 */

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


/*
 * ============================================================
 * ROOT
 * ============================================================
 */

app.get("/", (req, res) => {
  res.status(200).json({
    name: "Zenith Proxy",
    status: "online",
    version: "3.0.0"
  });
});


/*
 * ============================================================
 * HEALTH CHECKS
 * ============================================================
 *
 * Keep several common health endpoints so the deployment
 * platform can successfully detect the server.
 */

function healthResponse(req, res) {
  res.status(200).json({
    status: "ok",
    service: "zenith-proxy",
    version: "3.0.0",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
}

app.get("/health", healthResponse);
app.get("/healthz", healthResponse);
app.get("/api/health", healthResponse);


/*
 * ============================================================
 * PROXY CONFIGURATION
 * ============================================================
 */

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]"
]);


function isPrivateIPv4(hostname) {
  const parts = hostname.split(".").map(Number);

  if (
    parts.length !== 4 ||
    parts.some(Number.isNaN)
  ) {
    return false;
  }

  const [a, b] = parts;

  if (a === 10) return true;

  if (
    a === 172 &&
    b >= 16 &&
    b <= 31
  ) {
    return true;
  }

  if (
    a === 192 &&
    b === 168
  ) {
    return true;
  }

  return false;
}


function isSafeTarget(target) {
  try {
    const url = new URL(target);

    if (
      url.protocol !== "http:" &&
      url.protocol !== "https:"
    ) {
      return false;
    }

    const hostname =
      url.hostname.toLowerCase();

    if (
      BLOCKED_HOSTS.has(hostname)
    ) {
      return false;
    }

    if (
      hostname === "metadata.google.internal" ||
      hostname.endsWith(".internal")
    ) {
      return false;
    }

    if (isPrivateIPv4(hostname)) {
      return false;
    }

    return true;

  } catch {
    return false;
  }
}


/*
 * ============================================================
 * URL REWRITING
 * ============================================================
 */

function makeAbsoluteUrl(value, base) {
  try {
    return new URL(
      value,
      base
    ).href;
  } catch {
    return null;
  }
}


function proxyUrl(url) {
  return (
    "/proxy?url=" +
    encodeURIComponent(url)
  );
}


/*
 * Rewrite common HTML URLs.
 *
 * This is intentionally conservative. It handles the common
 * src/href/action attributes without trying to rewrite every
 * possible JavaScript string.
 */

function rewriteHtml(body, target) {

  const base =
    new URL(target).href;

  return body.replace(
    /(src|href|action)\s*=\s*(["'])(.*?)\2/gi,

    (match, attribute, quote, value) => {

      const original =
        String(value || "").trim();

      if (!original) {
        return match;
      }

      if (
        original.startsWith("#") ||
        original.startsWith("data:") ||
        original.startsWith("blob:") ||
        original.startsWith("javascript:") ||
        original.startsWith("mailto:") ||
        original.startsWith("tel:")
      ) {
        return match;
      }

      const absolute =
        makeAbsoluteUrl(
          original,
          base
        );

      if (!absolute) {
        return match;
      }

      if (
        !/^https?:\/\//i.test(
          absolute
        )
      ) {
        return match;
      }

      return (
        attribute +
        "=" +
        quote +
        proxyUrl(absolute) +
        quote
      );
    }
  );
}


/*
 * ============================================================
 * PROXY
 * ============================================================
 */

app.get("/proxy", async (req, res) => {

  const target =
    String(req.query.url || "").trim();

  if (!target) {

    return res.status(400).json({
      error: "Missing url parameter."
    });
  }


  if (!isSafeTarget(target)) {

    return res.status(400).json({
      error: "Invalid target URL."
    });
  }


  try {

    console.log(
      "[PROXY]",
      target
    );


    const upstream =
      await request(
        target,
        {
          method: "GET",

          headers: {
            "user-agent":
              "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/156 Safari/537.36",

            "accept":
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",

            "accept-language":
              "en-US,en;q=0.9",

            "accept-encoding":
              "identity"
          },

          maxRedirections: 5,

          headersTimeout: 15000,

          bodyTimeout: 60000
        }
      );


    res.status(
      upstream.statusCode
    );


    /*
     * Forward useful headers.
     */

    const headers =
      upstream.headers;

    const allowedHeaders = [
      "content-type",
      "content-length",
      "cache-control",
      "etag",
      "last-modified",
      "expires",
      "date"
    ];


    for (
      const header of allowedHeaders
    ) {

      if (
        headers[header] !== undefined
      ) {

        res.setHeader(
          header,
          headers[header]
        );
      }
    }


    /*
     * Prevent the upstream website from preventing
     * itself from being displayed inside our browser.
     */

    res.removeHeader(
      "content-security-policy"
    );

    res.removeHeader(
      "content-security-policy-report-only"
    );

    res.removeHeader(
      "x-frame-options"
    );


    const contentType =
      String(
        headers["content-type"] || ""
      ).toLowerCase();


    /*
     * HTML / XHTML
     */

    if (
      contentType.includes(
        "text/html"
      ) ||
      contentType.includes(
        "application/xhtml+xml"
      )
    ) {

      let body = "";

      for await (
        const chunk of upstream.body
      ) {

        body +=
          Buffer
            .from(chunk)
            .toString("utf8");
      }


      body =
        rewriteHtml(
          body,
          target
        );


      /*
       * Prevent the original page from trying to
       * navigate the top-level Zenith page.
       */

      body =
        body.replace(
          /<base\s+[^>]*>/gi,
          ""
        );


      res.send(body);

      return;
    }


    /*
     * Non-HTML content:
     *
     * Images
     * CSS
     * JavaScript
     * JSON
     * Fonts
     * etc.
     */

    upstream.body.pipe(res);

  } catch (error) {

    console.error(
      "[PROXY ERROR]",
      error
    );


    if (!res.headersSent) {

      res.status(502).json({
        error:
          "Unable to reach the requested website.",

        message:
          error?.message ||
          "Unknown proxy error."
      });

    } else {

      res.end();
    }
  }
});


/*
 * ============================================================
 * 404 HANDLER
 * ============================================================
 */

app.use((req, res) => {

  res.status(404).json({
    error: "Not found",
    path: req.path
  });

});


/*
 * ============================================================
 * ERROR HANDLER
 * ============================================================
 */

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
      error: "Internal server error."
    });
  }
);


/*
 * ============================================================
 * START SERVER
 * ============================================================
 *
 * 0.0.0.0 is important for cloud deployment.
 */

const server =
  app.listen(
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
        `Port: ${PORT}`
      );

      console.log(
        "Host: 0.0.0.0"
      );

      console.log(
        "Status: ONLINE"
      );

      console.log(
        `Health: /health`
      );

      console.log(
        `Proxy: /proxy?url=...`
      );

      console.log(
        "================================"
      );
    }
  );


/*
 * ============================================================
 * GRACEFUL SHUTDOWN
 * ============================================================
 */

function shutdown(signal) {

  console.log(
    `${signal} received. Shutting down...`
  );

  server.close(() => {

    console.log(
      "Server closed."
    );

    process.exit(0);
  });


  setTimeout(() => {

    console.error(
      "Forced shutdown."
    );

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
);;
