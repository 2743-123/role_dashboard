import express from "express";
import cors from "cors";
import "reflect-metadata";
import { AppDataSource } from "./config/db";
import authroutes from "./routes/auth";
import morgan from "morgan";
import { logger } from "./config/logger";
import dotenv from "dotenv"

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000

app.use("/api/auth", authroutes);

app.use(
  morgan("dev", {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  })
);

AppDataSource.initialize()
  .then(() => {
    console.log("database connected");

    app.listen(PORT, () => {
      console.log("server running port 5000");
    });
  })
  .catch((err) => {
    console.error("database connection error", err);
  });
