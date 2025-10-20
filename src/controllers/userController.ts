import { Request, RequestHandler, Response } from "express";
import { AppDataSource } from "../config/db";
import { User } from "../models/User";
import bcrypt from "bcryptjs";

const userRepo = AppDataSource.getRepository(User);

export const getUser = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user; // logged-in user info from JWT
    let users;

    if (currentUser.role === "superadmin") {
      // SuperAdmin => sab dekh sakta hai
      users = await userRepo.find({
        select: ["id", "name", "email", "role", "isActive", "createdBy"],
        order: { id: "DESC" },
      });
    } else if (currentUser.role === "admin") {
      // Admin => sirf apne banaye hue users dekh sakta hai
      users = await userRepo.find({
        where: { createdBy: currentUser.id, role: "user" },
        select: ["id", "name", "email", "role", "isActive", "createdBy"],
        order: { id: "DESC" },
      });
    } else {
      // Normal User => sirf apna data dekh sakta hai
      users = await userRepo.findOne({
        where: { id: currentUser.id },
        select: ["id", "name", "email", "role", "isActive", "createdBy"],
      });
    }

    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ msg: "Error fetching users", error });
  }
};

declare module "express-serve-static-core" {
  interface Request {
    user?: {
      id: number;
      role: string;
    };
  }
}
export const updateuser: RequestHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, password, role, isActive } = req.body;

    const user = await userRepo.findOneBy({ id: parseInt(id) });
    if (!user) return res.status(404).json({ message: "User Not Found" });

    // role-based restrictions
    if (req.user?.role === "admin") {
      if (user.role !== "user") {
        return res.status(403).json({ message: "Admin can only update users" });
      }
      if (user.id === req.user.id) {
        return res
          .status(403)
          .json({ message: "Admin cannot update themselves" });
      }
    } else if (req.user?.role === "user") {
      return res.status(403).json({ message: "Users cannot update anyone" });
    }

    // update fields
    if (name) user.name = name;
    if (password) user.password = await bcrypt.hash(password, 10);
    if (email) user.email = email;
    if (role) user.role = role;
    if (typeof isActive === "boolean") user.isActive = isActive;

    await userRepo.save(user);

    res.status(200).json({ message: "User update successful", user });
  } catch (error) {
    res.status(500).json({ message: "Error updating user", error });
  }
};

export const deleteUser: RequestHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await userRepo.findOneBy({ id: parseInt(id) });
    if (!user) return res.status(404).json({ message: "User Not Found" });

    // ✅ Check if user is inactive
    if (user.isActive) {
      return res
        .status(403)
        .json({ message: "Active users cannot be deleted" });
    }

    await userRepo.remove(user);
    res.status(200).json({ message: "User Deleted Successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error Deleting User", error });
  }
};
