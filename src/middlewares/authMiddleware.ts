import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AppDataSource } from "../config/db";
import { User } from "../models/User";
import { BlacklistToken } from "../models/BlackListToken";

const JWT_SECRET = process.env.JWT_SECRET || "supersecretkey";

export interface AuthRequest extends Request {
  user?: any;
}

export const authMiddleWare = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = req.headers["authorization"]?.split(" ")[1];
    if (!token) {
      return res.status(401).json({ msg: "No Token, Authorization denied" });
    }

    // 🛑 Check if token is blacklisted
    const blacklistRepo = AppDataSource.getRepository(BlacklistToken);
    const blacklisted = await blacklistRepo.findOne({ where: { token } });
    if (blacklisted) {
      return res.status(401).json({ msg: "Token expired or invalid" });
    }

    // ✅ Verify token
    const decoded = jwt.verify(token, JWT_SECRET) as {
      id: number;
      role: string;
    };
    req.user = decoded;

    next();
  } catch (err) {
    res.status(401).json({ msg: "Invalid Token" });
  }
};

export const adminMiddleware = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (req.user?.role !== "admin" && req.user?.role !== "superadmin") {
    return res.status(403).json({ msg: "Acces denide: admin only" });
  }
  next();
};

// export const superAdminMiddleware = (
//   req: AuthRequest,
//   res: Response,
//   next: NextFunction
// ) => {
//   if (req.user?.role !== "superadmin" && req.user?.role !== "admin") {
//     return res
//       .status(403)
//       .json({ message: "Access denied, Super Admins only" });
//   }
//   next();
// };

export const roleCheckMiddleware = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const creatorRole = req.user?.role; // login किया हुआ user
  const { role: newUserRole } = req.body; // जिसको create करना है उसका role

  // Admin user बना सकता है (लेकिन admin/superadmin नहीं)
  if (creatorRole === "admin" && newUserRole && newUserRole !== "user") {
    return res.status(403).json({ message: "Admins can only create users" });
  }

  // Superadmin user या admin दोनों बना सकता है
  if (creatorRole === "superadmin") {
    return next();
  }

  // Normal user को किसी को create करने की इजाजत नहीं
  if (creatorRole === "user") {
    return res.status(403).json({ message: "Users cannot create accounts" });
  }

  next();
};

const userRepo = AppDataSource.getRepository(User);

export const roleCheckUpdateDelete = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const requesterRole = req.user?.role;
  const requesterId = req.user?.id;
  const targetId = parseInt(req.params.id);

  const targetUser = await userRepo.findOne({ where: { id: targetId } });
  if (!targetUser) {
    return res.status(404).json({ message: "Target user not found" });
  }

  // 🟢 RULE 1: Users cannot update/delete anyone (even themselves)
  if (requesterRole === "user") {
    return res
      .status(403)
      .json({ message: "Users cannot update or delete accounts" });
  }

  // 🟢 RULE 2: Admin can only update/delete users
  if (requesterRole === "admin") {
    if (targetUser.role !== "user") {
      return res.status(403).json({
        message:
          "Admins can only update or delete users (not admins or superadmins)",
      });
    }
    if (requesterId === targetId) {
      return res
        .status(403)
        .json({ message: "Admins cannot update or delete themselves" });
    }
  }

  // 🟢 RULE 3: SuperAdmin has full power
  // (no restriction)

  next();
};
