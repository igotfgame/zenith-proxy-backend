const express = require("express");

const app = express();

const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
  res.json({
    name: "Zenith Proxy Backend",
    status: "online"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Zenith Proxy Backend running on port ${PORT}`);
});
