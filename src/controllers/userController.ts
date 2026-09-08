import { Request, RequestHandler, Response } from "express";
import { In } from "typeorm";
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

declare module "express-serve-static-core" {
  interface Request {
    user?: {
      id: number;
      role: string;
    };
  }
}

export const getUser = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    let users = []; 

    // ✅ FIX: Removed 'createdBy' from select, used 'relations: ["creator"]' instead
    if (currentUser.role === "superadmin") {
      users = await userRepo.find({
        select: ["id", "name", "email", "role", "isActive"],
        relations: ["creator"],
        order: { id: "DESC" },
      });
    } else if (currentUser.role === "admin") {
      users = await userRepo.find({
        where: { creator: { id: currentUser.id }, role: "user" }, // 👈 Updated where clause
        select: ["id", "name", "email", "role", "isActive"],
        relations: ["creator"],
        order: { id: "DESC" },
      });
    } else {
      users = await userRepo.find({
        where: { id: currentUser.id },
        select: ["id", "name", "email", "role", "isActive"],
        relations: ["creator"],
      });
    }

    // ✅ FIX: Map the response so frontend still gets 'createdBy' normally without crashing
    const formattedUsers = users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      createdBy: u.creator?.id || null // 👈 Safely extract ID
    }));

    return res.status(200).json(formattedUsers);
  } catch (error) {
    console.error("Error fetching users:", error);
    return res.status(500).json({ msg: "Error fetching users", error });
  }
};

export const updateuser: RequestHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, password, role, isActive } = req.body;
    const currentUser = req.user!;

    // ✅ FIX: Fetch 'creator' relation
    const user = await userRepo.findOne({
      where: { id: parseInt(id) },
      relations: ["creator"]
    });

    if (!user) return res.status(404).json({ message: "User Not Found" });

    // 🔐 Role-based restrictions & IDOR protection
    if (currentUser.role === "admin") {
      if (user.role !== "user") {
        return res.status(403).json({ message: "Admin can only update regular users" });
      }
      // ✅ FIX: Check creator?.id instead of createdBy
      if (user.creator?.id !== currentUser.id) {
        return res.status(403).json({ message: "Access Denied: Not your user" });
      }
      if (role && role !== "user") {
        return res.status(403).json({ message: "Admin cannot change user roles to higher levels" });
      }
    } else if (currentUser.role === "user") {
      return res.status(403).json({ message: "Users cannot update anyone" });
    }

    if (email && email !== user.email) {
      const existingUser = await userRepo.findOne({ where: { email } });
      if (existingUser) {
        return res.status(400).json({ message: "Email is already in use by another account" });
      }
      user.email = email;
    }

    if (name) user.name = name;
    if (password) user.password = await bcrypt.hash(password, 10);
    if (role && currentUser.role === "superadmin") user.role = role;
    if (typeof isActive === "boolean") user.isActive = isActive;

    await userRepo.save(user);

    return res.status(200).json({ message: "User update successful", user });
  } catch (error) {
    console.error("Update error:", error);
    return res.status(500).json({ message: "Error updating user", error });
  }
};

export const deleteUser: RequestHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUser = req.user!;

    // ✅ FIX: Fetch 'creator' relation
    const user = await userRepo.findOne({
      where: { id: parseInt(id) },
      relations: ["creator"]
    });

    if (!user) return res.status(404).json({ message: "User not found" });

    // 🔐 Permissions Check
    if (currentUser.role === "user") {
      return res.status(403).json({ message: "Access Denied" });
    }

    if (user.role === "admin" && currentUser.role !== "superadmin") {
      return res.status(403).json({ message: "Only SuperAdmin can delete an admin" });
    }

    // ✅ FIX: Check creator?.id instead of createdBy
    if (currentUser.role === "admin" && user.creator?.id !== currentUser.id) {
      return res.status(403).json({ message: "Access Denied: You cannot delete this user" });
    }

    await AppDataSource.manager.transaction(async (transactionalEntityManager) => {
      
      // Step 1: If deleting an admin, delete all users created by this admin
      if (user.role === "admin") {
        // ✅ FIX: where creator = user.id
        const adminUsers = await transactionalEntityManager.find(User, { 
          where: { creator: { id: user.id } } 
        });

        if (adminUsers.length > 0) {
          const userIds = adminUsers.map(u => u.id);
          
          await transactionalEntityManager.delete(MaterialAccount, { user: { id: In(userIds) } });
          await transactionalEntityManager.delete(Transaction, { user: { id: In(userIds) } });
          await transactionalEntityManager.delete(BedashMessage, { user: { id: In(userIds) } });
          
          await transactionalEntityManager.delete(User, { id: In(userIds) });
        }
      }

      // Step 2: Delete target user's related data
      await transactionalEntityManager.delete(MaterialAccount, { user: { id: user.id } });
      await transactionalEntityManager.delete(Transaction, { user: { id: user.id } });
      await transactionalEntityManager.delete(BedashMessage, { user: { id: user.id } });
      
      // Step 3: Delete user itself
      await transactionalEntityManager.remove(user);
    });

    return res.status(200).json({ message: "User and all related data deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    return res.status(500).json({ message: "Error deleting user", error });
  }
};