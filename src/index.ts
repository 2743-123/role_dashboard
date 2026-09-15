import dotenv from "dotenv";
dotenv.config(); // 👈 Sabse pehle env variables load hone chahiye

import "reflect-metadata";
import compression from "compression";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import { logger } from "./config/logger";
import { AppDataSource } from "./config/db";

// Routes
import authroutes from "./routes/auth";
import userroutes from "./routes/user";
import addBalance from "./routes/addBalance";
import BedashMessage from "./routes/bedashRoutes";
import token from "./routes/Token";
import webhookRoutes from "./routes/webhookRoutes";
import paymentRoutes from "./routes/paymentRoutes";
import backupRoutes from "./routes/backupRoutes";
import aiRoutes from "./routes/aiRoutes";

// Cron Service
import { initBedashScheduler } from "./services/cronService";

const app = express();

// 1. Compression
app.use(compression());

// 2. CORS
const corsOptions = {
  origin: ["https://roll-frontend-one.vercel.app", "http://localhost:3000"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

// 3. Request Logging (Routes se pehle taaki saari requests log hon)
app.use(
  morgan("dev", {
    stream: { write: (message) => logger.info(message.trim()) },
  })
);

// 4. Body Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 5. Routes
app.use("/api/auth", authroutes);
app.use("/api/users", userroutes);
app.use("/api/balance", addBalance);
app.use("/api/token", token);
app.use("/api/message", BedashMessage);
app.use("/api/payment-history", paymentRoutes);
app.use("/api/backup", backupRoutes);
app.use("/api", webhookRoutes);
app.use("/api/ai", aiRoutes);

// 6. Database & Server Initialization
const PORT = process.env.PORT || 5000;

AppDataSource.initialize()
  .then(() => {
    console.log("Database connected");
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    
    // Scheduler init
    initBedashScheduler();
  })
  .catch((err) => {
    console.error("Database connection error", err);
    process.exit(1);
  });