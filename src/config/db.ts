import "reflect-metadata";
import { DataSource } from "typeorm";
import { User } from "../models/User";
import * as dotenv from "dotenv";
import { BlacklistToken } from "../models/BlackListToken";
dotenv.config();

export const AppDataSource = new DataSource({
  type: "postgres",
  // host: "localhost",
  // username: "dashboard_user",
  // password: "As2743@123",
  // database: "admin_dashboard",
  url: process.env.DATABASE_URL,

  synchronize: true,
  ssl: { rejectUnauthorized: false },
  logging: true,
  entities: [User, BlacklistToken],
});
console.log("URL", process.env.DATABASE_URL);
