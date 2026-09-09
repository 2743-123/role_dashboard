import express from "express";
import cors from "cors";
import "reflect-metadata";
import { AppDataSource } from "./config/db";
import authroutes from "./routes/auth";
import userroutes from "./routes/user";
import addBalance from "./routes/addBalance";
import BedashMessage from "./routes/bedashRoutes";
import token from "./routes/Token";
import webhookRoutes from "./routes/webhookRoutes";
import morgan from "morgan";
import { logger } from "./config/logger";
import dotenv from "dotenv";
import paymentRoutes from "./routes/paymentRoutes";
import backupRoutes from "./routes/backupRoutes";
import { initBedashScheduler } from "./services/cronService"; // 👈 1. Cron service import kiya

dotenv.config();

const app = express();

app.use(
  cors({
    origin: ["https://roll-frontend-one.vercel.app", "http://localhost:3000"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders:["Content-Type","Authorization"],
    credentials: true,
  })
);
app.options(/.*/,cors());
// parse JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 5000;

// ROUTES
app.use("/api/auth", authroutes);
app.use("/api/users", userroutes);
app.use("/api/balance", addBalance);
app.use("/api/token", token);
app.use("/api/message", BedashMessage);
app.use("/api/payment-history", paymentRoutes);
app.use("/api/backup", backupRoutes);
app.use("/api", webhookRoutes);

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
    
    // 🚀 2. Server start hote hi 3:00 PM wala Bedash Cron Scheduler start ho jayega
    initBedashScheduler(); 
  })
  .catch((err) => {
    console.error("Database connection error", err);
  });