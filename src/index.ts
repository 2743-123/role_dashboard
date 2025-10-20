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
const allowedOrigins = [
  "http://localhost:3000",
  "https://roll-frontend-one.vercel.app",
];

app.use(cors({
  origin: function(origin, callback) {
    // allow requests with no origin like mobile apps or curl
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true,
}));

// handle preflight
app.options("*", cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(express.json());

const PORT = process.env.PORT || 5000;

app.use("/api/auth", authroutes, userroutes, addBalance, token);

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
