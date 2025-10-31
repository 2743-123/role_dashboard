import "reflect-metadata";
import { DataSource } from "typeorm";
import { User } from "../models/User";
import * as dotenv from "dotenv";
import { BlacklistToken } from "../models/BlackListToken";
import { MaterialAccount } from "../models/materialaccount";
import { Token } from "../models/Token";
import { Transaction } from "../models/Transaction";
import { BedashMessage } from "../models/bedashMessage";
dotenv.config();

export const AppDataSource = new DataSource({
  type: "postgres",
  // host: "localhost",
  // username: "dashboard_user",
  // password: "As2743@123",
  // database: "admin_dashboard",
  url: process.env.DATABASE_URL,
  schema: "public",

  synchronize: true,
  ssl: { rejectUnauthorized: false },
  logging: true,
  entities: [
    User,
    BlacklistToken,
    MaterialAccount,
    Token,
    Transaction,
    BedashMessage,
  ],
});
console.log("URL", process.env.DATABASE_URL);
