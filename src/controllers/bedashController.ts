import { Request, Response } from "express";
import { AppDataSource } from "../config/db";
import { In } from "typeorm";

import { User } from "../models/User";
import { MaterialAccount } from "../models/materialaccount";
import { BedashMessage } from "../models/bedashMessage";

const bedashRepo = AppDataSource.getRepository(BedashMessage);
const userRepo = AppDataSource.getRepository(User);
const accountRepo = AppDataSource.getRepository(MaterialAccount);

// ✅ CREATE BEDASH ENTRY
export const createBedash = async (req: Request, res: Response) => {
  try {
    const { userId, materialType, customDate, targetDate, amount } = req.body;
    const currentUser = (req as any).user;

    if (!["admin", "superadmin"].includes(currentUser.role)) {
      return res
        .status(403)
        .json({ msg: "❌ Only Admin/SuperAdmin can create" });
    }

    // 🐛 FIX 1: Find user and verify if admin owns this user
    const user = await userRepo.findOne({ 
      where: { id: userId }, 
      relations: ["creator"] 
    });
    
    if (!user) return res.status(404).json({ msg: "❌ User not found" });

    // 🔐 Security FIX: Admin cannot create bedash for another admin's user
    if (currentUser.role === "admin" && user.creator?.id !== currentUser.id) {
      return res.status(403).json({ msg: "❌ Access Denied: Not your user" });
    }

    const bedash = bedashRepo.create({
      user,
      createdBy: { id: currentUser.id } as any, // 🐛 FIX 2: Passed as relation object
      materialType: materialType as "flyash" | "bedash",
      customDate,
      targetDate,
      status: "pending",
      amount,
    });

    await bedashRepo.save(bedash);

    return res.json({
      msg: "✅ Bedash message created successfully",
      data: bedash,
    });
  } catch (err) {
    console.error("Error creating bedash:", err);
    res.status(500).json({ msg: "❌ Server error" });
  }
};

// ✅ GET BEDASH LIST
export const getBedashList = async (req: Request, res: Response) => {
  try {
    const currentUser = (req as any).user;
    let bedashList;

    if (currentUser.role === "superadmin") {
      bedashList = await bedashRepo.find({ 
        relations: ["user", "createdBy"],
        order: { id: "DESC" }
      });
    } else if (currentUser.role === "admin") {
      // 🐛 FIX 3: Fixed relation queries for 'creator' and 'createdBy'
      bedashList = await bedashRepo.find({
        where: [
          { createdBy: { id: currentUser.id } },
          { user: { creator: { id: currentUser.id } } },
        ],
        relations: ["user", "createdBy"],
        order: { id: "DESC" }
      });
    } else {
      bedashList = await bedashRepo.find({
        where: { user: { id: currentUser.id } },
        relations: ["user", "createdBy"],
        order: { id: "DESC" }
      });
    }

    // Solve N+1 Issue: Batch fetch material accounts
    const userIds = [...new Set(bedashList.map((b) => b.user.id))];
    let accounts: MaterialAccount[] = [];
    
    if (userIds.length > 0) {
      accounts = await accountRepo.find({
        where: { user: { id: In(userIds) } },
        relations: ["user"],
      });
    }

    const result = bedashList.map((b) => {
      const account = accounts.find(
        (a) => a.user.id === b.user.id && a.materialType === b.materialType
      );

      return {
        id: b.id,
        userName: b.user.name,
        materialType: b.materialType,
        amount: Number(b.amount).toFixed(3), // Exact formatting
        remainingTons: account ? Number(account.remainingTons).toFixed(3) : "0.000",
        status: b.status,
        customDate: b.customDate,
        targetDate: b.targetDate,
        createdAt: b.createdAt,
      };
    });

    res.json(result);
  } catch (err) {
    console.error("Error fetching bedash list:", err);
    res.status(500).json({ msg: "❌ Server error" });
  }
};

// ✅ CONFIRM BEDASH (mark completed & deduct balance)
// ✅ CONFIRM BEDASH (Sirf status update hoga, balance nahi katega)
export const confirmBedash = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const currentUser = (req as any).user;

    if (!["admin", "superadmin"].includes(currentUser.role)) {
      return res
        .status(403)
        .json({ msg: "❌ Only Admin/SuperAdmin can confirm" });
    }

    const bedash = await bedashRepo.findOne({
      where: { id: Number(id) },
      relations: ["user", "user.creator"], 
    });

    if (!bedash) return res.status(404).json({ msg: "❌ Not found" });
    
    // 🔐 Security FIX: Admin cannot confirm another admin's record
    if (currentUser.role === "admin" && bedash.user.creator?.id !== currentUser.id) {
      return res.status(403).json({ msg: "❌ Access Denied: Not your user's record" });
    }

    if (bedash.status === "completed") {
      return res.status(400).json({ msg: "⚠️ Bedash is already confirmed" });
    }

    // ✅ SIRF STATUS COMPLETED KARENGE (Koi Material Minus Nahi Hoga)
    bedash.status = "completed";
    await bedashRepo.save(bedash);

    res.json({ msg: "✅ Bedash marked as completed successfully", data: bedash });
  } catch (err) {
    console.error("Error confirming bedash:", err);
    res.status(500).json({ msg: "❌ Server error" });
  }
};