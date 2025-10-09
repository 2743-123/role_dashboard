import { Request, Response, RequestHandler } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { AppDataSource } from "../config/db";
import { User } from "../models/User";
import { logger } from "../config/logger";
import { error } from "console";
import { BlacklistToken } from "../models/BlackListToken";

interface AuthenticatedRequest extends Request {
  user: {
    id: number;
    role: "admin" | "user" | "superadmin"; // jo bhi roles hain aapke system me
  };
}

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";
const userRepo = AppDataSource.getRepository(User);

export const register = async (req: Request, res: Response) => {
  try {
    const { name, email, password, role } = req.body;

    logger.info(`register attempt by ${email}`);

    const existingUser = await userRepo.findOneBy({ email });
    if (existingUser) {
      logger.warn(`existing user ${email}`);
      return res.status(400).json({ msg: "User already exist" });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = userRepo.create({
      name,
      email,
      password: hashedPassword,
      role,
    });
    await userRepo.save(newUser);
    res.status(201).json({ msg: " User Register Succesfully" });
    logger.info(`Register Sucess: ${email}`);
  } catch (err: any) {
    logger.error(`register error ${req.body.email}:${err.message}`);
    res.status(500).json({ msg: "Erro Registering User", error: err });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    console.log("request body", req.body);

    logger.info(`Login attempt by: ${email}`);

    const user = await userRepo.findOneBy({ email });
    if (!user) {
      logger.warn(`Login failed(user not found: ${email})`);
      return res.status(400).json({ msg: "Invalid Credintial" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      logger.warn(`login failed (Wrong password): ${email}`);
      return res.status(400).json({ msg: "Invalid Credintail" });
    }

    const token = jwt.sign(
      { id: user.id,  name: user.name, role: user.role,  },
      JWT_SECRET,
      {
        expiresIn: "1h",
      }
    );
    res.status(200).json({ token });
    logger.info(`login success: ${email}, role: ${user.role}`);
  } catch (err: any) {
    logger.error(`login error for  ${req.body.email}: ${err.message}`);
    res.status(500).json({ msg: "Error logging in ", error: err });
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(400).json({ msg: "Token missing" });

    const blacklistRepo = AppDataSource.getRepository(BlacklistToken);
    await blacklistRepo.save({ token });

    res.status(200).json({ msg: "Logout successful, token invalidated" });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({ msg: "Server error" });
  }
};
