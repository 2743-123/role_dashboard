import { Request, RequestHandler, Response } from "express";
import { AppDataSource } from "../config/db";
import { User } from "../models/User";
import bcrypt from "bcryptjs";
import { MaterialAccount } from "../models/materialaccount";
import { Transaction } from "../models/Transaction";
import { BedashMessage } from "../models/bedashMessage";

const userRepo = AppDataSource.getRepository(User);
const accountRepo = AppDataSource.getRepository(MaterialAccount);
const transactionRepo = AppDataSource.getRepository(Transaction);
const bedashRepo = AppDataSource.getRepository(BedashMessage);

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
    const user = await userRepo.findOne({
      where: { id: parseInt(id) },
      relations: ["accounts", "transactions", "bedashMessages"],
    });

    if (!user) return res.status(404).json({ message: "User not found" });

    // ✅ Only SuperAdmin can delete admin
    const currentUser = (req as any).user;
    if (user.role === "admin" && currentUser.role !== "superadmin") {
      return res.status(403).json({ message: "Only SuperAdmin can delete admin" });
    }

    // ✅ Step 1: If deleting an admin, also delete all users created by that admin
    if (user.role === "admin") {
      const adminUsers = await userRepo.find({
        where: { createdBy: user.id },
      });

      for (const u of adminUsers) {
        // Delete that user's material accounts
        await accountRepo.delete({ user: { id: u.id } });
        // Delete that user's transactions
        await transactionRepo.delete({ user: { id: u.id } });
        // Delete that user's bedash messages
        await bedashRepo.delete({ user: { id: u.id } });
        // Finally, delete user
        await userRepo.delete({ id: u.id });
      }
    }

    // ✅ Step 2: Delete current user's related data
    await accountRepo.delete({ user: { id: user.id } });
    await transactionRepo.delete({ user: { id: user.id } });
    await bedashRepo.delete({ user: { id: user.id } });

    // ✅ Step 3: Delete user itself
    await userRepo.remove(user);

    res.status(200).json({ message: "User and related data deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ message: "Error deleting user", error });
  }
};