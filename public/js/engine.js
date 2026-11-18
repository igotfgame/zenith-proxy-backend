
import { LibcurlClient } from "/libcurl/index.mjs";

const iframe = document.getElementById("browser");
const address = document.getElementById("address");
const homeSearch = document.getElementById("homeSearch");
const home = document.getElementById("home");
const status = document.getElementById("status");

const WISP_URL =
  `${location.protocol === "https:" ? "wss:" : "ws:"}` +
  `//${location.host}/wisp/`;

let frame;
let controller;

function setStatus(message) {
  status.textContent = message;
}

function normalizeUrl(input) {
  const value = input.trim();

  if (!value) {
    return "";
  }

  if (
    /^https?:\/\//i.test(value)
  ) {
    return value;
  }

  if (
    value.includes(".") &&
    !value.includes(" ")
  ) {
    return `https://${value}`;
  }

  return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
}

async function loadEngine() {
  try {
    setStatus("Loading Scramjet engine...");

    /*
     * The controller uses the service worker,
     * libcurl transport, and Scramjet runtime.
     */
    controller = new api.Controller({
      serviceworker,
      transport: new LibcurlClient({
        wisp: WISP_URL
      }),

      config: {
        scramjetPath:
          "/scram/scramjet.js",

        wasmPath:
          "/scram/scramjet.wasm",

        injectPath:
          "/controller/controller.inject.js"
      }
    });

    await controller.wait();

    frame = controller.createFrame(
      iframe,
      {
        plugins: [
          new utils.HttpCachePlugin(),

          new utils.UrlWatcherPlugin(
            url => {
              address.value = url;
              home.style.display = "none";
              setStatus(
                `Loaded: ${url}`
              );
            }
          ),

          new utils.CatchEscapedLinksPlugin(
            url => new URL(location.href)
          )
        ]
      }
    );

    setStatus("Zenith Proxy ready.");

  } catch (error) {
    console.error(error);

    setStatus(
      "Proxy failed to start: " +
      (error?.message || error)
    );
  }
}

function navigate() {
  const value =
    address.value.trim();

  if (!value || !frame) {
    return;
  }

  const url = normalizeUrl(value);

  if (!url) {
    return;
  }

  home.style.display = "none";

  setStatus(
    `Opening ${url}...`
  );

  /*
   * Important:
   * frame.go() is synchronous.
   */
  frame.go(url);
}

function searchHome() {
  address.value =
    homeSearch.value;

  navigate();
}

document
  .getElementById("go")
  .addEventListener(
    "click",
    navigate
  );

document
  .getElementById("homeGo")
  .addEventListener(
    "click",
    searchHome
  );

address.addEventListener(
  "keydown",
  event => {
    if (event.key === "Enter") {
      navigate();
    }
  }
);

homeSearch.addEventListener(
  "keydown",
  event => {
    if (event.key === "Enter") {
      searchHome();
    }
  }
);

document
  .getElementById("reload")
  .addEventListener(
    "click",
    () => {
      if (frame) {
        frame.go(
          address.value ||
          "https://duckduckgo.com/"
        );
      }
    }
  );

document
  .getElementById("back")
  .addEventListener(
    "click",
    () => {
      if (frame) {
        history.back();
      }
    }
  );

document
  .getElementById("forward")
  .addEventListener(
    "click",
    () => {
      if (frame) {
        history.forward();
      }
    }
  );

loadEngine();
