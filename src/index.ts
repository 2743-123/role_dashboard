import express from "express";
import cors from "cors";
import "reflect-metadata";
import { AppDataSource } from "./config/db";
import authroutes from "./routes/auth";
import userroutes from "./routes/user";
import addBalance from "./routes/addBalance";
import token from "./routes/Token";
import morgan from "morgan";
import { logger } from "./config/logger";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: ["https://roll-frontend-one.vercel.app"], // ✅ only your frontend
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);
// parse JSON
app.use(express.json());

const PORT = process.env.PORT || 5000;

// ROUTES
app.use("/api/auth", authroutes);
app.use("/api/users", userroutes);
app.use("/api/balance", addBalance);
app.use("/api/token", token);

// Logging
app.use(
  morgan("dev", {
    stream: { write: (message) => logger.info(message.trim()) },
  })
);

// DATABASE + SERVER START
AppDataSource.initialize()
  .then(() => {
    console.log("Database connected");
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("Database connection error", err);
  });
