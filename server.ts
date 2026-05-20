import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import admin from "firebase-admin";

import fs from "fs";

dotenv.config();

// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      admin.initializeApp({
        projectId: config.projectId
      });
      console.log("Firebase Admin initialized with project ID:", config.projectId);
    } else {
      admin.initializeApp();
      console.log("Firebase Admin initialized with default credentials");
    }
  } catch (e: any) {
    console.error("Firebase Admin initialization error:", e.message);
  }
}

const app = express();
app.use(express.json());
const PORT = 3000;

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
